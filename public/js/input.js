window.addEventListener('resize', () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});

window.addEventListener('keydown', e => {
  if (['INPUT', 'TEXTAREA'].includes(e.target.tagName) && e.target.type !== 'range') return;

  const key = e.key.toLowerCase();
  keys[key] = true;

  // Shortcuts overlay toggle
  if (key === '?' || (key === 'h' && !e.ctrlKey)) {
    toggleShortcutsOverlay();
    return;
  }

  // Big map toggle
  if (key === 'm') { window.mapExpanded = !window.mapExpanded; return; }
  if (key === 'escape' && window.mapExpanded) { window.mapExpanded = false; return; }

  // Screenshot
  if (key === 'p') {
    captureScreenshot();
    return;
  }

  // FPS counter toggle
  if (key === 'f') {
    fpsVisible = !fpsVisible;
    return;
  }

  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
    hideShortcutsOverlay();
  }

  if (key === 'escape') {
    document.getElementById('repo-modal')?.classList.add('hidden');
    document.getElementById('profile-modal')?.classList.add('hidden');
    document.getElementById('citizens-sidebar')?.classList.add('hidden');
    hideShortcutsOverlay();
  }
});

window.addEventListener('keyup', e => {
  keys[e.key.toLowerCase()] = false;
});

window.addEventListener('blur', () => {
  keys = {};
});

// Zoom
window.addEventListener('wheel', e => {
  if (e.target !== canvas) return; // let dialogs and lists scroll normally
  e.preventDefault();
  const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
  targetCamera.zoom = Math.max(0.1, Math.min(2.5, targetCamera.zoom * zoomDelta));
}, { passive: false });

canvas.addEventListener('mousedown', e => {
  if (e.button === 0) {
    autopilotTarget = null;
  }
});

function findBuildingAtPoint(mx, my) {
  for (const island of islands) {
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
    // Anywhere on the island counts: the grass disc or the rock underneath it.
    const r = island.islandRadius * camera.zoom;
    const onTop = dx * dx + dy * dy < r * r * 1.1;
    const onRock = dy > 0 && dy < r * 1.55 && Math.abs(dx) < r * (1 - dy / (r * 1.55));
    if (onTop || onRock) {
      return island;
    }
  }
  return null;
}

