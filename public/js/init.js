// Boot: session, stats, spawn point, first chunks, then the game loop.
// The React UI (public/app) reads window.gs and listens for 'gs:change'; it can mount before or after this finishes.
window.gs = { authChecked: false, user: null, stats: { totalUsers: 0, totalRepos: 0 }, ready: false, error: null };
function setGs(patch) {
  Object.assign(window.gs, patch);
  window.dispatchEvent(new CustomEvent('gs:change'));
}

window.onerror = function (msg) {
  setGs({ error: String(msg || 'An unexpected error occurred') });
  return false;
};

window.addEventListener('unhandledrejection', event => {
  console.error('Unhandled promise rejection:', event.reason);
});

async function updateStats() {
  try {
    const res = await fetch('/api/stats');
    worldData = await res.json();
    setGs({ stats: { totalUsers: worldData.totalUsers || 0, totalRepos: worldData.totalRepos || 0 } });
  } catch (e) { }
}

async function init() {
  try {
    let user = null;
    try {
      const res = await fetch('/api/me');
      user = await res.json();
    } catch (e) { }
    // Decide signed-in vs signed-out before anything is shown, so signed-in people never see the front page.
    if (user && user.authenticated) window.currentUserLogin = user.login;
    else user = null;
    window.authChecked = true;
    setGs({ authChecked: true, user });

    await updateStats();

    try {
      const spawnData = await (await fetch('/api/spawn')).json();
      player.x = spawnData.x ?? 2000;
      player.y = spawnData.y ?? 2000;
      camera.x = player.x;
      camera.y = player.y;
    } catch (e) { }

    await checkChunks();

    if (user) {
      try {
        const repoData = await (await fetch('/api/repos')).json();
        if (repoData.authenticated === false) {
          console.warn('Session expired, falling back to signed out');
          window.currentUserLogin = null;
          user = null;
          setGs({ user: null });
        } else if (repoData.success) {
          player.x = repoData.cx;
          player.y = repoData.cy;
          camera.x = player.x;
          camera.y = player.y;
          loadedChunks.clear();
          islands.length = 0;
          updateStats();
        }
      } catch (e) {
        console.error('Failed to pre-fetch repos:', e);
      }
      currentUser = user;
    }

    const flyToLogin = new URLSearchParams(window.location.search).get('fly');
    if (flyToLogin) {
      try {
        const matches = await (await fetch('/api/search?q=' + encodeURIComponent(flyToLogin))).json();
        const target = matches.find(m => m.login === flyToLogin);
        if (target) {
          player.x = target.x || target.cx;
          player.y = target.y || target.cy;
          camera.x = player.x;
          camera.y = player.y;
        }
      } catch (e) { }
    }

    setInterval(updateStats, 30000);
    gameLoop();
    setGs({ ready: true });
  } catch (fatalError) {
    console.error('Fatal initialization error:', fatalError);
    setGs({ error: fatalError.message || 'Failed to initialize', ready: true });
  }
}

init();
