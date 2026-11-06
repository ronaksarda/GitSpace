const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Set ENGINE_BIN to test a freshly built engine; otherwise uses the one the server would use.
const enginePath = process.env.ENGINE_BIN || path.join(__dirname, '../src/engine',
    process.platform === 'win32' ? 'gitspace_engine.exe' : 'gitspace_engine');

const generateLayoutJS = require('../src/backend/routes/api')({}, null).generateLayoutJS;

// Deterministic fixture: mix of tiny and max-radius (18) repos so large neighbours are exercised.
const langs = ['JavaScript', 'C++', 'Python', 'Rust', 'Go', 'TypeScript'];
const repos = Array.from({ length: 80 }, (_, i) => ({
    name: `repo-${String(i).padStart(2, '0')}`,
    language: langs[i % langs.length],
    stargazers_count: (i * 7919) % 15000,
    size: (i * 104729) % 200000,
    fork: i % 5 === 0,
    html_url: `https://github.com/x/repo-${i}`
}));
const baseX = 1234.5, baseY = -6789.25;

test('C++ engine layout matches JS layout', { skip: !fs.existsSync(enginePath) && `no engine at ${enginePath}` }, () => {
    const sorted = [...repos].sort((a, b) => a.name.localeCompare(b.name));
    // same input format as generateLayoutEngine in routes/api.js
    const input = [`${baseX} ${baseY}`, ...sorted.map(r =>
        `${r.stargazers_count}\t${r.size}\t${r.fork ? 1 : 0}\t${r.language}\t${r.name}\t${r.html_url}`)].join('\n') + '\n';
    const proc = spawnSync(enginePath, { input, encoding: 'utf8' });
    assert.strictEqual(proc.status, 0, proc.stderr);

    const cpp = JSON.parse(proc.stdout);
    const js = generateLayoutJS(sorted, baseX, baseY).repos;
    assert.strictEqual(cpp.length, js.length);
    js.forEach((j, i) => {
        const c = cpp[i];
        const cx = baseX + (c.x - baseX) * 3.5;
        const cy = baseY + (c.y - baseY) * 3.5;
        assert.strictEqual(c.name, j.name);
        assert.ok(Math.abs(cx - j.x) < 0.01 && Math.abs(cy - j.y) < 0.01,
            `${j.name}: cpp (${cx}, ${cy}) vs js (${j.x}, ${j.y})`);
    });
});
