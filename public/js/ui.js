const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');

function escapeHTML(str) {
  if (!str) return '';
  return String(str).replace(/[&<>'"]/g,
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

/* ---------- Search (command-style popover) ---------- */

let searchActive = -1;

function searchRows() { return Array.from(searchResults.querySelectorAll('.search-result')); }

function setSearchActive(i) {
  const rows = searchRows();
  searchActive = rows.length ? (i + rows.length) % rows.length : -1;
  rows.forEach((r, n) => r.setAttribute('aria-selected', String(n === searchActive)));
  if (searchActive >= 0) {
    searchInput.setAttribute('aria-activedescendant', rows[searchActive].id);
    rows[searchActive].scrollIntoView({ block: 'nearest' });
  } else {
    searchInput.removeAttribute('aria-activedescendant');
  }
}

function clearSearch() {
  searchResults.innerHTML = '';
  searchActive = -1;
  searchInput.setAttribute('aria-expanded', 'false');
  searchInput.removeAttribute('aria-activedescendant');
}

let searchTimeout;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(async () => {
    const q = searchInput.value.trim();
    if (q.length < 2) {
      clearSearch();
      if (q.length === 1) { searchResults.innerHTML = '<div class="search-empty">Keep typing a username or repo name.</div>'; }
      return;
    }

    try {
      const res = await fetch('/api/search?q=' + encodeURIComponent(q));
      const matches = await res.json();
      if (!Array.isArray(matches) || matches.length === 0) {
        searchResults.innerHTML = `<div class="search-empty">Nothing on the map matches "${escapeHTML(q)}".</div>`;
        searchInput.setAttribute('aria-expanded', 'true');
        searchActive = -1;
        return;
      }
      searchResults.innerHTML = matches.slice(0, 8).map((m, i) => {
        const jStr = encodeURIComponent(JSON.stringify(m));
        const isUser = m.type === 'user';
        const name = escapeHTML(isUser ? m.login : m.name);
        const sub = isUser ? 'Developer' : 'Repo by ' + escapeHTML(m.login);
        const dx = (m.x || 0) - player.x, dy = (m.y || 0) - player.y;
        const dist = Math.hypot(dx, dy);
        const distLabel = dist < 1000 ? Math.round(dist) + ' u' : (dist / 1000).toFixed(1) + ' ku';
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
        const glyph = isUser
          ? `<img class="dest-avatar" src="${escapeHTML(safeAvatarUrl(m.avatar, m.login))}" alt="" loading="lazy">`
          : `<span class="dest-glyph" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 20V9l7-5 7 5v11z"/><path d="M10 20v-5h4v5"/></svg></span>`;
        return `<div class="search-result" id="sr-${i}" role="option" aria-selected="false" data-x="${m.x}" data-y="${m.y}" data-item="${jStr}">
          ${glyph}
          <span class="dest-text"><span class="sr-label">${name}</span><span class="dest-sub">${sub}</span></span>
          <span class="dest-dist">${dist < 40 ? 'Here' : distLabel}</span>
          <svg class="dest-arrow" viewBox="0 0 24 24" aria-hidden="true" style="transform:rotate(${angle.toFixed(0)}deg)"><path d="M4 12h15M13 6l6 6-6 6"/></svg>
        </div>`;
      }).join('');
      searchInput.setAttribute('aria-expanded', 'true');
      setSearchActive(0);
    } catch (e) {
      searchResults.innerHTML = '<div class="search-empty">Search is not responding. Try again in a moment.</div>';
      searchInput.setAttribute('aria-expanded', 'true');
    }
  }, 250);
});

searchInput.addEventListener('keydown', e => {
  const rows = searchRows();
  if (e.key === 'ArrowDown' && rows.length) { e.preventDefault(); setSearchActive(searchActive + 1); }
  else if (e.key === 'ArrowUp' && rows.length) { e.preventDefault(); setSearchActive(searchActive - 1); }
  else if (e.key === 'Enter' && rows[searchActive]) { e.preventDefault(); rows[searchActive].click(); searchInput.blur(); }
});

searchResults.addEventListener('mousemove', e => {
  const row = e.target.closest('.search-result');
  if (row) setSearchActive(searchRows().indexOf(row));
});

window.flyTo = function (x, y, jsonStr) {
  let item = null;
  try { if (jsonStr) item = JSON.parse(jsonStr); } catch (e) { }
  if (isNaN(x) || isNaN(y)) { x = 0; y = 0; }
  autopilotTarget = { x, y, item };
  clearSearch();
  searchInput.value = '';
  if (window.closeWhereTo) window.closeWhereTo();
};

/* ---------- Repo + profile modals ---------- */

/* Guests can look at one person (their island and repos). Anyone else asks them to sign in. */
const PEEK_KEY = 'gitspace_guest_peek';
function guestMayOpen(login) {
  if (!window.isGuest || !login) return true;
  let peek = null;
  try { peek = sessionStorage.getItem(PEEK_KEY); } catch (e) { }
  if (!peek) {
    try { sessionStorage.setItem(PEEK_KEY, login); } catch (e) { }
    return true;
  }
  if (peek === login) return true;
  document.getElementById('guest-gate').classList.remove('hidden');
  return false;
}

function openModalForItem(item) {
  if (!guestMayOpen(item.login || item.owner)) return;
  if (item.type === 'repo') {
    window.currentModalRepoOwner = item.login || item.owner || '';
    document.getElementById('rm-name').textContent = item.name;
    document.getElementById('rm-owner').textContent = window.currentModalRepoOwner ? 'by ' + window.currentModalRepoOwner : '';
    document.getElementById('rm-lang').textContent = (item.language || 'Unknown') + (item.isFork ? ' (fork)' : '');
    document.getElementById('rm-stars').textContent = (item.stars || 0).toLocaleString();
    if (window.setRepoTab) window.setRepoTab(false);

    document.getElementById('rm-description').textContent = item.description || 'No description provided.';
    document.getElementById('rm-size').textContent = typeof formatSize === 'function' ? formatSize(item.size) : (item.size || 0) + ' KB';
    document.getElementById('rm-updated').textContent = item.updatedAt ? timeAgo(item.updatedAt) : 'Unknown';

    document.getElementById('rm-audit-content').innerHTML = '';
    document.getElementById('rm-btn').onclick = () => { if (item.url) window.open(item.url, '_blank', 'noopener'); };
    document.getElementById('repo-modal').classList.remove('hidden');
  } else if (item.type === 'user') {
    const island = islands.find(i => i.login === item.login);
    if (island) {
      showProfileModal(island);
    } else {
      fetch('/api/user/' + encodeURIComponent(item.login))
        .then(res => res.json())
        .then(fullUser => {
          if (fullUser.error) throw new Error(fullUser.error);
          showProfileModal({
            login: fullUser.login,
            cx: fullUser.cx,
            cy: fullUser.cy,
            avatar: fullUser.avatar,
            primaryLanguage: fullUser.primaryLanguage,
            repoCount: fullUser.repos.length,
            totalStars: fullUser.repos.reduce((sum, r) => sum + (r.stars || 0), 0),
            buildings: fullUser.repos
          });
        })
        .catch(() => {
          showProfileModal({
            login: item.login,
            cx: item.x,
            cy: item.y,
            avatar: item.avatar,
            repoCount: item.repoCount || 0,
            totalStars: item.totalStars || 0,
            buildings: []
          });
        });
    }
  }
}

/* ---------- Citizens ---------- */

let allCitizens = [];

class TrieNode {
  constructor() {
    this.children = {};
    this.items = [];
  }
}
let citizensTrie = new TrieNode();

function insertTrie(trie, key, item) {
  let node = trie;
  for (const char of key) {
    if (!node.children[char]) node.children[char] = new TrieNode();
    node = node.children[char];
    if (node.items.length < 50) {
      node.items.push(item);
    }
  }
}

function searchTrie(trie, prefix) {
  let node = trie;
  for (const char of prefix) {
    if (!node.children[char]) return [];
    node = node.children[char];
  }
  return node.items;
}

function safeAvatarUrl(url, login) {
  if (url && (url.startsWith('https://') || url.startsWith('data:image/'))) return url;
  return 'https://avatars.githubusercontent.com/' + encodeURIComponent(login) + '?s=80';
}

function plural(n, one, many) { return Number(n).toLocaleString() + ' ' + (n === 1 ? one : many); }

function renderCitizensList(query = '') {
  const list = document.getElementById('citizens-list');
  const toRender = query ? searchTrie(citizensTrie, query) : allCitizens.slice(0, 50);

  if (toRender.length === 0) {
    list.innerHTML = query
      ? `<p class="list-note">No citizen's username starts with "${escapeHTML(query)}".</p>`
      : '<p class="list-note">Nobody has signed in yet. Sign in with GitHub to be the first island.</p>';
    return;
  }

  list.innerHTML = toRender.map(c => {
    const avatarSrc = escapeHTML(safeAvatarUrl(c.avatar, c.login));
    const jStr = encodeURIComponent(JSON.stringify({
      type: 'user', login: c.login, avatar: c.avatar, primaryLanguage: c.primaryLanguage, repoCount: c.repoCount, totalStars: c.totalStars, x: c.x, y: c.y
    }));
    const meta = [plural(c.repoCount || 0, 'repo', 'repos'), plural(c.totalStars || 0, 'star', 'stars'), c.primaryLanguage || 'Other'].join(', ');
    return `
      <div class="citizen-item">
        <img class="citizen-avatar" src="${avatarSrc}" alt="" loading="lazy">
        <div class="citizen-info">
          <div class="citizen-name">${escapeHTML(c.login)}</div>
          <div class="citizen-meta">${escapeHTML(meta)}</div>
        </div>
        <wa-button size="s" appearance="outlined" variant="neutral" class="btn-more-info" data-item="${jStr}">View</wa-button>
      </div>
    `;
  }).join('');
}

const citSearch = document.getElementById('citizens-search');
let citSearchTimeout;
if (citSearch) {
  citSearch.addEventListener('input', e => {
    clearTimeout(citSearchTimeout);
    citSearchTimeout = setTimeout(() => {
      renderCitizensList(e.target.value.toLowerCase().trim());
    }, 200);
  });
}

let citizensLoaded = false;
window.toggleCitizens = async function () {
  const sb = document.getElementById('citizens-sidebar');
  sb.classList.toggle('hidden');

  if (!sb.classList.contains('hidden') && !citizensLoaded) {
    const list = document.getElementById('citizens-list');
    list.innerHTML = '<p class="list-note">Loading citizens...</p>';
    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const res = await fetch('/api/citizens', { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) throw new Error('Bad response: ' + res.status);
        allCitizens = await res.json();
        if (!Array.isArray(allCitizens)) throw new Error('Not an array');
        citizensTrie = new TrieNode();
        for (let i = 0; i < allCitizens.length; i++) {
          const lower = allCitizens[i].login.toLowerCase();
          allCitizens[i].loginLower = lower;
          insertTrie(citizensTrie, lower, allCitizens[i]);
        }
        citizensLoaded = true;
        renderCitizensList('');
        break;
      } catch (e) {
        console.error('Citizens load error (attempt ' + (attempt + 1) + '):', e);
        if (attempt === maxRetries) {
          list.innerHTML = '<div class="list-note">Could not load the citizen list. The server did not answer.<br><wa-button size="s" appearance="outlined" variant="neutral" id="btn-citizens-retry">Try again</wa-button></div>';
          document.getElementById('btn-citizens-retry').onclick = () => { sb.classList.add('hidden'); window.toggleCitizens(); };
        }
      }
    }
  }
};

