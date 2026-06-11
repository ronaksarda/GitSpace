// ── Input handling ────────────────────────────────────
window.addEventListener('resize', () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});

window.addEventListener('keydown', e => {
  if (['INPUT', 'TEXTAREA'].includes(e.target.tagName) && e.target.type !== 'range') return;

  const key = e.key.toLowerCase();
  keys[key] = true;

  // Shortcuts overlay (Feature 10) — toggle with ? or h
  if (key === '?' || key === '/' || (key === 'h' && !e.ctrlKey)) {
    toggleShortcutsOverlay();
    return;
  }

  // Screenshot (Feature 11) — press P
  if (key === 'p') {
    captureScreenshot();
    return;
  }

  // FPS toggle (Feature 14) — press F
  if (key === 'f') {
    fpsVisible = !fpsVisible;
    return;
  }

  // Close any open shortcuts overlay on movement keys
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
    hideShortcutsOverlay();
  }

  // Escape to close modals/overlays
  if (key === 'escape') {
    document.getElementById('repo-modal')?.classList.add('hidden');
    document.getElementById('profile-modal')?.classList.add('hidden');
    document.getElementById('citizens-sidebar')?.classList.add('hidden');
    document.getElementById('achievements-sidebar')?.classList.add('hidden');
    hideShortcutsOverlay();
  }
});

window.addEventListener('keyup', e => {
  keys[e.key.toLowerCase()] = false;
});

// Prevent infinite travel if window loses focus while a key is held down
window.addEventListener('blur', () => {
  keys = {};
});

// Zoom with scroll wheel
window.addEventListener('wheel', e => {
  e.preventDefault();
  const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
  camera.zoom = Math.max(0.1, Math.min(2.5, camera.zoom * zoomDelta));
}, { passive: false });

// Click to Pan/Select
canvas.addEventListener('mousedown', e => {
  if (e.button === 0) {
    autopilotTarget = null;
  }
});

// Direct hit-test at click time
function findBuildingAtPoint(mx, my) {
  for (const island of islands) {
    // Buildings are already sorted ascending by Y. Iterate backwards for correct top-down clicking.
    for (let i = island.buildings.length - 1; i >= 0; i--) {
      const b = island.buildings[i];
      const bsx = canvas.width / 2 + (b.x - camera.x) * camera.zoom;
      const bsy = canvas.height / 2 + (b.y - camera.y) * camera.zoom;
      const bw = b.width * camera.zoom;
      const bh = b.height * camera.zoom;
      const depth = bw * 0.6;
      const pad = 4;

      const hitLeft = bsx - bw / 2 - pad;
      const hitRight = bsx + bw / 2 + depth + pad;
      const hitTop = bsy - bh - depth * 0.5 - pad;
      const hitBottom = bsy + depth * 0.5 + pad;

      if (mx >= hitLeft && mx <= hitRight && my >= hitTop && my <= hitBottom) {
        return { building: b, island: island };
      }
    }
  }
  return null;
}

function findIslandAtPoint(mx, my) {
  for (const island of islands) {
    const isx = canvas.width / 2 + (island.cx - camera.x) * camera.zoom;
    const isy = canvas.height / 2 + (island.cy - camera.y) * camera.zoom;
    const dx = mx - isx;
    const dy = my - isy;
    // Generous hit radius for the center icon/base
    if (Math.sqrt(dx * dx + dy * dy) < (40 * camera.zoom + 15)) {
      return island;
    }
  }
  return null;
}

canvas.addEventListener('mouseup', e => {
  if (e.button === 0) {
    const mx = e.clientX;
    const my = e.clientY;

    const hit = findBuildingAtPoint(mx, my);
    if (hit && hit.building) {
      const b = hit.building;

      document.getElementById('rm-name').textContent = b.name;
      document.getElementById('rm-lang').textContent = b.language + (b.isFork ? ' (Fork)' : '');
      document.getElementById('rm-stars').textContent = '⭐ ' + (b.stars || 0).toLocaleString();

      // Rich modal fields (Feature 6)
      const rmDesc = document.getElementById('rm-description');
      if (rmDesc) rmDesc.textContent = b.description || 'No description provided.';

      const rmSize = document.getElementById('rm-size');
      if (rmSize) rmSize.textContent = formatSize(b.size);

      const rmUpdated = document.getElementById('rm-updated');
      if (rmUpdated) rmUpdated.textContent = b.updatedAt ? timeAgo(b.updatedAt) : 'Unknown';

      // Size bar
      const rmSizeBar = document.getElementById('rm-size-fill');
      if (rmSizeBar) {
        const maxSize = 100000;
        const pct = Math.min(100, (b.size / maxSize) * 100);
        rmSizeBar.style.width = pct + '%';
      }

      // Language color accent
      const rmAccent = document.getElementById('rm-lang-accent');
      if (rmAccent) rmAccent.style.backgroundColor = langColor(b.language);

      document.getElementById('rm-btn').onclick = () => {
        if (b.url) window.open(b.url, '_blank');
      };
      document.getElementById('repo-modal').classList.remove('hidden');

      // Achievement triggers
      if (window.unlockAchievement) {
        if (!window.inspectedRepos) window.inspectedRepos = new Set();
        window.inspectedRepos.add(b.name);
        if (window.inspectedRepos.size >= 10) window.unlockAchievement('architect');

        if (b.stars >= 1000) window.unlockAchievement('stargazer');
        if (b.size >= 100000) window.unlockAchievement('collector');

        if (['C', 'C++', 'Rust'].includes(b.language)) window.unlockAchievement('sys_architect');
        if (['Python'].includes(b.language)) window.unlockAchievement('ai_pioneer');
        if (['JavaScript', 'TypeScript', 'HTML'].includes(b.language)) window.unlockAchievement('frontend_master');
      }
      return;
    }

    const island = findIslandAtPoint(mx, my);
    if (island) {
      showProfileModal(island);
    }
  }
});

