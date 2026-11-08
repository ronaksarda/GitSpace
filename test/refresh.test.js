const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { refreshOne } = require('../src/backend/refresh');
const makeRouter = require('../src/backend/routes/api.js');

const router = makeRouter({}, (req, res, next) => next());
const user = { login: 'someone', cx: 100, cy: 200, avatar: 'a.png', repos_etag: '"old"' };

let saved, marked;
const db = {
    saveUserLayout: async (...args) => { saved = args; },
    markRefreshed: async (login, etag) => { marked = { login, etag }; },
};
beforeEach(() => { saved = null; marked = null; });

function mockFetch(status, body, etag) {
    global.fetch = async () => ({
        status, ok: status >= 200 && status < 300,
        headers: { get: (h) => (h.toLowerCase() === 'etag' ? etag : null) },
        json: async () => body,
    });
}

test('rebuilds the island in place, skips forks, and does not count as a sign-in', async () => {
    mockFetch(200, [
        { name: 'app', language: 'Go', stargazers_count: 5, size: 100, fork: false },
        { name: 'forked', language: 'Go', stargazers_count: 99, size: 100, fork: true },
    ], '"new"');
    assert.strictEqual(await refreshOne(db, router, user), 'updated');
    const [login, cx, cy, avatar, repos, opts] = saved;
    assert.deepStrictEqual([login, cx, cy, avatar], ['someone', 100, 200, 'a.png']);
    assert.deepStrictEqual(repos.map(r => r.name), ['app']);
    assert.deepStrictEqual(opts, { touchLogin: false });
    assert.deepStrictEqual(marked, { login: 'someone', etag: '"new"' });
});

test('unchanged accounts (304) are only marked, not rebuilt', async () => {
    mockFetch(304, null, null);
    assert.strictEqual(await refreshOne(db, router, user), 'unchanged');
    assert.strictEqual(saved, null);
    assert.deepStrictEqual(marked, { login: 'someone', etag: '"old"' });
});

test('rate limited: stops without touching anything', async () => {
    mockFetch(403, null, null);
    assert.strictEqual(await refreshOne(db, router, user), 'limited');
    assert.strictEqual(saved, null);
    assert.strictEqual(marked, null);
});
