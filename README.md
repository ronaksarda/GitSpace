<div align="center">

<img src="public/logo.svg" alt="GitSpace" width="120"/>

# GitSpace

### Every GitHub account is an island. Every repo is a building. Fly to anyone.

**[Play it live at gitspace.me](https://gitspace.me)** · [Run it locally](#run-it-locally) · [How it works](#how-it-works) · [Your first open-source PR](#your-first-open-source-pr)

![Node](https://img.shields.io/badge/node-%E2%89%A522.12-3c873a)
![Express](https://img.shields.io/badge/backend-Express-black)
![React](https://img.shields.io/badge/UI-React%2019%20%2B%20MUI-149eca)
![Canvas](https://img.shields.io/badge/world-Canvas%202D-orange)
![C++17](https://img.shields.io/badge/layout-C%2B%2B17%20%2B%20JS%20fallback-00599c)
![Postgres](https://img.shields.io/badge/db-Postgres%20or%20sandbox-336791)

<img src="readme_demo.gif" alt="Flying across GitSpace islands" width="820"/>

</div>

---

A GitHub profile is a list. GitSpace turns it into a place.

Sign in, and your public repos rise out of the sea as an island city. Small side projects are huts. Repos with thousands of stars are towers that glow. Then search any developer, hit warp, and fly across the map to see what they have built.

When you are ready, GitSpace also hands you a beginner issue in a language you already write, watches for your pull request, and counts it once it is merged. Your first open-source PR, with a map to get there.

## What you can do

| | |
| --- | --- |
| **Get an island** | Sign in with GitHub. Each public repo becomes a building. Stars make it taller, size makes it wider, and your languages shape the land. |
| **Fly anywhere** | Pilot your ship with `WASD` or the arrow keys. Search a developer or a repo and the autopilot warps you there. |
| **Read any repo** | Click a building to read its README and run a **health check**: a graded report (A+ to F) on activity, docs, license, issues and more, with concrete fixes. |
| **Share your island** | Download a postcard PNG of your island, or copy a link that flies people straight to it. |
| **Watch it grow** | Islands refresh by themselves four times a day. New repos show up as new buildings, and active islands pulse. |
| **Land your first PR** | Press **First PR** for beginner issues picked for you. See below. |

## Your first open-source PR

Press **First PR** in the top bar (sign in first).

1. **For you** lists beginner issues ("good first issue", "beginner") in the languages your island is built from, newest first. Only real, active projects qualify: 50 to 50,000 stars, pushed in the last 30 days, not a fork or a template. **Refresh** pulls fresh ones from GitHub on the spot.
2. **I'm on it** takes an issue as a mission. You can hold 2 at a time. GitSpace checks GitHub first, so you never take an issue that was just assigned to someone else, and at most 2 GitSpace users work on one issue.
3. **Merged counts.** Every hour GitSpace looks for your PR. It counts only when it is yours, in that repo, links the issue (`Fixes #N` or a linked issue), and is merged after you took the mission.
   - PR closed without merging: the mission goes back to "working on it".
   - Issue closed or given to someone else: the mission ends.
   - 45 days with no PR: the mission expires.
4. **Your contributions** appears after your first merge: every PR you got merged into other people's projects, with projects, commits, merges per month and links. **For you** then also suggests issues in projects that already merged your work.

The **First PR** button turns into your merged count.

## Run it locally

You need Node.js 22.12 or newer. A C++17 compiler and Postgres are optional.

```bash
git clone https://github.com/ronaksarda/GitSpace.git
```

```bash
cd GitSpace
```

```bash
npm install
```

`npm install` also builds the React UI into `public/app/`.

```bash
cp .env.example .env
```

The example file uses `DATABASE_URL=sandbox`, a local JSON database. No Postgres needed.

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000).

### Sign in locally

Create a GitHub OAuth App at [github.com/settings/developers](https://github.com/settings/developers):

- **Homepage URL:** `http://localhost:3000`
- **Authorization callback URL:** `http://localhost:3000/auth/callback`

Put its client ID and secret in `.env`.

To skip OAuth while you develop, set `NODE_ENV=development` and `MOCK_USER_LOGIN=<a GitHub username>`. Mock login is refused in production.

### Optional: the native layout engine

The layout engine runs in JavaScript by default. A C++17 build gives the same layout, faster:

```bash
npm run build
```

`npm run build` compiles `src/engine/main.cpp` when `g++` is installed, then builds the UI. Without `g++` it skips the engine and keeps the JavaScript version. A parity test (`test/engine-parity.test.js`) keeps the two identical.

## Configuration

| Variable | Required | What it does |
| --- | --- | --- |
| `GITHUB_CLIENT_ID` | for sign-in | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | for sign-in | GitHub OAuth App client secret |
| `SESSION_SECRET` | yes | Signs session cookies. Use a long random string |
| `APP_URL` | yes | Base URL for the OAuth callback, e.g. `http://localhost:3000` |
| `PORT` | no | Server port. Default `3000` |
| `DATABASE_URL` | yes | Postgres connection string, or `sandbox` for the local JSON database |
| `DATABASE_SSL_CA` | no | Path to a CA certificate. Turns on verified TLS to Postgres |
| `USE_SANDBOX` | no | `true` forces sandbox mode |
| `SANDBOX_DB_FILE` | no | Where the sandbox database lives. Default `src/backend/sandbox_db.json` |
| `GITHUB_TOKEN` | no | Read-only token. Raises the GitHub budget from 60 to 5,000 requests an hour, so background refreshes cover far more islands and issues |
| `REFRESH_DISABLED` | no | `true` stops the 6-hourly island refresh |
| `MISSIONS_DISABLED` | no | `true` stops the issue refresh and PR checks |
| `REFRESH_IN_SANDBOX`, `MISSIONS_IN_SANDBOX` | no | `true` runs those background jobs in sandbox mode too (off by default) |
| `NODE_ENV` | no | `development` allows mock login |
| `MOCK_USER_LOGIN` | no | GitHub username for mock login |

## How it works

```text
Browser                                   Server (Express)                      GitHub
───────                                   ────────────────                      ──────
Canvas world (public/js) ── viewport ──▶  /api/chunk: islands in the box + 600
React UI (web/src)       ◀── JSON ─────   layout engine (C++ or JS) places repos
                                          Postgres / sandbox JSON
Sign in ─────────────────────────────▶   /auth/github ─────────────────────▶ OAuth
                                          every 6 h: refresh islands, issues ─▶ REST API
                                          every 1 h: check mission PRs ───────▶ REST API
```

### The world

The world is a plain Canvas 2D engine in `public/js/` (no WebGL). It draws repos back to front for an isometric look, in four tiers (`hut`, `house`, `tower`, `skyscraper`) set by stars and size. Space has three parallax star layers and soft nebulae. During a long warp, the engine draws speed streaks and skips small objects to hold 60 FPS.

The interface on top (search, cards, dialogs, health reports, missions, the front page) is React 19 with MUI, built by Vite from `web/src/` into `public/app/`.

### Island layout

Each repo needs a spot on its island that does not overlap its neighbours. The engine walks an outward spiral: each try turns 0.38197 radians and moves out to `0.8 × radius × √attempt`, until the building clears every neighbour by the sum of their radii plus 5 units. A quadtree keeps the neighbour checks fast. Footprints grow with `√stars` and `√size`, and systems languages such as C++ and Rust get a larger base.

The same algorithm exists in C++ (`src/engine/`) and JavaScript, and they produce identical layouts.

### Placing new developers

When someone new signs in, `findFreeSpot` searches outward from `(0, 0)` in 1,000-unit rings at 45° steps until it finds 2,000 units of empty space for the new island.

### Loading the map

The client asks only for what is on screen: `/api/chunk` takes the viewport box, and the server pads it by 600 units so neighbouring islands are ready before you reach them.

### Data and security

- **Postgres in production, JSON in development.** The database module wraps both. Sandbox mode searches users and repos with an in-memory trie.
- **Tokens are encrypted** with `aes-256-gcm` before they are stored.
- **Read-only.** GitSpace reads public repos and your profile. It never posts anything for you.
- Heavy endpoints are rate limited, and READMEs are sanitized with DOMPurify before they render.

### Background jobs

| Job | How often | What it does |
| --- | --- | --- |
| Island refresh | every 6 hours | Rebuilds islands not refreshed in 5 hours. Unchanged accounts answer `304` to the ETag check and cost no quota |
| Issue refresh | every 6 hours | Collects fresh beginner issues for **For you** |
| Mission check | every hour | Looks for merged PRs on active missions |

## Project layout

```text
public/            static site: index.html, the Canvas engine (js/), built UI (app/)
web/src/           React UI source (components/, theme, motion, postcard renderer)
src/backend/       Express server, routes, database, refresh, missions, health checks
src/engine/        C++17 layout engine
test/              node --test suites
docs/              plans and build notes
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Start the server |
| `npm test` | Run the tests (`node --test`) |
| `npm run build` | Build the C++ engine (if `g++` exists) and the UI |
| `npm run build:web` | Build only the UI into `public/app/` |
| `npm run dev:web` | Rebuild the UI on every change |
| `npm run seed:stress` | Fill the database with many fake islands for load testing |
| `npm run compact` | Dry run: show how existing islands would pack closer together. Add `-- --apply` to write it (a backup JSON is saved first) |

## Deploy

GitSpace is a single Node process, so any host that runs `npm start` works. Live, it runs on Render with Postgres.

1. Set the variables from [Configuration](#configuration). Use a real Postgres `DATABASE_URL`, and set `APP_URL` to your public URL.
2. Point your GitHub OAuth App callback at `<APP_URL>/auth/callback`.
3. Build with `npm install` (add the `g++` line from `railway.json` if you want the native engine). Start with `npm start`.
4. Use `/health` as the health check.

`railway.json` and `nixpacks.toml` are ready for Nixpacks-based hosts such as Railway.

## Troubleshooting

**`redirect_uri_mismatch` from GitHub.** The OAuth App callback URL must be exactly `APP_URL` + `/auth/callback`.

**`relation "users" does not exist` or no database connection.** Check that Postgres is running and `DATABASE_URL` is right. To work without Postgres, set `DATABASE_URL=sandbox`.

**`g++: command not found`.** Nothing breaks: the JavaScript engine takes over. For the native engine, install a compiler: `sudo apt install build-essential` (Ubuntu/Debian), `xcode-select --install` (macOS), or MinGW or WSL (Windows).

**Islands or issues refresh slowly.** Without `GITHUB_TOKEN` the server has 60 GitHub requests an hour. Add a read-only token.

## Contributing

Issues and pull requests are welcome. Run `npm test` before you open a PR.

Fitting, for a project that helps people land their first one.