/* ---------- Session ---------- */

const OVERLAYS = ['repo-modal', 'profile-modal', 'citizens-sidebar', 'shortcuts-overlay', 'radar-modal'];

// Look around without an account: search, postcards, repo cards and the map work; the engine keeps the ship still.
// The guest HUD switches on whenever engine.js starts guest explore, whoever starts it (our login card or the landing page).
function enterGuestUI() {
  window.isGuest = true;
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('hud').style.display = 'block';
  document.getElementById('hud-name').textContent = 'Exploring as a guest';
  document.getElementById('btn-logout').textContent = 'Back to sign in';
  document.getElementById('guest-chip').hidden = false;
}
if (typeof window.startGuestExplore === 'function') {
  const startGuestExplore = window.startGuestExplore;
  window.startGuestExplore = function () {
    window.isGuest = true; // set first so the login-screen observer does not restart attract mode
    const result = startGuestExplore.apply(this, arguments);
    enterGuestUI();
    return result;
  };
}

window.exploreAsGuest = function () {
  if (typeof window.stopAttractMode === 'function') window.stopAttractMode();
  if (typeof window.hideLanding === 'function') window.hideLanding();
  if (typeof window.startGuestExplore === 'function') window.startGuestExplore();
  else enterGuestUI();
};

window.logout = function () {
  OVERLAYS.forEach(id => document.getElementById(id)?.classList.add('hidden'));
  if (window.closeShipUI) window.closeShipUI();
  // The server ends the session and sends us back to the login screen (attract mode starts there)
  window.location.href = '/auth/logout';
};


