// ── Search ────────────────────────────────────────────
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g,
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// Debounce helper
let searchTimeout;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(async () => {
    const q = searchInput.value.trim();
    if (q.length < 2) { searchResults.innerHTML = ''; return; }

    try {
      const res = await fetch('/api/search?q=' + encodeURIComponent(q));
      const matches = await res.json();

      searchResults.innerHTML = matches.map(m => {
        const jStr = encodeURIComponent(JSON.stringify(m));
        const displayStr = escapeHTML(m.label || m.login + (m.name ? '/' + m.name : ''));
        return `<div class="search-result" data-x="${m.x}" data-y="${m.y}" data-item="${jStr}">
          <strong>${m.type === 'user' ? '👤' : '📦'}</strong> ${displayStr}
        </div>`;
      }).join('');
    } catch (e) { }
  }, 300);
});

window.flyTo = function (x, y, jsonStr) {
  let item = null;
  try { if (jsonStr) item = JSON.parse(jsonStr); } catch (e) { }
  if (isNaN(x) || isNaN(y)) { x = 0; y = 0; }
  autopilotTarget = { x, y, item };
  searchResults.innerHTML = '';
  searchInput.value = '';

  if (item && item.type === 'repo' && window.unlockAchievement) {
    window.unlockAchievement('first_flight');
  }
};

function openModalForItem(item) {
  if (item.type === 'repo') {
    document.getElementById('rm-name').textContent = item.name;
    document.getElementById('rm-lang').textContent = item.language + (item.isFork ? ' (Fork)' : '');
    document.getElementById('rm-stars').textContent = '⭐ ' + (item.stars || 0).toLocaleString();

    const rmDesc = document.getElementById('rm-description');
    if (rmDesc) rmDesc.textContent = item.description || 'No description provided.';
    const rmSize = document.getElementById('rm-size');
    if (rmSize) rmSize.textContent = typeof formatSize === 'function' ? formatSize(item.size) : (item.size || 0) + ' KB';

    document.getElementById('rm-btn').onclick = () => window.open(item.url, '_blank');
    document.getElementById('repo-modal').classList.remove('hidden');

    if (window.unlockAchievement) {
      const lang = item.language || '';
      
      if (!window.inspectedRepos) window.inspectedRepos = new Set();
      window.inspectedRepos.add(item.name);
      if (window.inspectedRepos.size >= 10) window.unlockAchievement('architect');

      if ((item.stars || 0) >= 1000) window.unlockAchievement('stargazer');
      if ((item.size || 0) >= 100000) window.unlockAchievement('collector');

      if (['C', 'C++', 'Rust'].includes(lang)) window.unlockAchievement('sys_architect');
      if (['Python'].includes(lang)) window.unlockAchievement('ai_pioneer');
      if (['JavaScript', 'TypeScript', 'HTML'].includes(lang)) window.unlockAchievement('frontend_master');
    }
  } else if (item.type === 'user') {
    // Find matching island for full data
    const island = islands.find(i => i.login === item.login);
    if (island) {
      showProfileModal(island);
    } else {
      // Fetch full profile to get repos and badges
      fetch('/api/user/' + encodeURIComponent(item.login))
        .then(res => res.json())
        .then(fullUser => {
          if (fullUser.error) throw new Error(fullUser.error);

          const mockIsland = {
            login: fullUser.login,
            cx: fullUser.cx,
            cy: fullUser.cy,
            avatar: fullUser.avatar,
            primaryLanguage: fullUser.primaryLanguage,
            repoCount: fullUser.repos.length,
            totalStars: fullUser.repos.reduce((sum, r) => sum + (r.stars || 0), 0),
            buildings: fullUser.repos,
            badges: typeof calculateBadges === 'function' ? calculateBadges(fullUser.repos) : []
          };

          showProfileModal(mockIsland);
        })
        .catch(err => {
          // Fallback with partial data if fetch fails
          document.getElementById('pm-avatar').src = item.avatar || 'https://github.com/identicons/' + item.login + '.png';
          document.getElementById('pm-name').textContent = item.login;
          document.getElementById('pm-repos').textContent = (item.repoCount || 0) + ' Repositories';
          document.getElementById('pm-stars').textContent = '⭐ ' + (item.totalStars || 0).toLocaleString();

          const badgesEl = document.getElementById('pm-badges');
          if (badgesEl) badgesEl.style.display = 'none';

          document.getElementById('pm-btn-github').onclick = () => window.open('https://github.com/' + item.login, '_blank');
          document.getElementById('pm-btn-travel').onclick = () => {
            document.getElementById('profile-modal').classList.add('hidden');
            document.getElementById('citizens-sidebar').classList.add('hidden');
            flyTo(item.x, item.y, null);
          };
          document.getElementById('profile-modal').classList.remove('hidden');
        });
    }
  }
}

