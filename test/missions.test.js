const { test } = require('node:test');
const assert = require('node:assert');
const m = require('../src/backend/missions');

const NOW = Date.parse('2026-11-08T12:00:00Z');
const ago = d => new Date(NOW - d * 864e5).toISOString();
const item = (over = {}) => ({
    id: 1, number: 7, title: 'Fix typo', html_url: 'https://github.com/o/r/issues/7', body: 'x'.repeat(60), comments: 1,
    created_at: ago(10), repository_url: 'https://api.github.com/repos/o/r', ...over,
});
const repo = (over = {}) => ({ stargazers_count: 500, pushed_at: ago(2), created_at: ago(900), fork: false, ...over });
const noWait = async () => {};
const limited = () => Object.assign(new Error('limited'), { limited: true });

test('readIssue keeps a good issue', () => {
    assert.deepEqual(m.readIssue(item(), NOW), { id: 1, repo: 'o/r', number: 7, title: 'Fix typo', url: 'https://github.com/o/r/issues/7', comments: 1, created_at: ago(10) });
});

test('readIssue drops PRs, assigned, short, chatty and old issues', () => {
    for (const bad of [{ pull_request: {} }, { assignee: { login: 'a' } }, { assignees: [{ login: 'a' }] }, { body: 'short' }, { body: null },
        { comments: 6 }, { created_at: ago(121) }, { repository_url: '' }]) {
        assert.equal(m.readIssue(item(bad), NOW), null, JSON.stringify(bad));
    }
});

test('keepRepo: star range, forks, templates, archived, disabled, stale and fresh-but-hyped repos are out', () => {
    assert.ok(m.keepRepo(repo(), NOW));
    for (const bad of [{ stargazers_count: 49 }, { stargazers_count: 50001 }, { fork: true }, { archived: true }, { is_template: true },
        { disabled: true }, { pushed_at: ago(31) }, { created_at: ago(30), stargazers_count: 2000 }]) {
        assert.equal(m.keepRepo(repo(bad), NOW), false, JSON.stringify(bad));
    }
    assert.equal(m.keepRepo(null, NOW), false);
});

test('rank: own language first, then newer; under 2 hours old is held back', () => {
    const base = { comments: 0, repo_pushed_at: ago(1), repo_stars: 300 };
    const list = [
        { id: 1, language: 'Go', created_at: ago(1), ...base },
        { id: 2, language: 'Python', created_at: ago(20), ...base },
        { id: 3, language: 'Python', created_at: ago(5), ...base },
        { id: 4, language: 'Python', created_at: new Date(NOW - 3600e3).toISOString(), ...base },
    ];
    assert.deepEqual(m.rank(list, ['Python', 'Go'], NOW).map(i => i.id), [3, 2, 1]);
});

test('rank: fewer comments, then mid-sized repos, break ties', () => {
    const mk = (id, comments, stars) => ({ id, language: 'Go', created_at: ago(5), comments, repo_pushed_at: ago(1), repo_stars: stars });
    assert.deepEqual(m.rank([mk(1, 3, 300), mk(2, 0, 300)], ['Go'], NOW).map(i => i.id), [2, 1]);
    assert.deepEqual(m.rank([mk(1, 0, 40000), mk(2, 0, 300)], ['Go'], NOW).map(i => i.id), [2, 1]);
});

const mission = { id: 1, login: 'Alice', repo: 'o/r', number: 7, started_at: ago(5) };
const pr = (over = {}) => ({ pull_request: { merged_at: ago(1) }, user: { login: 'alice' }, repository_url: 'https://api.github.com/repos/O/R',
    title: 'Fix the typo', body: 'Fixes #7', html_url: 'https://github.com/o/r/pull/9', ...over });

test('matchPr: own PR, same repo, and it names the issue', () => {
    assert.ok(m.matchPr([pr()], mission));
    assert.ok(m.matchPr([pr({ body: null, title: 'Fix typo (#7)' })], mission));
    assert.ok(m.matchPr([pr({ body: 'See https://github.com/O/R/issues/7' })], mission));
});