/* ---------- Dialogs ----------
   Panels are Web Awesome <wa-dialog>/<wa-drawer> (focus trap, Esc, inert page, focus return built in).
   The rest of the codebase opens and closes panels by toggling the "hidden" class, so mirror that class
   onto the component's `open` property, and put the class back when the component closes itself. */

const DIALOG_IDS = ['error-screen', 'radar-modal', 'repo-modal', 'profile-modal', 'shortcuts-overlay', 'citizens-sidebar', 'guest-gate'];

function syncDialog(d) {
  const want = !d.classList.contains('hidden');
  customElements.whenDefined(d.localName).then(() => { if (d.open !== want) d.open = want; });
}

const dialogObserver = new MutationObserver(records => records.forEach(r => syncDialog(r.target)));
DIALOG_IDS.forEach(id => {
  const d = document.getElementById(id);
  if (!d) return;
  dialogObserver.observe(d, { attributes: true, attributeFilter: ['class'] });
  d.addEventListener('wa-after-hide', e => {
    if (e.target !== d) return; // ignore tooltips/details inside
    d.classList.add('hidden');
    if (id === 'shortcuts-overlay' && typeof hideShortcutsOverlay === 'function') hideShortcutsOverlay();
  });
  syncDialog(d);
});

const anyDialogOpen = () => DIALOG_IDS.some(id => !document.getElementById(id)?.classList.contains('hidden'));
const hudVisible = () => document.getElementById('hud').style.display !== 'none';

/* ---------- Ship speed ---------- */

const SPEED_KEY = 'gitspace_speed';
const speedSlider = document.getElementById('speed-slider');

function applySpeed(v) {
  const n = Math.min(3, Math.max(0.5, Number(v) || 1));
  window.speedMultiplier = n;
  if (speedSlider && Number(speedSlider.value) !== n) speedSlider.value = n;
  return n;
}
try { applySpeed(localStorage.getItem(SPEED_KEY) || 1); } catch (e) { applySpeed(1); }
if (speedSlider) {
  speedSlider.valueFormatter = v => v + 'x';
  speedSlider.addEventListener('input', () => {
    const n = applySpeed(speedSlider.value);
    try { localStorage.setItem(SPEED_KEY, String(n)); } catch (e) { }
  });
}

/* ---------- Ship ring (Space, or click the ship) ---------- */

const ring = document.getElementById('ship-ring');
const ringSpeed = document.getElementById('ring-speed');
const ringMore = document.getElementById('ring-more');
const whereTo = document.getElementById('where-to');
const ringItems = () => Array.from(ring.querySelectorAll('.ring-btn'));

function shipScreenPos() {
  const r = canvas.getBoundingClientRect();
  const k = r.width / canvas.width;
  return {
    x: r.left + (canvas.width / 2 + (player.x - camera.x) * camera.zoom) * k,
    y: r.top + (canvas.height / 2 + (player.y - camera.y) * camera.zoom) * k
  };
}

function layoutRing() {
  const slots = Array.from(ring.querySelectorAll(':scope > .ring-btn, :scope > .ring-slot')).filter(el => !el.hidden);
  const radius = window.innerWidth < 640 ? 70 : 82;
  slots.forEach((el, i) => {
    const a = (-90 + i * 360 / slots.length) * Math.PI / 180;
    el.style.setProperty('--i', i);
    el.style.setProperty('--x', Math.round(Math.cos(a) * radius) + 'px');
    el.style.setProperty('--y', Math.round(Math.sin(a) * radius) + 'px');
  });
}

