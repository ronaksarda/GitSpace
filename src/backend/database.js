const { Pool } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const connectionString = process.env.DATABASE_URL;
let isSandbox = connectionString === 'sandbox' || process.env.USE_SANDBOX === 'true';
const SANDBOX_FILE = process.env.SANDBOX_DB_FILE || path.join(__dirname, 'sandbox_db.json');

if (!isSandbox) {
    if (!connectionString) {
        console.error('[DB] FATAL: DATABASE_URL is not set. PostgreSQL is required.');
        process.exit(1);
    }
    if (!process.env.SESSION_SECRET) {
        console.error('[DB] FATAL: SESSION_SECRET is not set. Refusing to start without secure encryption key.');
        process.exit(1);
    }
}

const pool = isSandbox ? null : new Pool({
    connectionString,
    ssl: process.env.DATABASE_SSL_CA
        ? { ca: require('fs').readFileSync(process.env.DATABASE_SSL_CA), rejectUnauthorized: true }
        : { rejectUnauthorized: false },
    max: 20,
    connectionTimeoutMillis: 15000
});

if (pool) {
    pool.on('error', (err, client) => {
        console.error('[DB] Unexpected error on idle client', err);
    });
}

const sessionSecret = isSandbox ? 'sandbox_secret_2026' : process.env.SESSION_SECRET;
const ENCRYPTION_KEY = crypto.scryptSync(sessionSecret, 'gitspace_token_encryption_v1', 32);

let cachedSandboxData = null;
let lastLoadedTime = 0;
let sandboxLoadFailed = false;

function loadSandboxData() {
    try {
        if (fs.existsSync(SANDBOX_FILE)) {
            const stats = fs.statSync(SANDBOX_FILE);
            if (!cachedSandboxData || stats.mtimeMs !== lastLoadedTime) {
                cachedSandboxData = JSON.parse(fs.readFileSync(SANDBOX_FILE, 'utf8'));
                lastLoadedTime = stats.mtimeMs;
                sandboxLoadFailed = false;
            }
            return cachedSandboxData;
        }
    } catch (e) {
        console.error('[SandboxDB] Failed to load sandbox data:', e.message);
        sandboxLoadFailed = true;
    }
    if (!cachedSandboxData) {
        cachedSandboxData = { sessions: {}, users: {}, repos: [] };
    }
    return cachedSandboxData;
}

