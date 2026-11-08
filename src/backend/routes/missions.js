// /api/missions/*: issues picked for you, take one, drop one, see yours. Signed-in only.
const express = require('express');
const { rank, makeGh, contributions, projectIssues, refreshIssues, LANGS, LIVE, MAX_PER_ISSUE } = require('../missions');

const ERRORS = {
    no_user: [403, 'Put your island on the map first, then come back.'],
    no_issue: [404, 'That issue is not in the list any more.'],
    limit: [409, 'You already have 2 missions. Finish or drop one first.'],
    full: [409, 'Two GitSpace people are already on this one. Pick another.'],
    dup: [409, 'You already took this one.'],
};

// The session only holds a GitHub token, so ask GitHub who it belongs to once and remember it for 10 minutes.
function sessionLogin(db) {
    const known = new Map();
    return async req => {
        const sid = req.headers.cookie?.match(/(?:^|;\s*)sid=([^;]+)/)?.[1];
        const session = sid && await db.getSessionById(sid);
        if (!session?.token) return null;
        if (session.token === 'mock_token') return process.env.MOCK_USER_LOGIN || 'mock_user'; // dev only; auth.js refuses it in production
        req.ghToken = session.token; // lets the dashboard read GitHub on the person's own quota
        const hit = known.get(sid);
        if (hit && Date.now() - hit.ts < 600e3) return hit.login;
        const r = await fetch('https://api.github.com/user', { headers: { Authorization: `token ${session.token}`, 'User-Agent': 'GitSpace' } });
        if (r.status === 401) { await db.deleteSession(sid); return null; }
        if (!r.ok) throw new Error(`GitHub ${r.status}`);
        if (known.size > 1000) known.clear();
        known.set(sid, { login: (await r.json()).login, ts: Date.now() });
        return known.get(sid).login;
    };
}

