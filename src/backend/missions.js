// Open-source missions: find beginner issues, rank them for a person, and notice when their PR is merged.
// Plain logic over `store` (missionsStore.js) and `gh` (a GitHub reader), so tests need no database or network.

const LIVE = ['active', 'pr_open']; // statuses the hourly check still moves forward
const MAX_ACTIVE = 2;    // missions one person can hold at once
const MAX_PER_ISSUE = 2; // GitSpace people allowed on the same issue
const EXPIRE_DAYS = 45;  // an active mission with no PR after this long expires
const FRESH_HOURS = 13;  // two 6-hour refreshes plus slack: an issue not seen since then may be closed or taken
const DAY = 864e5;
const LANGS = ['JavaScript', 'TypeScript', 'Python', 'Java', 'Go', 'Rust', 'C++', 'C#', 'C', 'PHP', 'Ruby', 'Kotlin', 'Swift', 'Dart', 'Shell'];

const ms = v => new Date(v).getTime();
const sleep = t => new Promise(r => setTimeout(r, t));
const gap = () => (process.env.GITHUB_TOKEN ? 2100 : 6500); // search allows 30 a minute with a token, 10 without

function makeGh(fetchFn = (...a) => fetch(...a), token = process.env.GITHUB_TOKEN) {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'GitSpace-missions' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return async function gh(path) {
        const r = await fetchFn('https://api.github.com' + path, { headers });
        // A 403 also means "repo blocked"; it is a rate limit only when GitHub says so.
        if (r.status === 429 || (r.status === 403 && (r.headers.get('retry-after') || r.headers.get('x-ratelimit-remaining') === '0'))) {
            throw Object.assign(new Error('GitHub rate limit'), { limited: true });
        }
        if ([403, 404, 410, 451].includes(r.status)) return null; // blocked, deleted or gone: treat as missing
        if (!r.ok) throw new Error(`GitHub ${r.status} for ${path}`);
        return r.json();
    };
}

const search = q => `/search/issues?per_page=100&sort=created&order=desc&q=${encodeURIComponent(q)}`;
// One query covers all three label spellings: a comma inside label: means OR.
const issueQuery = lang => `is:issue is:open no:assignee archived:false language:"${lang}" label:"good first issue","good-first-issue",beginner`;
const repoOf = item => (item.repository_url || '').split('/repos/')[1] || '';

// Search hit -> our issue, or null when it fails the cheap checks.
function readIssue(item, now = Date.now()) {
    const repo = repoOf(item);
    if (!repo || item.pull_request || item.assignee || item.assignees?.length) return null;
    if ((item.body || '').length < 40 || item.comments > 5 || now - ms(item.created_at) > 120 * DAY) return null;
    return { id: item.id, repo, number: item.number, title: item.title, url: item.html_url, comments: item.comments, created_at: item.created_at };
}

// Repo checks: real, active, mid-sized, not a fork or template, no bought stars.
function keepRepo(repo, now = Date.now()) {
    if (!repo || repo.fork || repo.is_template || repo.archived || repo.disabled) return false;
    const stars = repo.stargazers_count;
    if (stars < 50 || stars > 50000 || now - ms(repo.pushed_at) > 30 * DAY) return false;
    return !(now - ms(repo.created_at) < 60 * DAY && stars > 1000);
}

// Best first: own top language, newer, fewer comments, recently pushed, mid-sized repo. Under 2 hours old is held back.
function rank(issues, langs, now = Date.now()) {
    const langRank = l => (langs.includes(l) ? langs.indexOf(l) : langs.length);
    const sweet = s => (s >= 200 && s <= 5000 ? 0 : 1);
    return issues.filter(i => now - ms(i.created_at) >= 2 * 3600e3).sort((a, b) =>
        langRank(a.language) - langRank(b.language) || ms(b.created_at) - ms(a.created_at) ||
        a.comments - b.comments || ms(b.repo_pushed_at) - ms(a.repo_pushed_at) || sweet(a.repo_stars) - sweet(b.repo_stars));
}

// A PR counts only if it is the person's own and names the issue ("Fixes #12" or the issue link), so an
// unrelated PR to the same repo earns nothing. The search's repo: qualifier already limits it to the issue's
// repo (a PR merged into a fork never shows up).
function matchPr(items, mission) {
    const url = `github.com/${mission.repo}/issues/${mission.number}`.replace(/[.]/g, '\\.');
    const ref = new RegExp(`(^|[^\\w/])#${mission.number}(?!\\d)|${url}(?!\\d)`, 'i');
    return items.find(it => it.pull_request &&
        it.user?.login?.toLowerCase() === mission.login.toLowerCase() &&
        ref.test(`${it.title}\n${it.body || ''}`)) || null;
}

