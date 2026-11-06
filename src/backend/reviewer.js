// Ponytail: Standard library only, zero heavy external AI dependencies.
// Fast deterministic multi-dimensional repository evaluation.

function calculateGrade(score) {
    if (score >= 95) return 'A+';
    if (score >= 85) return 'A';
    if (score >= 75) return 'B';
    if (score >= 60) return 'C';
    if (score >= 45) return 'D';
    return 'F';
}

function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 KB';
    const kb = bytes; // GitHub size is already in KB
    if (kb < 1024) return kb + ' KB';
    const mb = (kb / 1024).toFixed(1);
    if (mb < 1024) return mb + ' MB';
    return (kb / (1024 * 1024)).toFixed(2) + ' GB';
}

function analyzeRepo(repoData, languagesData = {}, commitsData = []) {
    let score = 50; // Baseline
    const insights = [];
    const recommendations = [];

    const stars = repoData.stargazers_count || repoData.stars || 0;
    const forks = repoData.forks_count || repoData.forks || 0;
    const openIssues = repoData.open_issues_count || repoData.open_issues || 0;
    const sizeKB = repoData.size || 0;
    const language = repoData.language || 'Other';
    const licenseName = repoData.license?.spdx_id || repoData.license?.name || (repoData.license ? 'Custom' : null);
    const hasDescription = Boolean(repoData.description && repoData.description.trim().length > 0);
    const topics = Array.isArray(repoData.topics) ? repoData.topics : [];
    const isArchived = Boolean(repoData.archived);

    // 1. Inactivity & Recency
    const now = Date.now();
    const lastPushedTime = repoData.pushed_at ? new Date(repoData.pushed_at).getTime() : 0;
    const daysSincePush = lastPushedTime ? Math.max(0, Math.floor((now - lastPushedTime) / (1000 * 60 * 60 * 24))) : 999;

    let activityStatus = 'Active';
    if (daysSincePush < 14) {
        score += 15;
        activityStatus = 'Hyper-Active';
        insights.push({
            type: 'strength',
            label: 'Fresh Codebase',
            detail: 'Pushed within the last 2 weeks (' + daysSincePush + ' days ago).'
        });
    } else if (daysSincePush < 60) {
        score += 8;
        activityStatus = 'Active';
        insights.push({
            type: 'strength',
            label: 'Maintained',
            detail: 'Active within the last 2 months.'
        });
    } else if (daysSincePush < 180) {
        score -= 5;
        activityStatus = 'Quiet';
        insights.push({
            type: 'tip',
            label: 'Slow Velocity',
            detail: 'Last commit was over ' + Math.floor(daysSincePush / 30) + ' months ago.'
        });
        recommendations.push('Refresh dependencies and verify build status.');
    } else {
        score -= 22;
        activityStatus = 'Stale';
        insights.push({
            type: 'warning',
            label: 'Inactivity Warning',
            detail: 'No pushes in ' + Math.floor(daysSincePush / 30) + ' months. Project may be abandoned.'
        });
        recommendations.push('Mark project status in README or archive if discontinued.');
    }

    // 2. License check
    if (licenseName && licenseName !== 'NOASSERTION') {
        score += 12;
        insights.push({
            type: 'strength',
            label: 'Open Source License',
            detail: 'Licensed under ' + licenseName + '.'
        });
    } else {
        score -= 15;
        insights.push({
            type: 'warning',
            label: 'Missing License',
            detail: 'No open-source license detected. Legal ambiguity restricts contributions.'
        });
        recommendations.push('Add an explicit OSI license like MIT, Apache-2.0, or MPL-2.0.');
    }

    // 3. Documentation & Metadata
    if (hasDescription) {
        score += 8;
    } else {
        score -= 10;
        insights.push({
            type: 'warning',
            label: 'Missing Description',
            detail: 'No repository summary provided on GitHub.'
        });
        recommendations.push('Write a crisp one-sentence description explaining the problem solved.');
    }

    if (topics.length >= 3) {
        score += 5;
    } else if (topics.length === 0) {
        recommendations.push('Add topic tags to improve GitHub search discovery.');
    }

    // 4. Issue Management & Community Ratio
    if (openIssues === 0 && stars > 20) {
        score += 6;
        insights.push({
            type: 'strength',
            label: 'Zero Issue Backlog',
            detail: 'All issues resolved or tightly triaged.'
        });
    } else if (openIssues > 50 && openIssues > stars * 0.5) {
        score -= 12;
        insights.push({
            type: 'warning',
            label: 'High Unresolved Issues',
            detail: openIssues + ' open issues relative to project footprint.'
        });
        recommendations.push('Run an issue triage session to close stale tickets.');
    }

    // 5. Star & Fork traction
    if (stars >= 500) {
        score += 15;
        insights.push({
            type: 'strength',
            label: 'High Community Adoption',
            detail: stars.toLocaleString() + ' stars indicates established community trust.'
        });
    } else if (stars >= 50) {
        score += 8;
    }

    // 6. Language Architecture
    const langKeys = Object.keys(languagesData);
    let architectureType = 'Monolithic Single-Stack';
    if (langKeys.length > 5) {
        architectureType = 'Polyglot Multi-Stack';
        insights.push({
            type: 'tip',
            label: 'High Language Variety',
            detail: 'Spans ' + langKeys.length + ' languages. Watch for tooling complexity.'
        });
    } else if (langKeys.length > 0) {
        const primary = langKeys[0];
        architectureType = primary + ' Centered';
    }

    // 7. Ponytail Simplicity Score (KISS & Minimalist check)
    let simplicityRating = 'Optimal';
    let simplicityPoints = 85;
    if (sizeKB > 150000) {
        simplicityRating = 'Heavyweight';
        simplicityPoints = 50;
        insights.push({
            type: 'warning',
            label: 'Repository Bloat',
            detail: 'Repository size is ' + formatBytes(sizeKB) + '. Check for checked-in binaries or git history bloat.'
        });
        recommendations.push('Use git-filter-repo or Git LFS to decouple massive assets.');
    } else if (sizeKB < 15000) {
        simplicityRating = 'Lean';
        simplicityPoints = 95;
        insights.push({
            type: 'strength',
            label: 'Lean Footprint',
            detail: 'Very compact footprint (' + formatBytes(sizeKB) + '). Fast cloning and minimal baggage.'
        });
    }

    if (isArchived) {
        score = Math.min(score, 45);
        insights.push({
            type: 'tip',
            label: 'Archived Repository',
            detail: 'Read-only archive. Preserved for reference.'
        });
    }

    // Clamp score
    const finalScore = Math.max(10, Math.min(100, Math.round(score)));
    const grade = calculateGrade(finalScore);

    // Senior Dev Verdict
    let verdict = '';
    if (finalScore >= 85) {
        verdict = 'Production grade repository with solid maintenance rhythm, clean scope, and healthy metadata.';
    } else if (finalScore >= 70) {
        verdict = 'Solid foundation with good potential. A few documentation or hygiene tune-ups will make it top tier.';
    } else if (finalScore >= 50) {
        verdict = 'Work in progress. Core code exists, but needs license clarity, fresher commits, and tighter issue backlog management.';
    } else {
        verdict = 'Legacy or dormant project. High maintenance debt or abandoned state. Needs active stewardship to be production ready.';
    }

    // Fallback recommendation if empty
    if (recommendations.length === 0) {
        recommendations.push('Maintain current CI/CD test automation and active release rhythm.');
    }

    return {
        score: finalScore,
        grade,
        verdict,
        metrics: {
            stars,
            forks,
            openIssues,
            sizeKB,
            sizeFormatted: formatBytes(sizeKB),
            primaryLanguage: language,
            license: licenseName || 'None',
            activityStatus,
            daysSincePush,
            isArchived,
            architectureType,
            languagesCount: langKeys.length
        },
        insights,
        recommendations,
        ponytailScore: {
            rating: simplicityRating,
            score: simplicityPoints
        }
    };
}

