// Cozy low-poly look. Plain 2D canvas: faceted polygons and flat shading fake the depth.
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const COZY = {
  skyTop: '#1E1B3A', skyMid: '#35295A', skyLow: '#5E4475', glow: '244,169,122',
  star: '#FFF1D6', cream: '#FFF4E6', ink: '#2B2340',
  grass: '#5F9460', grassLight: '#79AE72', dirt: '#8A5F4B', // night-tuned
  rock: ['#3B3550', '#4C4566', '#5E567A'],
  leaf: ['#2F5E43', '#3F7553'], trunk: '#5E4034',
  window: '#FFD27A', shadow: 'rgba(43,35,64,0.28)', coral: '#F2765A', glass: '#7FC8E8',
};

const _mixCache = new Map();
function mixHex(a, b, t) {
  const key = a + b + t;
  let v = _mixCache.get(key);
  if (v) return v;
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  v = `rgb(${ch(16)},${ch(8)},${ch(0)})`;
  _mixCache.set(key, v);
  return v;
}
function shadeRgb(rgb, f) {
  const m = rgb.match(/\d+/g).map(Number);
  return `rgb(${Math.round(m[0] * f)},${Math.round(m[1] * f)},${Math.round(m[2] * f)})`;
}
function seededRand(seed) {
  let s = Math.floor(seed * 2147483646) || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
function easeOutBack(p) { const c = 1.6; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); }

// Night sky: pure black with the real bright stars (Yale Bright Star Catalog, public/data/sky.json).
// Star colours come from each star's measured B-V colour index, so most read blue-white and a few
// giants read orange or red. The sky is a wrapped panorama that drifts slowly with the camera.
let skyGrad = null, skyGradH = 0; // kept: renderIslandSnapshot saves and restores these
let SKY = null;
const SKY_W = 3400, SKY_H = 1700, SKY_PARALLAX = 0.012;
fetch('data/sky.json').then(r => r.ok ? r.json() : null).then(d => {
  if (!d) return;
  SKY = {
    stars: d.stars.map(([ra, dec, mag, col]) => ({ x: (ra + 180) / 360 * SKY_W, y: (90 - dec) / 180 * SKY_H, mag, col,
      r: Math.max(0.7, (6.3 - mag) * 0.55), a: Math.min(1, Math.max(0.45, (6.8 - mag) / 4.5)) })),
    lines: d.lines.map(c => c.l.map(seg => seg.map(([ra, dec]) => [(ra + 180) / 360 * SKY_W, (90 - dec) / 180 * SKY_H]))),
  };
}).catch(() => {});

function drawNebula() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function skyOffset() {
  const ox = ((camera.x * SKY_PARALLAX) % SKY_W + SKY_W) % SKY_W;
  const oy = ((camera.y * SKY_PARALLAX) % SKY_H + SKY_H) % SKY_H;
  return [ox, oy];
}
const wrap = (v, m) => ((v % m) + m) % m;

