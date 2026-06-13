// ══════════════════════════════════════════════════════
// GITSPACE — Canvas 2D Game Engine v2.0
// ══════════════════════════════════════════════════════

const canvas = document.getElementById('world');
const ctx = canvas.getContext('2d', { alpha: false });
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const isMobile = () => window.innerWidth < 768;

// Global nearest island state set by checkProximity
let nearestIsland = null;
let nearestDist = Infinity;

// Collision Helper
function isValidPosition(x, y) {
  return true;
}

// World state
let worldData = { totalUsers: 0, totalRepos: 0 };
let currentUser = null;
let islands = [];
let loadedChunks = new Set();
let player = { x: 50000, y: 50000, speed: 12 };
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

// ── Language colours ──────────────────────────────────
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

// ── Resize ────────────────────────────────────────────
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// ── Generate stars (more for depth) ───────────────────
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

// ── Badge calculator (Feature 8) ─────────────────────
function calculateBadges(repos) {
  const badges = [];
  const totalStars = repos.reduce((sum, r) => sum + (r.stars || 0), 0);
  const languages = new Set(repos.map(r => r.language).filter(Boolean));
  const forkCount = repos.filter(r => r.isFork).length;
  const maxStars = Math.max(0, ...repos.map(r => r.stars || 0));

  if (totalStars >= 100) {
    badges.push({ icon: '🌟', label: 'Star Collector', bgColor: 'rgba(251,191,36,0.3)', borderColor: '#fbbf24' });
  }
  if (repos.length >= 30) {
    badges.push({ icon: '🏗️', label: 'Prolific Builder', bgColor: 'rgba(59,130,246,0.3)', borderColor: '#3b82f6' });
  }
  if (languages.size >= 5) {
    badges.push({ icon: '🌐', label: 'Polyglot', bgColor: 'rgba(168,85,247,0.3)', borderColor: '#a855f7' });
  }
  if (maxStars >= 500) {
    badges.push({ icon: '🔥', label: 'Trending', bgColor: 'rgba(239,68,68,0.3)', borderColor: '#ef4444' });
  }
  if (forkCount >= 5) {
    badges.push({ icon: '🍴', label: 'Contributor', bgColor: 'rgba(34,197,94,0.3)', borderColor: '#22c55e' });
  }
  return badges;
}

// ── Island builder ────────────────────────────────────
function buildIsland(login, userData) {
  const { cx, cy, avatar, primaryLanguage, repos, isActive } = userData;
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

  const islandRadius = Math.max(120, maxDist + 60);

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = avatar || `https://github.com/identicons/${login}.png`;

  const badges = calculateBadges(repos);

  return {
    login, cx, cy, color, islandRadius,
    avatar, primaryLanguage, isActive,
    repoCount: repos.length, buildings, seed: rng(0),
    avatarImg: img, badges,
    totalStars: repos.reduce((s, r) => s + (r.stars || 0), 0)
  };
}

let currentTerritory = null;

function updateHUD() {
  const loginScreen = document.getElementById('login-screen');
  if (loginScreen && !loginScreen.classList.contains('hidden')) {
    return;
  }

  const hudBl = document.getElementById('hud-bl');
  const hudBr = document.getElementById('hud-br');
  if (hudBl && hudBr) {
    const hudY = window.innerHeight - (isMobile() ? 60 : 30);
    hudBl.style.bottom = (window.innerHeight - hudY) + 'px';
    hudBr.style.bottom = (window.innerHeight - hudY) + 'px';
  }

  document.getElementById('hud-coords').textContent = `X: ${Math.round(player.x)} Y: ${Math.round(player.y)}`;

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

  let inTerritory = null;
  if (nearestIsland && nearestDist < nearestIsland.islandRadius * 1.2) {
    document.getElementById('hud-island').textContent = nearestIsland.login + "'s Island";
    inTerritory = nearestIsland.login;
  } else {
    document.getElementById('hud-island').textContent = 'Deep Space';
  }

  if (inTerritory !== currentTerritory) {
    currentTerritory = inTerritory;
    const banner = document.getElementById('territory-banner');
    if (banner) {
      if (currentTerritory) {
        document.getElementById('tb-name').textContent = currentTerritory + "'s Island";
        banner.classList.remove('hidden');
        // Auto-hide after 4 seconds
        clearTimeout(window.territoryBannerTimeout);
        window.territoryBannerTimeout = setTimeout(() => banner.classList.add('hidden'), 4000);
      } else {
        banner.classList.add('hidden');
      }
    }
  }
}

