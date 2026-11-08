# Research: checking docs/PLAN.md against primary sources

Checked 2026-11-08 against vendor docs only. Verdicts: CONFIRMED, WRONG, UNCLEAR.

## Vercel (Hobby)

| Claim | Verdict | Source | Note |
|---|---|---|---|
| Max function duration 300 s | CONFIRMED | https://vercel.com/docs/functions/limitations | 300 s default and max on Hobby (fluid compute). 2 GB / 1 vCPU. |
| Cron once per day, imprecise | CONFIRMED | https://vercel.com/docs/cron-jobs/usage-and-pricing | Hobby: once per day, "per-hour (±59 min)". A more frequent schedule fails the deploy. Docs now say Cron Jobs are legacy and moving to "Schedules"; check https://vercel.com/docs/schedules/limits before building. Plan cites a blog (crontap); use this page instead. |
| In-memory state not reliable | CONFIRMED (softened) | https://vercel.com/docs/fluid-compute | Instances can be shared across requests (global state exists) but there is no guarantee how long. Treat memory as a best-effort cache only. |
| Express on Vercel, how to export | CONFIRMED | https://vercel.com/docs/frameworks/backend/express | Zero config. File at `app.js`, `index.js`, `server.js` or `src/` equivalents; `module.exports = app` / `export default app`, or a plain `app.listen` also works. The whole Express app becomes ONE function. |
| Static files served by Express | WRONG | same page | `express.static()` is ignored on Vercel. Static files must be in `public/**` (CDN). Plan already says static `public/`; make sure server code does not rely on express.static. |
| File size limits | CONFIRMED | https://vercel.com/docs/functions/limitations | 250 MB uncompressed per function (5 GB beta "large functions"). Request/response body max 4.5 MB. 1,024 file descriptors shared. Plan did not mention the 4.5 MB body cap; fine for this app. |
| Child processes / native binaries | UNCLEAR | same page ("Full Node.js coverage") | Docs do not say either way. A C++ binary built on your machine would not match their Linux anyway. Plan's choice (JS layout only on Vercel) is right. |
| Hobby allows public use, not commercial | CONFIRMED | https://vercel.com/docs/limits/fair-use-guidelines | Hobby is "non-commercial personal use only". Donations are allowed. Ads, payments, affiliate-primary sites, or anyone paid to build/host it make it commercial and need Pro. A free public hobby site is fine. |
| Hobby free usage | note | same page | 1M invocations, 4 CPU-hours, 100 GB transfer per month are the "typical" guidelines. Fine for this app. |

## Neon and Upstash

| Claim | Verdict | Source | Note |
|---|---|---|---|
| Neon free tier is enough | CONFIRMED | https://neon.com/docs/introduction/plans | Free: 1 GB storage per project, 100 CU-hours per project per month, 5 min autosuspend (cannot disable), 5 GB transfer per month. Data is not deleted when limits hit; writes fail at 1 GB. Cold wake-up after 5 idle minutes adds latency on the first request. |
| Pooled connection string | CONFIRMED | https://neon.com/docs/connect/connection-pooling | Add `-pooler` to the host, or toggle in the console. PgBouncer transaction mode. |
| Advisory locks for job overlap | WRONG on pooled | same page | Session-level advisory locks (`pg_try_advisory_lock`) do not work through the pooler. Fix: use `pg_try_advisory_xact_lock` inside a transaction, or open the job connection on the direct (non-pooled) string. Also run `pg_dump`/migrations on the direct string. |
| Upstash Redis free tier | UNCLEAR / partly wrong | https://upstash.com/pricing/redis | Page shows 500K commands per MONTH (no daily limit stated), 250 MB, 1 database, 10 GB bandwidth. Averages ~16K commands/day, so a per-request cache plus rate limit can burn it. Count commands per request before choosing. |
| @upstash/ratelimit | CONFIRMED | https://upstash.com/docs/redis/sdks/ratelimit-ts/overview | HTTP (connectionless), made for serverless. Docs show no Express example; use it as plain middleware. Each check costs several Redis commands, which eats the 500K/month. A Postgres cache/limit table is a free alternative. |

## GitHub

| Claim | Verdict | Source | Note |
|---|---|---|---|
| Search API 30/min authenticated | CONFIRMED | https://docs.github.com/en/rest/search/search | 30/min (10/min unauthenticated; code search 10/min). Max 1,000 results per query, 100 per page. |
| Query limits | new | same page | Query text over 256 chars, or more than 5 AND/OR/NOT operators, fails validation. Plan queries are fine. |
| Qualifiers `no:assignee`, `archived:false`, `label:`, `is:merged`, `author:`, `repo:`, `type:pr` | CONFIRMED | https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests | All documented. |
| `language:` on issue search | CONFIRMED | same page | It matches the REPOSITORY language, not the issue. Plan treats it right. |
| Label variants need 3 queries | WRONG (can be 1) | same page | `label:a,b` matches either label (comma = OR). One query `label:"good first issue","good-first-issue",beginner` replaces three, cutting 45 queries to 15 per refresh. |
| 5,000/hr core limit | CONFIRMED | https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api | PAT: 5,000/hr, shared across all of that user's tokens. |
| GitHub App vs PAT | CONFIRMED | same page | App installation token: 5,000 minimum, scales with repos/users up to 12,500. For public-repo reads there is no big gain; a PAT is fine to start. Actions `GITHUB_TOKEN`: 1,000/hr per repo. |
| Secondary limits and retry-after | CONFIRMED | same page + https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api | Obey `retry-after`; else wait to `x-ratelimit-reset` if remaining is 0; else wait at least 1 minute; then exponential backoff. Make requests serially, not concurrent (max 100 concurrent, 900 points/min REST). Continuing while limited can get the integration banned. |
| ETag 304 not counted | CONFIRMED (with a condition) | best-practices page above | Free only when the request is authenticated. |
| Timeline `cross-referenced`, `connected` | PARTLY WRONG | https://docs.github.com/en/rest/issues/timeline | `cross-referenced` carries `source.issue` with `pull_request.merged_at`, so it can identify a PR. `connected`/`disconnected` events have NO field naming the PR. Use `cross-referenced` to find the PR; use `connected` only as a hint. Cross-references include any mention, not only closing PRs, so also check the PR author and base repo (plan already does). |
| Actions schedule min 5 min | CONFIRMED | https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows | Also: delays under load (worst at the top of the hour; some queued runs may be dropped); runs only from the default branch. Use odd minutes like `17 * * * *`. |
| Auto-disabled after 60 days idle | CONFIRMED | same page | Public repos only, after 60 days with no repo activity. Re-enable manually. Add a keep-alive (the job itself does not count as activity). |
| Actions free minutes | CONFIRMED | https://docs.github.com/en/billing/managing-billing-for-your-products/about-billing-for-github-actions | Standard runners in public repos are free. Private repos on Free get $12 of usage per month (about 2,000 Linux minutes). |

