<div align="center">
  <img src="public/logo.png" alt="GitSpace Logo" width="200"/>
  <h1>🌌 GitSpace: The GitHub Universe 🚀</h1>
  <p><strong>Your GitHub repositories are a world. Every repo is a building. Every developer is an island.</strong></p>
  <h3>🌐 Play Live: <a href="https://gitspace.me">https://gitspace.me</a></h3>
</div>

Welcome to **GitSpace**—a gamified, massive 2D universe that transforms the world of open-source into a sprawling, explorable galaxy. Say goodbye to scrolling through endless lists of repositories. Instead, strap into your ship, fire up the warp drive, and physically *fly* through the open-source ecosystem. 
Whether you're visiting your own island or discovering new citizens of the galaxy, GitSpace makes exploring code a beautiful, immersive adventure!


![GitSpace demo](./readme_demo.gif)


---

## 🎮 The Experience

- **🚀 Pilot Your Ship**: Use `WASD` or `Arrow Keys` to fly your personal spacecraft through deep space. Leave glowing engine trails as you navigate the cosmos.
- **🏝️ Developer Islands**: Every GitHub user gets their own procedurally generated island. Watch as the "terrain" reflects their primary coding language.
- **🏙️ Repository Cities**: Your repositories are transformed into isometric buildings. A small side-project might be a humble hut, while a massive 10k+ star repository becomes a towering, flashing skyscraper emitting a golden aura!
- **⚡ Slipstream Warp Drive**: Found an interesting developer in the Citizens Directory? Engage the autopilot warp drive and watch the stars streak past you as you seamlessly travel thousands of lightyears to their island.
- **🏆 Unlock Achievements**: Play while you explore! Unlock achievements like *"Space Marathon"* (traveling 100k units), *"The Architect"* (inspecting 10 repos), or *"The Polyglot"* (mastering 4+ languages).
- **🔥 Heatmap Rings & Activity**: Islands actually *pulse* with energy if the developer is active, and individual repositories glow based on how recently they were updated.

---

## 🛠️ Tech Stack

Beneath the fun exterior lies a highly optimized, custom-built engine:

- **Frontend**: Vanilla JavaScript & HTML5 Canvas API (No heavy WebGL frameworks—pure, raw 60FPS 2D rendering!)
- **Backend Framework**: Express.js (Node.js)
- **Spatial Engine**: Optional C++17 native accelerator for lightning-fast coordinate math (with a seamless, deterministic JavaScript fallback)
- **Database**: PostgreSQL (with a seamless local JSON Sandbox mode fallback)
- **Deployment**: Render (via Nixpacks)

---

## 🏁 Getting Started

Ready to launch your own local instance of the GitSpace universe?

### 1. Clone the Repository

```bash
git clone https://github.com/ronaksarda/GitSpace.git
cd GitSpace
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Compile the Spatial Engine

GitSpace relies on a blazing-fast custom C++ engine to handle the math of placing thousands of buildings without overlapping.

```bash
# Using Make (Linux/macOS)
cd src/engine
make
cd ../..

# Or manually compile it (Windows/Linux/macOS)
g++ -O2 -std=c++17 -o src/engine/gitspace_engine src/engine/main.cpp   # add .exe on Windows

# Or: npm run build (same command, falls back to the JS engine if g++ is missing)
```

### 4. Environment Setup

Copy the example environment file:

```bash
cp .env.example .env
```

Configure your `.env` variables:

| Variable | Description | Example |
| --- | --- | --- |
| `GITHUB_CLIENT_ID` | Your GitHub OAuth App Client ID | `Iv1.abc...` |
| `GITHUB_CLIENT_SECRET` | Your GitHub OAuth App Client Secret | `abc123def...` |
| `SESSION_SECRET` | Secret used to sign session cookies | `super_secret_string` |
| `PORT` | The port the Node server runs on | `3000` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/gitspace` |
| `APP_URL` | The callback base URL | `http://localhost:3000` |

*💡 Tip: Don't want to set up Postgres right now? Set `DATABASE_URL=sandbox` to use the built-in local JSON database for instant development!*

### 5. Start the Universe

Ignite the thrusters and start the Express server:

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000) and prepare for liftoff!

---

## 🧠 How It Works: Deep Dive Architecture

For the curious engineers, here is exactly how we generate a galaxy from code.

### 1. The Spatial Layout Engine (`src/engine/` & `api.js`)

The core of GitSpace's backend performance relies on an iterative outward spiral algorithm to organically pack repositories together without overlapping. By default, this runs as a deterministic JavaScript algorithm. However, for extreme performance on large deployments, it can be accelerated using an optional custom C++17 engine.