function saveSandboxData(data) {
    cachedSandboxData = data;
    if (sandboxLoadFailed) {
        console.error('[SandboxDB] Not saving: existing sandbox file could not be parsed. Fix or remove it.');
        return;
    }
    try {
        fs.writeFileSync(SANDBOX_FILE + '.tmp', JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(SANDBOX_FILE + '.tmp', SANDBOX_FILE);
        try {
            lastLoadedTime = fs.statSync(SANDBOX_FILE).mtimeMs;
        } catch (err) {
            lastLoadedTime = Date.now();
        }
    } catch (e) {
        console.error('[SandboxDB] Failed to save sandbox data:', e.message);
    }
}

function encryptToken(text) {
    if (!text) return null;
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decryptToken(text) {
    if (!text) return null;
    try {
        const parts = text.split(':');
        if (parts.length !== 3) {
            console.warn('[DB] Token format mismatch — possible unencrypted legacy token. Returning null.');
            return null;
        }
        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encrypted = parts[2];
        const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        return null;
    }
}

async function initDb() {
    if (isSandbox) {
        console.log('[SandboxDB] Initializing Local JSON Database Sandbox...');
        const data = loadSandboxData();
        saveSandboxData(data);
        console.log('[SandboxDB] Local JSON Database Sandbox Ready.');
        return;
    }
    console.log('[DB] Initializing PostgreSQL Database Schema...');
    let client;
    let retries = 3;
    while (retries > 0) {
        try {
            client = await pool.connect();
            break;
        } catch (err) {
            console.error(`[DB] Connection failed. Retries left: ${retries - 1}. Error: ${err.message}`);
            retries--;
            if (retries === 0) {
                if (process.env.NODE_ENV !== 'development') {
                    // Render's disk is wiped on every deploy, so a sandbox fallback would silently lose data
                    console.error('[DB] FATAL: Could not connect to database. Exiting.');
                    process.exit(1);
                }
                console.error('[DB] FATAL: Could not connect to database to initialize schema. Auto-falling back to Sandbox mode!');
                isSandbox = true;
                const data = loadSandboxData();
                saveSandboxData(data);
                return;
            }
            await new Promise(r => setTimeout(r, 3000));
        }
    }

    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS sessions (
                sid VARCHAR(64) PRIMARY KEY,
                state VARCHAR(255),
                token TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        try {
            const colCheck = await client.query(`
                SELECT column_name FROM information_schema.columns 
                WHERE table_name = 'sessions' AND column_name = 'id' AND table_schema = current_schema()
            `);
            if (colCheck.rows.length > 0) {
                console.log('[DB] Migrating sessions table: renaming column id -> sid');
                await client.query(`ALTER TABLE sessions RENAME COLUMN id TO sid`);
            }
        } catch (migErr) {
        }

        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                login VARCHAR(255) PRIMARY KEY,
                cx FLOAT NOT NULL,
                cy FLOAT NOT NULL,
                avatar TEXT,
                primary_language VARCHAR(100),
                first_seen BIGINT NOT NULL,
                last_login BIGINT NOT NULL
            );
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS repos (
                id SERIAL PRIMARY KEY,
                login VARCHAR(255) REFERENCES users(login) ON DELETE CASCADE,
                name VARCHAR(255) NOT NULL,
                language VARCHAR(100),
                url TEXT,
                size INT,
                stars INT,
                isFork BOOLEAN,
                description TEXT,
                updated_at VARCHAR(100),
                x FLOAT NOT NULL,
                y FLOAT NOT NULL,
                radius FLOAT NOT NULL
            );
        `);

        try {
            await client.query(`ALTER TABLE repos ADD COLUMN IF NOT EXISTS description TEXT;`);
            await client.query(`ALTER TABLE repos ADD COLUMN IF NOT EXISTS updated_at VARCHAR(100);`);
            await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS refreshed_at TIMESTAMPTZ;`);
            await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS repos_etag TEXT;`);
            await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pinned TEXT[] NOT NULL DEFAULT '{}';`);
        } catch (e) {
            console.log('[DB] Note: Migration for repos table description/updated_at skipped or failed', e.message);
        }

        await client.query(`DROP INDEX IF EXISTS idx_repos_name;`).catch(() => {});
        await client.query(`DROP INDEX IF EXISTS idx_users_login_trgm;`).catch(() => {});
        
        await client.query(`CREATE INDEX IF NOT EXISTS idx_users_cx_cy ON users (cx, cy);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_repos_login ON repos (login);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_repos_name_btree ON repos (name);`);
        await client.query(`DROP INDEX IF EXISTS idx_users_login_btree;`).catch(() => {});

        console.log('[DB] PostgreSQL Schema Ready.');
    } catch (err) {
        console.error('[DB] Error initializing database:', err.message);
        throw err; // without its tables every request fails; stop so the host restarts us instead of serving errors
    } finally {
        if (client) client.release();
    }
}

async function createSession(sid, state, token = null) {
    if (isSandbox) {
        const data = loadSandboxData();
        data.sessions[sid] = {
            sid,
            state,
            token: encryptToken(token),
            created_at: new Date().toISOString()
        };
        saveSandboxData(data);
        return;
    }
    await pool.query(
        `INSERT INTO sessions (sid, state, token) VALUES ($1, $2, $3) ON CONFLICT (sid) DO UPDATE SET state = EXCLUDED.state, token = EXCLUDED.token`,
        [sid, state, encryptToken(token)]
    );
}

