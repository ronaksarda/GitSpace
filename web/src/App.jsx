// The UI shell over the canvas engine. Boot state comes from public/js/init.js (window.gs + 'gs:change').
// The engine calls back into the UI through window.openModalForItem / showProfileModal / showToast / toggleShortcuts.
import { useEffect, useRef, useState } from 'react';
import { Box, Snackbar } from '@mui/material';
import { t } from './theme.js';
import { getJSON, islandByLogin, shipScreenPos, toast, world } from './lib.js';
import FrontPage from './components/FrontPage.jsx';
import DeveloperCard from './components/DeveloperCard.jsx';
import RepoCard from './components/RepoCard.jsx';
import { Citizens, ErrorDialog, GuestGate, ReviewDialog, Shortcuts } from './components/Dialogs.jsx';
import { ArrivalCard, MainMenu, Onboarding, Readout, ShipRing, SpeedPopover, TopBar, readSpeed } from './components/World.jsx';

const PEEK_KEY = 'gitspace_guest_peek';
const ONBOARD_KEY = 'gitspace_onboarded';
// Letters with their own shortcut (fly, review, screenshot, fps, help, map) never start a search.
const RESERVED = new Set(['w', 'a', 's', 'd', 'r', 'p', 'f', 'h', 'm']);
const flyParam = new URLSearchParams(window.location.search).get('fly');

const store = (kind, key, value) => {
  try { return value === undefined ? window[kind].getItem(key) : window[kind].setItem(key, value); } catch (e) { return null; }
};