let followFrame = 0;
function follow() {
  followFrame = 0;
  if (ring.hidden && whereTo.hidden) return;
  const p = shipScreenPos();
  if (!ring.hidden) ring.style.transform = `translate(${p.x}px, ${p.y}px)`;
  if (!whereTo.hidden) {
    const w = whereTo.offsetWidth, h = whereTo.offsetHeight;
    const left = Math.max(12, Math.min(window.innerWidth - w - 12, p.x - w / 2));
    // Sit above the ship; drop below it when there is no room up top
    let top = p.y - 56 - h;
    if (top < 12) top = Math.min(window.innerHeight - h - 12, p.y + 56);
    whereTo.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(12, top))}px)`;
  }
  followFrame = requestAnimationFrame(follow);
}
const startFollow = () => { if (!followFrame) followFrame = requestAnimationFrame(follow); };

function setHomeLabel() {
  const guest = !window.currentUserLogin;
  const label = guest ? 'Sign in with GitHub' : 'My island';
  document.getElementById('ring-home').setAttribute('aria-label', label);
  document.getElementById('ring-home-tip').textContent = label;
}

function openRing() {
  if (!hudVisible() || anyDialogOpen()) return;
  closeWhereTo();
  setHomeLabel();
  layoutRing();
  ring.hidden = false;
  follow();
  requestAnimationFrame(() => ring.classList.add('open'));
  setTimeout(() => ringItems()[0]?.focus(), 60);
}

function closeRing() {
  if (ring.hidden) return;
  ring.classList.remove('open');
  ringSpeed.hidden = true;
  document.getElementById('ring-speed-btn').setAttribute('aria-expanded', 'false');
  if (ringMore) ringMore.open = false;
  if (ring.contains(document.activeElement)) document.activeElement.blur();
  setTimeout(() => { if (!ring.classList.contains('open')) ring.hidden = true; }, 160);
}
const toggleRing = () => (ring.hidden ? openRing() : closeRing());
window.closeShipUI = () => { closeRing(); closeWhereTo(); };

function flyHome() {
  if (!window.currentUserLogin) { window.location.href = '/auth/github'; return; }
  fetch('/api/user/' + encodeURIComponent(window.currentUserLogin))
    .then(r => r.json())
    .then(d => {
      if (d.error) throw new Error(d.error);
      window.flyTo(d.cx, d.cy, null);
      window.showToast('Flying home');
    })
    .catch(() => window.showToast('Could not find your island. Try again in a moment.'));
}

ring.addEventListener('click', e => {
  const btn = e.target.closest('.ring-btn');
  if (!btn) return;
  const action = btn.dataset.ring;
  if (action === 'where') openWhereTo('');
  else if (action === 'map') { window.mapExpanded = true; closeRing(); }
  else if (action === 'speed') {
    ringSpeed.hidden = !ringSpeed.hidden;
    btn.setAttribute('aria-expanded', String(!ringSpeed.hidden));
    if (!ringSpeed.hidden) setTimeout(() => speedSlider?.focus(), 30);
  } else if (action === 'home') { closeRing(); flyHome(); }
});

function onMenuSelect(e) {
  const v = e.detail?.item?.value;
  closeRing();
  if (v === 'home') return flyHome();
  if (v === 'map') { window.mapExpanded = true; return; }
  if (v === 'speed') { openRing(); setTimeout(() => document.getElementById('ring-speed-btn')?.click(), 60); return; }
  if (v === 'citizens') window.toggleCitizens();
  else if (v === 'radar') window.openRepoRadar();
  else if (v === 'shortcuts') typeof toggleShortcutsOverlay === 'function' && toggleShortcutsOverlay();
  else if (v === 'screenshot') setTimeout(() => typeof captureScreenshot === 'function' && captureScreenshot(), 200);
  else if (v === 'sync') syncIsland();
  else if (v === 'privacy') window.location.href = '/privacy.html';
  else if (v === 'logout') { if (window.isGuest) window.location.href = '/auth/github'; else window.logout(); }
}
ringMore?.addEventListener('wa-select', onMenuSelect);
document.getElementById('top-menu')?.addEventListener('wa-select', onMenuSelect);
// Guests see Sign in instead of Sign out.
new MutationObserver(() => { const el = document.getElementById('top-menu-logout'); if (el) el.textContent = window.isGuest ? 'Sign in with GitHub' : 'Sign out'; }).observe(document.getElementById('hud'), { attributes: true, attributeFilter: ['style'] });

ring.addEventListener('keydown', e => {
  if (e.defaultPrevented) return;
  const inMenu = e.target.closest?.('wa-dropdown-item') || ringMore?.open;
  const inSlider = e.target === speedSlider;
  const key = e.key;
  if (key === 'Escape') {
    if (inMenu || !ringSpeed.hidden && inSlider) { ringSpeed.hidden = true; return; }
    e.stopPropagation();
    closeRing();
    return;
  }
  if (inMenu || inSlider) { if (key.startsWith('Arrow')) e.stopPropagation(); return; }
  const items = ringItems();
  const i = items.indexOf(e.target.closest('.ring-btn'));
  if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(key)) {
    e.preventDefault();
    e.stopPropagation(); // arrows cycle the ring here; they must not also steer the ship
    const step = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1;
    items[(i + step + items.length) % items.length]?.focus();
  } else if (key === 'Tab') {
    e.preventDefault();
    items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length]?.focus();
  } else if (['w', 'a', 's', 'd'].includes(key.toLowerCase())) {
    closeRing(); // flying away closes the ring; the key still reaches the ship
  }
});

/* ---------- "Where to?" destination prompt ---------- */

function openWhereTo(seed) {
  if (!hudVisible()) return;
  document.body.classList.add('where-open');
  closeRing();
  whereTo.hidden = false;
  searchInput.value = seed || '';
  startFollow();
  follow();
  searchInput.focus();
  searchInput.dispatchEvent(new Event('input'));
}

function closeWhereTo() {
  if (!whereTo || whereTo.hidden) return;
  whereTo.hidden = true;
  document.body.classList.remove('where-open');
  clearSearch();
  searchInput.value = '';
  if (document.activeElement === searchInput) searchInput.blur();
}
window.closeWhereTo = closeWhereTo;

searchInput.addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.stopPropagation(); closeWhereTo(); }
});

/* ---------- Global keys: Space opens the ring, "/" or typing a name opens Where to ---------- */

// Letters with their own shortcut (fly, review, screenshot, fps, help, map) never start a search.
const RESERVED_KEYS = new Set(['w', 'a', 's', 'd', 'r', 'p', 'f', 'h', 'm']);

window.addEventListener('keydown', e => {
  const t = e.target;
  if (t.closest?.('input, textarea, [contenteditable], wa-dialog, wa-drawer, wa-dropdown, #ship-ring')) return;
  if (!hudVisible() || anyDialogOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === ' ') { e.preventDefault(); toggleRing(); return; }
  if (e.key === '/') { e.preventDefault(); openWhereTo(''); return; }
  if (/^[a-z0-9]$/i.test(e.key) && !RESERVED_KEYS.has(e.key.toLowerCase())) {
    e.preventDefault();
    openWhereTo(e.key);
  }
}, true);

// Clicking (or tapping) the ship toggles the ring. Capture phase so a click on the ship does not also open a building.
function nearShip(x, y) {
  const p = shipScreenPos();
  return Math.hypot(x - p.x, y - p.y) < 30;
}
window.addEventListener('mouseup', e => {
  if (e.button !== 0 || e.target !== canvas || !hudVisible() || !nearShip(e.clientX, e.clientY)) return;
  e.stopPropagation();
  toggleRing();
}, true);
window.addEventListener('touchend', e => {
  if (e.target !== canvas || e.changedTouches.length !== 1 || !hudVisible()) return;
  const t = e.changedTouches[0];
  if (!nearShip(t.clientX, t.clientY) || (typeof touchDragDistance !== 'undefined' && touchDragDistance > 8)) return;
  e.stopPropagation();
  // input.js would have reset its drag state in its own touchend
  window.isDragging = false;
  window.touchJoystick = null;
  toggleRing();
}, true);

document.addEventListener('pointerdown', e => {
  if (!ring.hidden && !e.target.closest('#ship-ring, wa-dropdown') && e.target !== canvas) closeRing();
  if (!whereTo.hidden && !e.target.closest('#where-to')) closeWhereTo();
});
window.addEventListener('resize', () => { if (!ring.hidden) layoutRing(); });

/* ---------- Signed out: attract mode behind the login card ---------- */

function syncAttract() {
  if (window.isGuest) return; // explore mode has its own camera
  const loginScreen = document.getElementById('login-screen');
  const signedOut = !loginScreen.classList.contains('hidden');
  if (signedOut) { closeRing(); closeWhereTo(); }
  // When the landing page is loaded it is the signed-out view; the login card stays as the fallback.
  const landing = signedOut && typeof window.showLanding === 'function';
  loginScreen.classList.toggle('has-landing', landing);
  if (landing) window.showLanding();
  const fn = signedOut ? window.startAttractMode : window.stopAttractMode;
  if (typeof fn === 'function') fn();
}
new MutationObserver(syncAttract).observe(document.getElementById('login-screen'), { attributes: true, attributeFilter: ['class'] });
window.addEventListener('load', syncAttract);

/* ---------- First sign-in coach ----------
   After the first sign-in the camera arrives at your island, then one speech bubble at a time points at
   the thing it talks about and moves on when you do it. Stored in localStorage so it runs once. */

const COACH_KEY = 'gitspace_onboarded';
const coach = document.getElementById('coach');
const coachText = document.getElementById('coach-text');
const COACH_STEPS = [
  { text: 'Each building is one of your projects. Click one.', anchor: 'building' },
  { text: 'This is you. Press Space or tap the ship for the menu.', anchor: 'ship' },
  { text: 'Type a name to visit someone.', anchor: 'above-ship' },
  // Guests get a single bubble (index 3)
  { text: 'Type a name or click an island to look around.', anchor: 'above-ship', guest: true }
];
const coachKey = () => (window.isGuest ? 'gitspace_guest_onboarded' : COACH_KEY);
let coachStep = -1;
let coachIsland = null;
let coachFrame = 0;

function onboarded() {
  try { return localStorage.getItem(coachKey()) === '1'; } catch (e) { return true; }
}

function worldToScreen(wx, wy) {
  const r = canvas.getBoundingClientRect();
  const k = r.width / canvas.width;
  return {
    x: r.left + (canvas.width / 2 + (wx - camera.x) * camera.zoom) * k,
    y: r.top + (canvas.height / 2 + (wy - camera.y) * camera.zoom) * k
  };
}

function coachAnchor() {
  const step = COACH_STEPS[coachStep];
  if (step.anchor === 'building' && coachIsland?.buildings?.length) {
    const b = [...coachIsland.buildings].sort((a, c) => (c.stars || 0) - (a.stars || 0))[0];
    const p = worldToScreen(b.x, b.y);
    return { x: p.x, y: p.y - (b.height || 30) * camera.zoom - 18 };
  }
  const p = shipScreenPos();
  return step.anchor === 'ship' ? { x: p.x, y: p.y - 34 } : { x: p.x, y: p.y - 34 };
}

function coachFollow() {
  coachFrame = 0;
  if (coachStep < 0 || coach.hidden) return;
  // Step out of the way while the ring or the Where to prompt is open
  coach.style.visibility = ring.hidden && whereTo.hidden ? '' : 'hidden';
  const a = coachAnchor();
  const w = coach.offsetWidth, h = coach.offsetHeight;
  const left = Math.max(12, Math.min(window.innerWidth - w - 12, a.x - w / 2));
  const top = Math.max(12, a.y - h - 10);
  coach.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  coach.style.setProperty('--tail-x', Math.round(Math.max(16, Math.min(w - 16, a.x - left))) + 'px');
  coachFrame = requestAnimationFrame(coachFollow);
}

function showCoachStep(i) {
  if (i >= COACH_STEPS.length || (COACH_STEPS[i].guest && !window.isGuest)) { finishCoach(); return; }
  coachStep = i;
  coachText.textContent = COACH_STEPS[i].text;
  coach.hidden = false;
  if (!coachFrame) coachFrame = requestAnimationFrame(coachFollow);
}

function finishCoach() {
  coachStep = -1;
  coach.hidden = true;
  try { localStorage.setItem(coachKey(), '1'); } catch (e) { }
}
document.getElementById('coach-skip').addEventListener('click', finishCoach);

// Advance when the user does what the bubble asks
const advanceOn = (step, test) => () => { if (coachStep === step && test()) showCoachStep(step + 1); };
new MutationObserver(advanceOn(0, () => !document.getElementById('repo-modal').classList.contains('hidden')))
  .observe(document.getElementById('repo-modal'), { attributes: true, attributeFilter: ['class'] });
new MutationObserver(advanceOn(1, () => !ring.hidden)).observe(ring, { attributes: true, attributeFilter: ['hidden'] });
new MutationObserver(() => { advanceOn(2, () => !whereTo.hidden)(); advanceOn(3, () => !whereTo.hidden)(); })
  .observe(whereTo, { attributes: true, attributeFilter: ['hidden'] });
// While a panel covers the world, the bubble waits
DIALOG_IDS.forEach(id => {
  const d = document.getElementById(id);
  d?.addEventListener('wa-after-hide', e => { if (e.target === d && coachStep >= 0) coach.hidden = false; });
  d?.addEventListener('wa-show', e => {
    if (e.target !== d || coachStep < 0) return;
    if (coachStep === 3 && (id === 'profile-modal' || id === 'repo-modal')) { finishCoach(); return; } // the guest looked around
    coach.hidden = true;
  });
});

function startCoachWhenReady(tries = 0) {
  if (window.isGuest) {
    if (!onboarded() && coachStep < 0) setTimeout(() => showCoachStep(3), 900);
    return;
  }
  const login = window.currentUserLogin;
  if (!login || onboarded() || !hudVisible()) return;
  const island = islands.find(i => i.login === login);
  if (!island) {
    if (tries < 40) setTimeout(() => startCoachWhenReady(tries + 1), 500);
    return;
  }
  coachIsland = island;
  if (typeof window.startArrival === 'function') window.startArrival(island);
  setTimeout(() => showCoachStep(island.buildings?.length ? 0 : 1), 3400); // after the arrival title card
}
// init.js shows the HUD once the session is known
new MutationObserver(() => { if (hudVisible()) startCoachWhenReady(); })
  .observe(document.getElementById('hud'), { attributes: true, attributeFilter: ['style'] });

/* ---------- Island postcard ---------- */

window.profileCache = window.profileCache || {};
let profileRequest = 0;
let postcardIsland = null;

function safeHttpUrl(u) {
  if (!u) return null;
  const url = /^https?:\/\//i.test(u) ? u : 'https://' + u;
  try { const p = new URL(url); return /^https?:$/.test(p.protocol) ? p.href : null; } catch (e) { return null; }
}

function renderReadme(md, login) {
  if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
    const pre = document.createElement('pre');
    pre.textContent = md;
    return pre.outerHTML;
  }
  const holder = document.createElement('div');
  holder.innerHTML = DOMPurify.sanitize(marked.parse(md, { gfm: true }), { USE_PROFILES: { html: true } });
  holder.querySelectorAll('a[href]').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
  holder.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src') || '';
    // Relative image paths in a profile README live in the login/login repo
    if (src && !/^(https?:|data:)/i.test(src)) {
      img.setAttribute('src', `https://raw.githubusercontent.com/${encodeURIComponent(login)}/${encodeURIComponent(login)}/HEAD/${src.replace(/^\.?\//, '')}`);
    }
    img.loading = 'lazy';
    img.alt = img.alt || '';
  });
  return holder.innerHTML;
}

