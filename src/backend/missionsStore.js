// Storage for missions: Postgres in production, the sandbox JSON file in local dev. Same functions either way.
const db = require('./database');
const { LIVE, MAX_ACTIVE, MAX_PER_ISSUE, FRESH_HOURS } = require('./missions');

const sandbox = () => db.isSandbox();
const query = (sql, args) => db.raw().pool.query(sql, args);
const iso = () => new Date().toISOString();
const fresh = i => i.state === 'open' && Date.now() - new Date(i.fetched_at) < FRESH_HOURS * 3600e3;

// The sandbox JSON file gets two extra keys, created on first use.
function file() {
    const data = db.raw().loadSandboxData();
    data.issues ||= {};
    data.missions ||= [];
    return { data, save: () => db.raw().saveSandboxData(data) };
}
const withIssue = (m, i = {}) => ({ ...m, repo: i.repo, number: i.number, title: i.title, url: i.url, language: i.language });
const JOIN = `SELECT m.*, i.repo, i.number, i.title, i.url, i.language FROM missions m JOIN issues i ON i.id = m.issue_id`;

async function ensureSchema() {
    if (sandbox()) return;
    await query(`
        CREATE TABLE IF NOT EXISTS issues (
            id BIGINT PRIMARY KEY, repo TEXT NOT NULL, number INT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL,
            language TEXT NOT NULL, repo_stars INT NOT NULL, repo_pushed_at TIMESTAMPTZ, comments INT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL, fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(), state TEXT NOT NULL DEFAULT 'open');
        CREATE INDEX IF NOT EXISTS issues_lang_open ON issues (language, fetched_at) WHERE state = 'open';
        CREATE TABLE IF NOT EXISTS missions (
            id BIGSERIAL PRIMARY KEY, login VARCHAR(255) NOT NULL REFERENCES users(login) ON DELETE CASCADE,
            issue_id BIGINT NOT NULL REFERENCES issues(id), status TEXT NOT NULL DEFAULT 'active',
            started_at TIMESTAMPTZ NOT NULL DEFAULT now(), pr_url TEXT, merged_at TIMESTAMPTZ, checked_at TIMESTAMPTZ,
            UNIQUE (login, issue_id));
        CREATE INDEX IF NOT EXISTS missions_live ON missions (checked_at) WHERE status IN ('active', 'pr_open');`);
}

// Seen again by the refresh: open, with fresh numbers.
async function saveIssues(list) {
    if (sandbox()) {
        const f = file();
        for (const i of list) f.data.issues[i.id] = { ...i, fetched_at: iso(), state: 'open' };
        f.save();
        return list.length;
    }
    for (const i of list) {
        await query(
            `INSERT INTO issues (id, repo, number, title, url, language, repo_stars, repo_pushed_at, comments, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (id) DO UPDATE SET repo=$2, title=$4, url=$5, language=$6, repo_stars=$7, repo_pushed_at=$8, comments=$9, fetched_at=now(), state='open'`,
            [i.id, i.repo, i.number, i.title, i.url, i.language, i.repo_stars, i.repo_pushed_at, i.comments, i.created_at]);
    }
    return list.length;
}

// Old issues nobody took are deleted; ones with missions stay so the mission keeps its title and link.
async function pruneIssues(cutoffMs) {
    if (sandbox()) {
        const f = file();
        const used = new Set(f.data.missions.map(m => String(m.issue_id)));
        for (const [id, i] of Object.entries(f.data.issues)) if (new Date(i.fetched_at) < cutoffMs && !used.has(id)) delete f.data.issues[id];
        return f.save();
    }
    await query(`DELETE FROM issues i WHERE fetched_at < to_timestamp($1 / 1000.0) AND NOT EXISTS (SELECT 1 FROM missions m WHERE m.issue_id = i.id)`, [cutoffMs]);
}

// Open issues in these languages seen by a recent refresh, with how many GitSpace people are on each.
async function openIssues(languages) {
    if (sandbox()) {
        const { data } = file();
        return Object.values(data.issues).filter(i => fresh(i) && languages.includes(i.language))
            .map(i => ({ ...i, gs_count: data.missions.filter(m => m.issue_id === i.id && LIVE.includes(m.status)).length }));
    }
    return (await query(
        `SELECT i.*, (SELECT COUNT(*) FROM missions m WHERE m.issue_id = i.id AND m.status IN ('active','pr_open'))::int AS gs_count
         FROM issues i WHERE i.state = 'open' AND i.language = ANY($1) AND i.fetched_at > now() - make_interval(hours => $2)
         ORDER BY i.created_at DESC LIMIT 500`, [languages, FRESH_HOURS])).rows;
}

async function getIssue(id) {
    if (sandbox()) return file().data.issues[id] || null;
    return (await query(`SELECT * FROM issues WHERE id = $1`, [id])).rows[0] || null;
}

async function setIssueState(id, state) {
    if (sandbox()) { const f = file(); if (f.data.issues[id]) { f.data.issues[id].state = state; f.save(); } return; }
    await query(`UPDATE issues SET state = $2 WHERE id = $1`, [id, state]);
}

// Shared rules, so both stores refuse the same things. Returns an error code or null.
function refuse({ old, mine, onIssue }) {
    if (['active', 'pr_open', 'merged'].includes(old)) return 'dup'; // dropped, expired or lost ones may be taken again
    if (mine >= MAX_ACTIVE) return 'limit';
    if (onIssue >= MAX_PER_ISSUE) return 'full';
    return null;
}

