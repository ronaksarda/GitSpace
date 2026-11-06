const { test, describe } = require('node:test');
const assert = require('node:assert');
const { analyzeRepo } = require('../src/backend/reviewer');

describe('Repo Reviewer Engine', () => {
    test('accurately scores a healthy, well-maintained repository', () => {
        const repoData = {
            name: 'clean-engine',
            full_name: 'acme/clean-engine',
            description: 'Ultra fast spatial simulation in pure C',
            language: 'C',
            stargazers_count: 1420,
            forks_count: 110,
            open_issues_count: 4,
            size: 2048,
            pushed_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(), // 3 days ago
            created_at: '2023-01-01T00:00:00Z',
            license: { spdx_id: 'MIT', name: 'MIT License' },
            archived: false,
            topics: ['systems', 'game-engine', 'c']
        };

        const languagesData = { 'C': 180000, 'Makefile': 2500 };
        const commitsData = [
            { commit: { message: 'feat: optimize spatial partitioning' } },
            { commit: { message: 'fix: pointer bounds check' } }
        ];

        const review = analyzeRepo(repoData, languagesData, commitsData);

        assert.ok(review.score >= 80, `Expected score >= 80, got ${review.score}`);
        assert.ok(['A+', 'A'].includes(review.grade), `Expected A/A+ grade, got ${review.grade}`);
        assert.strictEqual(review.metrics.license, 'MIT');
        assert.ok(review.insights.some(i => i.type === 'strength'));
        assert.ok(review.verdict.length > 0);
        assert.ok(!review.verdict.includes('—'), 'No em dashes allowed in verdict');
    });

    test('flags stale repository with missing license and high open issues', () => {
        const repoData = {
            name: 'abandoned-tool',
            full_name: 'ghost/abandoned-tool',
            description: '',
            language: 'JavaScript',
            stargazers_count: 12,
            forks_count: 2,
            open_issues_count: 85,
            size: 45000,
            pushed_at: '2021-01-01T00:00:00Z', // Years ago
            created_at: '2020-01-01T00:00:00Z',
            license: null,
            archived: false,
            topics: []
        };

        const review = analyzeRepo(repoData, { 'JavaScript': 50000 }, []);

        assert.ok(review.score < 60, `Expected score < 60, got ${review.score}`);
        assert.ok(['C', 'D', 'F'].includes(review.grade), `Expected lower grade, got ${review.grade}`);
        assert.ok(review.insights.some(i => i.type === 'warning' && i.label.toLowerCase().includes('license')));
        assert.ok(review.insights.some(i => i.type === 'warning' && (i.label.toLowerCase().includes('stale') || i.label.toLowerCase().includes('inactivity'))));
        assert.ok(review.recommendations.length >= 2);
    });

    test('verifies no em dashes exist anywhere in generated output', () => {
        const repoData = {
            name: 'test-dash',
            full_name: 'test/test-dash',
            description: 'Testing dash constraints',
            language: 'TypeScript',
            stargazers_count: 100,
            forks_count: 10,
            open_issues_count: 2,
            size: 1024,
            pushed_at: new Date().toISOString(),
            license: { spdx_id: 'Apache-2.0' },
            archived: false,
            topics: []
        };

        const review = analyzeRepo(repoData, {}, []);
        const serialized = JSON.stringify(review);
        assert.ok(!serialized.includes('—'), 'No em dashes (—) permitted');
        assert.ok(!serialized.includes('--'), 'No double dashes (--) permitted');
    });

    test('handles polyglot and bloat analysis correctly', () => {
        const repoData = {
            name: 'giant-monorepo',
            full_name: 'corp/giant-monorepo',
            description: 'Massive enterprise suite',
            language: 'Rust',
            stargazers_count: 50,
            forks_count: 10,
            open_issues_count: 5,
            size: 250000, // 250MB
            pushed_at: new Date().toISOString(),
            license: { spdx_id: 'MIT' },
            archived: false,
            topics: ['monorepo']
        };
        const langs = { 'Rust': 500000, 'Python': 300000, 'JavaScript': 200000, 'Go': 100000, 'C++': 90000, 'Shell': 10000 };
        const review = analyzeRepo(repoData, langs, []);
        assert.strictEqual(review.ponytailScore.rating, 'Heavyweight');
        assert.strictEqual(review.metrics.architectureType, 'Polyglot Multi-Stack');
    });
});