window.addEventListener('mousemove', e => {
  lastMouse.x = e.clientX;
  lastMouse.y = e.clientY;
});

// ── Shortcuts Overlay (Feature 10) ────────────────────
let shortcutsVisible = false;
let shortcutsAutoHide = null;

function toggleShortcutsOverlay() {
  const overlay = document.getElementById('shortcuts-overlay');
  if (!overlay) return;
  shortcutsVisible = !shortcutsVisible;
  if (shortcutsVisible) {
    overlay.classList.remove('hidden');
    overlay.classList.add('visible');
    clearTimeout(shortcutsAutoHide);
    shortcutsAutoHide = setTimeout(hideShortcutsOverlay, 6000);
  } else {
    hideShortcutsOverlay();
  }
}

function hideShortcutsOverlay() {
  const overlay = document.getElementById('shortcuts-overlay');
  if (!overlay) return;
  shortcutsVisible = false;
  overlay.classList.remove('visible');
  overlay.classList.add('hidden');
  clearTimeout(shortcutsAutoHide);
}

// ── Screenshot (Feature 11) ──────────────────────────
function captureScreenshot() {
  try {
    // Create a temporary canvas for watermark
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(canvas, 0, 0);

    // Watermark
    tempCtx.fillStyle = 'rgba(255,255,255,0.15)';
    tempCtx.font = 'bold 14px monospace';
    tempCtx.textAlign = 'right';
    tempCtx.fillText('GitSpace', canvas.width - 20, canvas.height - 20);

    const link = document.createElement('a');
    link.download = `gitspace_${Date.now()}.png`;
    link.href = tempCanvas.toDataURL('image/png');
    link.click();
    showToast('📸 Screenshot saved!');
  } catch (err) {
    showToast('Screenshot failed — try again');
  }
}