// Fill the shared issue pool. A rate limit ends the run early; the next run carries on.
async function refreshIssues(store, { gh, languages = LANGS, repoBudget = process.env.GITHUB_TOKEN ? 400 : 40, now = Date.now(), wait = sleep } = {}) {
    const repos = new Map();
    const out = { saved: 0, limited: false };
    try {
        for (const [n, language] of languages.entries()) {
            if (n) await wait(gap());
            const keep = [];
            for (const item of (await gh(search(issueQuery(language))))?.items || []) {
                const issue = readIssue(item, now);
                if (!issue) continue;
                if (!repos.has(issue.repo)) {
                    if (repoBudget-- <= 0) continue; // unchecked repos are not saved; their old rows go stale and hide themselves
                    repos.set(issue.repo, await gh(`/repos/${issue.repo}`));
                }
                const repo = repos.get(issue.repo);
                if (keepRepo(repo, now)) keep.push({ ...issue, language, repo_stars: repo.stargazers_count, repo_pushed_at: repo.pushed_at });
            }
            out.saved += await store.saveIssues(keep);
        }
    } catch (e) {
        if (!e.limited) throw e;
        out.limited = true;
    }
    await store.pruneIssues(now - 30 * DAY);
    return out;
}

// Move each live mission forward. Order matters: merged beats open beats "issue gone" beats expiry.
async function checkMissions(store, { gh, batch = 200, now = Date.now(), wait = sleep } = {}) {
    const out = { merged: 0, opened: 0, lost: 0, expired: 0, limited: false };
    let calls = 0;
    const call = async path => { if (calls++) await wait(gap()); return gh(path); };
    const prs = async (m, state) => (await call(search(`type:pr author:${m.login} repo:${m.repo} ${state}`)))?.items || [];
    try {
        for (const m of await store.missionsToCheck(batch)) {
            const save = patch => store.updateMission(m, patch);
            // Merged before they took the mission does not count: no claiming old work.
            const merged = matchPr((await prs(m, 'is:merged')).filter(it => ms(it.pull_request?.merged_at) >= ms(m.started_at)), m);
            if (merged) {
                await save({ status: 'merged', pr_url: merged.html_url, merged_at: merged.pull_request.merged_at });
                out.merged++;
                continue;
            }
            const open = matchPr(await prs(m, 'is:open'), m);
            if (open) {
                await save({ status: 'pr_open', pr_url: open.html_url });
                if (m.status !== 'pr_open') out.opened++;
                continue;
            }
            // No live PR (or it was closed without merging). Is the issue itself still there for them?
            const issue = await call(`/repos/${m.repo}/issues/${m.number}`);
            const others = (issue?.assignees || []).filter(a => a.login.toLowerCase() !== m.login.toLowerCase());
            // Their own merge closes the issue too, and search can lag behind it: give a closed issue 3 days
            // of re-checks before calling it lost.
            const justClosed = issue?.state === 'closed' && now - ms(issue.closed_at) < 3 * DAY;
            if (!justClosed && (!issue || issue.state !== 'open' || others.length)) {
                await save({ status: 'lost' });
                out.lost++;
            } else if (!justClosed && now - ms(m.started_at) > EXPIRE_DAYS * DAY) {
                await save({ status: 'expired' });
                out.expired++;
            } else {
                await save({ status: 'active' }); // also where a PR closed without merging lands
            }
        }
    } catch (e) {
        if (!e.limited) throw e;
        out.limited = true;
    }
    return out;
}

