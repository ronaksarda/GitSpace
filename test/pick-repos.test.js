const { test } = require('node:test');
const assert = require('node:assert');
const makeRouter = require('../src/backend/routes/api.js');

const { pickIslandRepos } = makeRouter({}, (req, res, next) => next());

test('big accounts keep 60 repos: pinned first, then by stars', () => {
    const repos = Array.from({ length: 200 }, (_, i) => ({ name: `r${i}`, stargazers_count: i, forks_count: 0 }));
    const picked = pickIslandRepos(repos, ['r3']);
    assert.strictEqual(picked.length, 60);
    assert.strictEqual(picked[0].name, 'r3');
    assert.strictEqual(picked[1].name, 'r199');
    assert.ok(!picked.some(r => r.name === 'r100'));
});

test('pinRepos tags pinned repos with their pinned place, case-insensitive', () => {
    process.env.USE_SANDBOX = 'true'; // database.js exits without a DB otherwise; pinRepos never touches it
    const { pinRepos } = require('../src/backend/database.js');
    const out = pinRepos([{ name: 'GitSpace' }, { name: 'Codes' }, { name: 'couch' }], ['gitspace', 'couch']);
    assert.deepStrictEqual(out.map(r => r.pin), [0, undefined, 1]);
});

test('small accounts keep every repo', () => {
    const repos = Array.from({ length: 12 }, (_, i) => ({ name: `r${i}` }));
    assert.strictEqual(pickIslandRepos(repos, []).length, 12);
});