// ── Profile Modal Helper (Feature 7) ─────────────────
function showProfileModal(island) {
  document.getElementById('pm-avatar').src = island.avatar || 'https://github.com/identicons/' + island.login + '.png';
  document.getElementById('pm-name').textContent = island.login;
  document.getElementById('pm-repos').textContent = island.repoCount + ' Repositories';
  document.getElementById('pm-stars').textContent = '⭐ ' + (island.totalStars || 0).toLocaleString();

  // Top repos list (Feature 7)
  const topReposEl = document.getElementById('pm-top-repos');
  if (topReposEl) {
    const sorted = [...island.buildings].sort((a, b) => b.stars - a.stars).slice(0, 5);
    if (sorted.length === 0) {
      topReposEl.innerHTML = '<div class="pm-repo-item" style="color: #666; font-style: italic; justify-content: center;">No repositories to display</div>';
    } else {
      topReposEl.innerHTML = sorted.map(r =>
        `<div class="pm-repo-item">
          <span class="pm-repo-dot" style="background:${langColor(r.language)}"></span>
          <span class="pm-repo-name">${escapeHTML(r.name)}</span>
          <span class="pm-repo-stars">⭐ ${r.stars}</span>
        </div>`
      ).join('');
    }
  }

  // Language pie chart (Feature 7)
  drawLanguagePie(island.buildings);

  // Share button
  const shareBtn = document.getElementById('pm-btn-share');
  if (shareBtn) {
    shareBtn.onclick = () => {
      const url = window.location.origin + '/?fly=' + encodeURIComponent(island.login);
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(url).then(() => {
          if (window.showToast) window.showToast('🔗 Profile link copied!');
        }).catch(() => {
          if (window.showToast) window.showToast('Copy failed');
        });
      } else {
        // Fallback for non-HTTPS environments like localhost
        const textArea = document.createElement("textarea");
        textArea.value = url;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          document.execCommand('copy');
          if (window.showToast) window.showToast('🔗 Profile link copied!');
        } catch (err) {
          if (window.showToast) window.showToast('Copy failed');
        }
        textArea.remove();
      }
    };
  }

  // Badges (Feature 8)
  const badgesEl = document.getElementById('pm-badges');
  if (badgesEl) {
    if (island.badges && island.badges.length > 0) {
      badgesEl.innerHTML = island.badges.map(b =>
        `<div class="pm-badge" style="border-color:${b.borderColor}; background:${b.bgColor}" title="${escapeHTML(b.label)}">${b.icon}</div>`
      ).join('');
      badgesEl.style.display = 'flex';
    } else {
      badgesEl.style.display = 'none';
    }
  }

  document.getElementById('profile-modal').classList.remove('hidden');

  if (window.unlockAchievement) {
    if (island.repoCount > 50) {
      window.unlockAchievement('mentor_seeker');
    }

    // Check primary language match
    if (window.currentUserLogin && window.currentUserLogin !== island.login && window.myPrimaryLanguage) {
      if (window.myPrimaryLanguage === island.primaryLanguage) {
        window.unlockAchievement('birds_of_feather');
      }
    }

    // Track unique languages visited
    if (!window.visitedLangs) window.visitedLangs = new Set();
    if (island.primaryLanguage && island.primaryLanguage !== 'Unknown') {
      window.visitedLangs.add(island.primaryLanguage);
      if (window.visitedLangs.size >= 3) {
        window.unlockAchievement('cross_pollination');
      }
    }
  }

  document.getElementById('pm-btn-github').onclick = () => window.open('https://github.com/' + island.login, '_blank');
  document.getElementById('pm-btn-travel').onclick = () => {
    document.getElementById('profile-modal').classList.add('hidden');
    document.getElementById('citizens-sidebar').classList.add('hidden');
    flyTo(island.cx, island.cy, null);
  };
  document.getElementById('profile-modal').classList.remove('hidden');
}

// ── Language Pie Chart (Feature 7) ────────────────────
function drawLanguagePie(buildings) {
  const pieCanvas = document.getElementById('pm-pie-chart');
  if (!pieCanvas) return;

  const pctx = pieCanvas.getContext('2d');
  const size = pieCanvas.width;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 8;

  pctx.clearRect(0, 0, size, size);

  // Count languages
  const langCounts = {};
  for (const b of buildings) {
    const lang = b.language || 'Other';
    langCounts[lang] = (langCounts[lang] || 0) + 1;
  }

  const total = buildings.length;
  const legendEl = document.getElementById('pm-pie-legend');
  
  if (total === 0) {
    if (legendEl) legendEl.innerHTML = '<div class="pie-legend-item" style="color: #666; font-style: italic; justify-content: center;">No repos</div>';
    return;
  }

  let startAngle = -Math.PI / 2;
  const entries = Object.entries(langCounts).sort((a, b) => b[1] - a[1]);

  // Draw donut chart
  for (const [lang, count] of entries) {
    const sliceAngle = (count / total) * Math.PI * 2;
    pctx.beginPath();
    pctx.moveTo(cx, cy);
    pctx.arc(cx, cy, radius, startAngle, startAngle + sliceAngle);
    pctx.closePath();
    pctx.fillStyle = langColor(lang);
    pctx.fill();
    startAngle += sliceAngle;
  }

  // Cut out center for donut effect
  pctx.beginPath();
  pctx.arc(cx, cy, radius * 0.55, 0, Math.PI * 2);
  pctx.fillStyle = 'rgba(10,10,26,0.95)';
  pctx.fill();

  // Center text
  pctx.fillStyle = '#ffffff';
  pctx.font = 'bold 14px monospace';
  pctx.textAlign = 'center';
  pctx.textBaseline = 'middle';
  pctx.fillText(total, cx, cy - 6);
  pctx.fillStyle = '#8a8acc';
  pctx.font = '9px monospace';
  pctx.fillText('repos', cx, cy + 8);

  // Legend
  if (legendEl) {
    legendEl.innerHTML = entries.slice(0, 6).map(([lang, count]) =>
      `<div class="pie-legend-item">
        <span class="pie-legend-dot" style="background:${langColor(lang)}"></span>
        <span>${lang}</span>
        <span class="pie-legend-pct">${Math.round(count / total * 100)}%</span>
      </div>`
    ).join('');
  }
}