export default function App() {
  const [gs, setGs] = useState(() => ({ ...window.gs }));
  const [view, setView] = useState('boot'); // boot | front | world
  const [guest, setGuest] = useState(false);
  const [dev, setDev] = useState(null);
  const [repo, setRepo] = useState(null);
  const [review, setReview] = useState(false);
  const [citizens, setCitizens] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [gate, setGate] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [speedAnchor, setSpeedAnchor] = useState(null);
  const [ring, setRing] = useState(false);
  const [onboard, setOnboard] = useState(false);
  const [snack, setSnack] = useState(null);
  const search = useRef(null);
  const user = gs.user;

  useEffect(() => {
    window.speedMultiplier = readSpeed();
    const sync = () => setGs({ ...window.gs });
    window.addEventListener('gs:change', sync);
    sync();
    return () => window.removeEventListener('gs:change', sync);
  }, []);

  const startGuest = () => {
    window.stopAttractMode?.();
    window.startGuestExplore?.();
    window.isGuest = true;
    setGuest(true);
    setView('world');
  };

  // Signed-in people never see the front page on load; a shared ?fly= link drops visitors straight onto the map.
  useEffect(() => {
    if (!gs.authChecked) return;
    if (view === 'boot') {
      if (user) setView('world');
      else if (flyParam) startGuest();
      else setView('front');
    } else if (view === 'world' && !user && !guest) setView('front'); // session expired during boot
  }, [gs.authChecked, user, view, guest]);

  // Open the shared developer once the map is ready.
  useEffect(() => {
    if (gs.ready && flyParam && view === 'world') window.openModalForItem({ type: 'user', login: flyParam });
  }, [gs.ready, view === 'world']);

  useEffect(() => {
    if (gs.ready && user && view === 'world' && store('localStorage', ONBOARD_KEY) !== '1') setOnboard(true);
  }, [gs.ready, user, view]);

  const anyPanel = !!(dev || repo || review || citizens || shortcuts || gate || menuAnchor || speedAnchor || gs.error);
  window.gsFrontPage = view !== 'world';
  window.gsModalOpen = anyPanel || view !== 'world';

  const closeAll = () => { setDev(null); setRepo(null); setReview(false); setCitizens(false); setRing(false); };

  const guestMayOpen = login => {
    if (!guest || !login) return true;
    const peek = store('sessionStorage', PEEK_KEY);
    if (!peek) { store('sessionStorage', PEEK_KEY, login); return true; }
    if (peek === login) return true;
    setGate(true);
    return false;
  };

  const showProfile = island => {
    if (!island || !guestMayOpen(island.login)) return;
    closeAll();
    setDev(island);
  };

  const openItem = item => {
    if (!item) return;
    if (item.type === 'repo') {
      if (!guestMayOpen(item.login || item.owner)) return;
      closeAll();
      setRepo({ ...item, login: item.login || item.owner || '' });
      return;
    }
    const island = islandByLogin(item.login);
    if (island) return showProfile(island);
    if (!guestMayOpen(item.login)) return;
    getJSON('/api/user/' + encodeURIComponent(item.login))
      .then(u => showProfile({
        login: u.login, cx: u.cx, cy: u.cy, avatar: u.avatar, primaryLanguage: u.primaryLanguage,
        repoCount: u.repos.length, totalStars: u.repos.reduce((s, r) => s + (r.stars || 0), 0), buildings: u.repos,
      }))
      .catch(() => showProfile({ login: item.login, cx: item.x, cy: item.y, avatar: item.avatar, repoCount: item.repoCount || 0, totalStars: item.totalStars || 0, buildings: [] }));
  };

  const flyHome = () => {
    if (!user) { window.location.href = '/auth/github'; return; }
    getJSON('/api/user/' + encodeURIComponent(user.login))
      .then(d => { window.flyTo(d.cx, d.cy, null); toast('Flying home'); })
      .catch(() => toast('Could not find your island. Try again in a moment.'));
  };

  const findRepo = r => {
    closeAll();
    getJSON('/api/search?q=' + encodeURIComponent(r.name))
      .then(matches => {
        const lc = s => String(s || '').toLowerCase();
        const m = Array.isArray(matches) && matches.find(x => x.type === 'repo' && lc(x.name) === lc(r.name) && (!r.owner || lc(x.login) === lc(r.owner)));
        if (m && typeof m.x === 'number') { window.flyTo(m.x, m.y, null); toast('Flying to ' + r.name); }
        else toast(r.name + ' is not on the map yet');
      })
      .catch(() => toast('Could not search the map. Try again.'));
  };

  const syncIsland = async () => {
    toast('Refreshing your island');
    try { await fetch('/api/repos', { method: 'POST' }); window.location.reload(); }
    catch (e) { toast('Could not refresh your island. Try again.'); }
  };

  const onAction = (key, anchorEl) => {
    const anchor = (anchorEl || document.querySelector('header [aria-label="Menu"]'))?.getBoundingClientRect();
    setRing(false);
    if (key === 'search') return search.current?.focus('');
    if (key === 'home') return flyHome();
    if (key === 'map') { window.mapExpanded = true; return; }
    if (key === 'speed') return setSpeedAnchor(anchor);
    if (key === 'more') return setMenuAnchor(anchor);
    if (key === 'citizens') return setCitizens(true);
    if (key === 'review') return setReview(true);
    if (key === 'shortcuts') return setShortcuts(true);
    if (key === 'screenshot') return setTimeout(() => window.captureScreenshot?.(), 250);
    if (key === 'sync') return syncIsland();
    if (key === 'howto') { closeAll(); return setView('front'); }
    if (key === 'privacy') { window.location.href = '/privacy.html'; return; }
    if (key === 'auth') window.location.href = user ? '/auth/logout' : '/auth/github';
  };

  // Hooks the engine (input.js, engine.js, render.js) calls. Reassigned every render so they see current state.
  useEffect(() => {
    window.openModalForItem = openItem;
    window.showProfileModal = showProfile;
    window.toggleShortcuts = () => setShortcuts(v => !v);
    window.showToast = msg => setSnack({ msg, key: performance.now() });
    window.showOnboarding = () => setOnboard(true);
    window.openWhereTo = seed => search.current?.focus(seed || '');
  });

  // Space toggles the ring, "/" or typing a name searches, R reviews a repo; clicking the ship toggles the ring.
  const inWorld = view === 'world' && gs.ready;
  useEffect(() => {
    if (!inWorld) return;
    const onKey = e => {
      if (window.gsModalOpen || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest?.('input, textarea, [contenteditable], [role="toolbar"], [role="dialog"], [role="menu"]')) return;
      const k = e.key.toLowerCase();
      if (e.key === ' ') { e.preventDefault(); setRing(v => !v); }
      else if (e.key === '/') { e.preventDefault(); search.current?.focus(''); }
      else if (k === 'r') { e.preventDefault(); setRing(false); setReview(true); }
      else if (/^[a-z0-9]$/i.test(e.key) && !RESERVED.has(k)) { e.preventDefault(); setRing(false); search.current?.focus(e.key); }
    };
    const nearShip = (x, y) => { const p = shipScreenPos(); return Math.hypot(x - p.x, y - p.y) < 30; };
    const onUp = e => {
      if (e.button !== 0 || e.target !== world().canvas || !nearShip(e.clientX, e.clientY)) return;
      e.stopPropagation(); // the ship sits on top of buildings; this click is for the ring
      setRing(v => !v);
    };
    let touchStart = null;
    const onTouchStart = e => { touchStart = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; };
    const onTouchEnd = e => {
      if (e.target !== world().canvas || !touchStart || e.changedTouches.length !== 1) return;
      const p = e.changedTouches[0];
      if (Math.hypot(p.clientX - touchStart.x, p.clientY - touchStart.y) > 8 || !nearShip(p.clientX, p.clientY)) return;
      e.stopPropagation();
      window.isDragging = false; // input.js would have reset its drag state in its own touchend
      window.touchJoystick = null;
      setRing(v => !v);
    };
    const onDown = e => { if (!e.target.closest('[role="toolbar"], .MuiPopover-root, .MuiTooltip-popper') && e.target !== world().canvas) setRing(false); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mouseup', onUp, true);
    window.addEventListener('touchstart', onTouchStart, true);
    window.addEventListener('touchend', onTouchEnd, true);
    document.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mouseup', onUp, true);
      window.removeEventListener('touchstart', onTouchStart, true);
      window.removeEventListener('touchend', onTouchEnd, true);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [inWorld]);

  return (
    <>
      {view === 'world' && (
        <>
          <TopBar ref={search} user={user} guest={guest} onPick={m => window.flyTo(m.x, m.y, m)}
            onMenu={el => setMenuAnchor(el.getBoundingClientRect())} />
          <Readout />
          <ArrivalCard />
          <ShipRing open={ring && inWorld} guest={!user} onClose={() => setRing(false)} onAction={onAction} />
          {onboard && <Onboarding onDone={() => { store('localStorage', ONBOARD_KEY, '1'); setOnboard(false); }} />}
        </>
      )}
      <MainMenu anchor={menuAnchor} onClose={() => setMenuAnchor(null)} onAction={k => onAction(k)} user={user} />
      <SpeedPopover anchor={speedAnchor} onClose={() => setSpeedAnchor(null)} />

      <DeveloperCard island={dev} onClose={() => setDev(null)}
        onOpenRepo={b => { setDev(null); window.flyTo(b.x, b.y, b); }} />
      <RepoCard item={repo} onClose={() => setRepo(null)} onFind={findRepo}
        onOpenOwner={login => { setRepo(null); openItem({ type: 'user', login }); }} />
      <ReviewDialog open={review} onClose={() => setReview(false)} onFind={findRepo} />
      <Citizens open={citizens} onClose={() => setCitizens(false)} onOpen={item => { setCitizens(false); openItem(item); }} />
      <Shortcuts open={shortcuts} onClose={() => setShortcuts(false)} />
      <GuestGate open={gate} onClose={() => setGate(false)} peek={store('sessionStorage', PEEK_KEY)} />
      <ErrorDialog message={gs.error} />

      {view === 'front' && <FrontPage signedIn={!!user} stats={gs.stats} onExplore={startGuest} onClose={() => setView('world')} />}
      {(view === 'boot' || (view === 'world' && !gs.ready)) && (
        <Box role="status" sx={{ position: 'fixed', inset: 0, zIndex: 1250, bgcolor: t.bg, display: 'grid', placeItems: 'center' }}>
          <Box sx={{ textAlign: 'center' }}>
            <Box sx={{ fontWeight: 700, fontSize: 18 }}>GitSpace</Box>
            <Box sx={{ mt: 0.5, fontSize: 14, color: t.muted }}>Loading the map</Box>
          </Box>
        </Box>
      )}

      <Snackbar key={snack?.key} open={!!snack} message={snack?.msg} autoHideDuration={3500} onClose={(e, r) => r !== 'clickaway' && setSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </>
  );
}
