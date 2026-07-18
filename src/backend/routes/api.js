const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const router = express.Router();

let activeEngineProcesses = 0;
const MAX_ENGINE_PROCESSES = 4;

// In-memory GitHub API cache — 5 minute TTL per username
const githubCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCached(key) {
    const entry = githubCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
        githubCache.delete(key);
        return null;
    }
    return entry.data;
}

function setCache(key, data) {
    githubCache.set(key, { data, ts: Date.now() });
    // Prevent unbounded growth — evict oldest if over 500 entries
    if (githubCache.size > 500) {
        const oldest = githubCache.keys().next().value;
        githubCache.delete(oldest);
    }
}

module.exports = function (db, CLIENT_ID, CLIENT_SECRET, heavyLimiter) {
    function getSessionId(req) {
        const match = req.headers.cookie?.match(/(?:^|;\s*)sid=([^;]+)/);
        return match ? match[1] : null;
    }

    async function getSession(req) {
        const sid = getSessionId(req);
        return sid ? await db.getSessionById(sid) : null;
    }

    async function requireAuth(req, res, next) {
        const session = await getSession(req);
        if (!session || !session.token) {
            return res.json({ authenticated: false });
        }
        req.session = session;
        next();
    }

    async function githubFetch(url, token) {
        const headers = { 'Accept': 'application/vnd.github.v3+json' };
        if (token && token !== 'mock_token') {
            headers['Authorization'] = `token ${token}`;
        }
        try {
            const response = await fetch(url, { headers });
            if (response.status === 401 && token && token !== 'mock_token') {
                console.warn('[GitHub API] Token expired/revoked for request:', url);
            }
            return response;
        } catch (err) {
            console.error('[GitHub API] Network error:', err.message);
            throw err;
        }
    }

    // API: Get authenticated user profile
    router.get('/api/me', async (req, res) => {
        try {
            const session = await getSession(req);
            if (!session || !session.token) {
                return res.json({ authenticated: false });
            }

            // Mock response for local development without credentials
            if (session.token === 'mock_token') {
                const mockLogin = process.env.MOCK_USER_LOGIN || 'mock_user';
                return res.json({ login: mockLogin, avatar_url: `https://avatars.githubusercontent.com/${mockLogin}`, authenticated: true });
            }

            const r = await githubFetch('https://api.github.com/user', session.token);
            if (!r.ok) {
                if (r.status === 401) {
                    await db.deleteSession(session.sid);
                    return res.json({ authenticated: false, expired: true });
                }
                return res.status(r.status).json({ error: 'GitHub API error' });
            }
            const data = await r.json();
            db.updateLastLogin(data.login);
            res.json({ ...data, authenticated: true });
        } catch (err) {
            console.error('[API] /me error:', err.message);
            res.status(500).json({ error: 'Internal error' });
        }
    });

    // Generate Layout - no absolute coordinates, rely on frontend deterministic renderer
    function generateLayoutJS(reposData, baseX, baseY) {
        const sorted = [...reposData].sort((a, b) => a.name.localeCompare(b.name));
        const repos = sorted.map(r => {
            const stars = r.stargazers_count || r.stars || 0;
            const size = r.size || 0;
            const isFork = !!(r.fork || r.isFork);
            const language = r.language || "Other";
            const name = r.name || "";
            const url = r.html_url || r.url || "";
            const description = r.description || "";
            const updatedAt = r.updated_at || r.updatedAt || null;

            let radius;
            if (["C++", "Rust", "C", "Go", "Java", "C#"].includes(language)) {
                radius = 6.0 + Math.sqrt(stars) * 0.16 + Math.sqrt(size) * 0.05;
            } else {
                radius = 3.0 + Math.sqrt(stars) * 0.10 + Math.sqrt(size) * 0.03;
            }
            radius = Math.min(18.0, radius);

            return {
                name,
                language,
                url,
                size,
                stars,
                isFork,
                radius,
                description,
                updatedAt,
                x: baseX,
                y: baseY
            };
        });

        const placed = [];
        for (const proj of repos) {
            const original_x = proj.x;
            const original_y = proj.y;
            let has_collision = true;
            let attempts = 0;
            let angle = 0.0;
            const step = proj.radius * 0.8;

            while (has_collision && attempts < 1000) {
                has_collision = false;
                for (const other of placed) {
                    const dx = proj.x - other.x;
                    const dy = proj.y - other.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const minDist = proj.radius + other.radius + 1.5;
                    if (dist < minDist) {
                        has_collision = true;
                        break;
                    }
                }

                if (has_collision) {
                    attempts++;
                    const r = step * Math.sqrt(attempts);
                    angle += 0.38197;
                    proj.x = original_x + r * Math.cos(angle);
                    proj.y = original_y + r * Math.sin(angle);
                }
            }
            placed.push(proj);
        }

        const scale = 3.5;
        const scaledPlaced = placed.map(p => {
            const dx = p.x - baseX;
            const dy = p.y - baseY;
            return {
                ...p,
                x: baseX + dx * scale,
                y: baseY + dy * scale
            };
        });

        return { cx: baseX, cy: baseY, repos: scaledPlaced };
    }

    const engineQueue = [];

    function processEngineQueue() {
        if (engineQueue.length === 0 || activeEngineProcesses >= MAX_ENGINE_PROCESSES) return;
        const task = engineQueue.shift();
        activeEngineProcesses++;
        task();
    }

    // Generate Layout using C++ Engine with identical Javascript-based fallback
    function generateLayoutEngine(username, reposData, baseX, baseY) {
        return new Promise((resolve) => {
            const sorted = [...reposData].sort((a, b) => a.name.localeCompare(b.name));
            
            const enginePath = process.platform === 'win32'
                ? path.join(__dirname, '../../engine/gitspace_engine.exe')
                : path.join(__dirname, '../../engine/gitspace_engine');

            if (!fs.existsSync(enginePath)) {
                console.warn('[Engine] C++ engine not found, using deterministic JS layout engine');
                return resolve(generateLayoutJS(sorted, baseX, baseY));
            }

            const executeEngine = () => {
                let isResolved = false;

                const cleanup = () => {
                    if (!isResolved) {
                        isResolved = true;
                        activeEngineProcesses--;
                        processEngineQueue();
                    }
                };

                const proc = spawn(enginePath);
                let out = '';
                let err = '';

                const timeout = setTimeout(() => {
                    proc.kill();
                    cleanup();
                    console.warn('[Engine] C++ engine timed out, falling back to deterministic JS layout engine');
                    resolve(generateLayoutJS(sorted, baseX, baseY));
                }, 5000);

                proc.stdout.on('data', d => out += d);
                proc.stderr.on('data', d => err += d);

                proc.on('close', code => {
                    clearTimeout(timeout);
                    cleanup();
                    if (code !== 0) {
                        console.warn('[Engine] C++ engine failed with code', code, 'error:', err, '- falling back to deterministic JS layout engine');
                        return resolve(generateLayoutJS(sorted, baseX, baseY));
                    }
                    try {
                        const result = JSON.parse(out);
                        const scale = 3.5;
                        const reposWithMeta = result.map((p, idx) => {
                            const original = sorted[idx] || {};
                            const dx = p.x - baseX;
                            const dy = p.y - baseY;
                            return {
                                ...p,
                                x: baseX + dx * scale,
                                y: baseY + dy * scale,
                                description: original.description || '',
                                updatedAt: original.updated_at || original.updatedAt || null
                            };
                        });
                        resolve({ cx: baseX, cy: baseY, repos: reposWithMeta });
                    } catch (e) {
                        console.warn('[Engine] Parse error from C++ output:', e.message, '- falling back to JS engine');
                        resolve(generateLayoutJS(sorted, baseX, baseY));
                    }
                });

                proc.on('error', e => {
                    clearTimeout(timeout);
                    cleanup();
                    console.warn('[Engine] Process error:', e.message, '- falling back to JS engine');
                    resolve(generateLayoutJS(sorted, baseX, baseY));
                });

                let inputLines = [];
                inputLines.push(`${baseX} ${baseY}`);
                for (const r of sorted) {
                    const stars = r.stargazers_count || r.stars || 0;
                    const size = r.size || 0;
                    const isFork = (r.fork || r.isFork) ? "1" : "0";
                    const language = String(r.language || "Other").replace(/[\r\n\t]/g, ' ').trim();
                    const name = String(r.name || "").replace(/[\r\n\t]/g, ' ').trim();
                    const url = String(r.html_url || r.url || "").replace(/[\r\n\t]/g, '').trim();
                    inputLines.push(`${stars}\t${size}\t${isFork}\t${language}\t${name}\t${url}`);
                }
                const inputData = inputLines.join('\n') + '\n';

                proc.stdin.write(inputData);
                proc.stdin.end();
            };

            if (activeEngineProcesses >= MAX_ENGINE_PROCESSES) {
                engineQueue.push(executeEngine);
            } else {
                activeEngineProcesses++;
                executeEngine();
            }
        });
    }

    router.all('/api/repos', heavyLimiter || ((req, res, next) => next()), requireAuth, async (req, res) => {
        try {
            let userData;
            if (req.session.token === 'mock_token') {
                const mockLogin = process.env.MOCK_USER_LOGIN || 'mock_user';
                userData = { login: mockLogin, avatar_url: `https://avatars.githubusercontent.com/${mockLogin}` };
            } else {
                const uRes = await githubFetch('https://api.github.com/user', req.session.token);
                if (!uRes.ok) {
                    if (uRes.status === 401) {
                        await db.deleteSession(req.session.sid);
                        return res.json({ authenticated: false, expired: true });
                    }
                    return res.status(uRes.status).json({ error: 'GitHub API error' });
                }
                userData = await uRes.json();
            }

            // If it's a GET request, try to load from DB first
            if (req.method === 'GET') {
                const existingUser = await db.getUser(userData.login);
                if (existingUser) {
                    const repos = await db.getRepos(userData.login);
                    if (repos && repos.length > 0) {
                        return res.json({ success: true, cx: existingUser.cx, cy: existingUser.cy, repos: repos });
                    }
                }
            }

            // If POST (sync) or not found in DB, fetch from GitHub
            let reposData;
            if (req.session.token === 'mock_token') {
                reposData = [
                    { name: 'mock-repo-1', language: 'JavaScript', size: 5000, stargazers_count: 10, html_url: '#', fork: false, description: 'A demo JavaScript project', updated_at: new Date().toISOString() },
                    { name: 'mock-repo-2', language: 'Python', size: 12000, stargazers_count: 45, html_url: '#', fork: true, description: 'Python ML toolkit fork', updated_at: new Date(Date.now() - 86400000 * 30).toISOString() },
                    { name: 'mock-repo-3', language: 'C++', size: 35000, stargazers_count: 120, html_url: '#', fork: false, description: 'High-performance spatial engine', updated_at: new Date(Date.now() - 86400000 * 7).toISOString() },
                ];
            } else {
                // Check cache before hitting GitHub API
                const cacheKey = `repos:${userData.login}`;
                const cached = getCached(cacheKey);
                if (cached && req.method === 'GET') {
                    reposData = cached;
                } else {
                    const rRes = await githubFetch('https://api.github.com/user/repos?per_page=100&sort=updated', req.session.token);
                    if (!rRes.ok) {
                        if (rRes.status === 401) {
                            await db.deleteSession(req.session.sid);
                            return res.json({ authenticated: false, expired: true });
                        }
                        return res.status(rRes.status).json({ error: 'GitHub API error' });
                    }
                    reposData = await rRes.json();
                    setCache(cacheKey, reposData);
                }
            }

            // Check if user already exists to keep coordinates stable
            const existingUser = await db.getUser(userData.login);
            let baseX, baseY;
            if (existingUser && existingUser.cx !== undefined && existingUser.cx !== null && existingUser.cy !== undefined && existingUser.cy !== null) {
                baseX = existingUser.cx;
                baseY = existingUser.cy;
            } else {
                const hash = crypto.createHash('md5').update(userData.login).digest('hex');
                const startX = (parseInt(hash.substring(0, 4), 16) % 20000) - 10000;
                const startY = (parseInt(hash.substring(4, 8), 16) % 20000) - 10000;
                const pos = await db.findFreeSpot(startX, startY);
                baseX = pos.x;
                baseY = pos.y;
            }

            const layout = await generateLayoutEngine(userData.login, reposData, baseX, baseY);
            await db.saveUserLayout(userData.login, layout.cx, layout.cy, userData.avatar_url, layout.repos);

            res.json({ success: true, cx: layout.cx, cy: layout.cy, repos: layout.repos });
        } catch (err) {
            console.error('[API] /repos error:', err.message);
            res.status(500).json({ error: err.message || 'Internal error' });
        }
    });

    router.get('/api/chunk', async (req, res) => {
        const minX = parseFloat(req.query.minX);
        const minY = parseFloat(req.query.minY);
        const maxX = parseFloat(req.query.maxX);
        const maxY = parseFloat(req.query.maxY);

        if (isNaN(minX) || isNaN(minY) || isNaN(maxX) || isNaN(maxY)) {
            return res.status(400).json({ error: 'minX, minY, maxX, maxY must be valid numbers' });
        }

        try {
            const data = await db.getChunks(minX, minY, maxX, maxY);
            res.json(data);
        } catch (err) {
            console.error('[API] /world error:', err.message);
            res.status(500).json({ error: 'Database error' });
        }
    });

    router.get('/api/stats', async (req, res) => {
        try {
            const stats = await db.getStats();
            res.json(stats);
        } catch (err) {
            res.status(500).json({ error: 'Failed to fetch stats' });
        }
    });

    // Fetch directory of citizens
    router.get('/api/citizens', heavyLimiter || ((req, res, next) => next()), async (req, res) => {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 50, 100);
            const offset = Math.min(parseInt(req.query.offset) || 0, 10000); // Prevent offset exhaustion DoS
            const list = await db.getCitizens(limit, offset);
            res.json(list);
        } catch (err) {
            console.error('[API] /api/citizens error:', err.message);
            res.status(500).json({ error: 'Failed to fetch citizens' });
        }
    });

    router.get('/api/user/:login', async (req, res) => {
        try {
            const login = req.params.login;
            const user = await db.getUser(login);
            if (!user) return res.status(404).json({ error: 'User not found' });
            
            const repos = await db.getRepos(login);
            res.json({
                login: user.login,
                cx: user.cx,
                cy: user.cy,
                avatar: user.avatar,
                primaryLanguage: user.primary_language,
                repos: repos
            });
        } catch (err) {
            console.error('[API] /api/user/:login error:', err.message);
            res.status(500).json({ error: 'Failed to fetch user' });
        }
    });

    router.get('/api/search', async (req, res) => {
        const q = req.query.q;
        if (!q || q.length < 2) return res.json([]);
        try {
            const results = await db.searchGlobal(q);
            res.json(results);
        } catch (err) {
            res.status(500).json({ error: 'Search failed' });
        }
    });

    router.get('/api/spawn', async (req, res) => {
        try {
            const pt = await db.getSpawnPoint();
            if (pt) return res.json(pt);
            res.json({ x: 0, y: 0 });
        } catch (err) {
            res.json({ x: 0, y: 0 });
        }
    });

    return router;
};
