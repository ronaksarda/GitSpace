// ══════════════════════════════════════════════════════
// GITSPACE — Rendering Engine v2.0
// ══════════════════════════════════════════════════════

// ── Nebula color clusters (shift with camera) ─────────
const nebulaColors = [
  { r: 20, g: 8, b: 60 },
  { r: 8, g: 25, b: 50 },
  { r: 40, g: 5, b: 30 },
  { r: 5, g: 15, b: 45 },
];

function drawNebula() {
  ctx.fillStyle = '#030308';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Subtle moving nebula clouds
  const time = Date.now() * 0.0001;
  for (let i = 0; i < 3; i++) {
    const nc = nebulaColors[i % nebulaColors.length];
    const ox = Math.sin(time + i * 2.1) * 200 - camera.x * 0.002 * (i + 1);
    const oy = Math.cos(time + i * 1.7) * 150 - camera.y * 0.002 * (i + 1);
    const cx = canvas.width * 0.3 + ox + i * canvas.width * 0.25;
    const cy = canvas.height * 0.4 + oy + i * canvas.height * 0.15;
    const radius = canvas.width * 0.4;

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, `rgba(${nc.r},${nc.g},${nc.b},0.12)`);
    grad.addColorStop(0.5, `rgba(${nc.r},${nc.g},${nc.b},0.04)`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

// ── Multi-layer parallax stars ────────────────────────
function drawStars() {
  const layers = [
    { speed: 0.02, sizeMultiplier: 0.6, alpha: 0.4 },
    { speed: 0.04, sizeMultiplier: 1.0, alpha: 0.7 },
    { speed: 0.07, sizeMultiplier: 1.4, alpha: 1.0 },
  ];

  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    const startIdx = Math.floor(li * (stars.length / 3));
    const endIdx = Math.floor((li + 1) * (stars.length / 3));

    for (let si = startIdx; si < endIdx; si++) {
      const s = stars[si];
      if (!s) continue;

      const px_raw = (s.x * canvas.width * 2) - (camera.x * layer.speed * s.r);
      const py_raw = (s.y * canvas.height * 2) - (camera.y * layer.speed * s.r);

      let sx = px_raw % canvas.width;
      if (sx < 0) sx += canvas.width;
      let sy = py_raw % canvas.height;
      if (sy < 0) sy += canvas.height;

      s.brightness += s.twinkleSpeed;
      if (s.brightness > 1 || s.brightness < 0.2) s.twinkleSpeed *= -1;

      const finalAlpha = s.brightness * layer.alpha;
      const finalRadius = s.r * layer.sizeMultiplier;

      ctx.globalAlpha = finalAlpha;
      ctx.fillStyle = '#ffffff';

      ctx.beginPath();
      ctx.arc(sx, sy, finalRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

// ── 2D Slipstream Warp ─────────────────────────────────
let slipstreamParticles = [];
function drawSlipstream2D() {
  if (!warpActive) {
    if (typeof warpProgress !== 'undefined' && warpProgress > 0) {
      warpProgress *= 0.8;
      if (warpProgress < 0.01) warpProgress = 0;
    }
  } else {
    if (typeof warpProgress !== 'undefined') {
      warpProgress += (1 - warpProgress) * 0.05;
    }
  }

  if (typeof warpProgress === 'undefined' || warpProgress <= 0) return;

  // Calculate direction
  let dirX = 1; let dirY = 0;
  if (typeof autopilotTarget !== 'undefined' && autopilotTarget) {
    const dx = autopilotTarget.x - player.x;
    const dy = autopilotTarget.y - player.y;
    const len = Math.sqrt(dx*dx + dy*dy);
    if (len > 0) {
      dirX = dx / len;
      dirY = dy / len;
    }
  }

  // Initialize particles once
  if (slipstreamParticles.length === 0) {
    for (let i = 0; i < 200; i++) {
      slipstreamParticles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.width,
        length: Math.random() * 150 + 50,
        speed: Math.random() * 30 + 20,
        color: ['#ffffff', '#8ab4f8', '#00f0ff'][Math.floor(Math.random() * 3)]
      });
    }
  }

  ctx.globalCompositeOperation = 'screen';

  // Render 2D streaks
  for (let i = 0; i < slipstreamParticles.length; i++) {
    const p = slipstreamParticles[i];
    
    const moveAmount = p.speed * warpProgress * 3;
    p.x -= dirX * moveAmount;
    p.y -= dirY * moveAmount;

    // Wrap around screen
    if (dirX > 0 && p.x < -p.length) p.x = canvas.width + p.length;
    if (dirX < 0 && p.x > canvas.width + p.length) p.x = -p.length;
    if (dirY > 0 && p.y < -p.length) p.y = canvas.height + p.length;
    if (dirY < 0 && p.y > canvas.height + p.length) p.y = -p.length;

    // To prevent getting stuck if direction changes
    if (p.x < -p.length || p.x > canvas.width + p.length || p.y < -p.length || p.y > canvas.height + p.length) {
      p.x = Math.random() * canvas.width;
      p.y = Math.random() * canvas.height;
    }

    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + dirX * p.length * warpProgress, p.y + dirY * p.length * warpProgress);
    ctx.strokeStyle = p.color;
    ctx.globalAlpha = warpProgress * 0.8;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// ── Shooting stars ────────────────────────────────────
let shootingStars = [];
let lastShootingStar = 0;

function updateShootingStars() {
  const now = Date.now();
  if (now - lastShootingStar > 4000 + Math.random() * 6000) {
    lastShootingStar = now;
    shootingStars.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height * 0.4,
      vx: 8 + Math.random() * 6,
      vy: 3 + Math.random() * 4,
      life: 1.0,
      len: 40 + Math.random() * 60
    });
  }

  ctx.lineCap = 'round';
  for (let i = shootingStars.length - 1; i >= 0; i--) {
    const ss = shootingStars[i];
    ss.x += ss.vx;
    ss.y += ss.vy;
    ss.life -= 0.02;
    if (ss.life <= 0) { shootingStars.splice(i, 1); continue; }

    const grad = ctx.createLinearGradient(
      ss.x, ss.y,
      ss.x - ss.vx * ss.len / 10, ss.y - ss.vy * ss.len / 10
    );
    grad.addColorStop(0, `rgba(255,255,255,${ss.life})`);
    grad.addColorStop(1, `rgba(255,255,255,0)`);

    ctx.strokeStyle = grad;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ss.x, ss.y);
    ctx.lineTo(ss.x - ss.vx * ss.len / 10, ss.y - ss.vy * ss.len / 10);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

// ── Draw island ───────────────────────────────────────
function drawIsland(island) {
  const { cx, cy, color, islandRadius, login, isActive, buildings, repoCount } = island;
  const scx = canvas.width / 2;
  const scy = canvas.height / 2;
  const sx = scx + (cx - camera.x) * camera.zoom;
  const sy = scy + (cy - camera.y) * camera.zoom;
  const sr = islandRadius * camera.zoom;

  if (sx < -sr - 200 || sx > canvas.width + sr + 200) return;
  if (sy < -sr - 200 || sy > canvas.height + sr + 200) return;

  // Activity heatmap ring (Feature 9)
  if (camera.zoom > 0.15 && buildings.length > 0) {
    drawHeatmapRing(island, sx, sy, sr);
  }

  // Atmospheric glow for active users
  if (isActive) {
    const pulsePhase = Math.sin(Date.now() * 0.002) * 0.03 + 0.07;
    const glowGrad = ctx.createRadialGradient(sx, sy, sr * 0.5, sx, sy, sr * 1.8);
    glowGrad.addColorStop(0, color + '00');
    glowGrad.addColorStop(0.5, hexToRgba(color, pulsePhase));
    glowGrad.addColorStop(1, color + '00');
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(sx, sy, sr * 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  // Water shimmer border
  if (camera.zoom > 0.15) {
    const waterPhase = Date.now() * 0.003;
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#0ea5e9';
    ctx.beginPath();
    for (let a = 0; a < Math.PI * 2; a += 0.05) {
      const wobble = Math.sin(a * 6 + waterPhase) * 3 * camera.zoom;
      const r = sr * 1.08 + wobble;
      const px = sx + Math.cos(a) * r;
      const py = sy + Math.sin(a) * r;
      if (a === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#0ea5e9';
    ctx.beginPath();
    ctx.arc(sx, sy, sr * 1.08, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Ground — concentric terrain rings
  const terrainRings = [
    { ratio: 1.0, color: '#0a0a14', alpha: 1.0 },
    { ratio: 0.85, color: '#0d1220', alpha: 0.8 },
    { ratio: 0.65, color: '#101828', alpha: 0.6 },
  ];
  for (const ring of terrainRings) {
    ctx.fillStyle = ring.color;
    ctx.globalAlpha = ring.alpha;
    ctx.beginPath();
    ctx.arc(sx, sy, sr * ring.ratio, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Color overlay on ground
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.2;
  ctx.beginPath();
  ctx.arc(sx, sy, sr, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Border
  ctx.strokeStyle = color + '55';
  ctx.lineWidth = 2 * camera.zoom;
  ctx.stroke();

  // Road lines from center to buildings
  if (camera.zoom > 0.3 && buildings.length > 0) {
    ctx.strokeStyle = '#1a2a1a';
    ctx.lineWidth = 1.5 * camera.zoom;
    ctx.globalAlpha = 0.3;
    ctx.setLineDash([4 * camera.zoom, 4 * camera.zoom]);
    ctx.beginPath();
    for (const b of buildings) {
      const bsx = scx + (b.x - camera.x) * camera.zoom;
      const bsy = scy + (b.y - camera.y) * camera.zoom;
      ctx.moveTo(sx, sy);
      ctx.lineTo(bsx, bsy);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // Floating debris particles around island
  if (camera.zoom > 0.3) {
    const debrisCount = Math.min(8, Math.floor(repoCount / 3));
    const t = Date.now() * 0.001;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.3;
    for (let i = 0; i < debrisCount; i++) {
      const angle = (i / debrisCount) * Math.PI * 2 + t * 0.3;
      const dist = sr * 1.2 + Math.sin(t + i * 2) * sr * 0.15;
      const dx = sx + Math.cos(angle) * dist;
      const dy = sy + Math.sin(angle) * dist;
      ctx.beginPath();
      ctx.arc(dx, dy, 2 * camera.zoom, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Draw buildings
  for (const b of buildings) {
    drawBuilding(b, scx, scy);
  }

  // Nameplate, avatar, badges
  if (camera.zoom > 0.1) {
    const nameplateY = sy - sr - (20 * camera.zoom);

    // Avatar
    if (island.avatarImg && island.avatarImg.complete && island.avatarImg.naturalWidth > 0) {
      const avatarSize = 40 * camera.zoom;
      ctx.save();
      ctx.beginPath();
      ctx.arc(sx, nameplateY - avatarSize / 2 - (5 * camera.zoom), avatarSize / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(island.avatarImg, sx - avatarSize / 2, nameplateY - avatarSize - (5 * camera.zoom), avatarSize, avatarSize);
      ctx.restore();

      // Avatar border with glow
      ctx.beginPath();
      ctx.arc(sx, nameplateY - avatarSize / 2 - (5 * camera.zoom), avatarSize / 2, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 * camera.zoom;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8 * camera.zoom;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Nameplate background
    ctx.font = `bold ${Math.max(8, 12 * camera.zoom)}px 'Space Mono', monospace`;
    ctx.fillStyle = 'rgba(5, 5, 15, 0.85)';
    const textWidth = ctx.measureText(login).width + 30 * camera.zoom;
    const npHeight = 22 * camera.zoom;
    const npX = sx - textWidth / 2;
    const npY = nameplateY;

    // Rounded nameplate
    const npRadius = 4 * camera.zoom;
    ctx.beginPath();
    ctx.moveTo(npX + npRadius, npY);
    ctx.lineTo(npX + textWidth - npRadius, npY);
    ctx.quadraticCurveTo(npX + textWidth, npY, npX + textWidth, npY + npRadius);
    ctx.lineTo(npX + textWidth, npY + npHeight - npRadius);
    ctx.quadraticCurveTo(npX + textWidth, npY + npHeight, npX + textWidth - npRadius, npY + npHeight);
    ctx.lineTo(npX + npRadius, npY + npHeight);
    ctx.quadraticCurveTo(npX, npY + npHeight, npX, npY + npHeight - npRadius);
    ctx.lineTo(npX, npY + npRadius);
    ctx.quadraticCurveTo(npX, npY, npX + npRadius, npY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1 * camera.zoom;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(login, sx, nameplateY + 15 * camera.zoom);

    // Repo count
    if (camera.zoom > 0.2) {
      ctx.fillStyle = color;
      ctx.font = `bold ${Math.max(8, 10 * camera.zoom)}px 'Space Mono', monospace`;
      ctx.fillText(repoCount + ' Repos', sx, nameplateY + 34 * camera.zoom);
    }

    // Badges (Feature 8)
    if (camera.zoom > 0.35 && island.badges && island.badges.length > 0) {
      drawBadges(island.badges, sx, nameplateY + 46 * camera.zoom, camera.zoom);
    }
  }
}

// ── Activity Heatmap Ring (Feature 9) ─────────────────
function drawHeatmapRing(island, sx, sy, sr) {
  const buildings = island.buildings;
  if (buildings.length === 0) return;

  const ringInner = sr * 1.02;
  const ringOuter = sr * 1.06;
  const segAngle = (Math.PI * 2) / buildings.length;

  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    // Use updatedAt if available, else use stars as proxy for freshness
    let freshness = 0.3;
    if (b.updatedAt) {
      const age = Date.now() - new Date(b.updatedAt).getTime();
      const dayAge = age / (1000 * 60 * 60 * 24);
      freshness = Math.max(0.1, Math.min(1.0, 1.0 - dayAge / 365));
    } else if (b.stars > 0) {
      freshness = Math.min(1.0, 0.3 + b.stars / 50);
    }

    const startAngle = i * segAngle - Math.PI / 2;
    const endAngle = startAngle + segAngle - 0.02;

    ctx.beginPath();
    ctx.arc(sx, sy, ringOuter, startAngle, endAngle);
    ctx.arc(sx, sy, ringInner, endAngle, startAngle, true);
    ctx.closePath();

    const hue = freshness > 0.5 ? 160 : 30;
    const sat = 70;
    const lit = 30 + freshness * 40;
    ctx.fillStyle = `hsla(${hue},${sat}%,${lit}%,${0.3 + freshness * 0.5})`;
    ctx.fill();
  }
}

// ── Badge Renderer (Feature 8) ────────────────────────
function drawBadges(badges, x, y, zoom) {
  const badgeSize = 14 * zoom;
  const gap = 4 * zoom;
  const totalWidth = badges.length * (badgeSize + gap) - gap;
  let bx = x - totalWidth / 2;

  ctx.font = `${Math.max(6, 10 * zoom)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const badge of badges) {
    // Badge circle background
    ctx.fillStyle = badge.bgColor || 'rgba(20,20,40,0.8)';
    ctx.beginPath();
    ctx.arc(bx + badgeSize / 2, y, badgeSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = badge.borderColor || '#4a4a6a';
    ctx.lineWidth = 1 * zoom;
    ctx.stroke();

    // Badge emoji
    ctx.fillStyle = '#ffffff';
    ctx.fillText(badge.icon, bx + badgeSize / 2, y + 1 * zoom);

    bx += badgeSize + gap;
  }
  ctx.textBaseline = 'alphabetic';
}

// ── Draw building (Enhanced - Feature 3) ──────────────
function drawBuilding(b, scx, scy) {
  const bsx = scx + (b.x - camera.x) * camera.zoom;
  const bsy = scy + (b.y - camera.y) * camera.zoom;
  if (bsx < -100 || bsx > canvas.width + 100) return;
  if (bsy < -100 || bsy > canvas.height + 100) return;

  const bw = b.width * camera.zoom;
  const bh = b.height * camera.zoom;
  const isNear = nearbyRepo && nearbyRepo.name === b.name && nearbyRepo.url === b.url;

  const color = b.isFork ? '#64748b' : b.color;
  
  // Extreme low-zoom culling (travel/warp mode optimization)
  if (camera.zoom < 0.05) {
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.6;
    ctx.fillRect(bsx - Math.max(1, bw/2), bsy - Math.max(2, bh), Math.max(2, bw), Math.max(2, bh));
    ctx.globalAlpha = 1;
    return;
  }

  const depth = bw * 0.6;

  // High-star golden aura
  if (b.stars > 100 && !b.isFork && camera.zoom > 0.2) {
    const pulseAlpha = 0.15 + Math.sin(Date.now() * 0.003 + b.seed * 10) * 0.08;
    const auraGrad = ctx.createRadialGradient(bsx, bsy - bh / 2, bw * 0.3, bsx, bsy - bh / 2, bw * 2);
    auraGrad.addColorStop(0, `rgba(251,191,36,${pulseAlpha})`);
    auraGrad.addColorStop(1, 'rgba(251,191,36,0)');
    ctx.fillStyle = auraGrad;
    ctx.fillRect(bsx - bw * 2, bsy - bh - bw * 2, bw * 4, bh + bw * 4);
  }

  // Ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.moveTo(bsx - bw / 2, bsy);
  ctx.lineTo(bsx - bw / 2 + depth, bsy + depth * 0.5);
  ctx.lineTo(bsx + bw / 2 + depth, bsy + depth * 0.5);
  ctx.lineTo(bsx + bw / 2, bsy);
  ctx.fill();

  // Right face — darker shade
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.moveTo(bsx + bw / 2, bsy);
  ctx.lineTo(bsx + bw / 2 + depth, bsy - depth * 0.5);
  ctx.lineTo(bsx + bw / 2 + depth, bsy - bh - depth * 0.5);
  ctx.lineTo(bsx + bw / 2, bsy - bh);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Front face — gradient
  if (bh > 5 && bw > 3) {
    const faceGrad = ctx.createLinearGradient(bsx, bsy, bsx, bsy - bh);
    const darkerColor = darkenHex(color, 0.3);
    faceGrad.addColorStop(0, darkerColor);
    faceGrad.addColorStop(0.5, color);
    faceGrad.addColorStop(1, color);
    ctx.fillStyle = faceGrad;
  } else {
    ctx.fillStyle = color;
  }
  ctx.globalAlpha = 0.85;
  ctx.fillRect(bsx - bw / 2, bsy - bh, bw, bh);
  ctx.globalAlpha = 1;

  // Roof
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(bsx - bw / 2, bsy - bh);
  ctx.lineTo(bsx - bw / 2 + depth, bsy - bh - depth * 0.5);
  ctx.lineTo(bsx + bw / 2 + depth, bsy - bh - depth * 0.5);
  ctx.lineTo(bsx + bw / 2, bsy - bh);
  ctx.fill();

  // Tier-specific details
  if (b.tier === 'skyscraper' && camera.zoom > 0.3) {
    // Antenna with blinking light
    const antennaX = bsx;
    const antennaBottom = bsy - bh;
    const antennaTop = antennaBottom - 15 * camera.zoom;
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 1 * camera.zoom;
    ctx.beginPath();
    ctx.moveTo(antennaX, antennaBottom);
    ctx.lineTo(antennaX, antennaTop);
    ctx.stroke();

    // Blinking red light
    const blink = Math.sin(Date.now() * 0.005 + b.seed * 100) > 0;
    if (blink) {
      ctx.fillStyle = '#ff3333';
      ctx.shadowColor = '#ff3333';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(antennaX, antennaTop, 2 * camera.zoom, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  if (b.tier === 'tower' && camera.zoom > 0.3) {
    // Neon accent stripe
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 4;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(bsx - bw / 2, bsy - bh * 0.6, bw, 2 * camera.zoom);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  // Windows — warm amber for houses, cool white for towers/skyscrapers
  if (bw > 6 && bh > 10 && !b.isFork) {
    const windowColor = (b.tier === 'house' || b.tier === 'hut')
      ? 'rgba(255,200,100,0.8)'
      : 'rgba(200,220,255,0.7)';
    ctx.fillStyle = windowColor;
    const rows = Math.floor(bh / (7 * camera.zoom));
    const cols = Math.floor(bw / (6 * camera.zoom));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const windowSeed = Math.sin(b.seed + r * 10 + c);
        if (windowSeed > 0) {
          ctx.fillRect(
            bsx - bw / 2 + 2 * camera.zoom + c * (6 * camera.zoom),
            bsy - bh + 4 * camera.zoom + r * (7 * camera.zoom),
            2 * camera.zoom, 3 * camera.zoom
          );
        }
      }
    }
  }

  // Hut doorway
  if (b.tier === 'hut' && camera.zoom > 0.5) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    const doorW = 3 * camera.zoom;
    const doorH = 5 * camera.zoom;
    ctx.fillRect(bsx - doorW / 2, bsy - doorH, doorW, doorH);
  }

  // Fork dashed outline
  if (b.isFork && camera.zoom > 0.4) {
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.setLineDash([3 * camera.zoom, 3 * camera.zoom]);
    ctx.strokeRect(bsx - bw / 2, bsy - bh, bw, bh);
    ctx.setLineDash([]);
  }

  // Hover highlight
  if (isNear) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bsx - bw / 2, bsy);
    ctx.lineTo(bsx + bw / 2, bsy);
    ctx.lineTo(bsx + bw / 2, bsy - bh);
    ctx.lineTo(bsx - bw / 2, bsy - bh);
    ctx.closePath();
    ctx.stroke();

    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // Building name label
  if ((camera.zoom > 0.4 && bw > 4) || isNear) {
    ctx.font = `${Math.max(7, 8 * camera.zoom)}px 'Space Mono', monospace`;
    ctx.textAlign = 'center';
    
    let label = b.name;
    if (label.length > 16 && !isNear) {
      label = label.slice(0, 14) + '…';
    }
    const finalLabel = label + (b.isFork ? ' ⑂' : '');
    
    const textWidth = ctx.measureText(finalLabel).width;
    const fontSize = Math.max(7, 8 * camera.zoom);
    const labelX = bsx + depth / 2;
    const labelY = bsy - bh - depth / 2 - 10;
    
    const padding = 2 * camera.zoom;
    const box = {
      x: labelX - textWidth / 2 - padding,
      y: labelY - fontSize - padding,
      w: textWidth + padding * 2,
      h: fontSize + padding * 2
    };

    let hasCollision = false;
    if (!isNear && window.drawnLabels) {
      for (let i = 0; i < window.drawnLabels.length; i++) {
        const other = window.drawnLabels[i];
        if (box.x < other.x + other.w &&
            box.x + box.w > other.x &&
            box.y < other.y + other.h &&
            box.y + box.h > other.y) {
          hasCollision = true;
          break;
        }
      }
    }

    if (!hasCollision || isNear) {
      ctx.fillStyle = '#e8e8f0';
      ctx.fillText(finalLabel, labelX, labelY);
      if (!window.drawnLabels) window.drawnLabels = [];
      window.drawnLabels.push(box);
    }
  }
}

// ── Draw player (Feature 4 — enhanced ship) ──────────
let idleTime = 0;
let lastMovingState = false;

function drawPlayer() {
  const sx = canvas.width / 2 + (player.x - camera.x) * camera.zoom;
  const sy = canvas.height / 2 + (player.y - camera.y) * camera.zoom;
  const isMoving = Object.values(keys).some(v => v) || !!autopilotTarget;

  if (isMoving) { idleTime = 0; lastMovingState = true; }
  else { idleTime++; lastMovingState = false; }

  // Trails with color variation
  ctx.globalCompositeOperation = 'screen';
  for (let i = trails.length - 1; i >= 0; i--) {
    const t = trails[i];
    t.life -= 0.04;
    t.x += t.vx;
    t.y += t.vy;
    if (t.life <= 0) { trails.splice(i, 1); continue; }

    const tsx = canvas.width / 2 + (t.x - camera.x) * camera.zoom;
    const tsy = canvas.height / 2 + (t.y - camera.y) * camera.zoom;

    // Gradient trail: cyan → purple
    const hue = 185 + (1 - t.life) * 60;
    ctx.fillStyle = `hsla(${hue}, 80%, 60%, ${t.life * 0.8})`;
    ctx.beginPath();
    ctx.arc(tsx, tsy, (3 + t.life * 3) * camera.zoom, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(playerAngle);

  // Dynamic engine flame (scales with speed)
  const flameLength = 8 + player.speed * 0.8;
  const flameFlicker = Math.sin(Date.now() * 0.02) * 3;
  if (isMoving) {
    ctx.fillStyle = '#06b6d4';
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(-10, 5);
    ctx.lineTo(-(flameLength + flameFlicker), 0);
    ctx.lineTo(-10, -5);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // Inner flame
    ctx.fillStyle = '#67e8f9';
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(-10, 3);
    ctx.lineTo(-(flameLength * 0.6 + flameFlicker * 0.5), 0);
    ctx.lineTo(-10, -3);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Engine glow
  ctx.fillStyle = '#06b6d4';
  ctx.shadowColor = '#06b6d4';
  ctx.shadowBlur = isMoving ? 15 : 8;
  ctx.beginPath();
  ctx.arc(-10, 0, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Hull
  ctx.fillStyle = '#e2e8f0';
  ctx.beginPath();
  ctx.moveTo(18, 0);
  ctx.lineTo(-4, 12);
  ctx.lineTo(-10, 8);
  ctx.lineTo(-6, 0);
  ctx.lineTo(-10, -8);
  ctx.lineTo(-4, -12);
  ctx.closePath();
  ctx.fill();

  // Hull accent stripe
  ctx.strokeStyle = '#06b6d4';
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.moveTo(14, 0);
  ctx.lineTo(-2, 9);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(14, 0);
  ctx.lineTo(-2, -9);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Cockpit
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.ellipse(2, 0, 6, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  // Cockpit reflection
  ctx.fillStyle = 'rgba(6,182,212,0.3)';
  ctx.beginPath();
  ctx.ellipse(4, -1, 3, 1.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Wing-tip particles
  if (isMoving && camera.zoom > 0.3) {
    const sparkAlpha = 0.3 + Math.random() * 0.4;
    ctx.fillStyle = `rgba(6,182,212,${sparkAlpha})`;
    ctx.beginPath();
    ctx.arc(-5, 10 + Math.random() * 3, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-5, -10 - Math.random() * 3, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  // Shield ring when idle > 3 seconds (180 frames at 60fps)
  if (idleTime > 180 && !autopilotTarget) {
    const shieldAlpha = Math.min(0.3, (idleTime - 180) / 300);
    const shieldPulse = Math.sin(Date.now() * 0.003) * 2;
    ctx.strokeStyle = `rgba(6,182,212,${shieldAlpha})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(sx, sy, 25 + shieldPulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// ── Warp drive overlay (Feature 5) ────────────────────
function drawWarpOverlay() {
  if (!warpActive) return;

  // Radial blue vignette
  const grad = ctx.createRadialGradient(
    canvas.width / 2, canvas.height / 2, canvas.width * 0.2,
    canvas.width / 2, canvas.height / 2, canvas.width * 0.6
  );
  grad.addColorStop(0, 'rgba(6,30,80,0)');
  grad.addColorStop(1, 'rgba(6,30,80,0.3)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Speed lines from center
  ctx.strokeStyle = 'rgba(100,180,255,0.15)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 30; i++) {
    const angle = (i / 30) * Math.PI * 2 + Date.now() * 0.001;
    const inner = canvas.width * 0.05;
    const outer = canvas.width * 0.5;
    ctx.beginPath();
    ctx.moveTo(
      canvas.width / 2 + Math.cos(angle) * inner,
      canvas.height / 2 + Math.sin(angle) * inner
    );
    ctx.lineTo(
      canvas.width / 2 + Math.cos(angle) * outer,
      canvas.height / 2 + Math.sin(angle) * outer
    );
    ctx.stroke();
  }
}

// ── Minimap & Compass ─────────────────────────────────
function drawMinimap() {
  const mmSize = isMobile() ? 90 : 150;
  const mmPadding = isMobile() ? 8 : 20;
  const mmx = canvas.width - mmSize - mmPadding;
  const mmy = isMobile() ? 8 : canvas.height - mmSize - mmPadding;

  // Background with rounded corners
  ctx.fillStyle = 'rgba(10, 10, 25, 0.85)';
  ctx.strokeStyle = '#2a2a4a';
  ctx.lineWidth = 1;
  const mmR = 8;
  ctx.beginPath();
  ctx.moveTo(mmx + mmR, mmy);
  ctx.lineTo(mmx + mmSize - mmR, mmy);
  ctx.quadraticCurveTo(mmx + mmSize, mmy, mmx + mmSize, mmy + mmR);
  ctx.lineTo(mmx + mmSize, mmy + mmSize - mmR);
  ctx.quadraticCurveTo(mmx + mmSize, mmy + mmSize, mmx + mmSize - mmR, mmy + mmSize);
  ctx.lineTo(mmx + mmR, mmy + mmSize);
  ctx.quadraticCurveTo(mmx, mmy + mmSize, mmx, mmy + mmSize - mmR);
  ctx.lineTo(mmx, mmy + mmR);
  ctx.quadraticCurveTo(mmx, mmy, mmx + mmR, mmy);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Title
  ctx.fillStyle = '#4a4a6a';
  ctx.font = '8px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('MAP', mmx + 6, mmy + 12);

  const mapScale = mmSize / (CHUNK_SIZE * 3);

  // Draw islands on minimap with glow
  for (const island of islands) {
    const mx = mmx + mmSize / 2 + (island.cx - player.x) * mapScale;
    const my = mmy + mmSize / 2 + (island.cy - player.y) * mapScale;
    if (mx > mmx && mx < mmx + mmSize && my > mmy && my < mmy + mmSize) {
      ctx.fillStyle = island.color;
      ctx.globalAlpha = 0.7;
      const size = Math.max(2, island.islandRadius * mapScale * 2);
      ctx.beginPath();
      ctx.arc(mx, my, Math.max(1.5, size / 2), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // Player dot with pulsing ring
  const pdx = mmx + mmSize / 2;
  const pdy = mmy + mmSize / 2;
  ctx.fillStyle = '#06b6d4';
  ctx.beginPath();
  ctx.arc(pdx, pdy, 3, 0, Math.PI * 2);
  ctx.fill();

  // Pulsing ring
  const pulseRadius = 5 + Math.sin(Date.now() * 0.004) * 2;
  ctx.strokeStyle = 'rgba(6,182,212,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(pdx, pdy, pulseRadius, 0, Math.PI * 2);
  ctx.stroke();
}

function drawCompass() {
  if (warpActive) return; // Hide during warp

  let closestIsland = null;
  let closestDist = Infinity;
  for (const island of islands) {
    const dx = island.cx - player.x;
    const dy = island.cy - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < closestDist && dist > island.islandRadius * 2) {
      closestDist = dist;
      closestIsland = island;
    }
  }

  if (closestIsland && closestDist < 8000) {
    const sx = canvas.width / 2 + (player.x - camera.x) * camera.zoom;
    const sy = canvas.height / 2 + (player.y - camera.y) * camera.zoom;

    const dx = closestIsland.cx - player.x;
    const dy = closestIsland.cy - player.y;
    const angle = Math.atan2(dy, dx);
    const radius = isMobile() ? 55 : 80;

    const px = sx + Math.cos(angle) * radius;
    const py = sy + Math.sin(angle) * radius;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.fillStyle = closestIsland.color;
    ctx.shadowColor = closestIsland.color;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-5, 5);
    ctx.lineTo(-5, -5);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();

    // Name label with distance
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    const distLabel = closestDist < 1000 ? Math.round(closestDist) + 'u' : (closestDist / 1000).toFixed(1) + 'ku';
    ctx.fillText(closestIsland.login + ' · ' + distLabel, px + Math.cos(angle) * 25, py + Math.sin(angle) * 25);
  }
}

// ── FPS Counter (Feature 14, dev mode) ────────────────
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

// ── Check proximity to repos ──────────────────────────
function checkProximity() {
  nearbyRepo = null;
  let clickedRepo = null;
  let clickedIsland = null;

  outer:
  for (const island of islands) {
    const isx = canvas.width / 2 + (island.cx - camera.x) * camera.zoom;
    const isy = canvas.height / 2 + (island.cy - camera.y) * camera.zoom;

    const sortedBuildingsForHit = [...island.buildings].sort((a, b) => b.y - a.y);
    for (const b of sortedBuildingsForHit) {
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
    document.getElementById('tt-lang').textContent = nearbyRepo.language + (nearbyRepo.isFork ? ' · Fork' : '');
    document.getElementById('tt-stars').textContent = '⭐ ' + (nearbyRepo.stars || 0).toLocaleString();

    tt.style.left = (lastMouse.x + 15) + 'px';
    tt.style.top = (lastMouse.y + 15) + 'px';
    tt.style.display = 'block';
  } else {
    tt.style.display = 'none';
  }
}

// ── Utility ───────────────────────────────────────────
function hexToRgba(hex, alpha) {
  const cleaned = hex.replace('#', '');
  const r = parseInt(cleaned.substring(0, 2), 16) || 0;
  const g = parseInt(cleaned.substring(2, 4), 16) || 0;
  const b = parseInt(cleaned.substring(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${alpha})`;
}

function darkenHex(hex, factor) {
  const cleaned = hex.replace('#', '');
  const r = Math.floor((parseInt(cleaned.substring(0, 2), 16) || 0) * (1 - factor));
  const g = Math.floor((parseInt(cleaned.substring(2, 4), 16) || 0) * (1 - factor));
  const b = Math.floor((parseInt(cleaned.substring(4, 6), 16) || 0) * (1 - factor));
  return `rgb(${r},${g},${b})`;
}