// Speed slider
const speedSlider = document.getElementById('speed-slider');
if (speedSlider) {
  speedSlider.addEventListener('input', e => {
    player.speed = parseFloat(e.target.value);
  });

  // Clear keys when interacting with slider to prevent "stuck keys" infinite travel bug
  speedSlider.addEventListener('focus', () => { if (typeof keys !== 'undefined') keys = {}; });
  speedSlider.addEventListener('mousedown', () => { if (typeof keys !== 'undefined') keys = {}; });
  speedSlider.addEventListener('touchstart', () => { if (typeof keys !== 'undefined') keys = {}; });
}

// Citizens search & rendering logic
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
  return 'https://github.com/identicons/' + encodeURIComponent(login) + '.png';
}

function renderCitizensList(query = '') {
  const list = document.getElementById('citizens-list');
  let toRender = [];
  if (!query) {
    toRender = allCitizens.slice(0, 50);
  } else {
    // O(L) prefix search using Trie (L = length of query, effectively O(1) relative to data size)
    toRender = searchTrie(citizensTrie, query);
  }

  list.innerHTML = toRender.map(c => {
    const avatarSrc = escapeHTML(safeAvatarUrl(c.avatar, c.login));
    const jStr = encodeURIComponent(JSON.stringify({
      type: 'user', login: c.login, avatar: c.avatar, primaryLanguage: c.primaryLanguage, repoCount: c.repoCount, totalStars: c.totalStars, x: c.x, y: c.y
    }));
    return `
      <div class="citizen-item" data-x="${c.x}" data-y="${c.y}">
        <img class="citizen-avatar" src="${avatarSrc}" loading="lazy">
        <div class="citizen-info">
          <div class="citizen-name">${escapeHTML(c.login)}</div>
          <div class="citizen-meta">${c.repoCount} Repos · ⭐ ${c.totalStars} · ${escapeHTML(c.primaryLanguage || 'Other')}</div>
        </div>
        <button class="btn-more-info" data-item="${jStr}">View</button>
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

// ── Auth & Citizens ───────────────────────────────────
window.logout = function () {
  const hiddenElements = [
    'repo-modal', 'profile-modal', 'citizens-sidebar',
    'achievements-sidebar', 'shortcuts-overlay', 'mobile-menu-dropdown',
    'confirm-modal'
  ];
  hiddenElements.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });

  if (document.getElementById('btn-logout').textContent === 'Back to Login') {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('hud').style.display = 'none';
    return;
  }
  window.location.href = '/auth/logout';
};

window.exploreAsGuest = function () {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('hud').style.display = 'block';
  document.getElementById('hud-avatar').style.display = 'none';
  document.getElementById('btn-logout').style.display = 'inline-block';
  document.getElementById('btn-logout').textContent = 'Back to Login';
  document.getElementById('hud-name').textContent = 'Guest Explorer';

  if (typeof initTour === 'function') {
    initTour();
  }
};

let citizensLoaded = false;
window.toggleCitizens = async function () {
  const sb = document.getElementById('citizens-sidebar');
  sb.classList.toggle('hidden');

  if (!sb.classList.contains('hidden') && window.unlockAchievement) {
    window.unlockAchievement('socialite');
  }

  if (!sb.classList.contains('hidden') && !citizensLoaded) {
    const list = document.getElementById('citizens-list');
    list.innerHTML = '<div style="padding: 10px; color: #a0a0c0;">Loading citizens...</div>';
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
          list.innerHTML = '<div style="padding: 10px; color: #f43f5e;">Failed to load. <span style="color:#06b6d4;cursor:pointer;text-decoration:underline" onclick="citizensLoaded=false;window.toggleCitizens();window.toggleCitizens();">Retry</span></div>';
        }
      }
    }
  }
};

// Mobile hamburger menu
window.toggleMobileMenu = function () {
  const menu = document.getElementById('mobile-menu-dropdown');
  if (menu) menu.classList.toggle('hidden');
};

// ── Event Listeners ───────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };

  bind('btn-explore-guest', window.exploreAsGuest);
  bind('btn-logout', window.logout);
  bind('btn-citizens', window.toggleCitizens);
  bind('btn-close-citizens', window.toggleCitizens);
  bind('btn-mobile-menu', window.toggleMobileMenu);

  bind('btn-close-repo-modal', () => document.getElementById('repo-modal').classList.add('hidden'));
  bind('btn-close-profile-modal', () => document.getElementById('profile-modal').classList.add('hidden'));

  bind('btn-restart-tour', () => {
    if (window.hideShortcutsOverlay) window.hideShortcutsOverlay();
    if (window.startTour) window.startTour();
  });

  bind('btn-sync', async () => {
    try {
      const btn = document.getElementById('btn-sync');
      const originalText = btn.textContent;
      btn.textContent = 'Syncing...';
      await fetch('/api/repos', { method: 'POST' });
      window.location.reload();
    } catch (e) {
      console.error(e);
    }
  });

  // Avatar / Name click → warp to own island + show profile
  const avatarWarp = async () => {
    const login = window.currentUserLogin;
    if (!login) return;
    try {
      const res = await fetch('/api/user/' + encodeURIComponent(login));
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      // Warp camera to own island
      if (typeof flyTo !== 'undefined') {
        flyTo(data.cx, data.cy, null);
      }

      // Build island object and show profile modal
      const island = {
        login: data.login,
        cx: data.cx,
        cy: data.cy,
        avatar: data.avatar,
        primaryLanguage: data.primaryLanguage,
        repoCount: data.repos.length,
        totalStars: data.repos.reduce((s, r) => s + (r.stars || 0), 0),
        buildings: data.repos,
        badges: typeof calculateBadges === 'function' ? calculateBadges(data.repos) : []
      };
      if (typeof showProfileModal === 'function') showProfileModal(island);
    } catch (e) {
      console.error('Avatar warp error:', e);
    }
  };
  bind('hud-avatar', avatarWarp);
  bind('hud-name', avatarWarp);
});

document.addEventListener('click', e => {
  const searchRes = e.target.closest('.search-result');
  if (searchRes) {
    const x = parseFloat(searchRes.getAttribute('data-x'));
    const y = parseFloat(searchRes.getAttribute('data-y'));
    const item = searchRes.getAttribute('data-item');
    if (window.flyTo) window.flyTo(x, y, decodeURIComponent(item));
    return;
  }

  const moreInfoBtn = e.target.closest('.btn-more-info');
  if (moreInfoBtn) {
    try {
      const item = JSON.parse(decodeURIComponent(moreInfoBtn.getAttribute('data-item')));
      if (window.openModalForItem) window.openModalForItem(item);
    } catch (err) {
      console.error('Failed to parse item data', err);
    }
  }

  // Close mobile menu if clicking outside
  const mobileMenu = document.getElementById('mobile-menu-dropdown');
  if (mobileMenu && !mobileMenu.classList.contains('hidden')) {
    if (!e.target.closest('#mobile-menu-dropdown') && !e.target.closest('#btn-mobile-menu')) {
      mobileMenu.classList.add('hidden');
    }
  }
});

// Global ESC Key Handler
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const hiddenElements = [
      'repo-modal', 'profile-modal', 'citizens-sidebar',
      'achievements-sidebar', 'shortcuts-overlay', 'mobile-menu-dropdown',
      'confirm-modal'
    ];
    hiddenElements.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
    // Clear text selection to prevent lag
    if (window.getSelection) {
      window.getSelection().removeAllRanges();
    }
    // Clear search and focus
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.value = '';
      searchInput.blur();
    }
    const searchResults = document.getElementById('search-results');
    if (searchResults) searchResults.innerHTML = '';
  }
});

window.showToast = function (msg, duration = 4000) {
  const toast = document.getElementById('toast-notification');
  if (!toast) return;
  toast.innerText = msg;
  toast.classList.remove('hidden');
  toast.style.opacity = '1';
  toast.style.transform = 'translate(-50%, 0)';

  clearTimeout(toast.timeoutId);
  toast.timeoutId = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translate(-50%, 20px)';
    setTimeout(() => toast.classList.add('hidden'), 300);
  }, duration);
};

// ── Achievement Tracker ────────────────────────────────
const ACHIEVEMENTS = [
  // Exploration Tier
  { id: 'first_flight', title: 'First Flight', desc: 'Use the search bar to warp to a repository.', icon: '🚀' },
  { id: 'architect', title: 'The Architect', desc: 'Inspect 10 different repositories.', icon: '🏛️' },
  { id: 'marathon', title: 'Space Marathon', desc: 'Travel 100,000 distance units.', icon: '🏃' },

  // Discovery Tier
  { id: 'sys_architect', title: 'The Systems Architect', desc: 'Inspect a C, C++, or Rust repository.', icon: '⚙️' },
  { id: 'ai_pioneer', title: 'The AI Pioneer', desc: 'Inspect a Python repository.', icon: '🧠' },
  { id: 'frontend_master', title: 'The Frontend Master', desc: 'Inspect a JavaScript, TypeScript, or HTML repository.', icon: '🎨' },
  { id: 'stargazer', title: 'Stargazer', desc: 'Inspect a repo with 1,000+ stars.', icon: '⭐' },
  { id: 'collector', title: 'The Collector', desc: 'Inspect a repo with 100,000+ KB size.', icon: '📦' },

  // Networking Tier
  { id: 'socialite', title: 'The Socialite', desc: 'Open the Citizens directory.', icon: '🤝' },
  { id: 'birds_of_feather', title: 'Birds of a Feather', desc: 'Visit an island with the same primary language as you.', icon: '🪶' },
  { id: 'mentor_seeker', title: 'The Mentor Seeker', desc: 'Visit an island with more than 50 repos.', icon: '🧙' },
  { id: 'cross_pollination', title: 'Cross-Pollination', desc: 'Visit 3 islands with different primary languages.', icon: '🐝' },

  // Personal Milestones Tier (auto-evaluated on login)
  { id: 'specialist', title: 'The Specialist', desc: 'Have 5+ repos in a single language.', icon: '🎯' },
  { id: 'os_contributor', title: 'Open Source Contributor', desc: 'Have a repo with at least 1 star.', icon: '🌟' },
  { id: 'polyglot', title: 'The Polyglot', desc: 'Have repos spanning 4+ languages.', icon: '🗣️' }
];

let unlockedAchievements = new Set();
let achievementsKey = 'gitspace_achievements_guest';

window.initAchievements = function (username) {
  achievementsKey = 'gitspace_achievements_' + (username || 'guest');
  try {
    const stored = localStorage.getItem(achievementsKey);
    if (stored) {
      unlockedAchievements = new Set(JSON.parse(stored));
    } else {
      unlockedAchievements = new Set();
    }
  } catch (e) {
    console.error("Failed to load achievements", e);
    unlockedAchievements = new Set();
  }
  renderAchievements();
};

window.unlockAchievement = function (id) {
  if (unlockedAchievements.has(id)) return;
  unlockedAchievements.add(id);
  localStorage.setItem(achievementsKey, JSON.stringify(Array.from(unlockedAchievements)));

  const ach = ACHIEVEMENTS.find(a => a.id === id);
  if (ach) {
    if (typeof showToast === 'function') {
      showToast(`🏆 ACHIEVEMENT UNLOCKED: ${ach.title.toUpperCase()} 🏆\n${ach.desc}`, 4000);

      // Play a quick celebration effect
      const toast = document.getElementById('toast-notification');
      if (toast) {
        toast.style.background = 'linear-gradient(135deg, rgba(251, 191, 36, 0.9), rgba(217, 119, 6, 0.9))';
        toast.style.color = '#fff';
        toast.style.boxShadow = '0 0 30px rgba(251, 191, 36, 0.5)';
        toast.style.transform = 'translate(-50%, 20px) scale(1.1)';

        setTimeout(() => {
          toast.style.background = '';
          toast.style.color = '';
          toast.style.boxShadow = '';
          toast.style.transform = '';
        }, 4000);
      }
    }
    renderAchievements();
  }
};

function renderAchievements() {
  const list = document.getElementById('achievements-list');
  if (!list) return;
  list.innerHTML = ACHIEVEMENTS.map(a => {
    const isUnlocked = unlockedAchievements.has(a.id);
    return `
      <div class="ach-item ${isUnlocked ? '' : 'locked'}">
        <div class="ach-icon">${a.icon}</div>
        <div class="ach-info">
          <h4>${a.title}</h4>
          <p>${a.desc}</p>
        </div>
      </div>
    `;
  }).join('');
}

window.toggleAchievements = function () {
  const sb = document.getElementById('achievements-sidebar');
  if (sb) {
    sb.classList.toggle('hidden');
    if (!sb.classList.contains('hidden')) {
      renderAchievements();
    }
  }
};

window.showResetConfirm = function() {
  document.getElementById('confirm-modal').classList.remove('hidden');
};

document.getElementById('btn-confirm-cancel').addEventListener('click', () => {
  document.getElementById('confirm-modal').classList.add('hidden');
});

document.getElementById('btn-confirm-reset').addEventListener('click', () => {
  const username = window.currentUserLogin || 'guest';
  localStorage.removeItem(`gitspace_achievements_${username}`);
  localStorage.removeItem(`gitspace_distance_${username}`);
  if (typeof totalDistanceTravelled !== 'undefined') {
    totalDistanceTravelled = 0;
  }
  unlockedAchievements.clear();
  window.renderAchievements();
  document.getElementById('confirm-modal').classList.add('hidden');
  showToast('Achievements have been reset');
  setTimeout(() => window.location.reload(), 1000);
});