## Gemini API

| Claim | Verdict | Source | Note |
|---|---|---|---|
| Free tier exists | CONFIRMED | https://aistudio.google.com/docs/pricing (ai.google.dev now redirects here) | Free-tier models include `gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-2.5-flash-lite`. 2.5 Pro / 2.5 Flash are listed as deprecated. Plan names no model; pick `gemini-3.5-flash-lite` or `gemini-3.8-flash` and read the model from an env var. |
| Structured output | CONFIRMED, field names changed | https://aistudio.google.com/docs/structured-output | Current docs use `response_format: { type: "text", mime_type: "application/json", schema: <JSON Schema> }` (Interactions API). Older `responseMimeType` + `responseSchema` is not in the current page; check the SDK version you use. `minLength/maxLength/uniqueItems` are NOT enforced; `minItems/maxItems` are. Plan already validates server-side, keep that. Deep/large schemas can return 400. |
| Free-tier quota numbers | UNCLEAR | (not on the pricing page) | Per-project limits show in AI Studio only; plan's daily cap approach is the right design. |
| Free tier trains on data | CONFIRMED (new risk) | https://aistudio.google.com/docs/pricing and https://aistudio.google.com/docs/terms | Free: "used to improve our products: Yes"; human reviewers may read inputs. Paid: No. Issue text, README and CONTRIBUTING are public, so this is acceptable, but never send private repo content or user data. |
| Regional limits | WRONG / missing | https://aistudio.google.com/docs/terms | If your app serves users in the EEA, UK or Switzerland, the terms say to use Paid Services only for those users. A public app with free-tier Gemini does not meet that. Either enable billing on the project (Paid terms also stop training) or accept the risk knowingly. |

## Alternatives to Vercel (one line)

- **Render/Railway/Fly.io (always-on Node)**: keeps Express as-is, in-memory cache, `setInterval`/real cron, and the C++ engine; Render free web services sleep, so a paid tier (~USD 7/mo) removes the sleep. Least change for this stack.
- **Vercel frontend + keep API on a small always-on host**: gets the CDN win without rewriting the cache or jobs.
- **Cloudflare Workers/Pages**: free cron triggers every minute and a generous free tier, but Express/pg needs a rewrite. Not worth it here.

I did not verify Render/Railway/Fly/Cloudflare pricing from their own docs; confirm before choosing.

## Changes the plan needs

1. Replace the crontap blog link with https://vercel.com/docs/cron-jobs/usage-and-pricing. Also note Vercel is renaming Cron Jobs to Schedules.
2. Replace `pg_try_advisory_lock` with `pg_try_advisory_xact_lock` in a transaction (or use Neon's direct connection for job runs). Session locks fail on the pooled string.
3. Upstash free tier is 500K commands per month, not per day. Estimate commands per request, or use a Postgres table for cache and rate limits to stay free.
4. Server code must not rely on `express.static()` on Vercel. Static files go in `public/`. The whole Express app is one function, 250 MB, 4.5 MB request/response cap.
5. Search: merge the three label passes into one query with comma-separated labels. Keep queries under 256 chars and 5 boolean operators. Page through at most 10 pages (1,000-result cap).
6. PR detection: do not use `connected` events to find the PR (no PR field). Use `cross-referenced` (`source.issue.pull_request.merged_at`) plus the PR search by author and repo.
7. Gemini: drop the claim list of limits from third-party blogs; name a current model (`gemini-3.5-flash-lite` or `gemini-3.8-flash`) via env var; check the SDK's current JSON-output field names; `maxLength`-style limits are not enforced so keep server validation.
8. Add a Gemini terms note: free tier data may train Google models; for EEA/UK/CH users the terms require Paid Services. Decide: enable billing (with a hard daily cap) or hide guides from those regions.
9. Actions cron: use an off-peak minute, expect delays and occasional dropped runs, and add a keep-alive because scheduled workflows auto-disable after 60 days of no repo activity in public repos.
10. Hobby is non-commercial. If GitSpace ever shows ads, takes payment or has a paid maintainer, move to Pro.
11. Neon free autosuspends after 5 min idle: the first request after a quiet period is slower. The 6-hourly jobs will wake it; budget against the 100 CU-hours/month.