// Someone's open-source work: PRs they got merged into other people's repos, grouped by repo, with commit counts
// for the latest `detail` PRs (one call each), merges per month for the last 12 months, and which came via GitSpace.
async function contributions(gh, login, { viaGitSpace = [], detail = 20, now = Date.now() } = {}) {
    const merged = await gh(search(`type:pr author:${login} -user:${login} is:merged`));
    const open = await gh(search(`type:pr author:${login} -user:${login} is:open`).replace('per_page=100', 'per_page=1'));
    const via = new Set(viaGitSpace);
    const prs = (merged?.items || []).map(it => ({
        repo: repoOf(it), number: it.number, title: it.title, url: it.html_url,
        merged_at: it.pull_request?.merged_at || it.closed_at, via_gitspace: via.has(it.html_url), commits: null,
    })).filter(p => p.repo).sort((a, b) => ms(b.merged_at) - ms(a.merged_at));
    let counted = 0; // commit counts are extra; if GitHub runs out of quota midway, show what we have
    try {
        for (const p of prs.slice(0, detail)) { p.commits = (await gh(`/repos/${p.repo}/pulls/${p.number}`))?.commits ?? null; counted++; }
    } catch (e) { if (!e.limited) throw e; }

    const repos = {};
    for (const p of prs) {
        const r = repos[p.repo] ||= { repo: p.repo, prs: [], commits: 0 };
        r.prs.push(p);
        r.commits += p.commits || 0;
    }
    const months = Array.from({ length: 12 }, (_, i) => {
        const d = new Date(now);
        d.setUTCDate(1);
        d.setUTCMonth(d.getUTCMonth() - 11 + i);
        return { month: d.toISOString().slice(0, 7), merged: 0 };
    });
    for (const p of prs) { const m = months.find(x => x.month === String(p.merged_at).slice(0, 7)); if (m) m.merged++; }

    return {
        merged: merged?.total_count ?? prs.length, // total can exceed the 100 we list
        open: open?.total_count ?? 0,
        projects: Object.keys(repos).length,
        commits: prs.reduce((s, p) => s + (p.commits || 0), 0),
        commitsCounted: counted, // commits are summed over this many latest PRs
        viaGitSpace: prs.filter(p => p.via_gitspace).length,
        months,
        repos: Object.values(repos).sort((a, b) => b.prs.length - a.prs.length || ms(b.prs[0].merged_at) - ms(a.prs[0].merged_at)),
    };
}

// The next step after a first merge: open, unassigned issues in projects that already merged their work.
// A maintainer who knows you is the easiest second PR, so "help wanted" counts too, and star limits do not apply.
// One search plus one repo lookup per project; returns issues ready for store.saveIssues.
async function projectIssues(gh, repos, now = Date.now()) {
    let q = 'is:issue is:open no:assignee archived:false label:"good first issue","good-first-issue","help wanted",beginner';
    for (const r of repos) if ((q + ` repo:${r}`).length <= 250) q += ` repo:${r}`; // search queries max out at 256 chars
    if (!q.includes(' repo:')) return [];
    const found = ((await gh(search(q)))?.items || []).map(it => readIssue(it, now)).filter(Boolean);
    const out = [];
    for (const name of new Set(found.map(i => i.repo))) {
        // archived:false already filtered dead repos; the lookup only adds language and stars, so a busy GitHub is fine.
        const repo = await gh(`/repos/${name}`).catch(e => { if (e.limited) return {}; throw e; });
        if (!repo || repo.disabled) continue;
        // At most 2 per project, so one busy repo cannot fill the list.
        for (const i of found.filter(x => x.repo === name).slice(0, 2)) {
            out.push({ ...i, language: repo.language || 'Other', repo_stars: repo.stargazers_count ?? 0, repo_pushed_at: repo.pushed_at ?? null });
        }
    }
    return out;
}

function start(db, store) {
    if (process.env.MISSIONS_DISABLED === 'true') return;
    if (db.isSandbox() && process.env.MISSIONS_IN_SANDBOX !== 'true') return;
    const gh = makeGh();
    const job = (name, fn) => async () => {
        const release = await db.tryJobLock(name).catch(() => null);
        if (!release) return; // another instance is running it
        try { console.log(`[Missions] ${name}`, JSON.stringify(await fn(store, { gh }))); }
        catch (e) { console.warn(`[Missions] ${name} failed:`, e.message); }
        finally { await release(); }
    };
    const refresh = job('issue-refresh', refreshIssues), check = job('mission-check', checkMissions);
    setTimeout(refresh, 3 * 60e3).unref();
    setInterval(refresh, 6 * 3600e3).unref();
    setTimeout(check, 5 * 60e3).unref();
    setInterval(check, 3600e3).unref();
}

module.exports = { LIVE, MAX_ACTIVE, MAX_PER_ISSUE, FRESH_HOURS, LANGS, makeGh, readIssue, keepRepo, rank, matchPr, refreshIssues, checkMissions, contributions, projectIssues, start, issueQuery };