function islandLanguages(buildings, max = 3) {
  const counts = {};
  for (const b of buildings || []) {
    const l = b.language || 'Other';
    counts[l] = (counts[l] || 0) + 1;
  }
  const total = (buildings || []).length || 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, max)
    .map(([lang, n]) => ({ lang, n, pct: Math.round(n / total * 100) }));
}

const topRepos = (island, n) => [...(island.buildings || [])].sort((a, b) => (b.stars || 0) - (a.stars || 0)).slice(0, n);

function postmarkText(island) {
  return `GitSpace, X ${Math.round(island.cx || 0)} Y ${Math.round(island.cy || 0)}`;
}

function postcardBodyHTML(island) {
  const langs = islandLanguages(island.buildings);
  const repos = topRepos(island, 3);
  const buildings = island.buildings || [];
  return `
    <div class="pm-about" id="pm-about">
      <div class="skel"></div><div class="skel short"></div>
    </div>
    <p class="pc-stats">${plural(island.repoCount || buildings.length || 0, 'repo', 'repos')} on the island, ${plural(island.totalStars || 0, 'star', 'stars')}</p>
    ${langs.length ? `<div class="pc-langs">${langs.map(l => `<wa-tag size="s" appearance="filled" variant="neutral"><span class="lang-dot" style="background:${langColor(l.lang)}"></span>${escapeHTML(l.lang)}</wa-tag>`).join('')}</div>` : ''}
    ${repos.length ? `<ul class="pc-repos">${repos.map(r => `
      <li><button type="button" class="pc-repo" data-repo-index="${buildings.indexOf(r)}">
        <span class="pc-repo-name">${escapeHTML(r.name)}</span>
        <span class="pc-repo-stars">${plural(r.stars || 0, 'star', 'stars')}</span>
      </button></li>`).join('')}</ul>` : '<p class="muted">No public repos on this island yet.</p>'}`;
}