// Returns { mission } or { error: 'no_user' | 'no_issue' | 'limit' | 'full' | 'dup' }.
async function startMission(login, issueId) {
    if (sandbox()) {
        const f = file();
        const issue = f.data.issues[issueId];
        if (!f.data.users[login]) return { error: 'no_user' };
        if (!issue) return { error: 'no_issue' };
        const old = f.data.missions.find(m => m.login === login && m.issue_id === issue.id);
        const error = refuse({
            old: old?.status,
            mine: f.data.missions.filter(m => m.login === login && LIVE.includes(m.status)).length,
            onIssue: f.data.missions.filter(m => m.issue_id === issue.id && LIVE.includes(m.status)).length,
        });
        if (error) return { error };
        const start = { status: 'active', started_at: iso(), pr_url: null, merged_at: null, checked_at: null };
        const mission = old ? Object.assign(old, start) : { id: f.data.missions.reduce((n, m) => Math.max(n, m.id), 0) + 1, login, issue_id: issue.id, ...start };
        if (!old) f.data.missions.push(mission);
        f.save();
        return { mission: withIssue(mission, issue) };
    }
    const client = await db.raw().pool.connect();
    const q = (sql, args) => client.query(sql, args);
    try {
        await q('BEGIN');
        // Lock the user row, then the issue row: two quick clicks, or two people, cannot both pass the limits.
        if (!(await q(`SELECT 1 FROM users WHERE login = $1 FOR UPDATE`, [login])).rows.length) return await q('ROLLBACK').then(() => ({ error: 'no_user' }));
        const issue = (await q(`SELECT * FROM issues WHERE id = $1 FOR UPDATE`, [issueId])).rows[0];
        if (!issue) return await q('ROLLBACK').then(() => ({ error: 'no_issue' }));
        const c = (await q(
            `SELECT (SELECT status FROM missions WHERE login = $1 AND issue_id = $2) AS old,
                    (SELECT COUNT(*) FROM missions WHERE login = $1 AND status IN ('active','pr_open'))::int AS mine,
                    (SELECT COUNT(*) FROM missions WHERE issue_id = $2 AND status IN ('active','pr_open'))::int AS "onIssue"`, [login, issueId])).rows[0];
        const error = refuse(c);
        if (error) return await q('ROLLBACK').then(() => ({ error }));
        const m = (await q(
            `INSERT INTO missions (login, issue_id) VALUES ($1, $2)
             ON CONFLICT (login, issue_id) DO UPDATE SET status = 'active', started_at = now(), pr_url = NULL, merged_at = NULL, checked_at = NULL
             RETURNING *`, [login, issueId])).rows[0];
        await q('COMMIT');
        return { mission: withIssue(m, issue) };
    } catch (e) {
        await q('ROLLBACK').catch(() => {});
        throw e;
    } finally {
        client.release();
    }
}

async function dropMission(login, id) {
    if (sandbox()) {
        const f = file();
        const m = f.data.missions.find(x => String(x.id) === String(id) && x.login === login && LIVE.includes(x.status));
        if (m) { m.status = 'dropped'; f.save(); }
        return !!m;
    }
    return (await query(`UPDATE missions SET status = 'dropped' WHERE id = $1 AND login = $2 AND status IN ('active','pr_open')`, [id, login])).rowCount > 0;
}

async function missionsOf(login) {
    if (sandbox()) {
        const { data } = file();
        return data.missions.filter(m => m.login === login && m.status !== 'dropped')
            .map(m => withIssue(m, data.issues[m.issue_id])).sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
    }
    return (await query(`${JOIN} WHERE m.login = $1 AND m.status <> 'dropped' ORDER BY m.started_at DESC`, [login])).rows;
}

async function missionsToCheck(limit) {
    if (sandbox()) {
        const { data } = file();
        return data.missions.filter(m => LIVE.includes(m.status))
            .sort((a, b) => new Date(a.checked_at || 0) - new Date(b.checked_at || 0)).slice(0, limit)
            .map(m => withIssue(m, data.issues[m.issue_id]));
    }
    return (await query(`${JOIN} WHERE m.status IN ('active','pr_open') ORDER BY m.checked_at ASC NULLS FIRST LIMIT $1`, [limit])).rows;
}

// mission: the row the check read; patch: { status, pr_url?, merged_at? }. Only applies if the mission is still
// live and was not dropped and taken again since the check read it (same started_at).
async function updateMission(mission, { status, pr_url = null, merged_at = null }) {
    const started = new Date(mission.started_at).toISOString();
    if (sandbox()) {
        const f = file();
        const m = f.data.missions.find(x => String(x.id) === String(mission.id) && LIVE.includes(x.status) && x.started_at === started);
        if (m) { Object.assign(m, { status, pr_url, merged_at, checked_at: iso() }); f.save(); }
        return;
    }
    await query(`UPDATE missions SET status = $2, pr_url = $3, merged_at = $4, checked_at = now()
                 WHERE id = $1 AND status IN ('active','pr_open') AND date_trunc('milliseconds', started_at) = $5`, [mission.id, status, pr_url, merged_at, started]);
}

async function countMerged() {
    if (sandbox()) return file().data.missions.filter(m => m.status === 'merged').length;
    return (await query(`SELECT COUNT(*)::int AS n FROM missions WHERE status = 'merged'`)).rows[0].n;
}

module.exports = { ensureSchema, saveIssues, pruneIssues, openIssues, getIssue, setIssueState, startMission, dropMission, missionsOf, missionsToCheck, updateMission, countMerged };
