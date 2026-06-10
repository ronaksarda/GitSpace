require('dotenv').config();
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString || connectionString === 'sandbox') {
    console.error('FATAL: This stress test requires a real PostgreSQL database to run efficiently.');
    process.exit(1);
}

const pool = new Pool({
    connectionString,
    ssl: process.env.DATABASE_SSL_CA
        ? { ca: require('fs').readFileSync(process.env.DATABASE_SSL_CA), rejectUnauthorized: true }
        : { rejectUnauthorized: false }
});

const NUM_USERS = 1000;
const REPOS_PER_USER = 80;
const BATCH_SIZE = 1000;

function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag])
    );
}

async function seed() {
    const client = await pool.connect();
    console.log('[Seed] Connected to database.');

    try {
        console.log('[Seed] Wiping existing data...');
        await client.query('TRUNCATE TABLE repos, users CASCADE');

        console.log(`[Seed] Generating ${NUM_USERS} users...`);
        const users = [];
        
        // Arrange users in a massive jittered grid
        const cols = Math.ceil(Math.sqrt(NUM_USERS));
        const cellSpacing = 8000; // 8000x8000 cell size
        const offset = (cols * cellSpacing) / 2;

        for (let i = 0; i < NUM_USERS; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);
            
            // Base center of the cell
            const baseX = (col * cellSpacing) - offset;
            const baseY = (row * cellSpacing) - offset;
            
            // Add a random jitter within the cell (ensures at least 2000 units of padding from cell borders)
            const jitterX = (Math.random() - 0.5) * (cellSpacing - 4000);
            const jitterY = (Math.random() - 0.5) * (cellSpacing - 4000);

            const cx = baseX + jitterX;
            const cy = baseY + jitterY;

            let login = `stress_user_${i}`;
            let avatar = `https://avatars.githubusercontent.com/u/${i}?v=4`;
            
            // Edge cases for user logins
            if (i === 10) login = '<script>alert("xss")</script>'; // HTML injection
            if (i === 20) login = 'A'.repeat(200); // Extremely long name
            if (i === 30) login = 'emoji_👨‍💻_🚀'; // Unicode
            
            users.push({
                login,
                cx,
                cy,
                avatar,
                primary_language: ['JavaScript', 'Python', 'Rust', 'Go', ''][i % 5],
                first_seen: Date.now(),
                last_login: Date.now()
            });
        }

        // Insert users in chunks
        console.log('[Seed] Inserting users...');
        for (let i = 0; i < users.length; i += BATCH_SIZE) {
            const batch = users.slice(i, i + BATCH_SIZE);
            const values = [];
            const placeholders = [];
            let pIdx = 1;

            for (const u of batch) {
                placeholders.push(`($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++})`);
                values.push(u.login, u.cx, u.cy, u.avatar, u.primary_language, u.first_seen, u.last_login);
            }

            await client.query(`
                INSERT INTO users (login, cx, cy, avatar, primary_language, first_seen, last_login)
                VALUES ${placeholders.join(', ')}
            `, values);
        }

        console.log(`[Seed] Generating ${NUM_USERS * REPOS_PER_USER} repositories...`);
        let reposBatch = [];
        let totalReposInserted = 0;

        for (let u = 0; u < users.length; u++) {
            const user = users[u];
            
            for (let r = 0; r < REPOS_PER_USER; r++) {
                let name = `repo_${r}`;
                let stars = Math.floor(Math.random() * 100);
                let size = Math.floor(Math.random() * 5000) + 100;
                let isFork = Math.random() > 0.8;
                let language = ['JavaScript', 'TypeScript', 'HTML', 'CSS', null, 'Unknown'][r % 6];
                let description = `Test repository ${r} for ${user.login}`;

                // Edge Cases
                if (r === 0) { stars = 15000; size = 150000; name = "Skyscraper_Max"; } // Skyscraper
                if (r === 1) { stars = 0; size = 10; name = "Tiny_Hut"; } // Smallest possible
                if (r === 2) { name = "B".repeat(200); } // Insanely long name
                if (r === 3) { description = "<img src=x onerror=alert(1)>"; } // HTML in description
                if (r === 4) { isFork = true; size = 9999999; } // Massive fork

                // Layout Math
                const layoutAngle = (r / REPOS_PER_USER) * Math.PI * 2;
                // Add some spiral or multiple rings for 80 repos so they don't overlap completely
                const ring = Math.floor(r / 20) + 1; // 4 rings of 20 repos
                const rDist = 150 * ring + (Math.random() * 50);
                
                const x = user.cx + Math.cos(layoutAngle) * rDist;
                const y = user.cy + Math.sin(layoutAngle) * rDist;
                const radius = Math.max(15, Math.min(50, Math.sqrt(size || 100) / 2));

                reposBatch.push({
                    login: user.login,
                    name,
                    language,
                    url: `https://github.com/${escapeHTML(user.login)}/${escapeHTML(name)}`,
                    size,
                    stars,
                    isFork,
                    description,
                    updated_at: new Date().toISOString(),
                    x,
                    y,
                    radius
                });

                if (reposBatch.length >= BATCH_SIZE) {
                    await insertRepos(client, reposBatch);
                    totalReposInserted += reposBatch.length;
                    process.stdout.write(`\r[Seed] Inserted ${totalReposInserted} repos...`);
                    reposBatch = [];
                }
            }
        }
        
        // Insert remaining
        if (reposBatch.length > 0) {
            await insertRepos(client, reposBatch);
            totalReposInserted += reposBatch.length;
        }

        console.log(`\n[Seed] Complete! Inserted 1000 users and ${totalReposInserted} repos.`);

    } catch (err) {
        console.error('[Seed] Error:', err);
    } finally {
        client.release();
        pool.end();
    }
}

async function insertRepos(client, batch) {
    const values = [];
    const placeholders = [];
    let pIdx = 1;

    for (const r of batch) {
        placeholders.push(`($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++})`);
        values.push(r.login, r.name, r.language, r.url, r.size, r.stars, r.isFork, r.description, r.updated_at, r.x, r.y, r.radius);
    }

    await client.query(`
        INSERT INTO repos (login, name, language, url, size, stars, isFork, description, updated_at, x, y, radius)
        VALUES ${placeholders.join(', ')}
    `, values);
}

seed();
