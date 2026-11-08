// Store (sandbox file) and the HTTP routes together, with GitHub faked.
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.USE_SANDBOX = 'true';
process.env.SANDBOX_DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gs-missions-')), 'db.json');

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const db = require('../src/backend/database');
const store = require('../src/backend/missionsStore');
const makeRouter = require('../src/backend/routes/missions');

const issue = (id, over = {}) => ({
    id, repo: 'o/r' + id, number: id, title: 'Issue ' + id, url: 'https://github.com/o/r' + id + '/issues/' + id, language: 'Go',
    repo_stars: 300, repo_pushed_at: new Date().toISOString(), comments: 0, created_at: new Date(Date.now() - 5 * 864e5).toISOString(), ...over,
});

let server, base, ghState, ghFails = false, ghBusy = false, freshKotlin = false;
const call = (p, login, method = 'GET') => fetch(base + p, { method, headers: login ? { 'x-login': login } : {} }).then(async r => ({ status: r.status, body: await r.json() }));

before(async () => {
    const data = db.raw().loadSandboxData();
    for (const login of ['alice', 'bob', 'cara']) data.users[login] = { login, cx: 0, cy: 0 };
    data.repos.push({ login: 'alice', name: 'a', language: 'Go' }, { login: 'alice', name: 'b', language: 'Go' }, { login: 'alice', name: 'c', language: 'Rust' });
    db.raw().saveSandboxData(data);
    await store.saveIssues([1, 2, 3, 4].map(i => issue(i)).concat(issue(5, { language: 'Perl' })));
    ghState = { state: 'open', assignees: [] };
    const gh = async path => {
        if (ghFails) throw new Error('network');
        if (ghBusy && path.startsWith('/search')) throw Object.assign(new Error('limited'), { limited: true });
        const p = decodeURIComponent(path);
        if (p.includes('author:fay') && p.includes('is:merged')) return { total_count: 1, items: [{ number: 3, title: 'Old fix', html_url: 'https://github.com/fay/proj/pull/3',
            repository_url: 'https://api.github.com/repos/kind/proj', pull_request: { merged_at: new Date().toISOString() } }] };
        if (p.includes('help wanted') && p.includes('repo:kind/proj')) return { items: [{ id: 501, number: 50, title: 'Next step', html_url: 'https://github.com/kind/proj/issues/50',
            repository_url: 'https://api.github.com/repos/kind/proj', body: 'y'.repeat(50), comments: 0, created_at: new Date(Date.now() - 3 * 864e5).toISOString() }] };
        if (freshKotlin && p.includes('language:"Kotlin"')) return { items: [{ id: 701, number: 1, title: 'Fresh one', html_url: 'https://github.com/kt/app/issues/1',
            repository_url: 'https://api.github.com/repos/kt/app', body: 'z'.repeat(50), comments: 0, created_at: new Date(Date.now() - 864e5).toISOString() }] };
        if (p === '/repos/kt/app') return { stargazers_count: 300, pushed_at: new Date().toISOString(), created_at: '2020-01-01T00:00:00Z' };
        if (p === '/repos/kind/proj') return { stargazers_count: 5, language: 'Go', pushed_at: new Date().toISOString() };
        return ghState;
    };
    const app = express();
    app.use(makeRouter({ db, store, gh, getLogin: async req => req.headers['x-login'] || null, searchGap: async () => {} }));
    server = app.listen(0);
    base = 'http://127.0.0.1:' + server.address().port;
});
after(() => { server.closeAllConnections(); server.close(); });

test('needs sign-in', async () => {
    assert.equal((await call('/api/missions/for-you')).status, 401);
    assert.equal((await call('/api/missions/1/start', null, 'POST')).status, 401);
});

test('for-you: the person\'s languages only, best first, other languages left out', async () => {
    const r = await call('/api/missions/for-you', 'alice');
    assert.deepEqual(r.body.languages, ['Go', 'Rust']);
    assert.deepEqual(r.body.issues.map(i => i.id).sort(), [1, 2, 3, 4]);
});

test('for-you: at most 2 issues from one repo', async () => {
    await store.saveIssues([11, 12, 13].map(i => issue(i, { repo: 'busy/repo', language: 'Rust' })));
    const r = await call('/api/missions/for-you', 'alice');
    assert.equal(r.body.issues.filter(i => i.repo === 'busy/repo').length, 2);
    for (const i of [11, 12, 13]) await store.setIssueState(i, 'closed');
});