// ── Utility ───────────────────────────────────────────
function formatSize(kb) {
  if (!kb) return '0 KB';
  if (kb < 1024) return kb + ' KB';
  if (kb < 1024 * 1024) return (kb / 1024).toFixed(1) + ' MB';
  return (kb / 1024 / 1024).toFixed(1) + ' GB';
}

function timeAgo(dateStr) {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return 'Unknown';
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  if (seconds < 2592000) return Math.floor(seconds / 86400) + 'd ago';
  if (seconds < 31536000) return Math.floor(seconds / 2592000) + 'mo ago';
  return Math.floor(seconds / 31536000) + 'y ago';
}

// ── Mobile Touch Mechanics ────────────────────────────
let previousTouch = null;
let initialPinchDistance = null;
let initialZoom = null;
let touchDragDistance = 0;

canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  if (e.touches.length === 1) {
    window.isDragging = true;
    previousTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    autopilotTarget = null;
    touchDragDistance = 0;
    lastMouse.x = e.touches[0].clientX;
    lastMouse.y = e.touches[0].clientY;
    
    window.touchJoystick = { 
      originX: e.touches[0].clientX, 
      originY: e.touches[0].clientY, 
      moveX: 0, moveY: 0, dist: 0 
    };
  } else if (e.touches.length === 2) {
    window.isDragging = false;
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    initialPinchDistance = Math.sqrt(dx * dx + dy * dy);
    initialZoom = camera.zoom;
  }
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (e.touches.length === 1 && window.isDragging && previousTouch) {
    const touch = e.touches[0];
    
    if (window.touchJoystick) {
      const dx = touch.clientX - window.touchJoystick.originX;
      const dy = touch.clientY - window.touchJoystick.originY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      touchDragDistance += Math.sqrt(Math.pow(touch.clientX - previousTouch.x, 2) + Math.pow(touch.clientY - previousTouch.y, 2));

      const maxRadius = 55;
      if (dist > maxRadius) {
        window.touchJoystick.originX += (dx / dist) * (dist - maxRadius);
        window.touchJoystick.originY += (dy / dist) * (dist - maxRadius);
        // Recalculate after moving origin
        const newDx = touch.clientX - window.touchJoystick.originX;
        const newDy = touch.clientY - window.touchJoystick.originY;
        const newDist = Math.sqrt(newDx * newDx + newDy * newDy);
        window.touchJoystick.dist = newDist;
        window.touchJoystick.moveX = newDx / newDist;
        window.touchJoystick.moveY = newDy / newDist;
      } else {
        window.touchJoystick.dist = dist;
        window.touchJoystick.moveX = dx / dist;
        window.touchJoystick.moveY = dy / dist;
      }
    }

    previousTouch = { x: touch.clientX, y: touch.clientY };
    lastMouse.x = touch.clientX;
    lastMouse.y = touch.clientY;
  } else if (e.touches.length === 2 && initialPinchDistance) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const currentDistance = Math.sqrt(dx * dx + dy * dy);
    const zoomFactor = currentDistance / initialPinchDistance;
    camera.zoom = Math.max(0.1, Math.min(2.5, initialZoom * zoomFactor));
  }
}, { passive: false });

canvas.addEventListener('touchend', e => {
  if (e.touches.length < 2) {
    initialPinchDistance = null;
  }
  if (e.touches.length === 0) {
    if (window.isDragging && touchDragDistance < 8) {
      const mx = lastMouse.x;
      const my = lastMouse.y;
      const hit = findBuildingAtPoint(mx, my);
      if (hit && hit.building) {
        // trigger the same modal logic as mouseup
        const b = hit.building;
        document.getElementById('rm-name').textContent = b.name;
        document.getElementById('rm-lang').textContent = b.language + (b.isFork ? ' (Fork)' : '');
        document.getElementById('rm-stars').textContent = '⭐ ' + (b.stars || 0).toLocaleString();
        const rmDesc = document.getElementById('rm-description');
        if (rmDesc) rmDesc.textContent = b.description || 'No description provided.';
        const rmSize = document.getElementById('rm-size');
        if (rmSize) rmSize.textContent = formatSize(b.size);
        const rmUpdated = document.getElementById('rm-updated');
        if (rmUpdated) rmUpdated.textContent = b.updatedAt ? timeAgo(b.updatedAt) : 'Unknown';
        document.getElementById('rm-btn').onclick = () => { if (b.url) window.open(b.url, '_blank'); };
        document.getElementById('repo-modal').classList.remove('hidden');
        
        window.isDragging = false;
        previousTouch = null;
        window.touchJoystick = null;
        return;
      }
      const island = findIslandAtPoint(mx, my);
      if (island) showProfileModal(island);
    }
    window.isDragging = false;
    previousTouch = null;
    window.touchJoystick = null;
  }
});