canvas.addEventListener('mouseup', e => {
  if (e.button === 0) {
    const mx = e.clientX;
    const my = e.clientY;
    if (window.minimapClick && window.minimapClick(mx, my)) return;

    const hit = findBuildingAtPoint(mx, my);
    if (hit && hit.building) {
      openModalForItem({ ...hit.building, type: 'repo', login: hit.island.login });
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

function captureScreenshot() {
  try {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(canvas, 0, 0);

    tempCtx.fillStyle = 'rgba(255,255,255,0.15)';
    tempCtx.font = 'bold 14px monospace';
    tempCtx.textAlign = 'right';
    tempCtx.fillText('GitSpace', canvas.width - 20, canvas.height - 20);

    const link = document.createElement('a');
    link.download = `gitspace_${Date.now()}.png`;
    link.href = tempCanvas.toDataURL('image/png');
    link.click();
    showToast('Screenshot saved');
  } catch (err) {
    showToast('Screenshot failed. Try again.');
  }
}

function showProfileModal(island) {
  document.getElementById('pm-avatar').src = island.avatar || 'https://avatars.githubusercontent.com/' + encodeURIComponent(island.login) + '?s=80';
  document.getElementById('pm-name').textContent = island.login;
  document.getElementById('pm-repos').textContent = island.repoCount + (island.repoCount === 1 ? ' repo' : ' repos');
  document.getElementById('pm-stars').textContent = (island.totalStars || 0).toLocaleString() + ' stars';

  const topReposEl = document.getElementById('pm-top-repos');
  if (topReposEl) {
    const sorted = [...island.buildings].sort((a, b) => b.stars - a.stars).slice(0, 5);
    if (sorted.length === 0) {
      topReposEl.innerHTML = '<div class="pm-repo-item muted">No public repos yet</div>';
    } else {
      topReposEl.innerHTML = sorted.map(r =>
        `<div class="pm-repo-item">
          <span class="pm-repo-dot" style="background:${langColor(r.language)}"></span>
          <span class="pm-repo-name">${escapeHTML(r.name)}</span>
          <span class="pm-repo-stars">${(r.stars || 0).toLocaleString()} stars</span>
        </div>`
      ).join('');
    }
  }

  drawLanguagePie(island.buildings);

  // Share button
  const shareBtn = document.getElementById('pm-btn-share');
  if (shareBtn) {
    shareBtn.onclick = () => {
      const url = window.location.origin + '/?fly=' + encodeURIComponent(island.login);
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(url).then(() => {
          if (window.showToast) window.showToast('Profile link copied');
        }).catch(() => {
          if (window.showToast) window.showToast('Copy failed');
        });
      } else {
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
          if (window.showToast) window.showToast('Profile link copied');
        } catch (err) {
          if (window.showToast) window.showToast('Copy failed');
        }
        textArea.remove();
      }
    };
  }

  document.getElementById('profile-modal').classList.remove('hidden');

  document.getElementById('pm-btn-github').onclick = () => window.open('https://github.com/' + island.login, '_blank');
  document.getElementById('pm-btn-travel').onclick = () => {
    document.getElementById('profile-modal').classList.add('hidden');
    document.getElementById('citizens-sidebar').classList.add('hidden');
    flyTo(island.cx, island.cy, null);
  };
}

function drawLanguagePie(buildings) {
  const pieCanvas = document.getElementById('pm-pie-chart');
  if (!pieCanvas) return;

  const pctx = pieCanvas.getContext('2d');
  const size = pieCanvas.width;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 8;

  pctx.clearRect(0, 0, size, size);

  const langCounts = {};
  for (const b of buildings) {
    const lang = b.language || 'Other';
    langCounts[lang] = (langCounts[lang] || 0) + 1;
  }

  const total = buildings.length;
  const legendEl = document.getElementById('pm-pie-legend');
  
  if (total === 0) {
    if (legendEl) legendEl.innerHTML = '<div class="pie-legend-item muted">No repos</div>';
    return;
  }

  let startAngle = -Math.PI / 2;
  const entries = Object.entries(langCounts).sort((a, b) => b[1] - a[1]);

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

  // Center cutout
  pctx.beginPath();
  pctx.arc(cx, cy, radius * 0.55, 0, Math.PI * 2);
  pctx.fillStyle = '#FFF4E6';
  pctx.fill();

  pctx.fillStyle = '#2B2340';
  pctx.font = '600 16px Rubik, sans-serif';
  pctx.textAlign = 'center';
  pctx.textBaseline = 'middle';
  pctx.fillText(total, cx, cy - 6);
  pctx.fillStyle = '#6B5E80';
  pctx.font = '11px Rubik, sans-serif';
  pctx.fillText('repos', cx, cy + 8);

  if (legendEl) {
    legendEl.innerHTML = entries.slice(0, 6).map(([lang, count]) =>
      `<div class="pie-legend-item">
        <span class="pie-legend-dot" style="background:${langColor(lang)}"></span>
        <span>${escapeHTML(lang)}</span>
        <span class="pie-legend-pct">${Math.round(count / total * 100)}%</span>
      </div>`
    ).join('');
  }
}

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
    initialPinchDistance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
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
        const newDx = touch.clientX - window.touchJoystick.originX;
        const newDy = touch.clientY - window.touchJoystick.originY;
        const newDist = Math.sqrt(newDx * newDx + newDy * newDy);
        window.touchJoystick.dist = newDist;
        window.touchJoystick.moveX = newDist > 0 ? newDx / newDist : 0;
        window.touchJoystick.moveY = newDist > 0 ? newDy / newDist : 0;
      } else {
        window.touchJoystick.dist = dist;
        window.touchJoystick.moveX = dist > 0 ? dx / dist : 0;
        window.touchJoystick.moveY = dist > 0 ? dy / dist : 0;
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
    camera.zoom = targetCamera.zoom = Math.max(0.1, Math.min(2.5, initialZoom * zoomFactor));
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
      if (window.minimapClick && window.minimapClick(mx, my)) { window.isDragging = false; previousTouch = null; window.touchJoystick = null; return; }
      const hit = findBuildingAtPoint(mx, my);
      if (hit && hit.building) {
        openModalForItem({ ...hit.building, type: 'repo', login: hit.island.login });
        
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