// searchGap: pause between searches in a personal refresh (30 searches a minute per signed-in person).
module.exports = function ({ db, store, getLogin, gh = makeGh(), searchGap = () => new Promise(ok => setTimeout(ok, 2100)) }) {
    const router = express.Router();
    const handle = fn => async (req, res) => {
        try {
            if (req.params.id && !/^\d{1,18}$/.test(req.params.id)) return res.status(400).json({ error: 'Bad id' });
            req.login = await getLogin(req);
            if (!req.login) return res.status(401).json({ error: 'Sign in first.' });
            await fn(req, res);
        } catch (e) {
            console.error('[Missions]', e.message);
            res.status(500).json({ error: 'Something went wrong. Try again.' });
        }
    };

    // Per person, kept 30 minutes: their contributions (about 22 GitHub calls) and issues from their projects.
    // Read on the person's own GitHub quota when signed in for real.
    const cache = new Map();
    async function remember(req, key, make) {
        const entry = cache.get(req.login) || {};
        if (entry[key] && Date.now() - entry[key].ts < 30 * 60e3) return entry[key].data;
        const data = await make(req.ghToken ? makeGh(undefined, req.ghToken) : gh);
        if (cache.size > 500) cache.clear();
        cache.set(req.login, { ...entry, [key]: { data, ts: Date.now() } });
        return data;
    }
    const contribsOf = async req => {
        const via = (await store.missionsOf(req.login)).filter(m => m.status === 'merged').map(m => m.pr_url);
        return remember(req, 'contribs', g => contributions(g, req.login, { viaGitSpace: via }));
    };

    // Top three languages on their island that the refresh covers ("Other" or HTML would match nothing).
    async function languagesOf(login) {
        const counts = {};
        for (const r of await db.getRepos(login)) if (LANGS.includes(r.language)) counts[r.language] = (counts[r.language] || 0) + 1;
        const langs = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 3);
        return langs.length ? langs : ['JavaScript', 'Python'];
    }

    // Fetch fresh beginner issues for one person's languages right now, on their own GitHub sign-in, instead of
    // waiting for the 6-hourly refresh. At most once per 10 minutes each; two clicks share one run.
    const refreshed = new Map(); // login -> { at, running }
    function refreshFor(req, langs) {
        const r = refreshed.get(req.login);
        if (r?.running) return r.running;
        if (r && Date.now() - r.at < 10 * 60e3) return null;
        const userGh = req.ghToken ? makeGh(undefined, req.ghToken) : gh;
        const running = refreshIssues(store, { gh: userGh, languages: langs, repoBudget: 60, wait: searchGap })
            .finally(() => refreshed.set(req.login, { at: Date.now() }));
        if (refreshed.size > 1000) refreshed.clear();
        refreshed.set(req.login, { at: Date.now(), running });
        return running;
    }

    async function forYou(req) {
        const langs = await languagesOf(req.login);
        // Hide ones they hold or finished; expired and lost ones may show up again to be retaken.
        const taken = new Set((await store.missionsOf(req.login)).filter(m => LIVE.includes(m.status) || m.status === 'merged').map(m => String(m.issue_id)));
        const usable = i => !taken.has(String(i.id)) && !(i.gs_count >= MAX_PER_ISSUE); // gs_count is unknown for project issues
        const perRepo = {}; // at most 2 per repo, so one busy repo cannot fill the list
        const issues = rank((await store.openIssues(langs)).filter(usable), langs)
            .filter(i => (perRepo[i.repo] = (perRepo[i.repo] || 0) + 1) <= 2).slice(0, 12);

        // Extra, shown folded below: issues in projects that merged their work before. Skipped if GitHub is busy.
        let fromProjects = [];
        try {
            const repos = (await contribsOf(req)).repos.map(r => r.repo);
            const found = await remember(req, 'projectIssues', g => projectIssues(g, repos));
            await store.saveIssues(found, 'project'); // startable, but kept out of everyone's shared list
            const shown = new Set(issues.map(i => String(i.id)));
            fromProjects = found.filter(i => usable(i) && !shown.has(String(i.id))).slice(0, 6);
        } catch (e) {
            if (!e.limited) throw e;
        }
        return { languages: langs, issues, fromProjects, refreshedAt: refreshed.get(req.login)?.at || null };
    }

    router.get('/api/missions/for-you', handle(async (req, res) => {
        let data = await forYou(req);
        // Too few to pick from (new language, or the shared refresh has not covered it yet): fetch now, once.
        if (data.issues.length < 6) {
            const run = refreshFor(req, data.languages);
            if (run) { await run.catch(e => { if (!e.limited) throw e; }); data = await forYou(req); }
        }
        res.json(data);
    }));

    router.post('/api/missions/refresh', handle(async (req, res) => {
        const run = refreshFor(req, await languagesOf(req.login));
        if (!run) {
            const mins = Math.ceil((10 * 60e3 - (Date.now() - refreshed.get(req.login).at)) / 60e3);
            return res.status(429).json({ error: `Just refreshed. Try again in ${mins} min.` });
        }
        try {
            await run;
        } catch (e) {
            if (!e.limited) throw e;
            return res.status(503).json({ error: 'GitHub is busy right now. Try again in a minute.' });
        }
        res.json(await forYou(req));
    }));

    router.get('/api/missions/mine', handle(async (req, res) => res.json(await store.missionsOf(req.login))));

    router.get('/api/missions/contributions', handle(async (req, res) => {
        try {
            res.json(await contribsOf(req));
        } catch (e) {
            if (!e.limited) throw e;
            res.status(503).json({ error: 'GitHub is busy right now. Try again in a minute.' });
        }
    }));

    router.post('/api/missions/:id/start', handle(async (req, res) => {
        const issue = await store.getIssue(req.params.id);
        if (!issue || !['open', 'project'].includes(issue.state)) return res.status(404).json({ error: ERRORS.no_issue[1] });
        // Ask GitHub again: it may have been closed or taken since the last refresh. If GitHub does not answer, go ahead;
        // the hourly check catches a closed issue later.
        const live = await gh(`/repos/${issue.repo}/issues/${issue.number}`).catch(() => undefined);
        const others = (live?.assignees || []).filter(a => a.login.toLowerCase() !== req.login.toLowerCase()); // assigned to them is fine
        if (live !== undefined && (!live || live.state !== 'open' || others.length)) {
            const taken = live?.state === 'open';
            await store.setIssueState(issue.id, taken ? 'taken' : 'closed');
            return res.status(409).json({ error: taken ? 'Someone just took this issue. Pick another.' : 'This issue was closed. Pick another.' });
        }
        const r = await store.startMission(req.login, issue.id);
        if (r.error) return res.status(ERRORS[r.error][0]).json({ error: ERRORS[r.error][1] });
        res.json(r.mission);
    }));

    router.post('/api/missions/:id/drop', handle(async (req, res) => {
        if (await store.dropMission(req.login, req.params.id)) return res.json({ ok: true });
        res.status(404).json({ error: 'No live mission with that id.' });
    }));

    return router;
};
module.exports.sessionLogin = sessionLogin;