async function getSessionById(sid) {
    if (isSandbox) {
        const data = loadSandboxData();
        const session = data.sessions[sid];
        if (!session) return null;
        return { ...session, token: decryptToken(session.token) };
    }
    const res = await pool.query(`SELECT sid, state, token, created_at FROM sessions WHERE sid = $1`, [sid]);
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return { ...row, token: decryptToken(row.token) };
}

async function deleteSession(sid) {
    if (isSandbox) {
        const data = loadSandboxData();
        delete data.sessions[sid];
        saveSandboxData(data);
        return;
    }
    await pool.query(`DELETE FROM sessions WHERE sid = $1`, [sid]);
}

// opts.touchLogin = false is used by the background refresh so it does not count as the person being active.
// The language the island is mostly built from, weighted by size and stars. "Other" only if nothing else.
function primaryLanguageOf(repos) {
    const langCounts = {};
    for (const r of repos) {
        const lang = r.language || 'Other';
        langCounts[lang] = (langCounts[lang] || 0) + (r.size || 1) + (r.stars || 0) * 100;
    }
    let primaryLang = 'Other';
    let maxCount = 0;
    for (const [lang, count] of Object.entries(langCounts)) {
        if (count > maxCount && lang !== 'Other') {
            primaryLang = lang;
            maxCount = count;
        }
    }
    return primaryLang;
}

