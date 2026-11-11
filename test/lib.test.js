const { test } = require('node:test');
const assert = require('node:assert');

// ESM helpers; load once for all tests.
let helpers;

test.before(async () => {
  helpers = await import('../web/src/lib.js');
});

test('safeHttpUrl adds https when scheme missing', () => {
  assert.strictEqual(helpers.safeHttpUrl('example.com'), 'https://example.com/');
  assert.strictEqual(helpers.safeHttpUrl('https://example.com/path'), 'https://example.com/path');
  assert.strictEqual(helpers.safeHttpUrl('http://example.com'), 'http://example.com/');
});

test('safeHttpUrl rejects non-http schemes such as javascript', () => {
  assert.strictEqual(helpers.safeHttpUrl('javascript:alert(1)'), null);
  assert.strictEqual(helpers.safeHttpUrl(''), null);
  assert.strictEqual(helpers.safeHttpUrl(null), null);
});

test('formatSize formats KB/MB/GB and zero', () => {
  assert.strictEqual(helpers.formatSize(0), '0 KB');
  assert.strictEqual(helpers.formatSize(512), '512 KB');
  assert.strictEqual(helpers.formatSize(1536), '1.5 MB');
  assert.strictEqual(helpers.formatSize(1024 * 1024 * 2), '2.0 GB');
});

test('timeAgo handles relative times and bad input', () => {
  const now = Date.now();
  assert.strictEqual(helpers.timeAgo(new Date(now - 30 * 60 * 1000).toISOString()), 'Within the hour');
  assert.strictEqual(helpers.timeAgo(new Date(now - 3 * 3600 * 1000).toISOString()), '3 h ago');
  assert.strictEqual(helpers.timeAgo(new Date(now - 2 * 86400 * 1000).toISOString()), '2 d ago');
  assert.strictEqual(helpers.timeAgo('not a date'), 'Unknown');
});

test('islandLanguages ranks languages and treats null as Other', () => {
  const buildings = [
    { language: 'JavaScript' },
    { language: 'JavaScript' },
    { language: null },
    { language: 'Python' },
  ];
  const result = helpers.islandLanguages(buildings, 3);
  assert.deepStrictEqual(result.map(r => r.lang), ['JavaScript', 'Other', 'Python']);
  assert.strictEqual(result[0].pct, 50);
  assert.strictEqual(result[1].pct, 25);
});

test('avatarUrl falls back for non-https input', () => {
  assert.strictEqual(
    helpers.avatarUrl('https://example.com/a.png', 'user', 80),
    'https://example.com/a.png'
  );
  assert.strictEqual(
    helpers.avatarUrl('http://example.com/a.png', 'octocat', 100),
    'https://avatars.githubusercontent.com/octocat?s=100'
  );
  assert.strictEqual(
    helpers.avatarUrl(null, 'octocat', 40),
    'https://avatars.githubusercontent.com/octocat?s=40'
  );
});