let autopilotTarget = null;
let totalDistanceTravelled = 0;
let distanceKey = 'gitspace_distance_guest';

window.initDistance = function (username) {
  distanceKey = 'gitspace_distance_' + (username || 'guest');
  totalDistanceTravelled = parseFloat(localStorage.getItem(distanceKey) || '0');
};
window.initDistance('guest'); // default fallback before login

// ── Toast notification system ─────────────────────────
function showToast(message, duration = 2500) {
  const toast = document.getElementById('toast-notification');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden');
  toast.classList.add('visible');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.remove('visible');
    toast.classList.add('hidden');
  }, duration);
}

// ── Main game loop ────────────────────────────────────
function gameLoop() {
  window.drawnLabels = [];
  ctx.fillStyle = '#030308';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

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

  if (moving) {
    const len = Math.sqrt(moveDx * moveDx + moveDy * moveDy);
    const dynamicSpeed = player.speed / Math.sqrt(camera.zoom) + camera.zoom;

    const stepSize = 5;
    const steps = Math.ceil(dynamicSpeed / stepSize);
    const stepX = (moveDx / len) * (dynamicSpeed / steps);
    const stepY = (moveDy / len) * (dynamicSpeed / steps);

    for (let i = 0; i < steps; i++) {
      let nx = player.x + stepX;
      let ny = player.y + stepY;
      nx = Math.max(-1000000, Math.min(1000000, nx));
      ny = Math.max(-1000000, Math.min(1000000, ny));
      if (isValidPosition(nx, player.y)) player.x = nx;
      if (isValidPosition(player.x, ny)) player.y = ny;
    }

    const targetAngle = Math.atan2(moveDy, moveDx);
    let diff = targetAngle - playerAngle;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    playerAngle += diff * 0.15;

    trails.push({
      x: player.x - Math.cos(playerAngle) * 12,
      y: player.y - Math.sin(playerAngle) * 12,
      vx: (Math.random() - 0.5) * 1.5 - Math.cos(playerAngle) * 2,
      vy: (Math.random() - 0.5) * 1.5 - Math.sin(playerAngle) * 2,
      life: 1.0
    });

    totalDistanceTravelled += dynamicSpeed;
    if (Math.random() < 0.05) localStorage.setItem(distanceKey, totalDistanceTravelled.toString());
    if (totalDistanceTravelled >= 100000 && window.unlockAchievement) {
      window.unlockAchievement('marathon');
    }
  }

  // Auto-Pilot with Warp Drive (Feature 5)
  if (autopilotTarget) {
    const dx = autopilotTarget.x - player.x;
    const dy = autopilotTarget.y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Stop early to prevent clipping into buildings/islands
    const stoppingDistance = autopilotTarget.item ? (autopilotTarget.item.type === 'repo' ? 80 : 150) : 5;

    // Activate warp for long distances
    if (dist > 5000 && !warpActive) {
      warpActive = true;
      warpProgress = 0;
    }

    const speedMultiplier = warpActive ? 10 : 1;
    const dynamicSpeed = Math.min(dist * 0.05, (30 / camera.zoom) * speedMultiplier);

    if (dist <= stoppingDistance || dist < dynamicSpeed) {
      if (warpActive) {
        warpActive = false;
        showToast('⚡ Warp complete');
      }
      if (autopilotTarget.item) openModalForItem(autopilotTarget.item);
      
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
        if (isValidPosition(nx, player.y)) player.x = nx;
        if (isValidPosition(player.x, ny)) player.y = ny;
      }
      
      totalDistanceTravelled += dynamicSpeed;
      if (Math.random() < 0.05) localStorage.setItem(distanceKey, totalDistanceTravelled.toString());
      if (totalDistanceTravelled >= 100000 && window.unlockAchievement) {
        window.unlockAchievement('marathon');
      }

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

  // Draw world
  drawNebula();
  drawStars();
  drawSlipstream2D();
  updateShootingStars();
  for (const island of islands) drawIsland(island);
  drawPlayer();
  drawMinimap();
  drawCompass();
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
  requestAnimationFrame(gameLoop);
}