// Facts from the repo's real file tree (GitHub git/trees API, recursive). Every finding names what it saw.
function analyzeTree(tree = []) {
    const files = tree.filter(e => e && e.type === 'blob' && typeof e.path === 'string');
    const paths = files.map(f => f.path);
    const has = (re) => paths.filter(p => re.test(p));
    const insights = [];
    const recommendations = [];
    let delta = 0;

    const readme = has(/^readme(\.[a-z]+)?$/i);
    if (readme.length) {
        const size = files.find(f => f.path === readme[0]).size || 0;
        if (size < 300) {
            insights.push({ type: 'warning', label: 'Thin README', detail: `${readme[0]} is only ${size} bytes.` });
            recommendations.push('Add install steps and one usage example to the README.');
            delta -= 3;
        } else {
            insights.push({ type: 'strength', label: 'README', detail: `${readme[0]}, ${Math.round(size / 102.4) / 10} KB.` });
        }
    } else {
        insights.push({ type: 'warning', label: 'No README', detail: 'No README file in the repo root.' });
        recommendations.push('Add a README.md that says what this does and how to run it.');
        delta -= 8;
    }

    const tests = has(/(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[jt]sx?$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$/i);
    if (tests.length) {
        insights.push({ type: 'strength', label: 'Tests', detail: `${tests.length} test files, for example ${tests.slice(0, 2).join(', ')}.` });
        delta += 6;
    } else {
        insights.push({ type: 'warning', label: 'No tests found', detail: 'No test/, tests/, __tests__/ or *.test.* files.' });
        recommendations.push('Add one test for the most important function.');
        delta -= 6;
    }

    const ci = has(/^\.github\/workflows\/[^/]+\.ya?ml$|^\.gitlab-ci\.yml$|^\.circleci\//);
    if (ci.length) {
        insights.push({ type: 'strength', label: 'CI', detail: `${ci.length} workflow file(s): ${ci.slice(0, 2).join(', ')}.` });
        delta += 4;
    } else {
        insights.push({ type: 'info', label: 'No CI', detail: 'No GitHub Actions workflow in .github/workflows/.' });
        recommendations.push('Add a GitHub Actions workflow that runs the tests on each push.');
    }

    const secrets = has(/(^|\/)\.env(\.[a-z]+)?$|(^|\/)id_rsa$|\.pem$|(^|\/)credentials\.json$/i)
        .filter(p => !/\.env\.(example|sample|template)$/i.test(p));
    if (secrets.length) {
        insights.push({ type: 'warning', label: 'Possible secrets committed', detail: `Found ${secrets.slice(0, 3).join(', ')}.` });
        recommendations.push(`Remove ${secrets[0]} from git history and rotate any keys in it.`);
        delta -= 15;
    }

    const vendored = has(/(^|\/)(node_modules|venv|__pycache__)\//);
    if (vendored.length) {
        insights.push({ type: 'warning', label: 'Dependencies committed', detail: `${vendored.length} files inside node_modules/, venv/ or __pycache__/.` });
        recommendations.push('Add node_modules/, venv/ and __pycache__/ to .gitignore and remove them from the repo.');
        delta -= 5;
    }

    const big = files.filter(f => (f.size || 0) > 5 * 1024 * 1024).sort((a, b) => b.size - a.size);
    if (big.length) {
        insights.push({ type: 'warning', label: 'Large files', detail: `${big.length} file(s) over 5 MB, largest ${big[0].path} (${Math.round(big[0].size / 1048576)} MB).` });
        recommendations.push('Move large binaries to Git LFS or a release asset.');
        delta -= 3;
    }

    const hasPackageJson = has(/(^|\/)package\.json$/).length > 0;
    const locks = has(/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/);
    if (hasPackageJson && !locks.length) {
        insights.push({ type: 'info', label: 'No lockfile', detail: 'package.json without package-lock.json, yarn.lock or pnpm-lock.yaml.' });
        recommendations.push('Commit a lockfile so installs are reproducible.');
    }
    if (files.length && !has(/^\.gitignore$/).length) {
        insights.push({ type: 'info', label: 'No .gitignore', detail: 'No .gitignore in the repo root.' });
    }

    return { insights, recommendations, delta, facts: { fileCount: files.length, testFiles: tests.length, ciFiles: ci.length, hasReadme: readme.length > 0 } };
}

module.exports = {
    analyzeRepo,
    analyzeTree,
    calculateGrade,
    formatBytes
};
