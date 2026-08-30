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

function loadSandboxData() {
    try {
        if (fs.existsSync(SANDBOX_FILE)) {
            const stats = fs.statSync(SANDBOX_FILE);
            if (!cachedSandboxData || stats.mtimeMs !== lastLoadedTime) {
                cachedSandboxData = JSON.parse(fs.readFileSync(SANDBOX_FILE, 'utf8'));
                lastLoadedTime = stats.mtimeMs;
            }
            return cachedSandboxData;
        }
    } catch (e) {
        console.error('[SandboxDB] Failed to load sandbox data:', e.message);
    }
    if (!cachedSandboxData) {
        cachedSandboxData = { sessions: {}, users: {}, repos: [] };
    }
    return cachedSandboxData;
}

let sandboxTrie = null;
let lastTrieBuildTime = 0;

class BackendTrieNode {
    constructor() {
        this.children = {};
        this.items = [];
    }
}

function insertBackendTrie(trie, key, item) {
    let node = trie;
    for (const char of key) {
        if (!node.children[char]) node.children[char] = new BackendTrieNode();
        node = node.children[char];
        if (node.items.length < 10) node.items.push(item);
    }
}

function searchBackendTrie(trie, prefix) {
    let node = trie;
    for (const char of prefix) {
        if (!node.children[char]) return [];
        node = node.children[char];
    }
    return node.items;
}

function buildSandboxTrie(data) {
    const root = new BackendTrieNode();
    for (const u of Object.values(data.users)) {
        insertBackendTrie(root, u.login.toLowerCase(), {
            type: 'user', login: u.login, avatar: u.avatar, primaryLanguage: u.primary_language,
            x: u.cx, y: u.cy, repoCount: 0, totalStars: 0
        });
    }
    for (const r of data.repos) {
        insertBackendTrie(root, r.name.toLowerCase(), {
            type: 'repo', login: r.login, name: r.name, language: r.language, url: r.url,
            size: r.size, stars: r.stars, x: r.x, y: r.y
        });
    }
    return root;
}

function saveSandboxData(data) {
    cachedSandboxData = data;
    try {
        fs.writeFileSync(SANDBOX_FILE, JSON.stringify(data, null, 2), 'utf8');
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
        } catch (e) {
            console.log('[DB] Note: Migration for repos table description/updated_at skipped or failed', e.message);
        }

        await client.query(`DROP INDEX IF EXISTS idx_repos_name;`).catch(() => {});
        await client.query(`DROP INDEX IF EXISTS idx_users_login_trgm;`).catch(() => {});
        
        await client.query(`CREATE INDEX IF NOT EXISTS idx_users_cx_cy ON users (cx, cy);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_repos_login ON repos (login);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_repos_name_btree ON repos (name);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_users_login_btree ON users (login);`);

        console.log('[DB] PostgreSQL Schema Ready.');
    } catch (err) {
        console.error('[DB] Error initializing database:', err.message);
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

async function getSessionByState(state) {
    if (isSandbox) {
        if (!state) return null;
        const data = loadSandboxData();
        const session = Object.values(data.sessions).find(s => s.state === state);
        if (!session) return null;
        return { ...session, token: decryptToken(session.token) };
    }
    if (!state) return null;
    const res = await pool.query(`SELECT sid, state, token, created_at FROM sessions WHERE state = $1`, [state]);
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return { ...row, token: decryptToken(row.token) };
}

async function updateSessionToken(sid, token) {
    if (isSandbox) {
        const data = loadSandboxData();
        if (data.sessions[sid]) {
            data.sessions[sid].token = encryptToken(token);
            saveSandboxData(data);
        }
        return;
    }
    await pool.query(`UPDATE sessions SET token = $1 WHERE sid = $2`, [encryptToken(token), sid]);
}

async function updateSessionState(sid, state) {
    if (isSandbox) {
        const data = loadSandboxData();
        if (data.sessions[sid]) {
            data.sessions[sid].state = state;
            saveSandboxData(data);
        }
        return;
    }
    await pool.query(`UPDATE sessions SET state = $1 WHERE sid = $2`, [state, sid]);
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

async function saveUserLayout(login, cx, cy, avatar, repos) {
    if (isSandbox) {
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

        const data = loadSandboxData();
        const now = Date.now();

        data.users[login] = {
            login,
            cx,
            cy,
            avatar,
            primary_language: primaryLang,
            first_seen: data.users[login] ? data.users[login].first_seen : now,
            last_login: now
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

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const now = Date.now();
        await client.query(`
            INSERT INTO users (login, cx, cy, avatar, primary_language, first_seen, last_login)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (login) DO UPDATE SET 
                cx = EXCLUDED.cx, 
                cy = EXCLUDED.cy, 
                avatar = EXCLUDED.avatar, 
                primary_language = EXCLUDED.primary_language,
                last_login = EXCLUDED.last_login
        `, [login, cx, cy, avatar, primaryLang, now, now]);

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
        const logins = [];
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
                    buildings: []
                };
                logins.push(u.login);
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

        return { users: userMap };
    }

    const client = await pool.connect();
    try {
        const usersRes = await client.query(`
            SELECT login, cx, cy, avatar, primary_language, first_seen, last_login 
            FROM users 
            WHERE cx >= $1 AND cx <= $2 AND cy >= $3 AND cy <= $4
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

        return { users: userMap };
    } finally {
        client.release();
    }
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

async function getSpawnPoint() {
    if (isSandbox) {
        const data = loadSandboxData();
        const users = Object.values(data.users);
        if (users.length > 0) {
            return { x: users[0].cx, y: users[0].cy };
        }
        return { x: 0, y: 0 };
    }
    const res = await pool.query(`SELECT cx as x, cy as y FROM users ORDER BY last_login DESC LIMIT 1`);
    return res.rows[0] || { x: 0, y: 0 };
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
    if (!isSandbox) {
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
}, 3600000);

async function findFreeSpot(startX, startY, minDistance = 2000) {
    if (isSandbox) {
        const data = loadSandboxData();
        let x = startX, y = startY, step = 0;
        while (true) {
            let collision = false;
            for (const u of Object.values(data.users)) {
                if (Math.sqrt(Math.pow(u.cx - x, 2) + Math.pow(u.cy - y, 2)) < minDistance) {
                    collision = true;
                    break;
                }
            }
            if (!collision) return { x, y };
            step++;
            const angle = step * 2.39996;
            const radius = Math.sqrt(step) * 1000;
            x = startX + Math.cos(angle) * radius;
            y = startY + Math.sin(angle) * radius;
        }
    }
    const res = await pool.query('SELECT cx, cy FROM users');
    const existingUsers = res.rows;

    let x = startX, y = startY, step = 0;
    while (true) {
        let collision = false;
        for (const u of existingUsers) {
            if (Math.sqrt(Math.pow(u.cx - x, 2) + Math.pow(u.cy - y, 2)) < minDistance) {
                collision = true;
                break;
            }
        }
        if (!collision) return { x, y };
        step++;
        const angle = step * 2.39996; 
        const radius = Math.sqrt(step) * 1000;
        x = startX + Math.cos(angle) * radius;
        y = startY + Math.sin(angle) * radius;
    }
}

module.exports = {
    initDb,
    createSession,
    getSessionById,
    getSessionByState,
    updateSessionToken,
    updateSessionState,
    deleteSession,
    saveUserLayout,
    getChunks,
    getUser,
    getRepos,
    updateLastLogin,
    getStats,
    getCitizens,
    getSpawnPoint,
    searchGlobal,
    findFreeSpot
};