// opts.touchLogin: false for background refreshes. opts.pinned: the account's pinned repo names, kept so the
// 6-hourly refresh picks the same repos as sign-in (undefined keeps what is stored).
async function saveUserLayout(login, cx, cy, avatar, repos, opts = {}) {
    const touchLogin = opts.touchLogin !== false;
    const primaryLang = primaryLanguageOf(repos);
    if (isSandbox) {
        const data = loadSandboxData();
        const now = Date.now();

        data.users[login] = {
            login,
            cx,
            cy,
            avatar,
            primary_language: primaryLang,
            first_seen: data.users[login] ? data.users[login].first_seen : now,
            last_login: touchLogin || !data.users[login] ? now : data.users[login].last_login,
            refreshed_at: data.users[login] ? data.users[login].refreshed_at : null,
            repos_etag: data.users[login] ? data.users[login].repos_etag : null,
            pinned: opts.pinned ?? data.users[login]?.pinned ?? []
        };

        data.repos = data.repos.filter(r => r.login !== login);

        for (const r of repos) {
            data.repos.push({
                login,
                name: r.name,
                language: r.language,
                url: r.url,
                size: r.size,
                stars: r.stars,
                isfork: r.isFork,
                description: r.description,
                updated_at: r.updatedAt,
                x: r.x,
                y: r.y,
                radius: r.radius
            });
        }

        saveSandboxData(data);
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const now = Date.now();
        await client.query(`
            INSERT INTO users (login, cx, cy, avatar, primary_language, first_seen, last_login, pinned)
            VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($9::text[], '{}'))
            ON CONFLICT (login) DO UPDATE SET
                cx = EXCLUDED.cx,
                cy = EXCLUDED.cy,
                avatar = EXCLUDED.avatar,
                primary_language = EXCLUDED.primary_language,
                last_login = CASE WHEN $8 THEN EXCLUDED.last_login ELSE users.last_login END,
                pinned = COALESCE($9::text[], users.pinned)
        `, [login, cx, cy, avatar, primaryLang, now, now, touchLogin, opts.pinned ?? null]);

        await client.query(`DELETE FROM repos WHERE login = $1`, [login]);

        if (repos.length > 0) {
            let valueStrings = [];
            let params = [];
            let paramIndex = 1;

            for (const r of repos) {
                valueStrings.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
                const rx = (r.x !== undefined && r.x !== null) ? r.x : 0;
                const ry = (r.y !== undefined && r.y !== null) ? r.y : 0;
                params.push(login, r.name, r.language, r.url, r.size, r.stars, r.isFork, r.description || '', r.updatedAt || null, rx, ry, r.radius);
            }

            await client.query(`
                INSERT INTO repos (login, name, language, url, size, stars, isFork, description, updated_at, x, y, radius)
                VALUES ${valueStrings.join(', ')}
            `, params);
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function getChunks(minX, minY, maxX, maxY) {
    const PADDING = 600;
    const qMinX = minX - PADDING;
    const qMaxX = maxX + PADDING;
    const qMinY = minY - PADDING;
    const qMaxY = maxY + PADDING;

    if (isSandbox) {
        const data = loadSandboxData();
        const userMap = {};
        const ONE_WEEK_MS = 7 * 24 * 3600 * 1000;
        const now = Date.now();

        for (const u of Object.values(data.users)) {
            if (u.cx >= qMinX && u.cx <= qMaxX && u.cy >= qMinY && u.cy <= qMaxY) {
                userMap[u.login] = {
                    cx: u.cx,
                    cy: u.cy,
                    avatar: u.avatar,
                    primaryLanguage: u.primary_language,
                    isActive: (now - (u.last_login || u.first_seen || 0)) < ONE_WEEK_MS,
                    pinned: u.pinned || [],
                    buildings: []
                };
            }
        }

        for (const r of data.repos) {
            if (userMap[r.login]) {
                userMap[r.login].buildings.push({
                    name: r.name,
                    language: r.language,
                    url: r.url,
                    size: r.size,
                    stars: r.stars,
                    isFork: r.isfork,
                    description: r.description,
                    updatedAt: r.updated_at,
                    x: r.x,
                    y: r.y,
                    radius: r.radius
                });
            }
        }

        return { users: markPinned(userMap) };
    }

    const client = await pool.connect();
    try {
        const usersRes = await client.query(`
            SELECT login, cx, cy, avatar, primary_language, first_seen, last_login, pinned
            FROM users
            WHERE cx >= $1 AND cx <= $2 AND cy >= $3 AND cy <= $4
            LIMIT 1000
        `, [qMinX, qMaxX, qMinY, qMaxY]);

        if (usersRes.rows.length === 0) return { users: {} };

        const userMap = {};
        const logins = [];
        const ONE_WEEK_MS = 7 * 24 * 3600 * 1000;
        const now = Date.now();

        for (const u of usersRes.rows) {
            userMap[u.login] = {
                cx: u.cx,
                cy: u.cy,
                avatar: u.avatar,
                primaryLanguage: u.primary_language,
                isActive: (now - (u.last_login || u.first_seen || 0)) < ONE_WEEK_MS,
                pinned: u.pinned || [],
                buildings: []
            };
            logins.push(u.login);
        }

        const reposRes = await client.query(`
            SELECT login, name, language, url, size, stars, isfork, description, updated_at, x, y, radius 
            FROM repos 
            WHERE login = ANY($1)
        `, [logins]);

        for (const r of reposRes.rows) {
            if (userMap[r.login]) {
                userMap[r.login].buildings.push({
                    name: r.name,
                    language: r.language,
                    url: r.url,
                    size: r.size,
                    stars: r.stars,
                    isFork: r.isfork,
                    description: r.description,
                    updatedAt: r.updated_at,
                    x: r.x,
                    y: r.y,
                    radius: r.radius
                });
            }
        }

        return { users: markPinned(userMap) };
    } finally {
        client.release();
    }
}

// Each building gets pin = its place in the owner's GitHub pinned list, so "top repos" can follow the owner's own pick.
function pinRepos(repos, pinned = []) {
    const at = new Map(pinned.map((name, i) => [name.toLowerCase(), i]));
    return repos.map(r => (at.has(r.name.toLowerCase()) ? { ...r, pin: at.get(r.name.toLowerCase()) } : r));
}

function markPinned(userMap) {
    for (const u of Object.values(userMap)) { u.buildings = pinRepos(u.buildings, u.pinned); delete u.pinned; }
    return userMap;
}

async function getUser(login) {
    if (isSandbox) {
        const data = loadSandboxData();
        return data.users[login] || null;
    }
    const res = await pool.query(`SELECT * FROM users WHERE login = $1`, [login]);
    return res.rows[0] || null;
}

async function getRepos(login) {
    if (isSandbox) {
        const data = loadSandboxData();
        return data.repos.filter(r => r.login === login);
    }
    const res = await pool.query(`SELECT * FROM repos WHERE login = $1`, [login]);
    return res.rows;
}

async function updateLastLogin(login) {
    const now = Date.now();
    if (isSandbox) {
        const data = loadSandboxData();
        if (data.users[login]) {
            data.users[login].last_login = now;
            saveSandboxData(data);
        }
        return;
    }
    await pool.query(`UPDATE users SET last_login = $1 WHERE login = $2`, [now, login]);
}

async function getStats() {
    if (isSandbox) {
        const data = loadSandboxData();
        return {
            totalUsers: Object.keys(data.users).length,
            totalRepos: data.repos.length
        };
    }
    const usersRes = await pool.query(`SELECT COUNT(*) FROM users`);
    const reposRes = await pool.query(`SELECT COUNT(*) FROM repos`);
    return {
        totalUsers: parseInt(usersRes.rows[0].count),
        totalRepos: parseInt(reposRes.rows[0].count)
    };
}

async function getCitizens(limit = 50, offset = 0) {
    if (isSandbox) {
        const data = loadSandboxData();
        const citizens = [];
        for (const u of Object.values(data.users)) {
            const userRepos = data.repos.filter(r => r.login === u.login);
            const totalStars = userRepos.reduce((sum, r) => sum + (r.stars || 0), 0);
            citizens.push({
                login: u.login,
                avatar: u.avatar,
                primaryLanguage: u.primary_language,
                x: u.cx,
                y: u.cy,
                repoCount: userRepos.length,
                totalStars: totalStars
            });
        }
        citizens.sort((a, b) => b.totalStars - a.totalStars || b.repoCount - a.repoCount);
        return citizens.slice(offset, offset + limit);
    }

    const query = `
        SELECT 
            u.login, 
            u.avatar, 
            u.primary_language as "primaryLanguage", 
            u.cx as x, 
            u.cy as y,
            COUNT(r.id)::int as "repoCount",
            COALESCE(SUM(r.stars), 0)::int as "totalStars"
        FROM users u
        LEFT JOIN repos r ON u.login = r.login
        GROUP BY u.login, u.avatar, u.primary_language, u.cx, u.cy
        ORDER BY "totalStars" DESC, "repoCount" DESC
        LIMIT $1 OFFSET $2;
    `;
    const res = await pool.query(query, [limit, offset]);
    return res.rows;
}

// Visitors start in open sky beside a random island, so no one person is featured.
async function getSpawnPoint() {
    let u;
    if (isSandbox) {
        const users = Object.values(loadSandboxData().users);
        u = users[Math.floor(Math.random() * users.length)];
    } else {
        u = (await pool.query('SELECT cx, cy FROM users ORDER BY random() LIMIT 1')).rows[0];
    }
    return u ? { x: u.cx, y: u.cy + 900 } : { x: 0, y: 0 };
}

async function searchGlobal(q) {
    q = `%${q}%`;
    if (isSandbox) {
        const data = loadSandboxData();
        const cleanQ = q.replace(/%/g, '').toLowerCase();

        const matches = [];
        for (const u of Object.values(data.users)) {
            if (u.login.toLowerCase().includes(cleanQ)) {
                matches.push({ type: 'user', login: u.login, name: u.login, avatar: u.avatar, x: u.cx, y: u.cy, cx: u.cx, cy: u.cy });
                if (matches.length >= 10) break;
            }
        }
        for (const r of data.repos) {
            if (r.name.toLowerCase().includes(cleanQ)) {
                const u = data.users[r.login] || { avatar: null, cx: 0, cy: 0 };
                matches.push({
                    type: 'repo', id: r.name, login: r.login, name: r.name, language: r.language, url: r.url,
                    size: r.size, stars: r.stars, isFork: r.isfork, description: r.description, updatedAt: r.updated_at, x: r.x, y: r.y, radius: r.radius,
                    avatar: u.avatar, cx: u.cx, cy: u.cy
                });
                if (matches.length >= 20) break;
            }
        }
        return matches;
    }
    const usersRes = await pool.query(`SELECT login, avatar, cx, cy FROM users WHERE login ILIKE $1 LIMIT 10`, [q]);
    const reposRes = await pool.query(`
        SELECT r.name, r.language, r.url, r.login, r.size, r.stars, r.isfork, r.description, r.updated_at, r.x, r.y, r.radius, u.avatar, u.cx, u.cy 
        FROM repos r 
        JOIN users u ON r.login = u.login 
        WHERE r.name ILIKE $1
        LIMIT 10
    `, [q]);

    const matches = [];
    for (const u of usersRes.rows) {
        matches.push({ type: 'user', login: u.login, name: u.login, avatar: u.avatar, x: u.cx, y: u.cy, cx: u.cx, cy: u.cy });
    }
    for (const r of reposRes.rows) {
        matches.push({
            type: 'repo', id: r.name, login: r.login, name: r.name, language: r.language, url: r.url,
            size: r.size, stars: r.stars, isFork: r.isfork, description: r.description, updatedAt: r.updated_at, x: r.x, y: r.y, radius: r.radius,
            avatar: r.avatar, cx: r.cx, cy: r.cy
        });
    }
    return matches;
}

// Session cleanup — delete sessions older than 24h
setInterval(() => {
    if (isSandbox) {
        try {
            const data = loadSandboxData();
            const now = Date.now();
            const ONE_DAY_MS = 24 * 3600 * 1000;
            let deletedCount = 0;
            for (const [sid, session] of Object.entries(data.sessions)) {
                const createdTime = new Date(session.created_at).getTime();
                if (now - createdTime > ONE_DAY_MS) {
                    delete data.sessions[sid];
                    deletedCount++;
                }
            }
            if (deletedCount > 0) {
                saveSandboxData(data);
                console.log(`[SandboxDB] Deleted ${deletedCount} expired sessions.`);
            }
        } catch (err) {
            console.error('[SandboxDB] Session cleanup error:', err.message);
        }
        return;
    }
    pool.query("DELETE FROM sessions WHERE created_at < NOW() - INTERVAL '24 hours'")
        .then(res => {
            if (res.rowCount > 0) {
                console.log(`[Cleanup] Deleted ${res.rowCount} expired sessions.`);
            }
        })
        .catch(err => console.error('[Cleanup] Session cleanup error:', err.message));
}, 3600000).unref(); // unref so a test process can exit

// Islands keep clear of each other based on both sizes (spread = farthest building from centre).
async function findFreeSpot(startX, startY, newSpread = 800) {
    let existingUsers;
    if (isSandbox) {
        const data = loadSandboxData();
        const spreadOf = {};
        for (const r of data.repos) {
            const u = data.users[r.login];
            if (u) spreadOf[r.login] = Math.max(spreadOf[r.login] || 0, Math.hypot(r.x - u.cx, r.y - u.cy));
        }
        existingUsers = Object.values(data.users).map(u => ({ cx: u.cx, cy: u.cy, spread: spreadOf[u.login] || 0 }));
    } else {
        existingUsers = (await pool.query(`
            SELECT u.cx, u.cy, COALESCE(MAX(SQRT(POWER(r.x - u.cx, 2) + POWER(r.y - u.cy, 2))), 0) AS spread
            FROM users u LEFT JOIN repos r ON r.login = u.login
            GROUP BY u.login, u.cx, u.cy`)).rows.map(u => ({ cx: u.cx, cy: u.cy, spread: Number(u.spread) }));
    }
    // Radius on screen = spread + 60; the rock underside and name sign need ~25% more, plus a sea gap.
    const clearance = (s) => (Math.max(120, s + 90)) * 1.25;

    const MAX_STEPS = 5000; // ~70k units out; past that just accept the last spot
    let x = startX, y = startY, step = 0;
    while (step < MAX_STEPS) {
        let collision = false;
        for (const u of existingUsers) {
            if (Math.hypot(u.cx - x, u.cy - y) < clearance(Math.min(u.spread, 560)) + clearance(Math.min(newSpread, 560)) + 900) {
                collision = true;
                break;
            }
        }
        if (!collision) return { x, y };
        step++;
        const angle = step * 2.39996; 
        const radius = Math.sqrt(step) * 160; // fine steps so islands pack tightly
        x = startX + Math.cos(angle) * radius;
        y = startY + Math.sin(angle) * radius;
    }
    return { x, y };
}


// ---------- Background refresh support (see refresh.js) ----------

// Islands not refreshed within staleHours, oldest first (never-refreshed first).
async function getRefreshQueue(limit, staleHours) {
    const cutoff = Date.now() - staleHours * 3600 * 1000;
    if (isSandbox) {
        return Object.values(loadSandboxData().users)
            .filter(u => !u.refreshed_at || u.refreshed_at < cutoff)
            .sort((a, b) => (a.refreshed_at || 0) - (b.refreshed_at || 0))
            .slice(0, limit)
            .map(u => ({ login: u.login, cx: u.cx, cy: u.cy, avatar: u.avatar, repos_etag: u.repos_etag || null, pinned: u.pinned || [] }));
    }
    const res = await pool.query(
        `SELECT login, cx, cy, avatar, repos_etag, pinned FROM users
         WHERE refreshed_at IS NULL OR refreshed_at < to_timestamp($1 / 1000.0)
         ORDER BY refreshed_at ASC NULLS FIRST LIMIT $2`, [cutoff, limit]);
    return res.rows;
}

async function markRefreshed(login, etag) {
    if (isSandbox) {
        const data = loadSandboxData();
        if (data.users[login]) { data.users[login].refreshed_at = Date.now(); data.users[login].repos_etag = etag || null; saveSandboxData(data); }
        return;
    }
    await pool.query(`UPDATE users SET refreshed_at = now(), repos_etag = $2 WHERE login = $1`, [login, etag || null]);
}

// Returns a release function if this process got the lock, or null if another one holds it.
// Runs fn while holding the one "place a new island" lock, so two sign-ins in the same second cannot both
// pick the same free spot. A queue in this process, plus a Postgres advisory lock for other processes.
let spawnQueue = Promise.resolve();
function withSpawnLock(fn) {
    const run = spawnQueue.then(async () => {
        if (isSandbox) return fn();
        const client = await pool.connect();
        try {
            await client.query(`SELECT pg_advisory_lock(7331)`);
            return await fn();
        } finally {
            await client.query(`SELECT pg_advisory_unlock(7331)`).catch(() => {});
            client.release();
        }
    });
    spawnQueue = run.catch(() => {});
    return run;
}

async function tryJobLock(name) {
    if (isSandbox) return async () => {};
    let key = 0;
    for (const ch of name) key = (key * 31 + ch.charCodeAt(0)) | 0;
    const client = await pool.connect();
    const got = (await client.query(`SELECT pg_try_advisory_lock($1) AS ok`, [key])).rows[0].ok;
    if (!got) { client.release(); return null; }
    return async () => { try { await client.query(`SELECT pg_advisory_unlock($1)`, [key]); } finally { client.release(); } };
}

module.exports = {
    isSandbox: () => isSandbox,
    raw: () => ({ pool, loadSandboxData, saveSandboxData }), // for missionsStore.js
    getRefreshQueue,
    markRefreshed,
    tryJobLock,
    withSpawnLock,
    initDb,
    createSession,
    getSessionById,
    deleteSession,
    saveUserLayout,
    getChunks,
    getUser,
    getRepos,
    pinRepos,
    updateLastLogin,
    getStats,
    getCitizens,
    getSpawnPoint,
    searchGlobal,
    findFreeSpot
};
