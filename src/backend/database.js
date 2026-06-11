const { Pool } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const connectionString = process.env.DATABASE_URL;
// Force Postgres if a real URL is provided, even if USE_SANDBOX is accidentally left on
const isSandbox = (connectionString === 'sandbox' || process.env.USE_SANDBOX === 'true') 
                  && !(connectionString && connectionString.startsWith('postgres'));
const SANDBOX_FILE = process.env.SANDBOX_DB_FILE || path.join(__dirname, 'sandbox_db.json');

if (!isSandbox) {
    if (!connectionString) {
        console.error('[DB] FATAL: DATABASE_URL is not set. PostgreSQL is required.');
        process.exit(1);
    }
    if (!process.env.SESSION_SECRET) {
        console.warn('[DB] WARNING: SESSION_SECRET is not set. Using insecure fallback for session encryption.');
        process.env.SESSION_SECRET = 'fallback_secret_do_not_use_in_prod';
    }
}

const pool = isSandbox ? null : new Pool({
    connectionString,
    ssl: process.env.DATABASE_SSL_CA
        ? { ca: require('fs').readFileSync(process.env.DATABASE_SSL_CA), rejectUnauthorized: true }
        : { rejectUnauthorized: false },
    max: 20, // Cap connections to prevent DB exhaustion DDoS
    connectionTimeoutMillis: 5000 // Prevent app from hanging if DB is unresponsive
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

// Initialize DB schema
async function initDb() {
    if (isSandbox) {
        console.log('[SandboxDB] Initializing Local JSON Database Sandbox...');
        const data = loadSandboxData();
        saveSandboxData(data); // ensure the structure is written
        console.log('[SandboxDB] Local JSON Database Sandbox Ready.');
        return;
    }
    console.log('[DB] Initializing PostgreSQL Database Schema...');
    let client;
    try {
        client = await pool.connect();
        await client.query(`
            CREATE TABLE IF NOT EXISTS sessions (
                sid VARCHAR(64) PRIMARY KEY,
                state VARCHAR(255),
                token TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Migrate old schema: rename 'id' column to 'sid' if it exists
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
            // Column already named sid or migration not needed
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

        // Migration for existing tables
        try {
            await client.query(`ALTER TABLE repos ADD COLUMN IF NOT EXISTS description TEXT;`);
            await client.query(`ALTER TABLE repos ADD COLUMN IF NOT EXISTS updated_at VARCHAR(100);`);
        } catch (e) {
            console.log('[DB] Note: Migration for repos table description/updated_at skipped or failed', e.message);
        }

        // Indexes and Extensions
        // Note: Dropped pg_trgm GIN indexes as they consume massive amounts of memory on the Supabase Free Tier.
        await client.query(`DROP INDEX IF EXISTS idx_repos_name;`).catch(() => {});
        await client.query(`DROP INDEX IF EXISTS idx_users_login_trgm;`).catch(() => {});
        
        await client.query(`CREATE INDEX IF NOT EXISTS idx_users_cx_cy ON users (cx, cy);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_repos_login ON repos (login);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_repos_name_btree ON repos (name);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_users_login_btree ON users (login);`);

        // Disable Row Level Security (RLS) because all queries go through the Node backend which is trusted.
        // RLS being enabled without policies caused all SELECTs to return 0 rows.
        await client.query(`ALTER TABLE sessions DISABLE ROW LEVEL SECURITY;`).catch(() => {});
        await client.query(`ALTER TABLE users DISABLE ROW LEVEL SECURITY;`).catch(() => {});
        await client.query(`ALTER TABLE repos DISABLE ROW LEVEL SECURITY;`).catch(() => {});

        console.log('[DB] PostgreSQL Schema Ready. RLS Disabled.');
    } catch (err) {
        console.error('[DB] Error initializing database:', err.message);
    } finally {
        if (client) client.release();
    }
}

// --- Session Management (all use `sid` column consistently) ---
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

// --- Spatial Data Management ---
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

        // Save user
        data.users[login] = {
            login,
            cx,
            cy,
            avatar,
            primary_language: primaryLang,
            first_seen: data.users[login] ? data.users[login].first_seen : now,
            last_login: now
        };

        // Remove old repos
        data.repos = data.repos.filter(r => r.login !== login);

        // Add new repos
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
        console.error('[DB] Transaction failed in saveUserLayout:', err);
        throw err;
    } finally {
        client.release();
    }
}

async function getChunks(minX, minY, maxX, maxY) {
    const PADDING = 600; // coordinate padding buffer to prevent islands from vanishing abruptly
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
                    firstSeen: u.first_seen,
                    isActive: (now - u.last_login) < ONE_WEEK_MS,
                    repos: []
                };
                logins.push(u.login);
            }
        }

        for (const r of data.repos) {
            if (userMap[r.login]) {
                userMap[r.login].repos.push({
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

    const usersRes = await pool.query(`
        SELECT login, cx, cy, avatar, primary_language, first_seen, last_login FROM users 
        WHERE cx >= $1 AND cx <= $2 AND cy >= $3 AND cy <= $4
    `, [qMinX, qMaxX, qMinY, qMaxY]);

    if (usersRes.rows.length === 0) {
        return { users: {} };
    }

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
            firstSeen: u.first_seen,
            isActive: (now - u.last_login) < ONE_WEEK_MS,
            repos: []
        };
        logins.push(u.login);
    }

    const reposRes = await pool.query(`
        SELECT login, name, language, url, size, stars, isfork, description, updated_at, x, y, radius FROM repos WHERE login = ANY($1::varchar[])
    `, [logins]);

    for (const r of reposRes.rows) {
        if (userMap[r.login]) {
            userMap[r.login].repos.push({
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

async function getUser(login) {
    if (isSandbox) {
        const data = loadSandboxData();
        const u = data.users[login];
        if (!u) return null;
        return {
            login: u.login,
            cx: u.cx,
            cy: u.cy,
            avatar: u.avatar,
            primary_language: u.primary_language
        };
    }
    const res = await pool.query(`SELECT login, cx, cy, avatar, primary_language FROM users WHERE login = $1`, [login]);
    return res.rows.length > 0 ? res.rows[0] : null;
}

async function getRepos(login) {
    if (isSandbox) {
        const data = loadSandboxData();
        return data.repos
            .filter(r => r.login === login)
            .map(r => ({
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
            }));
    }
    const res = await pool.query(`SELECT name, language, url, size, stars, isfork, description, updated_at, x, y, radius FROM repos WHERE login = $1`, [login]);
    return res.rows.map(r => ({
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
    }));
}

async function updateLastLogin(login) {
    if (isSandbox) {
        const data = loadSandboxData();
        if (data.users[login]) {
            data.users[login].last_login = Date.now();
            saveSandboxData(data);
        }
        return;
    }
    await pool.query(`UPDATE users SET last_login = $1 WHERE login = $2`, [Date.now(), login]);
}

async function getStats() {
    if (isSandbox) {
        const data = loadSandboxData();
        return {
            totalUsers: Object.keys(data.users).length,
            totalRepos: data.repos.length
        };
    }
    const usersRes = await pool.query(`SELECT COUNT(*) AS count FROM users`);
    const reposRes = await pool.query(`SELECT COUNT(*) AS count FROM repos`);
    return {
        totalUsers: parseInt(usersRes.rows[0].count, 10),
        totalRepos: parseInt(reposRes.rows[0].count, 10)
    };
}

async function getCitizens(limit = 50, offset = 0) {
    if (isSandbox) {
        const data = loadSandboxData();
        const userStars = {};
        const userRepoCounts = {};

        for (const u of Object.keys(data.users)) {
            userStars[u] = 0;
            userRepoCounts[u] = 0;
        }

        for (const r of data.repos) {
            if (data.users[r.login]) {
                userRepoCounts[r.login]++;
                userStars[r.login] += (r.stars || 0);
            }
        }

        const citizensList = Object.values(data.users).map(u => ({
            login: u.login,
            avatar: u.avatar,
            primaryLanguage: u.primary_language,
            x: u.cx,
            y: u.cy,
            repoCount: userRepoCounts[u.login] || 0,
            totalStars: userStars[u.login] || 0
        }));

        citizensList.sort((a, b) => b.totalStars - a.totalStars || a.login.localeCompare(b.login));

        return citizensList.slice(offset, offset + limit);
    }
    const res = await pool.query(`
        SELECT u.login, u.avatar, u.primary_language, u.cx, u.cy,
               COUNT(r.id) AS repo_count,
               COALESCE(SUM(r.stars), 0) AS total_stars
        FROM users u
        LEFT JOIN repos r ON r.login = u.login
        GROUP BY u.login, u.avatar, u.primary_language, u.cx, u.cy
        ORDER BY total_stars DESC
        LIMIT $1 OFFSET $2
    `, [limit, offset]);
    return res.rows.map(row => ({
        login: row.login,
        avatar: row.avatar,
        primaryLanguage: row.primary_language,
        x: row.cx,
        y: row.cy,
        repoCount: parseInt(row.repo_count, 10),
        totalStars: parseInt(row.total_stars, 10)
    }));
}

async function getSpawnPoint() {
    if (isSandbox) {
        const data = loadSandboxData();
        const users = Object.values(data.users);
        return users.length > 0 ? { x: users[0].cx, y: users[0].cy } : null;
    }
    const res = await pool.query(`SELECT cx, cy FROM users LIMIT 1`);
    return res.rows.length > 0 ? { x: res.rows[0].cx, y: res.rows[0].cy } : null;
}

async function searchGlobal(query) {
    const escaped = query.replace(/%/g, '\\%').replace(/_/g, '\\_');
    const q = `${escaped}%`;

    if (isSandbox) {
        const data = loadSandboxData();
        const lowerQ = query.toLowerCase().trim();

        if (!sandboxTrie || lastTrieBuildTime !== lastLoadedTime) {
            sandboxTrie = buildSandboxTrie(data);
            lastTrieBuildTime = lastLoadedTime;
        }

        return searchBackendTrie(sandboxTrie, lowerQ);
    }
    if (!isSandbox) {
        // Fast prefix search (hits BTREE index)
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

// Session cleanup — delete sessions older than 24 hours, every hour
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
            const angle = step * Math.PI / 4;
            const radius = step * 1000;
            x = startX + Math.cos(angle) * radius;
            y = startY + Math.sin(angle) * radius;
        }
    }

    let x = startX, y = startY, step = 0;
    while (true) {
        const res = await pool.query(
            `SELECT COUNT(*) as count FROM users 
             WHERE cx BETWEEN $1::float - $3::float AND $1::float + $3::float 
             AND cy BETWEEN $2::float - $3::float AND $2::float + $3::float 
             AND sqrt(power(cx - $1::float, 2) + power(cy - $2::float, 2)) < $3::float`,
            [x, y, minDistance]
        );
        if (parseInt(res.rows[0].count) === 0) return { x, y };
        step++;
        const angle = step * Math.PI / 4;
        const radius = step * 1000;
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