function showProfileModal(island) {
  if (!guestMayOpen(island.login)) return;
  const req = ++profileRequest;
  const login = island.login;
  postcardIsland = island;
  const modal = document.getElementById('profile-modal');
  const avatar = safeAvatarUrl(island.avatar, login);
  closeRing();
  closeWhereTo();

  document.getElementById('pm-avatar').src = avatar;
  document.getElementById('pm-avatar').alt = login + "'s avatar";
  document.getElementById('pc-stamp-img').src = avatar;
  document.getElementById('pc-postmark').textContent = postmarkText(island);
  document.getElementById('pm-name').textContent = login;
  const loginLink = document.getElementById('pm-login');
  loginLink.textContent = '@' + login;
  loginLink.href = 'https://github.com/' + encodeURIComponent(login);

  // Left half: a live picture of their island, or the avatar large when it is not loaded nearby
  const pic = document.getElementById('pc-picture');
  pic.innerHTML = '';
  const small = window.innerWidth < 720;
  const snap = typeof window.renderIslandSnapshot === 'function'
    ? window.renderIslandSnapshot(login, small ? Math.min(window.innerWidth - 48, 520) : 340, small ? 190 : 392) : null;
  if (snap) pic.appendChild(snap);
  else pic.innerHTML = `<img class="pc-picture-avatar" src="${escapeHTML(avatar)}" alt="">`;

  const body = document.getElementById('pm-body');
  body.innerHTML = postcardBodyHTML(island);
  body.querySelectorAll('.pc-repo').forEach(btn => btn.addEventListener('click', () => {
    const b = island.buildings[Number(btn.dataset.repoIndex)];
    if (!b) return;
    modal.classList.add('hidden');
    document.getElementById('citizens-sidebar')?.classList.add('hidden');
    window.flyTo(b.x, b.y, JSON.stringify({ ...b, type: 'repo', login }));
  }));

  const readmeBox = document.getElementById('pc-readme');
  readmeBox.open = false;
  document.getElementById('pm-readme').innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel short"></div>';

  modal.classList.remove('hidden');

  const cached = window.profileCache[login];
  const load = cached ? Promise.resolve(cached) : fetch('/api/profile/' + encodeURIComponent(login))
    .then(async res => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(data.error || 'Status ' + res.status), { status: res.status });
      window.profileCache[login] = data;
      return data;
    });
  load.then(p => { if (req === profileRequest) fillProfile(p, login); })
    .catch(err => { if (req === profileRequest) profileFailed(err, login); });
}