test('matchPr: someone else\'s PR or a PR for a different issue earns nothing', () => {
    assert.equal(m.matchPr([pr({ user: { login: 'bob' } })], mission), null);
    assert.equal(m.matchPr([pr({ body: 'Fixes #70' })], mission), null);
    assert.equal(m.matchPr([pr({ body: 'Fixes other/repo#7' })], mission), null);
    assert.equal(m.matchPr([pr({ body: 'see https://github.com/x/y/issues/7' })], mission), null);
    assert.equal(m.matchPr([pr({ body: 'Small cleanup' })], mission), null);
    assert.equal(m.matchPr([{ ...pr(), pull_request: undefined }], mission), null);
});

function fakeStore(missions = []) {
    const calls = { saved: [], updates: [], pruned: null };
    return {
        calls,
        saveIssues: async l => { calls.saved.push(...l); return l.length; },
        pruneIssues: async c => { calls.pruned = c; },
        missionsToCheck: async () => missions,
        updateMission: async (mission, p) => { calls.updates.push([mission.id, p]); },
    };
}

test('refreshIssues: saves issues from good repos only, one repo lookup per repo', async () => {
    const store = fakeStore();
    let repoCalls = 0;
    const gh = async path => {
        if (path.startsWith('/search')) return { items: [item({ id: 1 }), item({ id: 3, number: 9 }), item({ id: 2, number: 8, repository_url: 'https://api.github.com/repos/o/bad' })] };
        repoCalls++;
        return path.endsWith('/bad') ? repo({ fork: true }) : repo();
    };
    const out = await m.refreshIssues(store, { gh, languages: ['Go'], now: NOW, wait: noWait });
    assert.equal(out.saved, 2);
    assert.equal(repoCalls, 2);
    assert.deepEqual(store.calls.saved.map(i => [i.id, i.language, i.repo_stars]), [[1, 'Go', 500], [3, 'Go', 500]]);
    assert.ok(store.calls.pruned < NOW);
});

test('refreshIssues: repo budget caps lookups; unchecked repos are not saved', async () => {
    const store = fakeStore();
    const gh = async path => (path.startsWith('/search')
        ? { items: [item({ id: 1 }), item({ id: 2, number: 8, repository_url: 'https://api.github.com/repos/o/two' })] } : repo());
    await m.refreshIssues(store, { gh, languages: ['Go'], repoBudget: 1, now: NOW, wait: noWait });
    assert.deepEqual(store.calls.saved.map(i => i.id), [1]);
});

test('refreshIssues: a rate limit ends the run but keeps what was saved; a real error is thrown', async () => {
    const store = fakeStore();
    let n = 0;
    const gh = async path => { if (path.startsWith('/search') && n++) throw limited(); return path.startsWith('/search') ? { items: [item()] } : repo(); };
    const out = await m.refreshIssues(store, { gh, languages: ['Go', 'Rust'], now: NOW, wait: noWait });
    assert.equal(out.limited, true);
    assert.equal(store.calls.saved.length, 1);
    await assert.rejects(m.refreshIssues(fakeStore(), { gh: async () => { throw new Error('boom'); }, languages: ['Go'], wait: noWait }), /boom/);
});

test('one search covers all three label spellings', () => {
    assert.match(m.issueQuery('C++'), /language:"C\+\+" label:"good first issue","good-first-issue",beginner/);
});

const live = (over = {}) => ({ id: 1, login: 'alice', repo: 'o/r', number: 7, status: 'active', started_at: ago(5), ...over });
// GitHub fake: which PR searches find something, and what the issue looks like.
const github = ({ merged = [], open = [], issue = { state: 'open', assignees: [] } } = {}) => async path => {
    const p = decodeURIComponent(path);
    if (p.includes('is:merged')) return { items: merged };
    if (p.includes('is:open')) return { items: open };
    return issue;
};
const statuses = store => store.calls.updates.map(u => u[1].status);

