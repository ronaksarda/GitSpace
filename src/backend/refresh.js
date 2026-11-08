// Daily island refresh that does not depend on anyone signing in.
// Every 10 minutes it takes the islands refreshed longest ago, re-reads their public repos from GitHub,
// and rebuilds them in place. Unchanged accounts answer 304 to the ETag check, which costs no quota.
//
// GITHUB_TOKEN (a read-only personal access token) raises the GitHub budget from 60 to 5,000 requests
// an hour. Without it the refresh still runs, just a few islands per tick.
// REFRESH_DISABLED=true turns it off (it is also off in sandbox mode unless REFRESH_IN_SANDBOX=true).

const TICK_MS = 10 * 60 * 1000;
const STALE_HOURS = 20;

function budgetPerTick() {
    // Up to 3 GitHub calls per island (pages of 100 repos). Keep well under the hourly limit.
    return process.env.GITHUB_TOKEN ? 150 : 3;
}

async function fetchRepos(login, etag) {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'GitSpace-refresh' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const base = `https://api.github.com/users/${encodeURIComponent(login)}/repos?type=owner&sort=updated&per_page=100`;

    const first = await fetch(base + '&page=1', { headers: etag ? { ...headers, 'If-None-Match': etag } : headers });
    if (first.status === 304) return { unchanged: true };
    if (first.status === 404) return { gone: true };
    if (first.status === 403 || first.status === 429) return { limited: true };
    if (!first.ok) throw new Error(`GitHub ${first.status} for ${login}`);

    const repos = await first.json();
    const newEtag = first.headers.get('etag');
    for (let page = 2; page <= 3 && repos.length === (page - 1) * 100; page++) {
        const r = await fetch(`${base}&page=${page}`, { headers });
        if (!r.ok) break;
        repos.push(...await r.json());
    }
    return { repos, etag: newEtag };
}

async function refreshOne(db, router, user) {
    const result = await fetchRepos(user.login, user.repos_etag);
    if (result.limited) return 'limited';
    if (result.unchanged || result.gone) {
        await db.markRefreshed(user.login, user.repos_etag);
        return result.gone ? 'gone' : 'unchanged';
    }
    const own = result.repos.filter(r => !r.fork); // forks never become buildings
    const picked = router.pickIslandRepos(own, []);
    const layout = router.generateLayoutJS(picked, user.cx, user.cy);
    await db.saveUserLayout(user.login, user.cx, user.cy, user.avatar, layout.repos, { touchLogin: false });
    await db.markRefreshed(user.login, result.etag);
    return 'updated';
}

async function tick(db, router) {
    const release = await db.tryJobLock('island-refresh');
    if (!release) return; // another instance is already running it
    const counts = { updated: 0, unchanged: 0, gone: 0, limited: 0, failed: 0 };
    try {
        const queue = await db.getRefreshQueue(budgetPerTick(), STALE_HOURS);
        for (const user of queue) {
            try {
                const outcome = await refreshOne(db, router, user);
                counts[outcome]++;
                if (outcome === 'limited') break; // stop until the next tick
            } catch (e) {
                counts.failed++;
                console.warn('[Refresh]', user.login, e.message);
            }
        }
    } finally {
        await release();
    }
    if (counts.updated || counts.failed || counts.limited) console.log('[Refresh]', JSON.stringify(counts));
}

function start(db, router) {
    if (process.env.REFRESH_DISABLED === 'true') return;
    if (db.isSandbox() && process.env.REFRESH_IN_SANDBOX !== 'true') return;
    const run = () => tick(db, router).catch(e => console.warn('[Refresh] tick failed:', e.message));
    setTimeout(run, 60 * 1000).unref(); // first run a minute after boot
    setInterval(run, TICK_MS).unref();
}

module.exports = { start, tick, refreshOne, fetchRepos };