function fillProfile(p, login) {
  if (p.avatar) {
    const a = safeAvatarUrl(p.avatar, login);
    document.getElementById('pm-avatar').src = a;
    document.getElementById('pc-stamp-img').src = a;
  }
  document.getElementById('pm-name').textContent = p.name || p.login || login;

  const meta = [];
  if (p.location) meta.push(`<li>${escapeHTML(p.location)}</li>`);
  if (p.createdAt) {
    const d = new Date(p.createdAt);
    if (!isNaN(d)) meta.push(`<li>Joined ${d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</li>`);
  }
  meta.push(`<li>${plural(p.followers || 0, 'follower', 'followers')}</li>`);
  const blog = safeHttpUrl(p.blog);
  if (blog) meta.push(`<li><a href="${escapeHTML(blog)}" target="_blank" rel="noopener noreferrer">${escapeHTML(blog.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a></li>`);

  document.getElementById('pm-about').innerHTML =
    (p.bio ? `<p class="pm-bio">${escapeHTML(p.bio)}</p>` : '') + `<ul class="pm-meta">${meta.join('')}</ul>`;

  const readme = document.getElementById('pm-readme');
  if (p.readme) {
    readme.innerHTML = renderReadme(p.readme, login);
    readme.querySelectorAll('img').forEach(img => img.addEventListener('error', () => img.remove()));
  } else {
    readme.innerHTML = `<p class="muted">${escapeHTML(login)} has no profile README. GitHub shows one when a repo named ${escapeHTML(login)}/${escapeHTML(login)} has a README.md.</p>`;
  }
}

function profileFailed(err, login) {
  const rate = err.status === 503;
  const missing = err.status === 404;
  const text = rate ? 'GitHub is limiting how often we can ask for profiles. Try again in a few minutes.'
    : missing ? 'GitHub does not know this account, so only the island is shown.'
    : 'We could not reach GitHub for the full profile. Open it on GitHub instead.';
  document.getElementById('pm-about').innerHTML = `<p class="muted">${escapeHTML(text)}</p>`;
  document.getElementById('pm-readme').innerHTML = '<p class="muted">The README could not be loaded. Open the profile on GitHub to read it.</p>';
}

function wrapText(c, text, x, y, maxW, lineH, maxLines) {
  const words = String(text).split(/\s+/);
  let line = '', lines = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + ' ' + words[i] : words[i];
    if (c.measureText(test).width > maxW && line) {
      if (lines === maxLines - 1) { c.fillText(line + '...', x, y); return y + lineH; }
      c.fillText(line, x, y); y += lineH; lines++; line = words[i];
    } else line = test;
  }
  if (line) { c.fillText(line, x, y); y += lineH; }
  return y;
}