test('checkMissions: merged PR is credited with its link and merge time', async () => {
    const store = fakeStore([live()]);
    const out = await m.checkMissions(store, { gh: github({ merged: [pr()] }), now: NOW, wait: noWait });
    assert.equal(out.merged, 1);
    assert.deepEqual(store.calls.updates[0][1], { status: 'merged', pr_url: 'https://github.com/o/r/pull/9', merged_at: ago(1) });
});

test('checkMissions: merged PR for a different issue, or merged before they took it, is not credited', async () => {
    for (const merged of [pr({ body: 'Fixes #8' }), pr({ pull_request: { merged_at: ago(6) } })]) {
        const store = fakeStore([live()]);
        await m.checkMissions(store, { gh: github({ merged: [merged] }), now: NOW, wait: noWait });
        assert.deepEqual(statuses(store), ['active']);
    }
});

test('checkMissions: searches only the issue\'s own repo, so a PR merged into a fork never appears', async () => {
    const seen = [];
    await m.checkMissions(fakeStore([live()]), { gh: async p => { seen.push(decodeURIComponent(p)); return { items: [], state: 'open' }; }, now: NOW, wait: noWait });
    assert.ok(seen.filter(p => p.startsWith('/search')).every(p => p.includes('repo:o/r ') && p.includes('author:alice')));
});

test('checkMissions: issue closed in the last 3 days stays active (their merge may not be searchable yet)', async () => {
    const store = fakeStore([live()]);
    await m.checkMissions(store, { gh: github({ issue: { state: 'closed', closed_at: ago(1), assignees: [] } }), now: NOW, wait: noWait });
    assert.deepEqual(statuses(store), ['active']);
});

test('checkMissions: open PR moves to pr_open and is counted once', async () => {
    const store = fakeStore([live(), live({ id: 2, status: 'pr_open' })]);
    const out = await m.checkMissions(store, { gh: github({ open: [pr({ pull_request: {} })] }), now: NOW, wait: noWait });
    assert.equal(out.opened, 1);
    assert.deepEqual(statuses(store), ['pr_open', 'pr_open']);
});

test('checkMissions: PR closed without merging goes back to active and loses its PR link', async () => {
    const store = fakeStore([live({ status: 'pr_open', pr_url: 'x' })]);
    await m.checkMissions(store, { gh: github(), now: NOW, wait: noWait });
    assert.deepEqual(store.calls.updates[0][1], { status: 'active' }); // the store clears pr_url when it is not given
});

test('checkMissions: issue closed, deleted, or given to someone else -> lost', async () => {
    for (const issue of [{ state: 'closed', closed_at: ago(4), assignees: [] }, null, { state: 'open', assignees: [{ login: 'bob' }] }]) {
        const store = fakeStore([live()]);
        const out = await m.checkMissions(store, { gh: github({ issue }), now: NOW, wait: noWait });
        assert.equal(out.lost, 1, JSON.stringify(issue));
        assert.deepEqual(statuses(store), ['lost']);
    }
});

test('checkMissions: being assigned yourself is fine; 45 days with no PR expires', async () => {
    const mine = fakeStore([live()]);
    await m.checkMissions(mine, { gh: github({ issue: { state: 'open', assignees: [{ login: 'Alice' }] } }), now: NOW, wait: noWait });
    assert.deepEqual(statuses(mine), ['active']);
    const old = fakeStore([live({ started_at: ago(46) })]);
    assert.equal((await m.checkMissions(old, { gh: github(), now: NOW, wait: noWait })).expired, 1);
    assert.deepEqual(statuses(old), ['expired']);
});

test('checkMissions: a rate limit stops without touching the mission', async () => {
    const store = fakeStore([live()]);
    const out = await m.checkMissions(store, { gh: async () => { throw limited(); }, now: NOW, wait: noWait });
    assert.equal(out.limited, true);
    assert.equal(store.calls.updates.length, 0);
});

