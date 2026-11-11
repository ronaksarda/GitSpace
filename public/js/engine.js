// let, not const: render.js swaps these briefly to draw island snapshots offscreen.
let canvas = document.getElementById('world');
let ctx = canvas.getContext('2d', { alpha: false });
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const isMobile = () => window.innerWidth < 768;

let nearestIsland = null;
let nearestDist = Infinity;

let worldData = { totalUsers: 0, totalRepos: 0 };
let currentUser = null;
let islands = [];
let loadedChunks = new Set();
let player = { x: 50000, y: 50000, speed: 12, vx: 0, vy: 0 };
let camera = { x: 50000, y: 50000, zoom: 0.5 };
let targetCamera = { x: 50000, y: 50000, zoom: 0.5 };
let keys = {};
let nearbyRepo = null;
let animFrame = 0;
let playerAngle = 0;
let trails = [];
window.isDragging = false;
let lastMouse = { x: 0, y: 0 };
let warpActive = false;
let warpProgress = 0;

const LANG_COLORS = {
  'JavaScript': '#f1e05a', 'TypeScript': '#3178c6',
  'Python': '#3572A5', 'C++': '#f34b7d', 'C': '#555555',
  'Rust': '#dea584', 'Go': '#00ADD8', 'Java': '#b07219',
  'Ruby': '#701516', 'PHP': '#4F5D95', 'Swift': '#F05138',
  'Kotlin': '#A97BFF', 'Shell': '#89e051', 'C#': '#178600',
  'Dart': '#00B4AB', 'Lua': '#000080', 'R': '#198CE7',
  'Scala': '#c22d40', 'Elixir': '#6e4a7e', 'Haskell': '#5e5086',
  'Other': '#6e7681'
};
function langColor(l) { return LANG_COLORS[l] || LANG_COLORS.Other; }

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

let stars = [];
function genStars(count = 900) {
  stars = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.5 + 0.3,
      brightness: Math.random(),
      twinkleSpeed: Math.random() * 0.02 + 0.005
    });
  }
}
genStars();

function buildIsland(login, userData) {
  const { cx, cy, avatar, primaryLanguage, isActive } = userData;
  // Islands show at most 60 buildings: the most-starred ones (matches the server cap on sync).
  // Forks are someone else's work: they never become buildings.
  const allRepos = (userData.repos || []).filter(r => !r.isFork && !r.isfork);
  const repos = allRepos.length > 60 ? [...allRepos].sort((a, b) => (b.stars || 0) - (a.stars || 0)).slice(0, 60) : allRepos;
  const color = langColor(primaryLanguage);
  const repoCount = repos.length;
  const baseRadius = Math.max(120, 80 + repoCount * 18);

  let seed = 0;
  for (let i = 0; i < login.length; i++) seed += login.charCodeAt(i);
  const rng = (s) => { s = Math.sin(s + seed) * 43758.5; return s - Math.floor(s); };

  let maxDist = 0;

  const buildings = repos.map((repo, i) => {
    const distFromCenter = Math.sqrt(Math.pow((repo.x || cx) - cx, 2) + Math.pow((repo.y || cy) - cy, 2));
    if (distFromCenter > maxDist) maxDist = distFromCenter;
    
    const score = (repo.stars || 0) * 10 + Math.sqrt(repo.size || 0);
    const tier = score > 5000 ? 'skyscraper' : score > 500 ? 'tower' : score > 50 ? 'house' : 'hut';
    const height = { skyscraper: 70, tower: 45, house: 30, hut: 18 }[tier];
    const width = { skyscraper: 35, tower: 28, house: 22, hut: 15 }[tier];

    return {
      ...repo,
      language: repo.language || 'Other',
      tier, height, width,
      color: langColor(repo.language),
      seed: rng(i + 200)
    };
  });

  // Pre-sort buildings by Y coordinate for correct rendering depth
  buildings.sort((a, b) => a.y - b.y);

  // No spread squeeze: squeezing pushed buildings into each other on 200+ repo accounts. The island grows instead.
  // Edge sits past the outermost building plus its widest footprint, so nothing hangs off the coast.
  // Size cap: very spread-out layouts (old saves, huge accounts) are scaled down as a whole, buildings included,
  // so nothing overlaps and no island dwarfs its neighbours.
  const MAX_SPREAD = 560;
  if (maxDist > MAX_SPREAD) {
    const k = MAX_SPREAD / maxDist;
    for (const b of buildings) {
      b.x = cx + (b.x - cx) * k; b.y = cy + (b.y - cy) * k;
      b.width *= Math.max(k, 0.55); b.height *= Math.max(k, 0.55);
    }
    maxDist = MAX_SPREAD;
  }
  // Only the most-starred buildings carry a name label; labels for all of them cost too much per frame.
  [...buildings].sort((a, b) => (a.pin ?? 99) - (b.pin ?? 99) || (b.stars || 0) - (a.stars || 0)).slice(0, 8).forEach(b => { b.showLabel = true; });
  const islandRadius = Math.max(120, maxDist + 90);

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = avatar || `https://avatars.githubusercontent.com/${encodeURIComponent(login)}?s=80`;

  return {
    login, cx, cy, color, islandRadius,
    avatar, primaryLanguage, isActive,
    repoCount: repos.length, buildings, seed: rng(0),
    avatarImg: img,
    totalStars: repos.reduce((s, r) => s + (r.stars || 0), 0)
  };
}