test('start: takes a mission, hides it from for-you, lists it in mine', async () => {
    const s = await call('/api/missions/1/start', 'alice', 'POST');
    assert.equal(s.status, 200);
    assert.equal(s.body.status, 'active');
    assert.ok(!(await call('/api/missions/for-you', 'alice')).body.issues.some(i => i.id === 1));
    assert.equal((await call('/api/missions/mine', 'alice')).body.length, 1);
    assert.equal((await call('/api/missions/1/start', 'alice', 'POST')).status, 409); // already took it
});

test('start: at most 2 active missions per person', async () => {
    assert.equal((await call('/api/missions/2/start', 'alice', 'POST')).status, 200);
    const third = await call('/api/missions/3/start', 'alice', 'POST');
    assert.equal(third.status, 409);
    assert.match(third.body.error, /2 missions/);
});

test('start: at most 2 GitSpace people on one issue', async () => {
    assert.equal((await call('/api/missions/1/start', 'bob', 'POST')).status, 200);
    const cara = await call('/api/missions/1/start', 'cara', 'POST');
    assert.equal(cara.status, 409);
    assert.match(cara.body.error, /Two GitSpace people/);
    assert.ok(!(await call('/api/missions/for-you', 'cara')).body.issues.some(i => i.id === 1));
});

test('drop frees a slot, and the issue can be taken again later', async () => {
    const mine = (await call('/api/missions/mine', 'alice')).body;
    assert.equal((await call(`/api/missions/${mine[0].id}/drop`, 'alice', 'POST')).status, 200);
    assert.equal((await call(`/api/missions/${mine[0].id}/drop`, 'alice', 'POST')).status, 404); // already dropped
    await store.updateMission(mine[0], { status: 'active' }); // a check job that started before the drop
    assert.equal((await call('/api/missions/mine', 'alice')).body.length, 1); // still dropped
    assert.equal((await call('/api/missions/3/start', 'alice', 'POST')).status, 200);
});

test('start: GitHub says taken or closed, so it is refused and marked', async () => {
    ghState = { state: 'open', assignees: [{ login: 'someone' }] };
    const taken = await call('/api/missions/4/start', 'cara', 'POST');
    assert.equal(taken.status, 409);
    assert.equal((await store.getIssue(4)).state, 'taken');
    ghState = { state: 'closed' };
    assert.equal((await call('/api/missions/2/start', 'cara', 'POST')).status, 409);
    assert.equal((await call('/api/missions/4/start', 'cara', 'POST')).status, 404); // marked taken: gone from the list
    ghState = null; // deleted on GitHub
    assert.equal((await call('/api/missions/5/start', 'cara', 'POST')).status, 409);
    ghState = { state: 'open', assignees: [] };
});

test('after a merge: for-you also offers issues from that project, kept out of everyone else\'s list, and startable', async () => {
    const data = db.raw().loadSandboxData();
    data.users.fay = { login: 'fay', cx: 0, cy: 0 };
    db.raw().saveSandboxData(data);
    const r = await call('/api/missions/for-you', 'fay');
    assert.deepEqual(r.body.fromProjects.map(i => [i.id, i.repo]), [[501, 'kind/proj']]);
    assert.ok(!r.body.issues.some(i => i.id === 501)); // not listed twice
    assert.equal((await store.getIssue(501)).state, 'project');
    assert.ok(!(await call('/api/missions/for-you', 'alice')).body.issues.some(i => i.id === 501)); // Go, but not alice's
    assert.equal((await call('/api/missions/contributions', 'fay')).body.merged, 1);
    assert.equal((await call('/api/missions/501/start', 'fay', 'POST')).status, 200);
    assert.ok(!(await call('/api/missions/for-you', 'fay')).body.fromProjects.some(i => i.id === 501));
});

test('GitHub busy: contributions says so (503), for-you still works without the project section', async () => {
    ghBusy = true;
    const c = await call('/api/missions/contributions', 'gus'); // nobody cached yet
    assert.equal(c.status, 503);
    assert.match(c.body.error, /busy/);
    const f = await call('/api/missions/for-you', 'alice');
    assert.equal(f.status, 200);
    assert.deepEqual(f.body.fromProjects, []);
    ghBusy = false;
});

test('nobody can drop someone else\'s mission, and a merged one cannot be dropped', async () => {
    const fays = (await call('/api/missions/mine', 'fay')).body[0];
    assert.equal((await call(`/api/missions/${fays.id}/drop`, 'alice', 'POST')).status, 404);
    assert.equal((await call('/api/missions/mine', 'fay')).body[0].status, 'active');
    await store.updateMission(fays, { status: 'merged', pr_url: 'u', merged_at: new Date().toISOString() });
    assert.equal((await call(`/api/missions/${fays.id}/drop`, 'fay', 'POST')).status, 404);
    assert.equal((await call('/api/missions/mine', 'fay')).body[0].status, 'merged');
});