function loadImage(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function downloadPostcard() {
  const island = postcardIsland;
  if (!island) return;
  const login = island.login;
  const p = window.profileCache[login] || {};
  try {
    await document.fonts?.ready;
    const W = 1440, H = 840, pad = 36;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#FFF4E6'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#E3CDB2'; g.lineWidth = 3; g.strokeRect(pad / 2, pad / 2, W - pad, H - pad);

    const picW = 640, picH = H - pad * 2;
    const snap = window.renderIslandSnapshot?.(login, picW / 2, picH / 2);
    if (snap) g.drawImage(snap, pad, pad, picW, picH);
    else { g.fillStyle = '#1E1B3A'; g.fillRect(pad, pad, picW, picH); }
    g.fillStyle = '#E3CDB2'; g.fillRect(pad + picW + 36, pad + 20, 2, picH - 40);

    const x = pad + picW + 76;
    const right = W - pad - 24;
    const avatar = await loadImage(safeAvatarUrl(p.avatar || island.avatar, login));
    // Stamp
    const sx = right - 120, sy = pad + 16;
    g.fillStyle = '#FFFFFF'; g.fillRect(sx, sy, 120, 140);
    g.setLineDash([6, 6]); g.strokeStyle = '#C9B39A'; g.strokeRect(sx + 4, sy + 4, 112, 132); g.setLineDash([]);
    if (avatar) g.drawImage(avatar, sx + 12, sy + 12, 96, 96);
    g.fillStyle = '#6B5E80'; g.font = '500 16px Rubik'; g.textAlign = 'center';
    g.fillText('GitSpace', sx + 60, sy + 128);
    // Postmark
    g.save(); g.translate(sx - 70, sy + 120); g.rotate(-0.18);
    g.strokeStyle = 'rgba(107,94,128,0.6)'; g.lineWidth = 2;
    g.beginPath(); g.arc(0, 0, 58, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(107,94,128,0.8)'; g.font = '500 14px Rubik';
    g.fillText('GitSpace', 0, -6);
    g.fillText(`X ${Math.round(island.cx || 0)} Y ${Math.round(island.cy || 0)}`, 0, 14);
    g.restore();

    g.textAlign = 'left';
    g.fillStyle = '#2B2340'; g.font = '600 52px Fredoka';
    let y = pad + 220;
    y = wrapText(g, p.name || login, x, y, right - x, 58, 2);
    g.fillStyle = '#6B5E80'; g.font = '400 24px Rubik';
    g.fillText('@' + login, x, y); y += 52;
    if (p.bio) { g.fillStyle = '#2B2340'; g.font = '400 24px Rubik'; y = wrapText(g, p.bio, x, y, right - x, 34, 3) + 12; }
    const langs = islandLanguages(island.buildings).map(l => l.lang).join(', ');
    g.fillStyle = '#6B5E80'; g.font = '400 22px Rubik';
    g.fillText(`${plural(island.repoCount || (island.buildings || []).length || 0, 'repo', 'repos')}, ${plural(island.totalStars || 0, 'star', 'stars')}${langs ? ', ' + langs : ''}`, x, y);
    y += 48;
    g.fillStyle = '#2B2340'; g.font = '500 24px Rubik';
    for (const r of topRepos(island, 3)) { g.fillText(r.name, x, y); y += 36; }
    g.fillStyle = '#6B5E80'; g.font = '400 20px Rubik';
    g.fillText(window.location.host + '/?fly=' + login, x, H - pad - 20);

    const blob = await new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('empty'))), 'image/png'));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `gitspace-${login}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    window.showToast('Postcard saved');
  } catch (e) {
    console.error('Postcard export failed:', e);
    window.showToast('Could not make the postcard image. An image on it would not load. Try again.');
  }
}

/* ---------- Wiring ---------- */

async function syncIsland() {
  const btn = document.getElementById('btn-sync');
  try {
    if (btn) btn.textContent = 'Refreshing...';
    await fetch('/api/repos', { method: 'POST' });
    window.location.reload();
  } catch (e) {
    console.error(e);
    if (btn) btn.textContent = 'Refresh my island';
    window.showToast('Could not refresh your island. Try again.');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  bind('btn-close-profile-modal', () => document.getElementById('profile-modal').classList.add('hidden'));
  bind('btn-explore-guest', window.exploreAsGuest);
  bind('pm-btn-download', downloadPostcard);
  bind('pm-btn-github', () => postcardIsland && window.open('https://github.com/' + encodeURIComponent(postcardIsland.login), '_blank', 'noopener'));
  bind('pm-btn-travel', () => {
    if (!postcardIsland) return;
    document.getElementById('profile-modal').classList.add('hidden');
    document.getElementById('citizens-sidebar')?.classList.add('hidden');
    window.flyTo(postcardIsland.cx, postcardIsland.cy, null);
  });
  bind('pm-btn-share', async () => {
    if (!postcardIsland) return;
    const url = window.location.origin + '/?fly=' + encodeURIComponent(postcardIsland.login);
    try {
      await navigator.clipboard.writeText(url);
      window.showToast('Island link copied');
    } catch (e) {
      window.showToast('Could not copy. The link is ' + url);
    }
  });
});

document.addEventListener('click', e => {
  const searchRes = e.target.closest('.search-result');
  if (searchRes) {
    const x = parseFloat(searchRes.getAttribute('data-x'));
    const y = parseFloat(searchRes.getAttribute('data-y'));
    window.flyTo(x, y, decodeURIComponent(searchRes.getAttribute('data-item')));
    return;
  }
  const moreInfoBtn = e.target.closest('.btn-more-info');
  if (moreInfoBtn) {
    try {
      openModalForItem(JSON.parse(decodeURIComponent(moreInfoBtn.getAttribute('data-item'))));
    } catch (err) {
      console.error('Failed to parse item data', err);
    }
  }
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  closeRing();
  closeWhereTo();
  if (window.getSelection) window.getSelection().removeAllRanges();
});

/* ---------- Toasts (bottom-center stack, newest on top, auto-dismiss) ---------- */

window.showToast = function (msg, duration = 3500) {
  const stack = document.getElementById('toast-notification');
  if (!stack) return;
  const t = document.createElement('li');
  t.className = 'toast';
  t.textContent = msg;
  stack.prepend(t);
  while (stack.children.length > 3) stack.lastElementChild.remove();
  setTimeout(() => {
    t.classList.add('leaving');
    setTimeout(() => t.remove(), 180);
  }, duration);
};

document.getElementById('search-trigger')?.addEventListener('click', () => openWhereTo(''));