- **Dynamic Quadtree Partitioning**: A `Quadtree` covering the area around the island centre makes searching for neighbors fast.
- **Spiral Collision Resolution**: When calculating where to place a building on a user's island, the engine walks an outward spiral: each attempt turns a fixed 0.38197 radians and moves out to `0.8 * radius * sqrt(attempt)`, until the building no longer overlaps its neighbours (radius sum + 5 units gap). This packs repositories into natural-looking circular cities. The JavaScript fallback in `api.js` runs the exact same algorithm, so both give identical layouts.
- **Landmass Footprint Calculation**: Repositories are categorized dynamically based on their language. For example, `C++` and `Rust` are treated as `FrameworkNode` types, giving them a larger fundamental base radius footprint. The footprint scales non-linearly with the repository's stars (`sqrt(stars)`) and size (`sqrt(size)`).

### 2. The Node.js Express Backend (`src/backend/`)

The Node.js backend serves as the API layer, database orchestrator, and OAuth handler.

- **Sandbox vs. Production Mode**: The database module seamlessly wraps PostgreSQL and a fallback local JSON file (`sandbox_db.json`). In sandbox mode, it utilizes a custom in-memory Trie data structure for instantaneous O(L) prefix queries when searching for users/repos globally.
- **Token Encryption**: Session tokens from GitHub OAuth are securely encrypted using `aes-256-gcm` before entering the database.
- **The Spawning Algorithm**: When a new user logs in, `findFreeSpot` initiates an outward radial search from coordinate `(0, 0)` in `1000` unit increments at `45-degree` angles until it finds a clear `2000` unit radius of empty space to construct their new island territory.
- **Dynamic Chunking**: The frontend requests data based on its viewport `(minX, minY, maxX, maxY)`. The backend buffers this by `600` units to pre-load adjacent islands, ensuring smooth scrolling without elements "popping" into existence.

### 3. The HTML5 Canvas Rendering Engine (`public/js/`)

The frontend doesn't use WebGL; it relies on a highly-optimized Vanilla JavaScript Canvas 2D engine that can handle thousands of entities.

- **Isometric Projections**: Repositories are drawn from back-to-front by pre-sorting their `Y` coordinates. They use 2D canvas pathing with varying height logic based on tiers (`hut`, `house`, `tower`, `skyscraper`), dynamically calculated by combining stars and file size.
- **Slipstream Warp Drive**: When auto-piloting to another developer's island via the Citizens menu, the engine calculates the distance vector. If it's a long journey, the `warpActive` state engages. This triggers a `screen` compositing operation, drawing hyper-speed particle streaks across the viewport while temporarily suppressing the rendering of small objects to maintain a buttery smooth 60 FPS.
- **Parallax Backgrounds**: Deep space is comprised of three depth-sorted layers of twinkling stars and multiple overlapping radial gradient nebulae that offset at slower fractional speeds relative to the camera position without any flickering.

### Data Flow Overview

```text
User Action (Browser Canvas) 
  → Interpolated camera coordinates sent to Express API 
    → PostgreSQL fetches User/Repo chunks in bounding box 
      → C++ Engine calculates collision-free repo footprints 
        → Node.js serializes back to JSON 
          → Canvas Engine renders isometric world
```

---

## 📜 Available Scripts

| Command | Description |
| --- | --- |
| `npm start` | Start the backend Express server |
| `npm run migrate` | Migrate data from JSON sandbox to PostgreSQL |
| `npm run seed` | Seed the database with sample users and repositories |
| `npm run seed:stress` | Stress test database seeding |

## 🧰 Troubleshooting

### C++ Engine Build Failures
**Error:** `g++: command not found`
**Solution:** Ensure you have GCC installed.
- **Ubuntu/Debian**: `sudo apt install build-essential`
- **macOS**: `xcode-select --install`
- **Windows**: Install MinGW or use WSL.

### Database Connection Issues
**Error:** `Could not connect to database` or `relation "users" does not exist`
**Solution:**
1. Verify PostgreSQL is running.
2. Check your `DATABASE_URL` connection string.
3. Use the fallback mode by setting `DATABASE_URL=sandbox` in your `.env` to test without a database.

### OAuth Redirect URI Mismatch
**Error:** `redirect_uri_mismatch` from GitHub.
**Solution:** Ensure the `Authorization callback URL` in your GitHub OAuth App settings matches your `APP_URL` + `/auth/callback` (e.g., `http://localhost:3000/auth/callback`).