function drawStars() {
  // Faint unresolved stars for depth (the procedural set from engine.js), drawn first and dim.
  ctx.fillStyle = '#C9D6FF';
  for (let i = 0; i < stars.length; i += 2) {
    const s = stars[i];
    let sx = ((s.x * canvas.width * 2) - camera.x * 0.008) % canvas.width; if (sx < 0) sx += canvas.width;
    let sy = ((s.y * canvas.height * 2) - camera.y * 0.008) % canvas.height; if (sy < 0) sy += canvas.height;
    ctx.globalAlpha = 0.12 + s.brightness * 0.12;
    ctx.fillRect(sx, sy, 1, 1);
  }
  ctx.globalAlpha = 1;
  if (!SKY) return;
  const [ox, oy] = skyOffset();
  const W = canvas.width, H = canvas.height;

  // Constellation lines, very faint, so the patterns are there when you look for them.
  ctx.strokeStyle = 'rgba(170, 190, 255, 0.11)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const c of SKY.lines) for (const seg of c) {
    for (let i = 1; i < seg.length; i++) {
      const x1 = wrap(seg[i - 1][0] - ox, SKY_W), y1 = wrap(seg[i - 1][1] - oy, SKY_H);
      const x2 = wrap(seg[i][0] - ox, SKY_W), y2 = wrap(seg[i][1] - oy, SKY_H);
      if (Math.abs(x1 - x2) > SKY_W / 2 || Math.abs(y1 - y2) > SKY_H / 2) continue; // crosses the wrap seam
      if ((x1 > W && x2 > W) || (y1 > H && y2 > H)) continue;
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    }
  }
  ctx.stroke();

  const t = performance.now() * 0.001;
  for (let i = 0; i < SKY.stars.length; i++) {
    const s = SKY.stars[i];
    const sx = wrap(s.x - ox, SKY_W), sy = wrap(s.y - oy, SKY_H);
    if (sx > W + 4 || sy > H + 4) continue;
    // Only the brightest stars scintillate, and only slightly.
    const tw = s.mag < 1.8 && !reduceMotion ? 0.88 + 0.12 * Math.sin(t * 1.7 + i) : 1;
    ctx.fillStyle = s.col;
    if (s.r < 1.3) { ctx.globalAlpha = s.a * tw; ctx.fillRect(sx, sy, s.r * 1.4, s.r * 1.4); continue; }
    ctx.globalAlpha = 0.12 * tw;
    ctx.beginPath(); ctx.arc(sx, sy, s.r * 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = s.a * tw;
    ctx.beginPath(); ctx.arc(sx, sy, s.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

let slipstreamParticles = [];
function drawSlipstream2D() {
  if (!warpActive) { if (warpProgress > 0) { warpProgress *= 0.8; if (warpProgress < 0.01) warpProgress = 0; } }
  else warpProgress += (1 - warpProgress) * 0.05;
  if (warpProgress <= 0) return;

  let dirX = 1, dirY = 0;
  if (autopilotTarget) {
    const dx = autopilotTarget.x - player.x, dy = autopilotTarget.y - player.y, len = Math.hypot(dx, dy);
    if (len > 0) { dirX = dx / len; dirY = dy / len; }
  }
  if (!slipstreamParticles.length) {
    for (let i = 0; i < 90; i++) slipstreamParticles.push({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, length: Math.random() * 120 + 40, speed: Math.random() * 30 + 20 });
  }
  ctx.strokeStyle = COZY.cream; ctx.lineWidth = 2; ctx.lineCap = 'round';
  for (const p of slipstreamParticles) {
    p.x -= dirX * p.speed * warpProgress * 3; p.y -= dirY * p.speed * warpProgress * 3;
    if (p.x < -p.length || p.x > canvas.width + p.length || p.y < -p.length || p.y > canvas.height + p.length) {
      p.x = Math.random() * canvas.width; p.y = Math.random() * canvas.height;
    }
    ctx.globalAlpha = warpProgress * 0.45;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + dirX * p.length * warpProgress, p.y + dirY * p.length * warpProgress); ctx.stroke();
  }
  ctx.globalAlpha = 1; ctx.lineCap = 'butt';
}

// Static per-island geometry, built once on first draw.
function prepareIsland(island) {
  const rand = seededRand(island.seed || 0.5);
  const n = 16;
  island._rim = Array.from({ length: n }, (_, i) => ({ a: (i / n) * Math.PI * 2, r: 1 + rand() * 0.08 }));
  island._grass = mixHex(COZY.grass, island.color, 0.22);
  island._grassLight = mixHex(COZY.grassLight, island.color, 0.12);
  const trees = [];
  const want = Math.min(18, 5 + Math.floor(island.buildings.length * 0.8));
  for (let tries = 0; tries < want * 6 && trees.length < want; tries++) {
    const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * island.islandRadius * 0.82;
    const x = island.cx + Math.cos(a) * d, y = island.cy + Math.sin(a) * d;
    if (island.buildings.some(b => Math.hypot(b.x - x, b.y - y) < (b.width || 20) + 14)) continue;
    trees.push({ isTree: true, x, y, size: 0.7 + rand() * 0.6, tone: rand() > 0.5 ? 1 : 0 });
  }
  island._props = [...island.buildings, ...trees].sort((p, q) => p.y - q.y);
  island._born = performance.now();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function drawIsland(island) {
  const { cx, cy, islandRadius, login, repoCount } = island;
  const scx = canvas.width / 2, scy = canvas.height / 2;
  const z = camera.zoom;
  const sx = scx + (cx - camera.x) * z;
  const sr = islandRadius * z;
  if (sx < -sr - 200 || sx > canvas.width + sr + 200) return;
  const syBase = scy + (cy - camera.y) * z;
  if (syBase < -sr * 2 - 200 || syBase > canvas.height + sr + 200) return;
  if (!island._rim) prepareIsland(island);

  const bob = reduceMotion ? 0 : Math.sin(performance.now() * 0.0011 + island.seed * 20) * 3 * z;
  const sy = syBase + bob;
  const pts = island._rim.map(p => [sx + Math.cos(p.a) * sr * p.r, sy + Math.sin(p.a) * sr * p.r]);
  const band = Math.max(4, 14 * z);

  // Rock keel under the island: flat-shaded facets fanning down to a tip.
  const tip = [sx + sr * 0.08, sy + sr * 1.55];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    if (p[1] < sy - sr * 0.15 && q[1] < sy - sr * 0.15) continue;
    ctx.fillStyle = COZY.rock[i % 3];
    ctx.beginPath(); ctx.moveTo(p[0], p[1] + band); ctx.lineTo(q[0], q[1] + band); ctx.lineTo(tip[0], tip[1]); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = COZY.dirt;
  ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1] + band) : ctx.moveTo(p[0], p[1] + band)); ctx.closePath(); ctx.fill();
  ctx.fillStyle = island._grass;
  ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.fill();
  ctx.fillStyle = island._grassLight;
  ctx.beginPath();
  pts.forEach((p, i) => { const x = sx - sr * 0.12 + (p[0] - sx) * 0.62, y = sy - sr * 0.12 + (p[1] - sy) * 0.62; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.closePath(); ctx.fill();

  window.islandBob = bob;
  const now = performance.now();
  island._props.forEach((p, idx) => {
    const t = reduceMotion ? 1 : Math.min(1, Math.max(0, (now - island._born - idx * Math.min(45, 1200 / island._props.length)) / 450));
    if (t <= 0) return;
    if (p.isTree) drawTree(p, scx, scy, easeOutBack(t));
    else drawBuilding(p, scx, scy, easeOutBack(t));
  });
  window.islandBob = 0;

  if (z > 0.1 && !window.__snapshotNoSign) {
    const fs = Math.max(11, 15 * z);
    ctx.font = `600 ${fs}px 'Fredoka', sans-serif`;
    const w = ctx.measureText(login).width + 26 * z;
    const h = fs + 12 * z;
    const ny = sy - sr - 18 * z - h;
    ctx.fillStyle = COZY.shadow; roundRect(sx - w / 2, ny + 3 * z, w, h, h / 2); ctx.fill();
    ctx.fillStyle = COZY.cream; roundRect(sx - w / 2, ny, w, h, h / 2); ctx.fill();
    ctx.fillStyle = COZY.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(login, sx, ny + h / 2 + 1);
    if (z > 0.22) {
      ctx.font = `500 ${Math.max(10, 11 * z)}px 'Rubik', sans-serif`;
      ctx.fillStyle = COZY.cream; ctx.globalAlpha = 0.8;
      ctx.fillText(`${repoCount} ${repoCount === 1 ? 'repo' : 'repos'}`, sx, ny - 9 * z);
      ctx.globalAlpha = 1;
    }
    ctx.textBaseline = 'alphabetic';
  }
}

function drawTree(t, scx, scy, grow) {
  const z = camera.zoom;
  if (z < 0.2) return;
  const x = scx + (t.x - camera.x) * z, y = scy + (t.y - camera.y) * z + (window.islandBob || 0);
  if (x < -60 || x > canvas.width + 60 || y < -80 || y > canvas.height + 60) return;
  const s = 14 * t.size * z * grow;
  ctx.fillStyle = COZY.shadow;
  ctx.beginPath(); ctx.ellipse(x + s * 0.3, y, s * 0.7, s * 0.28, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = COZY.trunk; ctx.fillRect(x - s * 0.1, y - s * 0.5, s * 0.2, s * 0.5);
  const top = y - s * 2.1, base = y - s * 0.4;
  ctx.fillStyle = COZY.leaf[1 - t.tone];
  ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x - s * 0.75, base); ctx.lineTo(x, base + s * 0.15); ctx.closePath(); ctx.fill();
  ctx.fillStyle = COZY.leaf[t.tone];
  ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x + s * 0.75, base); ctx.lineTo(x, base + s * 0.15); ctx.closePath(); ctx.fill();
}

function drawBuilding(b, scx, scy, grow = 1) {
  const z = camera.zoom;
  const bsx = scx + (b.x - camera.x) * z;
  let bsy = scy + (b.y - camera.y) * z + (window.islandBob || 0);
  if (bsx < -100 || bsx > canvas.width + 100 || bsy < -150 || bsy > canvas.height + 100) return;

  const isNear = nearbyRepo && nearbyRepo.name === b.name && nearbyRepo.url === b.url;
  b._lift = (b._lift || 0) + ((isNear ? 1 : 0) - (b._lift || 0)) * 0.25;
  bsy -= b._lift * 4 * z;

  if (!b._wall) {
    const base = b.isFork ? '#9A93B5' : b.color;
    b._wall = mixHex(base, '#B8AE9E', 0.5); // dimmer walls at night so lit windows carry the light
    b._side = shadeRgb(b._wall, 0.78);
    b._roof = mixHex(base, '#3A2E55', 0.25);
    b._roofSide = shadeRgb(b._roof, 0.75);
  }
  const bw = b.width * z * grow, bh = b.height * z * grow, depth = bw * 0.5;
  if (z < 0.05) { ctx.fillStyle = b._wall; ctx.fillRect(bsx - bw / 2, bsy - bh, bw, bh); return; }

  if (z > 0.25) {
    ctx.fillStyle = COZY.shadow;
    ctx.beginPath(); ctx.ellipse(bsx + depth * 0.5, bsy + 1, bw * 0.75 + depth * 0.4, bw * 0.28, 0, 0, Math.PI * 2); ctx.fill();
  }

  const pitched = b.tier === 'hut' || b.tier === 'house';
  const wallH = pitched ? bh * 0.62 : bh;
  const top = bsy - wallH;

  ctx.fillStyle = b._side;
  ctx.beginPath(); ctx.moveTo(bsx + bw / 2, bsy); ctx.lineTo(bsx + bw / 2 + depth, bsy - depth * 0.5);
  ctx.lineTo(bsx + bw / 2 + depth, top - depth * 0.5); ctx.lineTo(bsx + bw / 2, top); ctx.closePath(); ctx.fill();
  ctx.fillStyle = b._wall;
  ctx.fillRect(bsx - bw / 2, top, bw, wallH);

  if (pitched) {
    const peak = bw * 0.48;
    ctx.fillStyle = b._roofSide;
    ctx.beginPath(); ctx.moveTo(bsx, top - peak); ctx.lineTo(bsx + depth, top - peak - depth * 0.5);
    ctx.lineTo(bsx + bw / 2 + depth, top - depth * 0.5); ctx.lineTo(bsx + bw / 2, top); ctx.closePath(); ctx.fill();
    ctx.fillStyle = b._roof;
    ctx.beginPath(); ctx.moveTo(bsx - bw / 2 - 2 * z, top + 1); ctx.lineTo(bsx, top - peak); ctx.lineTo(bsx + bw / 2 + 2 * z, top + 1); ctx.closePath(); ctx.fill();
    if (z > 0.35) { ctx.fillStyle = b._roofSide; roundRect(bsx - bw * 0.12, bsy - wallH * 0.5, bw * 0.24, wallH * 0.5, bw * 0.08); ctx.fill(); }
  } else {
    ctx.fillStyle = b._roof;
    ctx.beginPath(); ctx.moveTo(bsx - bw / 2, top); ctx.lineTo(bsx - bw / 2 + depth, top - depth * 0.5);
    ctx.lineTo(bsx + bw / 2 + depth, top - depth * 0.5); ctx.lineTo(bsx + bw / 2, top); ctx.closePath(); ctx.fill();
    if (b.tier === 'skyscraper') {
      const cw = bw * 0.5, ch = bh * 0.14, c0 = bsx + depth * 0.25 - cw / 2, cy0 = top - depth * 0.25 - ch;
      ctx.fillStyle = b._wall; ctx.fillRect(c0, cy0, cw, ch);
      ctx.fillStyle = b._roof; ctx.fillRect(c0 - 1, cy0 - 3 * z, cw + 2, 3 * z);
    }
  }

  if (z > 0.3 && !b.isFork && bw > 6) {
    ctx.fillStyle = COZY.window;
    const ws = Math.max(2, 3.2 * z), gap = 7 * z;
    const rows = Math.max(1, Math.floor((wallH - (pitched ? wallH * 0.5 : 6 * z)) / gap));
    const cols = Math.max(1, Math.floor((bw - 4 * z) / gap));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (Math.sin(b.seed * 50 + r * 7.1 + c * 3.3) < 0.1) continue;
      ctx.fillRect(bsx - bw / 2 + 3 * z + c * gap, top + 4 * z + r * gap, ws, ws * 1.2);
    }
  }

  if (b._lift > 0.05) {
    ctx.strokeStyle = COZY.cream; ctx.globalAlpha = b._lift; ctx.lineWidth = 2;
    ctx.strokeRect(bsx - bw / 2, top, bw, wallH); ctx.globalAlpha = 1;
  }

  if ((z > 0.55 && bw > 4 && b.showLabel) || isNear) {
    const fontSize = Math.max(10, 10 * z);
    ctx.font = `500 ${fontSize}px 'Rubik', sans-serif`;
    ctx.textAlign = 'center';
    let label = b.name;
    if (label.length > 16 && !isNear) label = label.slice(0, 14) + '...';
    const textWidth = ctx.measureText(label).width;
    const labelX = bsx + depth / 2, labelY = top - (pitched ? bw * 0.5 : depth * 0.5) - 8 * z;
    const box = { x: labelX - textWidth / 2 - 4, y: labelY - fontSize - 3, w: textWidth + 8, h: fontSize + 6 };
    let hit = false;
    if (!isNear && window.drawnLabels) for (const o of window.drawnLabels) {
      if (box.x < o.x + o.w && box.x + box.w > o.x && box.y < o.y + o.h && box.y + box.h > o.y) { hit = true; break; }
    }
    if (!hit || isNear) {
      ctx.lineWidth = 3; ctx.strokeStyle = COZY.ink; ctx.lineJoin = 'round';
      ctx.strokeText(label, labelX, labelY);
      ctx.fillStyle = COZY.cream; ctx.fillText(label, labelX, labelY);
      (window.drawnLabels = window.drawnLabels || []).push(box);
    }
  }
}