// The React UI reads this for the bottom-left readout.
window.gsHud = { island: null, x: 0, y: 0 };

function updateHUD() {
  if (window.gsFrontPage) return;
  let newNearestIsland = null;
  let newNearestDist = Infinity;
  for (const island of islands) {
    const dx = player.x - island.cx;
    const dy = player.y - island.cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < newNearestDist) { newNearestDist = dist; newNearestIsland = island; }
  }
  nearestIsland = newNearestIsland;
  nearestDist = newNearestDist;
  window.gsHud.x = Math.round(player.x);
  window.gsHud.y = Math.round(player.y);
  window.gsHud.island = nearestIsland && nearestDist < nearestIsland.islandRadius * 1.2 ? nearestIsland.login : null;
}

let autopilotTarget = null;
let totalDistanceTravelled = 0;
let distanceKey = 'gitspace_distance_guest';

window.initDistance = function (username) {
  distanceKey = 'gitspace_distance_' + (username || 'guest');
  totalDistanceTravelled = parseFloat(localStorage.getItem(distanceKey) || '0');
};
window.initDistance('guest');

function gameLoop() {
  requestAnimationFrame(gameLoop); // first, so one bad frame cannot stop the map for good
  window.drawnLabels = [];

  let moving = false;
  let moveDx = 0, moveDy = 0;

  if (keys['arrowup'] || keys['w']) { moveDy = -1; moving = true; autopilotTarget = null; }
  if (keys['arrowdown'] || keys['s']) { moveDy = 1; moving = true; autopilotTarget = null; }
  if (keys['arrowleft'] || keys['a']) { moveDx = -1; moving = true; autopilotTarget = null; }
  if (keys['arrowright'] || keys['d']) { moveDx = 1; moving = true; autopilotTarget = null; }

  if (window.touchJoystick && (window.touchJoystick.moveX !== 0 || window.touchJoystick.moveY !== 0)) {
    moveDx = window.touchJoystick.moveX;
    moveDy = window.touchJoystick.moveY;
    moving = true;
    autopilotTarget = null;
  }

  // Ship has inertia: it eases up to speed and coasts to a stop.
  // shortcut: per-frame easing, not dt-scaled; feels slower on 30fps devices, upgrade if that matters.
  const boost = keys['shift'] ? 2.5 : 1; // hold Shift to go faster
  const topSpeed = (player.speed * (window.speedMultiplier || 1) * boost) / Math.sqrt(camera.zoom) + camera.zoom;
  const len = Math.hypot(moveDx, moveDy) || 1;
  const accel = moving ? 0.12 : 0.07;
  player.vx += ((moving ? (moveDx / len) * topSpeed : 0) - player.vx) * accel;
  player.vy += ((moving ? (moveDy / len) * topSpeed : 0) - player.vy) * accel;
  const coastSpeed = Math.hypot(player.vx, player.vy);
  if (!autopilotTarget && coastSpeed > 0.05) {
    player.x = Math.max(-1000000, Math.min(1000000, player.x + player.vx));
    player.y = Math.max(-1000000, Math.min(1000000, player.y + player.vy));
    let diff = Math.atan2(player.vy, player.vx) - playerAngle;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    playerAngle += diff * 0.15;
    if (coastSpeed > 1.5 && animFrame % 2 === 0) {
      trails.push({ x: player.x - Math.cos(playerAngle) * 14, y: player.y - Math.sin(playerAngle) * 14,
        vx: (Math.random() - 0.5) * 1.2 - Math.cos(playerAngle) * 1.5, vy: (Math.random() - 0.5) * 1.2 - Math.sin(playerAngle) * 1.5, life: 1.0 });
    }
    totalDistanceTravelled += coastSpeed;
    if (Math.random() < 0.05) localStorage.setItem(distanceKey, totalDistanceTravelled.toString());
  }
  window.shipSpeed = autopilotTarget ? 10 : coastSpeed;

  // Autopilot navigation
  if (autopilotTarget) {
    const dx = autopilotTarget.x - player.x;
    const dy = autopilotTarget.y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (autopilotTarget.startDist === undefined) autopilotTarget.startDist = dist;
    const stoppingDistance = autopilotTarget.item ? (autopilotTarget.item.type === 'repo' ? 80 : 150) : 5;

    if (dist > 5000 && !warpActive) {
      warpActive = true;
      warpProgress = 0;
    }

    const speedMultiplier = warpActive ? 10 : 1;
    const dynamicSpeed = Math.min(dist * 0.05, (30 / camera.zoom) * speedMultiplier);

    if (dist <= stoppingDistance || dist < dynamicSpeed) {
      if (warpActive) {
        warpActive = false;
      }
      if (autopilotTarget.startDist > 1200 && window.startArrival) {
        const near = islands.find(i => Math.hypot(i.cx - player.x, i.cy - player.y) < i.islandRadius * 1.6);
        if (near) window.startArrival(near);
      }
      if (autopilotTarget.item) window.openModalForItem?.(autopilotTarget.item);
      
      // We don't snap exactly to the target to avoid clipping
      autopilotTarget = null;
    } else {
      // Deactivate warp when close
      if (warpActive && dist < 3000) {
        warpActive = false;
      }

      const targetAngle = Math.atan2(dy, dx);
      let diff = targetAngle - playerAngle;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      playerAngle += diff * 0.1;

      const stepSize = 5;
      const steps = Math.ceil(dynamicSpeed / stepSize);
      const stepXa = (dx / dist) * (dynamicSpeed / steps);
      const stepYa = (dy / dist) * (dynamicSpeed / steps);

      for (let i = 0; i < steps; i++) {
        let nx = player.x + stepXa;
        let ny = player.y + stepYa;
        nx = Math.max(-1000000, Math.min(1000000, nx));
        ny = Math.max(-1000000, Math.min(1000000, ny));
        player.x = nx;
        player.y = ny;
      }
      
      totalDistanceTravelled += dynamicSpeed;
      if (Math.random() < 0.05) localStorage.setItem(distanceKey, totalDistanceTravelled.toString());

      trails.push({
        x: player.x - Math.cos(playerAngle) * 12,
        y: player.y - Math.sin(playerAngle) * 12,
        vx: (Math.random() - 0.5) * 1.5 - Math.cos(playerAngle) * 2,
        vy: (Math.random() - 0.5) * 1.5 - Math.sin(playerAngle) * 2,
        life: 1.0
      });
    }
  }

  // Cancel warp if no autopilot
  if (!autopilotTarget && warpActive) {
    warpActive = false;
  }

  // Smooth camera follow
  targetCamera.x = player.x;
  targetCamera.y = player.y;
  camera.x += (targetCamera.x - camera.x) * 0.08;
  camera.y += (targetCamera.y - camera.y) * 0.08;
  camera.zoom += (targetCamera.zoom - camera.zoom) * 0.15;

  // Draw world
  drawNebula();
  drawStars();
  drawSlipstream2D();
  for (const island of islands) drawIsland(island);
  drawPlayer(); drawMinimap(); drawCompass();
  drawArrival();
  drawFPS();

  // Draw virtual joystick
  if (window.isDragging && window.touchJoystick && window.touchJoystick.originX && window.touchJoystick.dist > 5) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); // reset transform for UI
    
    // Draw base
    ctx.beginPath();
    ctx.arc(window.touchJoystick.originX, window.touchJoystick.originY, 50, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(6, 182, 212, 0.1)';
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.4)';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();

    // Draw nub
    const nubDist = Math.min(50, window.touchJoystick.dist);
    const nx = window.touchJoystick.originX + window.touchJoystick.moveX * nubDist;
    const ny = window.touchJoystick.originY + window.touchJoystick.moveY * nubDist;
    
    ctx.beginPath();
    ctx.arc(nx, ny, 25, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(6, 182, 212, 0.5)';
    ctx.fill();
    ctx.restore();
  }

  checkProximity();
  updateHUD();

  animFrame++;
}

// Hooks for the React UI (public/app): fly somewhere, and read the live world without touching engine globals by name.
window.flyTo = function (x, y, item) {
  if (typeof item === 'string') { try { item = JSON.parse(item); } catch (e) { item = null; } }
  if (isNaN(x) || isNaN(y)) { x = 0; y = 0; }
  autopilotTarget = { x, y, item: item || null };
};
window.gsWorld = {
  get islands() { return islands; },
  get player() { return player; },
  get camera() { return camera; },
  get canvas() { return canvas; },
};
