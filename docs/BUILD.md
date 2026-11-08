# What to build and how

Source: docs/PLAN.md, checked against docs/RESEARCH.md and the current code.

## State today (checked)

- `npm run build:web` passes. `npm test` passes (10 tests).
- Express app starts in `src/backend/server.js` (listen on line 136), routes in `routes/api.js` (738 lines) and `routes/auth.js`.
- Rate limits use `express-rate-limit` default memory store (`server.js:19-35`). Cache is `new Map()` (`api.js:11`).
- **Gap the plan misses:** island refresh already runs by `setInterval` every 6 h (`refresh.js:79-80`), and `database.js:680` has another `setInterval`. Both die on Vercel. They need the same jobs endpoint + scheduler as missions.
- No `issues`, `guides`, `missions` tables yet. No `/api/jobs/*`. No `vercel.json`.

## Build order

### Phase A: Vercel split (do first, nothing else works without it)
1. `src/backend/app.js` exports the app. `server.js` imports it and calls `listen`.
2. `vercel.json`: static `public/`, rewrite `/api/*` and `/auth/*` to the function, headers (CSP, cache) copied from `server.js`.
3. Shared store: Upstash when `UPSTASH_REDIS_REST_URL` set, memory otherwise. Use for the `githubCache` and the rate limiter.
4. Layout engine: JS only when `VERCEL` is set.
5. `/api/jobs/refresh-islands`, `/api/jobs/refresh-issues`, `/api/jobs/check-missions`. Header `JOBS_SECRET`. Move the island refresh from `refresh.js` setInterval to the first one. Keep setInterval only when not on Vercel.
6. `.github/workflows/jobs.yml` on schedule calls the endpoints.
7. Test: jobs reject wrong or missing secret.

You do: Vercel project, Neon DB, Upstash DB, env vars, OAuth callback, domain, `pg_dump` to Neon.

### Phase B: missions without AI
1. Tables `issues`, `missions` (SQL in PLAN.md section 2).
2. Refresh job: search queries, filters, backoff on `retry-after`, advisory lock.
3. Endpoints `for-you`, `start`, `drop`, `mine`. Max 2 active missions. Recheck issue open before start.
4. Check job: merged PR by author on the issue's base repo, then open PR, then expire after 45 days.
5. Tests: filters, ranking, 2-mission limit, PR matching.
6. React: Missions drawer and mission card.

### Phase C: Gemini guides
`guides` table, fixed prompt, JSON schema, drop paths not in the tree, per-user and global caps, plain checklist fallback. Mocked-client tests.

### Phase D: world and sharing
Lighthouses and flags in `public/js/render.js`, "N PRs merged" on postcard, real `prsMerged` in `/api/stats` and front page.

## Team split (parallel, no shared files)
- Agent 1: Phase A backend (`app.js`, `vercel.json`, jobs, workflow).
- Agent 2: Phase B backend (DB, search, check job) after A step 1 lands.
- Agent 3: Phase B/D front end (`web/src`, `public/js/render.js`) against the API shape in PLAN.md.
- Phase C starts after B. One reviewer agent checks each phase.

## Fixes to PLAN.md from research (details in docs/RESEARCH.md)
- Job locks: `pg_try_advisory_xact_lock` inside a transaction, or Neon direct URL. Session locks fail on the pooled URL.
- Upstash free = 500K commands per month. Rate limit plus cache may burn it. Prefer a Postgres cache/limit table first.
- No `express.static()` on Vercel. Whole Express app = one function.
- One search query with `label:"good first issue","good-first-issue",beginner` (comma = OR). 15 queries, not 45.
- PR detection: use `cross-referenced` events plus PR search. `connected` has no PR field.
- Gemini: model from env (`gemini-3.5-flash-lite`), check SDK JSON-output field names. Free tier trains on data and terms require paid use for EEA/UK/CH users: enable billing with a hard cap, or hide guides there.
- Actions cron: odd minute (`17 * * * *`), expect delays, add keep-alive (auto-disables after 60 days idle).
- Vercel Hobby is non-commercial only.
- Cheaper option: keep API on an always-on host, move only frontend. Avoids all the cache and job rewrites.

## Token budget
Phase A about 40% of effort, B 30%, C 15%, D 15%. Run A alone first; B and the front end run in parallel after it.
