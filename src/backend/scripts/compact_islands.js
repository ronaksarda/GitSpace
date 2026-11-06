// Packs existing islands closer together around the centre, oldest users first.
// Each island keeps its own layout; the island and its buildings move together.
//
//   node src/backend/scripts/compact_islands.js                 dry run against DATABASE_URL
//   node src/backend/scripts/compact_islands.js --apply         write (saves a backup JSON first)
//   node src/backend/scripts/compact_islands.js --sandbox <file> [--apply]
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const sandboxFile = args.includes('--sandbox') ? args[args.indexOf('--sandbox') + 1] : null;

// Same rule as findFreeSpot in database.js: radius = spread + 60, plus 25% for the rock underside and sign.
const clearance = (spread) => Math.max(120, spread + 60) * 1.25;
const SEA_GAP = 250;

function pack(users) {
    const placed = [];
    for (const u of users) {
        let x = 0, y = 0, step = 0;
        for (;;) {
            const hit = placed.some(p => Math.hypot(p.x - x, p.y - y) < clearance(p.spread) + clearance(u.spread) + SEA_GAP);
            if (!hit) break;
            step++;
            const r = Math.sqrt(step) * 160;
            x = Math.cos(step * 2.39996) * r;
            y = Math.sin(step * 2.39996) * r;
        }
        placed.push({ ...u, x: Math.round(x), y: Math.round(y) });
    }
    return placed;
}

function spreadOf(u, repos) {
    return repos.reduce((m, r) => Math.max(m, Math.hypot(r.x - u.cx, r.y - u.cy)), 0);
}

async function main() {
    if (sandboxFile) {
        const data = JSON.parse(fs.readFileSync(sandboxFile, 'utf8'));
        const byLogin = {};
        for (const r of data.repos) (byLogin[r.login] = byLogin[r.login] || []).push(r);
        const users = Object.values(data.users)
            .sort((a, b) => (a.first_seen || 0) - (b.first_seen || 0))
            .map(u => ({ login: u.login, cx: u.cx, cy: u.cy, spread: spreadOf(u, byLogin[u.login] || []) }));
        const packed = pack(users);
        report(users, packed);
        if (!apply) return;
        fs.writeFileSync(sandboxFile + '.before-compact.json', JSON.stringify(data));
        for (const p of packed) {
            const u = data.users[p.login], dx = p.x - u.cx, dy = p.y - u.cy;
            u.cx = p.x; u.cy = p.y;
            for (const r of byLogin[p.login] || []) { r.x += dx; r.y += dy; }
        }
        fs.writeFileSync(sandboxFile, JSON.stringify(data));
        console.log('Applied. Backup:', sandboxFile + '.before-compact.json');
        return;
    }

    const { Pool } = require('pg');
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    const client = await pool.connect();
    try {
        const users = (await client.query(`
            SELECT u.login, u.cx, u.cy, COALESCE(MAX(SQRT(POWER(r.x - u.cx, 2) + POWER(r.y - u.cy, 2))), 0) AS spread
            FROM users u LEFT JOIN repos r ON r.login = u.login
            GROUP BY u.login, u.cx, u.cy, u.first_seen
            ORDER BY u.first_seen ASC NULLS LAST`)).rows.map(u => ({ ...u, spread: Number(u.spread) }));
        const packed = pack(users);
        report(users, packed);
        if (!apply) return;
        const backup = path.join(process.cwd(), `islands-before-compact-${Date.now()}.json`);
        fs.writeFileSync(backup, JSON.stringify(users));
        await client.query('BEGIN');
        for (const p of packed) {
            const dx = p.x - p.cx, dy = p.y - p.cy;
            await client.query('UPDATE users SET cx = $1, cy = $2 WHERE login = $3', [p.x, p.y, p.login]);
            await client.query('UPDATE repos SET x = x + $1, y = y + $2 WHERE login = $3', [dx, dy, p.login]);
        }
        await client.query('COMMIT');
        console.log('Applied. Backup of old positions:', backup);
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
    } finally {
        client.release();
        await pool.end();
    }
}

function report(before, after) {
    const extent = (list, kx, ky) => Math.round(Math.max(...list.map(u => Math.hypot(u[kx], u[ky]))));
    console.log(`${after.length} islands. Farthest from centre: ${extent(before, 'cx', 'cy')} -> ${extent(after, 'x', 'y')} units.`);
    if (!apply) console.log('Dry run. Add --apply to write.');
}

main().catch(e => { console.error(e.message); process.exit(1); });
