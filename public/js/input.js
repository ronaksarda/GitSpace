window.addEventListener('resize', () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});

window.addEventListener('keydown', e => {
  if (['INPUT', 'TEXTAREA'].includes(e.target.tagName) && e.target.type !== 'range') return;
  if (window.gsModalOpen) return; // a panel is open; keys belong to it, not the ship

  const key = e.key.toLowerCase();
  keys[key] = true;

  // Shortcuts overlay toggle
  if (key === '?' || (key === 'h' && !e.ctrlKey)) {
    if (window.toggleShortcuts) window.toggleShortcuts();
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