test('few issues for their languages: for-you fetches fresh ones right away; Refresh works once per 10 minutes', async () => {
    const data = db.raw().loadSandboxData();
    data.users.hal = { login: 'hal', cx: 0, cy: 0 };
    data.repos.push({ login: 'hal', name: 'h', language: 'Kotlin' });
    db.raw().saveSandboxData(data);
    freshKotlin = true;
    const r = await call('/api/missions/for-you', 'hal');
    assert.deepEqual(r.body.languages, ['Kotlin']);
    assert.deepEqual(r.body.issues.map(i => i.id), [701]);
    assert.ok(r.body.refreshedAt);
    const again = await call('/api/missions/refresh', 'hal', 'POST');
    assert.equal(again.status, 429);
    assert.match(again.body.error, /Try again in \d+ min/);
    freshKotlin = false;
});

test('start: an issue assigned to the person themself is fine', async () => {
    await store.saveIssues([issue(7)]);
    const data = db.raw().loadSandboxData();
    data.users.eve = { login: 'eve', cx: 0, cy: 0 };
    db.raw().saveSandboxData(data);
    ghState = { state: 'open', assignees: [{ login: 'Eve' }] };
    assert.equal((await call('/api/missions/7/start', 'eve', 'POST')).status, 200);
    ghState = { state: 'open', assignees: [] };
});

test('start: GitHub not answering does not block taking an issue', async () => {
    const data = db.raw().loadSandboxData();
    data.users.dan = { login: 'dan', cx: 0, cy: 0 };
    db.raw().saveSandboxData(data);
    await store.saveIssues([issue(6)]);
    ghFails = true;
    assert.equal((await call('/api/missions/6/start', 'dan', 'POST')).status, 200);
    ghFails = false;
});

test('start: bad id, unknown issue, and someone with no island', async () => {
    assert.equal((await call('/api/missions/abc/start', 'alice', 'POST')).status, 400);
    assert.equal((await call('/api/missions/999/start', 'alice', 'POST')).status, 404);
    await store.saveIssues([issue(9)]);
    assert.equal((await call('/api/missions/9/start', 'nobody', 'POST')).status, 403);
});

test('merged missions are counted and cannot be started again', async () => {
    const m = (await call('/api/missions/mine', 'alice')).body.find(x => x.issue_id === 3);
    const before = await store.countMerged();
    await store.updateMission(m, { status: 'merged', pr_url: 'https://github.com/o/r3/pull/1', merged_at: new Date().toISOString() });
    assert.equal(await store.countMerged(), before + 1);
    assert.equal((await call('/api/missions/3/start', 'alice', 'POST')).status, 409);
    assert.ok(!(await call('/api/missions/for-you', 'alice')).body.issues.some(i => i.id === 3));
});

test('expired or lost missions come back in for-you and can be taken again', async () => {
    const m = (await call('/api/missions/mine', 'dan')).body[0];
    await store.updateMission(m, { status: 'expired' });
    const data = db.raw().loadSandboxData();
    data.repos.push({ login: 'dan', name: 'd', language: 'Go' });
    db.raw().saveSandboxData(data);
    assert.ok((await call('/api/missions/for-you', 'dan')).body.issues.some(i => i.id === 6));
    assert.equal((await call('/api/missions/6/start', 'dan', 'POST')).status, 200);
});

test('a check that read the mission before it was dropped and retaken cannot overwrite the new one', async () => {
    const before = (await call('/api/missions/mine', 'dan')).body[0];
    await call(`/api/missions/${before.id}/drop`, 'dan', 'POST');
    await new Promise(r => setTimeout(r, 5));
    assert.equal((await call('/api/missions/6/start', 'dan', 'POST')).status, 200);
    await store.updateMission(before, { status: 'expired' }); // stale decision from the old run
    assert.equal((await call('/api/missions/mine', 'dan')).body[0].status, 'active');
});

test('issues the refresh has not seen for 13 hours leave for-you; old unused ones are pruned, ones with missions stay', async () => {
    assert.ok((await call('/api/missions/for-you', 'alice')).body.issues.some(i => i.id === 9));
    const data = db.raw().loadSandboxData();
    for (const i of Object.values(data.issues)) i.fetched_at = new Date(Date.now() - 14 * 3600e3).toISOString();
    db.raw().saveSandboxData(data);
    assert.equal((await call('/api/missions/for-you', 'alice')).body.issues.length, 0);
    await store.pruneIssues(Date.now());
    assert.equal(await store.getIssue(9), null); // nobody took it
    assert.ok(await store.getIssue(1)); // bob's mission still needs its title and link
    assert.equal((await call('/api/missions/mine', 'bob')).body[0].title, 'Issue 1');
});
