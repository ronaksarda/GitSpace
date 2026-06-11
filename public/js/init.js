// ── Global Error Boundary (Feature 14) ────────────────
window.onerror = function(msg, src, line, col, err) {
  const errorScreen = document.getElementById('error-screen');
  if (errorScreen) {
    document.getElementById('error-message').textContent = msg || 'An unexpected error occurred';
    errorScreen.classList.remove('hidden');
  }
  return false;
};

window.addEventListener('unhandledrejection', event => {
  console.error('Unhandled promise rejection:', event.reason);
});

// ── Load world data and start ─────────────────────────
async function init() {
  const loadFill = document.getElementById('loadfill');
  const loading = document.getElementById('loading');
  const loginScreen = document.getElementById('login-screen');
  const hud = document.getElementById('hud');

  try {
    loadFill.style.width = '20%';
    let user = null;
    try {
      const res = await fetch('/api/me');
      user = await res.json();
    } catch (e) { }

    loadFill.style.width = '50%';
    async function updateStats() {
      try {
        const res = await fetch('/api/stats');
        worldData = await res.json();
        const usersEl = document.getElementById('hud-users');
        const reposEl = document.getElementById('hud-repos');
        if (usersEl) usersEl.textContent = (worldData.totalUsers || 0) + ' Developers';
        if (reposEl) reposEl.textContent = (worldData.totalRepos || 0) + ' Repositories';
      } catch (e) { }
    }
    await updateStats();

    loadFill.style.width = '80%';

    // Fetch exact spawn point
    try {
      const spawnRes = await fetch('/api/spawn');
      const spawnData = await spawnRes.json();
      player.x = spawnData.x ?? 2000;
      player.y = spawnData.y ?? 2000;
      camera.x = player.x;
      camera.y = player.y;
    } catch (e) { }

    // Start with center chunk
    await checkChunks();

    loadFill.style.width = '100%';
    setTimeout(() => { loading.classList.add('hidden'); }, 400);

    document.getElementById('hud-users').textContent = (worldData.totalUsers || 0) + ' Developers';
    document.getElementById('hud-repos').textContent = (worldData.totalRepos || 0) + ' Repositories';

    if (user && user.authenticated) {
      loginScreen.classList.add('hidden');
      hud.style.display = 'block';
      document.getElementById('hud-avatar').style.display = 'inline-block';
      document.getElementById('btn-logout').style.display = 'inline-block';
      document.getElementById('hud-avatar').src = user.avatar_url || user.avatar || `https://github.com/identicons/${user.login || user.name}.png`;
      document.getElementById('hud-name').textContent = user.login || user.name;
      window.currentUserLogin = user.login;
      
      if (window.initAchievements) window.initAchievements(user.login || user.name);
      if (window.initDistance) window.initDistance(user.login || user.name);

      const btnSync = document.getElementById('btn-sync');
      if (btnSync) {
        btnSync.style.display = (user.login === 'Guest Explorer' || user.token === 'mock_token') ? 'none' : 'inline-block';
      }

      try {
        const repoRes = await fetch('/api/repos');
        const repoData = await repoRes.json();
        if (repoData.authenticated === false) {
          console.warn('Session expired, falling back to guest mode');
          user = null;
          hud.style.display = 'none';
          loginScreen.classList.remove('hidden');
        } else if (repoData.success && repoData.repos && window.unlockAchievement) {
          // Spawn player at their island
          player.x = repoData.cx;
          player.y = repoData.cy;
          camera.x = player.x;
          camera.y = player.y;

          // Evaluate Personal Milestones based on real GitHub data
          const myRepos = repoData.repos;
          const langs = {};
          let maxLangCount = 0;
          let hasStarred = false;
          window.myPrimaryLanguage = null;
          
          for (const r of myRepos) {
            if (r.language) {
              langs[r.language] = (langs[r.language] || 0) + 1;
              if (langs[r.language] > maxLangCount) {
                maxLangCount = langs[r.language];
                window.myPrimaryLanguage = r.language;
              }
            }
            if ((r.stars || 0) > 0) hasStarred = true;
          }
          
          const uniqueLangs = Object.keys(langs).length;
          if (maxLangCount >= 5) window.unlockAchievement('specialist');
          if (hasStarred) window.unlockAchievement('os_contributor');
          if (uniqueLangs >= 4) window.unlockAchievement('polyglot');
          
          if (typeof loadedChunks !== 'undefined') loadedChunks.clear();
          if (typeof islands !== 'undefined') islands.length = 0;
          
          // Refresh stats now that our island is in the database!
          updateStats();
        } else if (repoData.success) {
          // No repos but still logged in - spawn at island
          player.x = repoData.cx;
          player.y = repoData.cy;
          camera.x = player.x;
          camera.y = player.y;
          
          if (typeof loadedChunks !== 'undefined') loadedChunks.clear();
          if (typeof islands !== 'undefined') islands.length = 0;
          
          // Refresh stats
          updateStats();
        }
      } catch (e) {
        console.error('Failed to pre-fetch repos:', e);
      }

      currentUser = user;

      // Init onboarding tour after everything is loaded and authenticated
      if (typeof initTour === 'function') {
        initTour();
      }
    } else {
      hud.style.display = 'none';
      if (window.initAchievements) window.initAchievements('guest');
      if (window.initDistance) window.initDistance('guest');
    }

    // Handle ?fly= param
    const params = new URLSearchParams(window.location.search);
    const flyToLogin = params.get('fly');
    if (flyToLogin) {
      try {
        const sRes = await fetch('/api/search?q=' + flyToLogin);
        const matches = await sRes.json();
        const target = matches.find(m => m.login === flyToLogin);
        if (target) {
          player.x = target.x || target.cx;
          player.y = target.y || target.cy;
          camera.x = player.x;
          camera.y = player.y;
          if (user && user.authenticated) {
            loginScreen.classList.add('hidden');
            hud.style.display = 'block';
          }
        }
      } catch (e) { }
    }

    // Poll stats every 30 seconds to keep live count updated
    setInterval(updateStats, 30000);

    gameLoop();

  } catch (fatalError) {
    console.error('Fatal initialization error:', fatalError);
    const errorScreen = document.getElementById('error-screen');
    if (errorScreen) {
      document.getElementById('error-message').textContent = fatalError.message || 'Failed to initialize';
      errorScreen.classList.remove('hidden');
    }
    loading.classList.add('hidden');
  }
}

init();