function drawPlayer() {
  const sx = canvas.width / 2 + (player.x - camera.x) * camera.zoom;
  const sy = canvas.height / 2 + (player.y - camera.y) * camera.zoom;
  const speed = window.shipSpeed || 0;
  const moving = speed > 0.5 || !!autopilotTarget;

  ctx.fillStyle = COZY.cream;
  for (let i = trails.length - 1; i >= 0; i--) {
    const t = trails[i];
    t.life -= 0.03; t.x += t.vx * 0.4; t.y += t.vy * 0.4;
    if (t.life <= 0) { trails.splice(i, 1); continue; }
    const tsx = canvas.width / 2 + (t.x - camera.x) * camera.zoom;
    const tsy = canvas.height / 2 + (t.y - camera.y) * camera.zoom;
    ctx.globalAlpha = t.life * 0.4;
    ctx.beginPath(); ctx.arc(tsx, tsy, 3 + (1 - t.life) * 7, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(playerAngle);
  const stretch = reduceMotion ? 0 : Math.min(0.12, speed * 0.008);
  ctx.scale(1 + stretch, 1 - stretch);
  if (moving) {
    const f = reduceMotion ? 0 : Math.sin(performance.now() * 0.03) * 2;
    ctx.fillStyle = '#FFB35C';
    ctx.beginPath(); ctx.ellipse(-17 - f * 0.5, 0, 6 + f, 3.5, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = COZY.coral;
  ctx.beginPath(); ctx.moveTo(-6, -6); ctx.lineTo(-15, -13); ctx.lineTo(-12, -4); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-6, 6); ctx.lineTo(-15, 13); ctx.lineTo(-12, 4); ctx.closePath(); ctx.fill();
  ctx.fillStyle = COZY.cream;
  ctx.beginPath(); ctx.ellipse(0, 0, 16, 8.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save(); ctx.clip(); ctx.fillStyle = COZY.coral; ctx.fillRect(9, -10, 10, 20); ctx.restore();
  ctx.fillStyle = COZY.ink;
  ctx.beginPath(); ctx.arc(1, 0, 4.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = COZY.glass;
  ctx.beginPath(); ctx.arc(1, 0, 2.8, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// Minimap: small in the corner, click (or press M) to open a big map, click a spot to fly there.
window.mapExpanded = false;
let mapT = 0, mapRect = null;
function drawMinimap() {
  mapT += ((window.mapExpanded ? 1 : 0) - mapT) * (reduceMotion ? 1 : 0.2);
  const small = isMobile() ? 96 : 140, pad = isMobile() ? 12 : 20;
  const big = Math.min(canvas.width * 0.62, canvas.height * 0.7, 560);
  const size = small + (big - small) * mapT;
  const x = (canvas.width - small - pad) + ((canvas.width - big) / 2 - (canvas.width - small - pad)) * mapT;
  const y = (canvas.height - small - pad - (isMobile() ? 56 : 0)) + ((canvas.height - big) / 2 - (canvas.height - small - pad - (isMobile() ? 56 : 0))) * mapT;
  // Big map fits the loaded islands around you; small map shows the local area.
  let reach = 0;
  for (const i of islands) reach = Math.max(reach, Math.abs(i.cx - player.x) + i.islandRadius, Math.abs(i.cy - player.y) + i.islandRadius);
  const bigSpan = Math.min(CHUNK_SIZE * 10, Math.max(CHUNK_SIZE * 1.2, reach * 2.3));
  const span = CHUNK_SIZE * 3 + (bigSpan - CHUNK_SIZE * 3) * mapT;
  const scale = size / span;
  mapRect = { x, y, size, scale };

  // See-through so the live world stays visible behind the map.
  ctx.fillStyle = `rgba(14,14,20,${0.9 - 0.3 * mapT})`; roundRect(x, y, size, size, 16); ctx.fill();
  ctx.strokeStyle = `rgba(255,244,230,${0.25 * mapT})`; ctx.lineWidth = 1; roundRect(x, y, size, size, 16); ctx.stroke();
  ctx.save(); roundRect(x, y, size, size, 16); ctx.clip();
  const cxm = x + size / 2, cym = y + size / 2;
  for (const island of islands) {
    const mx = cxm + (island.cx - player.x) * scale, my = cym + (island.cy - player.y) * scale;
    if (mx < x - 20 || mx > x + size + 20 || my < y - 20 || my > y + size + 20) continue;
    ctx.fillStyle = island._grass || COZY.grass;
    ctx.beginPath(); ctx.arc(mx, my, Math.max(2.5, island.islandRadius * scale), 0, Math.PI * 2); ctx.fill();
    if (mapT > 0.6) {
      ctx.globalAlpha = (mapT - 0.6) / 0.4;
      ctx.font = "600 13px 'Fredoka', sans-serif"; ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = COZY.ink; ctx.strokeText(island.login, mx, my - Math.max(6, island.islandRadius * scale) - 6);
      ctx.font = "500 11px 'Rubik', sans-serif"; ctx.strokeText(`${island.repoCount} repos`, mx, my + Math.max(6, island.islandRadius * scale) + 14);
      ctx.fillStyle = COZY.cream; ctx.fillText(`${island.repoCount} repos`, mx, my + Math.max(6, island.islandRadius * scale) + 14);
      ctx.font = "600 13px 'Fredoka', sans-serif";
      ctx.fillStyle = COZY.cream; ctx.fillText(island.login, mx, my - Math.max(6, island.islandRadius * scale) - 6);
      ctx.globalAlpha = 1;
    }
  }
  if (autopilotTarget) {
    const tx = cxm + (autopilotTarget.x - player.x) * scale, ty = cym + (autopilotTarget.y - player.y) * scale;
    ctx.strokeStyle = COZY.coral; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(cxm, cym); ctx.lineTo(tx, ty); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(tx, ty, 6, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = COZY.coral;
  ctx.beginPath(); ctx.arc(cxm, cym, 4, 0, Math.PI * 2); ctx.fill();
  if (mapT > 0.6) {
    ctx.globalAlpha = (mapT - 0.6) / 0.4;
    ctx.font = "500 13px 'Rubik', sans-serif"; ctx.textAlign = 'center'; ctx.fillStyle = COZY.cream;
    ctx.lineWidth = 3; ctx.strokeStyle = COZY.ink; ctx.strokeText('Click a spot to fly there. Press M or Esc to close.', canvas.width / 2, y + size + 24);
    ctx.fillText('Click a spot to fly there. Press M or Esc to close.', canvas.width / 2, y + size + 24);
    ctx.globalAlpha = 1;
  }
}

// Returns true when the click was handled by the map.
window.minimapClick = function (sx, sy) {
  if (!mapRect) return false;
  const inside = sx >= mapRect.x && sx <= mapRect.x + mapRect.size && sy >= mapRect.y && sy <= mapRect.y + mapRect.size;
  if (!window.mapExpanded) { if (inside) { window.mapExpanded = true; return true; } return false; }
  if (inside) {
    const wx = player.x + (sx - (mapRect.x + mapRect.size / 2)) / mapRect.scale;
    const wy = player.y + (sy - (mapRect.y + mapRect.size / 2)) / mapRect.scale;
    autopilotTarget = { x: wx, y: wy };
  }
  window.mapExpanded = false;
  return true;
};

// Points at the nearest island you are not already on.
function drawCompass() {
  if (warpActive) return;
  let closest = null, closestDist = Infinity;
  for (const island of islands) {
    const dist = Math.hypot(island.cx - player.x, island.cy - player.y);
    if (dist < closestDist && dist > island.islandRadius * 2) { closestDist = dist; closest = island; }
  }
  if (!closest || closestDist >= 8000) return;
  const sx = canvas.width / 2 + (player.x - camera.x) * camera.zoom;
  const sy = canvas.height / 2 + (player.y - camera.y) * camera.zoom;
  const angle = Math.atan2(closest.cy - player.y, closest.cx - player.x);
  const radius = isMobile() ? 56 : 80;
  const px = sx + Math.cos(angle) * radius, py = sy + Math.sin(angle) * radius;
  ctx.save(); ctx.translate(px, py); ctx.rotate(angle);
  ctx.fillStyle = COZY.cream; ctx.globalAlpha = 0.85;
  ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-4, 5); ctx.lineTo(-2, 0); ctx.lineTo(-4, -5); ctx.closePath(); ctx.fill();
  ctx.restore(); ctx.globalAlpha = 1;
  const distLabel = closestDist < 1000 ? Math.round(closestDist) + ' u' : (closestDist / 1000).toFixed(1) + ' ku';
  ctx.font = "500 11px 'Rubik', sans-serif"; ctx.textAlign = 'center';
  const lx = px + Math.cos(angle) * 26, ly = py + Math.sin(angle) * 26;
  ctx.lineWidth = 3; ctx.strokeStyle = COZY.ink; ctx.strokeText(`${closest.login}, ${distLabel}`, lx, ly);
  ctx.fillStyle = COZY.cream; ctx.fillText(`${closest.login}, ${distLabel}`, lx, ly);
}


let fpsVisible = false;
let fpsFrames = 0;
let fpsLastTime = Date.now();
let fpsDisplay = 0;

function drawFPS() {
  if (!fpsVisible) return;
  fpsFrames++;
  const now = Date.now();
  if (now - fpsLastTime >= 1000) {
    fpsDisplay = fpsFrames;
    fpsFrames = 0;
    fpsLastTime = now;
  }

  ctx.fillStyle = fpsDisplay >= 50 ? '#22c55e' : fpsDisplay >= 30 ? '#eab308' : '#ef4444';
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'left';
  const fpsY = canvas.height - (isMobile() ? 60 : 10);
  ctx.fillText(fpsDisplay + ' FPS', 10, fpsY);
}

function checkProximity() {
  nearbyRepo = null;
  let clickedRepo = null;
  let clickedIsland = null;

  outer:
  for (const island of islands) {
    const isx = canvas.width / 2 + (island.cx - camera.x) * camera.zoom;
    const isy = canvas.height / 2 + (island.cy - camera.y) * camera.zoom;

    // buildings are pre-sorted by y ascending (engine.js buildIsland); walk backwards for front-most first
    for (let i = island.buildings.length - 1; i >= 0; i--) {
      const b = island.buildings[i];
      const bsx = canvas.width / 2 + (b.x - camera.x) * camera.zoom;
      const bsy = canvas.height / 2 + (b.y - camera.y) * camera.zoom;
      const bw = b.width * camera.zoom;
      const bh = b.height * camera.zoom;
      const depth = bw * 0.6;

      const hitLeft = bsx - bw / 2;
      const hitRight = bsx + bw / 2 + depth;
      const hitTop = bsy - bh - depth * 0.5;
      const hitBottom = bsy + depth * 0.5;

      if (lastMouse.x >= hitLeft && lastMouse.x <= hitRight &&
        lastMouse.y >= hitTop && lastMouse.y <= hitBottom) {
        nearbyRepo = b;
        clickedRepo = b;
        break outer;
      }
    }

    const dx = lastMouse.x - isx;
    const dy = lastMouse.y - isy;
    if (Math.sqrt(dx * dx + dy * dy) < (10 * camera.zoom + 3)) {
      clickedIsland = island;
      break;
    }
  }

  window._lastHoveredRepo = clickedRepo;
  window._lastHoveredIsland = clickedIsland;

  const tt = document.getElementById('repo-tooltip');
  if (nearbyRepo) {
    document.getElementById('tt-name').textContent = nearbyRepo.name;
    document.getElementById('tt-lang').textContent = nearbyRepo.language + (nearbyRepo.isFork ? ', fork' : '');
    document.getElementById('tt-stars').textContent = (nearbyRepo.stars || 0).toLocaleString() + ' stars';

    tt.style.left = (lastMouse.x + 15) + 'px';
    tt.style.top = (lastMouse.y + 15) + 'px';
    tt.style.display = 'block';
  } else {
    tt.style.display = 'none';
  }
}

// Live picture of someone's island for the postcard. Draws with the same renderer into an offscreen canvas.
// target: a login on the map, or an island object from buildIsland. opts.sky = false gives a transparent background.
// opts.born (a performance.now() time) draws the buildings mid rise-in; opts.canvas reuses a canvas.
window.renderIslandSnapshot = function (target, width, height, opts = {}) {
  const island = typeof target === 'string' ? islands.find(i => i.login === target) : target;
  if (!island) return null;
  if (!island._rim) prepareIsland(island);
  const off = opts.canvas || document.createElement('canvas'); // opts.canvas: redraw in place (front-page rise-in)
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  off.width = Math.round(width * dpr); off.height = Math.round(height * dpr);
  const saved = { canvas, ctx, cam: { ...camera }, born: island._born, labels: window.drawnLabels, sky: skyGrad, skyH: skyGradH };
  canvas = off; ctx = off.getContext('2d');
  skyGrad = null;
  const fit = Math.min(off.width, off.height) / (island.islandRadius * (opts.fit || 3.1));
  window.__snapshotNoSign = opts.sign === false;
  camera.x = island.cx; camera.y = island.cy + island.islandRadius * 0.28; camera.zoom = fit;
  island._born = opts.born ?? -1e9; // fully grown unless the caller animates a rise-in
  window.drawnLabels = [];
  try {
    if (opts.sky !== false) { drawNebula(); drawStars(); }
    drawIsland(island);
  } finally {
    canvas = saved.canvas; ctx = saved.ctx; Object.assign(camera, saved.cam);
    window.__snapshotNoSign = false;
    island._born = saved.born; window.drawnLabels = saved.labels; skyGrad = saved.sky; skyGradH = saved.skyH;
  }
  off.style.width = width + 'px'; off.style.height = height + 'px';
  return off;
};

// Arrival: letterbox bars while the camera settles and the buildings rise again. The title card is DOM (React listens for gs:arrival).
let arrival = null;
window.startArrival = function (island) {
  if (!island) return;
  arrival = { island, t0: performance.now() };
  island._born = performance.now() + 250;
  targetCamera.zoom = Math.max(0.25, Math.min(1.2, Math.min(canvas.width, canvas.height) / (island.islandRadius * 2.6)));
  window.dispatchEvent(new CustomEvent('gs:arrival', { detail: { login: island.login, repoCount: island.repoCount, totalStars: island.totalStars || 0 } }));
};
function drawArrival() {
  if (!arrival) return;
  const t = (performance.now() - arrival.t0) / 1000, total = 3.2;
  if (t > total) { arrival = null; return; }
  const inOut = Math.min(1, t / 0.35, (total - t) / 0.45);
  const e = reduceMotion ? (inOut > 0 ? 1 : 0) : 1 - Math.pow(1 - Math.max(0, inOut), 3);
  const bar = canvas.height * 0.08 * e;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, bar); ctx.fillRect(0, canvas.height - bar, canvas.width, bar);
}