test('contributions: groups merged PRs by repo, sums commits, counts months, marks GitSpace ones', async () => {
    const hit = (repo, number, mergedAt) => ({ number, title: 'PR ' + number, html_url: `https://github.com/${repo}/pull/${number}`,
        repository_url: `https://api.github.com/repos/${repo}`, pull_request: { merged_at: mergedAt } });
    const seen = [];
    const gh = async path => {
        const p = decodeURIComponent(path);
        seen.push(p);
        if (p.includes('is:merged')) return { total_count: 3, items: [hit('a/x', 1, ago(40)), hit('b/y', 2, ago(2)), hit('a/x', 3, ago(1))] };
        if (p.includes('is:open')) return { total_count: 4, items: [] };
        return { commits: Number(p.split('/').pop()) * 2 }; // PR n has 2n commits
    };
    const d = await m.contributions(gh, 'alice', { viaGitSpace: ['https://github.com/b/y/pull/2'], detail: 2, now: NOW });
    assert.ok(seen[0].includes('author:alice -user:alice is:merged')); // other people's repos only
    assert.deepEqual([d.merged, d.open, d.projects, d.viaGitSpace, d.commitsCounted], [3, 4, 2, 1, 2]);
    assert.equal(d.commits, 6 + 4); // only the latest 2 PRs (#3 and #2) were looked up
    assert.deepEqual(d.repos.map(r => [r.repo, r.prs.length, r.commits]), [['a/x', 2, 6], ['b/y', 1, 4]]);
    assert.equal(d.months.length, 12);
    assert.equal(d.months.at(-1).merged, 2);
    assert.equal(d.months.reduce((s, x) => s + x.merged, 0), 3);

    // Out of quota while counting commits: the dashboard still comes back, with what was counted.
    const busy = async path => (path.startsWith('/search') ? gh(path) : (() => { throw limited(); })());
    const partial = await m.contributions(busy, 'alice', { now: NOW });
    assert.deepEqual([partial.merged, partial.commits, partial.commitsCounted], [3, 0, 0]);
});

test('projectIssues: one search over their projects, help wanted and small repos allowed, 2 per project', async () => {
    const seen = [];
    const gh = async path => {
        const p = decodeURIComponent(path);
        seen.push(p);
        if (p.startsWith('/search')) {
            return { items: [item({ id: 1 }), item({ id: 3, number: 9 }), item({ id: 4, number: 10 }), item({ id: 2, number: 8, repository_url: 'https://api.github.com/repos/busy/gh' })] };
        }
        if (p.endsWith('/gh')) throw limited(); // GitHub busy for the repo lookup: still listed, without language
        return repo({ stargazers_count: 3, language: 'Go' });
    };
    const out = await m.projectIssues(gh, ['o/r', 'busy/gh'], NOW);
    assert.match(seen[0], /archived:false .*"help wanted".* repo:o\/r repo:busy\/gh/);
    assert.deepEqual(out.map(i => [i.id, i.language, i.repo_stars]), [[1, 'Go', 3], [3, 'Go', 3], [2, 'Other', 0]]);
    assert.deepEqual(await m.projectIssues(gh, [], NOW), []);
    const many = Array.from({ length: 40 }, (_, i) => `someone-long/project-number-${i}`);
    await m.projectIssues(async p => (p.startsWith('/search') ? (seen.push(decodeURIComponent(p)), { items: [] }) : null), many, NOW);
    assert.ok(decodeURIComponent(seen.at(-1)).split('q=')[1].length <= 256); // GitHub rejects longer queries
});

test('makeGh: missing or blocked gives null; real rate limits throw limited; other failures throw', async () => {
    const reply = (status, h = {}) => ({ status, ok: status < 300, headers: { get: k => h[k] ?? null }, json: async () => ({ ok: 1 }) });
    const gh = (...a) => m.makeGh(async () => reply(...a), 't')('/x');
    for (const s of [404, 410, 451, 403]) assert.equal(await gh(s), null, String(s));
    await assert.rejects(gh(403, { 'retry-after': '30' }), e => e.limited);
    await assert.rejects(gh(403, { 'x-ratelimit-remaining': '0' }), e => e.limited);
    await assert.rejects(gh(429), e => e.limited);
    await assert.rejects(gh(500), /GitHub 500/);
    assert.deepEqual(await gh(200), { ok: 1 });
});
