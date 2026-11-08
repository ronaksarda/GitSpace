const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { analyzeRepo, analyzeTree, calculateGrade } = require('../reviewer');
const router = express.Router();

let activeEngineProcesses = 0;
const MAX_ENGINE_PROCESSES = 4;

const githubCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;
const CITIZENS_TTL_MS = 60 * 1000;

function getCached(key, ttl = CACHE_TTL_MS) {
    const entry = githubCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > ttl) {
        githubCache.delete(key);
        return null;
    }
    return entry.data;
}

function setCache(key, data) {
    githubCache.set(key, { data, ts: Date.now() });
    if (githubCache.size > 500) {
        const oldest = githubCache.keys().next().value;
        githubCache.delete(oldest);
    }
}

module.exports = function (db, heavyLimiter) {
    function getSessionId(req) {
        const match = req.headers.cookie?.match(/(?:^|;\s*)sid=([^;]+)/);
        return match ? match[1] : null;
    }

    async function getSession(req) {
        const sid = getSessionId(req);
        return sid ? await db.getSessionById(sid) : null;
    }

    async function requireAuth(req, res, next) {
        try {
            const session = await getSession(req);
            if (!session || !session.token) {
                return res.json({ authenticated: false });
            }
            req.session = session;
        } catch (err) {
            console.error('[API] requireAuth error:', err.message);
            return res.status(500).json({ error: 'Internal error' });
        }
        next();
    }

    const MAX_ISLAND_REPOS = 60;

    // Pinned repo names via GraphQL (needs the user's token). Empty on any failure.
    async function fetchPinnedNames(token) {
        if (!token || token === 'mock_token') return [];
        try {
            const r = await fetch('https://api.github.com/graphql', {
                method: 'POST',
                headers: { 'Authorization': `bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: '{ viewer { pinnedItems(first: 6, types: REPOSITORY) { nodes { ... on Repository { name } } } } }' }),
            });
            if (!r.ok) return [];
            const j = await r.json();
            return (j?.data?.viewer?.pinnedItems?.nodes || []).map(n => n && n.name).filter(Boolean);
        } catch (e) { return []; }
    }

    // Big accounts show their best repos only: pinned first, then stars, then forks, then most recent push.
    function pickIslandRepos(repos, pinned = []) {
        if (repos.length <= MAX_ISLAND_REPOS) return repos;
        const pin = new Set(pinned);
        return [...repos].sort((a, b) =>
            (pin.has(b.name) - pin.has(a.name)) ||
            ((b.stargazers_count || 0) - (a.stargazers_count || 0)) ||
            ((b.forks_count || 0) - (a.forks_count || 0)) ||
            (new Date(b.pushed_at || 0) - new Date(a.pushed_at || 0))
        ).slice(0, MAX_ISLAND_REPOS);
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

    router.get('/api/me', async (req, res) => {
        try {
            const session = await getSession(req);
            if (!session || !session.token) {
                return res.json({ authenticated: false });
            }

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

            while (has_collision && attempts < 10000) {
                has_collision = false;
                for (const other of placed) {
                    const dx = proj.x - other.x;
                    const dy = proj.y - other.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const minDist = proj.radius + other.radius + 5.0;
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
    router.generateLayoutJS = generateLayoutJS; // exposed for test/engine-parity.test.js
    router.pickIslandRepos = pickIslandRepos; // exposed for test/pick-repos.test.js

    const engineQueue = [];
    const MAX_ENGINE_QUEUE = 50;

    function processEngineQueue() {
        if (engineQueue.length === 0 || activeEngineProcesses >= MAX_ENGINE_PROCESSES) return;
        const task = engineQueue.shift();
        activeEngineProcesses++;
        task();
    }

    function generateLayoutEngine(reposData, baseX, baseY) {
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
                let timedOut = false;

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
                    timedOut = true;
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
                    if (timedOut) return;
                    if (code !== 0) {
                        console.warn('[Engine] C++ engine failed with code', code, 'error:', err, '- falling back to deterministic JS layout engine');
                        return resolve(generateLayoutJS(sorted, baseX, baseY));
                    }
                    try {
                        const result = JSON.parse(out);
                        if (result.length !== sorted.length) throw new Error('engine skipped rows');
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
                    if (timedOut) return;
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

                proc.stdin.on('error', () => {}); // EPIPE if the engine dies early; 'close' handles fallback
                proc.stdin.write(inputData);
                proc.stdin.end();
            };

            if (activeEngineProcesses >= MAX_ENGINE_PROCESSES) {
                if (engineQueue.length >= MAX_ENGINE_QUEUE) {
                    return resolve(generateLayoutJS(sorted, baseX, baseY));
                }
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

            if (req.method === 'GET') {
                const existingUser = await db.getUser(userData.login);
                if (existingUser) {
                    const repos = await db.getRepos(userData.login);
                    if (repos && repos.length > 0) {
                        return res.json({ success: true, cx: existingUser.cx, cy: existingUser.cy, repos: repos });
                    }
                }
            }

            let reposData;
            if (req.session.token === 'mock_token') {
                reposData = [
                    { name: 'mock-repo-1', language: 'JavaScript', size: 5000, stargazers_count: 10, html_url: '#', fork: false, description: 'A demo JavaScript project', updated_at: new Date().toISOString() },
                    { name: 'mock-repo-2', language: 'Python', size: 12000, stargazers_count: 45, html_url: '#', fork: true, description: 'Python ML toolkit fork', updated_at: new Date(Date.now() - 86400000 * 30).toISOString() },
                    { name: 'mock-repo-3', language: 'C++', size: 35000, stargazers_count: 120, html_url: '#', fork: false, description: 'High-performance spatial engine', updated_at: new Date(Date.now() - 86400000 * 7).toISOString() },
                ];
            } else {
                const cacheKey = `repos:${userData.login}`;
                const cached = getCached(cacheKey);
                if (cached && req.method === 'GET') {
                    reposData = cached;
                } else {
                    // Up to 3 pages (300 repos); bigger accounts keep their 300 most recently updated.
                    reposData = [];
                    for (let page = 1; page <= 3; page++) {
                        const rRes = await githubFetch(`https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner`, req.session.token);
                        if (!rRes.ok) {
                            if (rRes.status === 401) {
                                await db.deleteSession(req.session.sid);
                                return res.json({ authenticated: false, expired: true });
                            }
                            return res.status(rRes.status).json({ error: 'GitHub API error' });
                        }
                        const pageData = await rRes.json();
                        reposData.push(...pageData);
                        if (pageData.length < 100) break;
                    }
                    setCache(cacheKey, reposData);
                }
            }

            const existingUser = await db.getUser(userData.login);
            let baseX, baseY;
            // Layout is translation-invariant, so build it at the origin first to learn the island size.
            reposData = reposData.filter(r => !r.fork); // forks never become buildings
            if (reposData.length > MAX_ISLAND_REPOS) reposData = pickIslandRepos(reposData, await fetchPinnedNames(req.session.token));
            const local = await generateLayoutEngine(reposData, 0, 0);
            const spread = local.repos.reduce((m, r) => Math.max(m, Math.hypot(r.x, r.y)), 0);
            if (existingUser && existingUser.cx !== undefined && existingUser.cx !== null && existingUser.cy !== undefined && existingUser.cy !== null) {
                baseX = existingUser.cx;
                baseY = existingUser.cy;
            } else {
                // New islands spiral out from the centre so the map stays dense.
                const startX = 0;
                const startY = 0;
                const pos = await db.findFreeSpot(startX, startY, spread);
                baseX = pos.x;
                baseY = pos.y;
            }

            const layout = { cx: baseX, cy: baseY, repos: local.repos.map(r => ({ ...r, x: r.x + baseX, y: r.y + baseY })) };
            await db.saveUserLayout(userData.login, layout.cx, layout.cy, userData.avatar_url, layout.repos);

            res.json({ success: true, cx: layout.cx, cy: layout.cy, repos: layout.repos });
        } catch (err) {
            console.error('[API] /repos error:', err.message);
            res.status(500).json({ error: 'Internal error' });
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
        // frontend asks for 4000x4000 chunks (CHUNK_SIZE in public/js/network.js)
        if (maxX - minX > 20000 || maxY - minY > 20000) {
            return res.status(400).json({ error: 'Requested area too large' });
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
            // Required here, not at the top: tests load this router without a database.
            res.json({ ...stats, prsMerged: await require('../missionsStore').countMerged().catch(() => 0) });
        } catch (err) {
            res.status(500).json({ error: 'Failed to fetch stats' });
        }
    });

    router.get('/api/citizens', heavyLimiter || ((req, res, next) => next()), async (req, res) => {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 50, 100);
            const offset = Math.min(parseInt(req.query.offset) || 0, 10000);
            const cacheKey = `citizens:${limit}:${offset}`;
            let list = getCached(cacheKey, CITIZENS_TTL_MS);
            if (!list) {
                list = await db.getCitizens(limit, offset);
                setCache(cacheKey, list);
            }
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

    // Island preview for any GitHub username, for the front page. Built from public repos, never saved.
    router.get('/api/preview/:login', heavyLimiter || ((req, res, next) => next()), async (req, res) => {
        try {
            const login = String(req.params.login || '');
            if (!/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(login)) return res.status(400).json({ error: 'That is not a valid GitHub username.' });
            const cacheKey = 'preview:' + login.toLowerCase();
            const cached = getCached(cacheKey, 60 * 60 * 1000);
            if (cached) return res.json(cached);

            const session = await getSession(req);
            const token = session?.token;
            const uRes = await githubFetch(`https://api.github.com/users/${encodeURIComponent(login)}`, token);
            if (uRes.status === 404) return res.status(404).json({ error: 'No GitHub account with that name.' });
            if (uRes.status === 403 || uRes.status === 429) return res.status(503).json({ error: 'GitHub is busy right now. Try again in a minute.' });
            if (!uRes.ok) return res.status(502).json({ error: 'Could not reach GitHub.' });
            const u = await uRes.json();

            const rRes = await githubFetch(`https://api.github.com/users/${encodeURIComponent(login)}/repos?per_page=100&sort=updated&type=owner`, token);
            if (rRes.status === 403 || rRes.status === 429) return res.status(503).json({ error: 'GitHub is busy right now. Try again in a minute.' });
            const repos = rRes.ok ? (await rRes.json()).filter(r => !r.fork) : [];
            const picked = pickIslandRepos(repos, []);
            const layout = await generateLayoutEngine(picked, 0, 0);

            const langCount = {};
            for (const r of picked) if (r.language) langCount[r.language] = (langCount[r.language] || 0) + 1;
            const primaryLanguage = Object.entries(langCount).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Other';
            const data = {
                login: u.login, name: u.name, avatar: u.avatar_url, createdAt: u.created_at, publicRepos: u.public_repos,
                followers: u.followers, primaryLanguage, cx: 0, cy: 0, repos: layout.repos, onMap: !!(await db.getUser(u.login)),
            };
            setCache(cacheKey, data);
            res.json(data);
        } catch (err) {
            console.error('[API] /api/preview error:', err.message);
            res.status(500).json({ error: 'Could not build that island.' });
        }
    });

    // Public GitHub profile + profile README for the island card. Only for people on the map, cached 1 hour.
    router.get('/api/profile/:login', heavyLimiter || ((req, res, next) => next()), async (req, res) => {
        try {
            const login = String(req.params.login || '');
            if (!/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(login)) return res.status(400).json({ error: 'Invalid username' });
            const user = await db.getUser(login);
            if (!user) return res.status(404).json({ error: 'This developer is not on the map yet.' });

            const cacheKey = 'profile:' + login.toLowerCase();
            const cached = getCached(cacheKey, 60 * 60 * 1000);
            if (cached) return res.json(cached);

            const session = await getSession(req);
            const token = session?.token;
            const uRes = await githubFetch(`https://api.github.com/users/${encodeURIComponent(login)}`, token);
            if (uRes.status === 403 || uRes.status === 429) return res.status(503).json({ error: 'GitHub rate limit, try again in a few minutes.' });
            if (!uRes.ok) return res.status(uRes.status === 404 ? 404 : 502).json({ error: 'Could not load this GitHub profile.' });
            const u = await uRes.json();

            let readme = null;
            try {
                const rRes = await fetch(`https://api.github.com/repos/${encodeURIComponent(login)}/${encodeURIComponent(login)}/readme`, {
                    headers: { 'Accept': 'application/vnd.github.raw+json', ...(token && token !== 'mock_token' ? { 'Authorization': `token ${token}` } : {}) },
                });
                if (rRes.ok) readme = (await rRes.text()).slice(0, 20000);
            } catch (e) { }

            const data = {
                login: u.login, name: u.name, avatar: u.avatar_url, bio: u.bio, company: u.company, location: u.location,
                blog: u.blog, twitter: u.twitter_username, followers: u.followers, following: u.following,
                publicRepos: u.public_repos, createdAt: u.created_at, htmlUrl: u.html_url, readme,
            };
            setCache(cacheKey, data);
            res.json(data);
        } catch (err) {
            console.error('[API] /api/profile error:', err.message);
            res.status(500).json({ error: 'Could not load this profile.' });
        }
    });

    router.get('/api/search', heavyLimiter || ((req, res, next) => next()), async (req, res) => {
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

    router.get('/api/review', heavyLimiter || ((req, res, next) => next()), async (req, res) => {
        const repoParam = req.query.repo || req.query.q;
        let owner = req.query.owner;
        let name = req.query.name;
        if ([repoParam, owner, name].some(v => v !== undefined && typeof v !== 'string')) {
            return res.status(400).json({ error: 'repo, owner and name must be single strings' });
        }

        if (repoParam) {
            const clean = repoParam.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
            if (clean.includes('/')) {
                const parts = clean.split('/');
                owner = parts[0];
                name = parts[1];
            } else if (!name) {
                name = clean;
            }
        }

        if (!name) {
            return res.status(400).json({ error: 'Repository name required (e.g. repo=owner/name)' });
        }

        const cacheKey = `review:${owner || 'unknown'}:${name}`;
        const cached = getCached(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        try {
            const session = await getSession(req);
            const token = session?.token;
            let repoData = null;
            let languagesData = {};
            let treeData = null;

            if (owner) {
                const ghRes = await githubFetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, token);
                if (ghRes.status === 403 || ghRes.status === 429 || ghRes.status >= 500) {
                    return res.status(503).json({ error: 'GitHub rate limit, try again later' });
                }
                if (ghRes.ok) {
                    repoData = await ghRes.json();
                    
                    try {
                        const langRes = await githubFetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/languages`, token);
                        if (langRes.ok) languagesData = await langRes.json();
                    } catch (e) { }
                    try {
                        const branch = encodeURIComponent(repoData.default_branch || 'HEAD');
                        const treeRes = await githubFetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/trees/${branch}?recursive=1`, token);
                        if (treeRes.ok) treeData = (await treeRes.json()).tree || null;
                    } catch (e) { }
                }
            }

            // Fallback: search local GitSpace database if not found on GitHub (needs owner + name)
            if (!repoData && owner) {
                const searchResults = await db.searchGlobal(name);
                const localMatch = searchResults.find(r => r.type === 'repo' && r.name.toLowerCase() === name.toLowerCase() && r.login.toLowerCase() === owner.toLowerCase());

                if (localMatch) {
                    owner = owner || localMatch.login;
                    name = localMatch.name;
                    repoData = {
                        name: localMatch.name,
                        full_name: `${owner}/${localMatch.name}`,
                        description: localMatch.description || '',
                        language: localMatch.language || 'Other',
                        stargazers_count: localMatch.stars || 0,
                        forks_count: 0,
                        open_issues_count: 0,
                        size: localMatch.size || 1024,
                        pushed_at: localMatch.updatedAt || new Date().toISOString(),
                        html_url: localMatch.url || `https://github.com/${owner}/${localMatch.name}`,
                        license: null,
                        topics: []
                    };
                    languagesData[localMatch.language || 'Other'] = 10000;
                }
            }

            // If mock token or demo mode fallback
            if (!repoData && process.env.NODE_ENV !== 'production' && (token === 'mock_token' || (!owner && name.startsWith('mock-')))) {
                owner = owner || 'demo';
                repoData = {
                    name,
                    full_name: `${owner}/${name}`,
                    description: 'Simulated high-performance space architecture',
                    language: 'TypeScript',
                    stargazers_count: 320,
                    forks_count: 24,
                    open_issues_count: 2,
                    size: 8192,
                    pushed_at: new Date().toISOString(),
                    html_url: `https://github.com/${owner}/${name}`,
                    license: { spdx_id: 'MIT' },
                    topics: ['developer-tools', 'space', 'visualization']
                };
                languagesData = { 'TypeScript': 85000, 'CSS': 12000 };
            }

            if (!repoData) {
                return res.status(404).json({ error: `Repository "${owner ? owner + '/' + name : name}" not found.` });
            }

            const analysis = analyzeRepo(repoData, languagesData);
            if (treeData) {
                const tree = analyzeTree(treeData);
                analysis.insights = [...tree.insights, ...analysis.insights];
                analysis.recommendations = [...tree.recommendations, ...analysis.recommendations.filter(r => !/Maintain current CI/.test(r))];
                analysis.score = Math.max(0, Math.min(100, analysis.score + tree.delta));
                analysis.grade = calculateGrade(analysis.score);
                analysis.metrics.fileCount = tree.facts.fileCount;
                const m = analysis.metrics;
                analysis.verdict = [
                    `${m.primaryLanguage} project with ${tree.facts.fileCount} files.`,
                    tree.facts.testFiles ? `${tree.facts.testFiles} test files` + (tree.facts.ciFiles ? ' and CI.' : ', no CI.') : (tree.facts.ciFiles ? 'CI but no tests.' : 'No tests or CI.'),
                    m.license === 'None' ? 'No license.' : `${m.license} license.`,
                    `Last push ${m.daysSincePush} days ago.`,
                ].join(' ');
            }
            const responseData = {
                success: true,
                repo: {
                    owner: owner || repoData.owner?.login || 'unknown',
                    name: repoData.name,
                    fullName: repoData.full_name || `${owner}/${name}`,
                    description: repoData.description || 'No description provided.',
                    htmlUrl: repoData.html_url || `https://github.com/${owner}/${name}`,
                    avatar: repoData.owner?.avatar_url || `https://github.com/identicons/${owner || name}.png`
                },
                analysis
            };

            setCache(cacheKey, responseData);
            res.json(responseData);
        } catch (err) {
            console.error('[API] /review error:', err.message);
            res.status(500).json({ error: 'Failed to complete repository review.' });
        }
    });

    return router;
};
