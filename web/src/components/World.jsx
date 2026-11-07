// Everything that sits over the live map: top bar, menu, ship ring, speed, readout, arrival title, onboarding.
import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Avatar, Box, Button, Divider, IconButton, ListItemText, Menu, MenuItem, Popover, Slider, Tooltip, useMediaQuery } from '@mui/material';
import { t } from '../theme.js';
import { animate, createTimeline, reduced, stagger } from '../motion.js';
import { avatarUrl, fmt, plural, shipScreenPos } from '../lib.js';
import SearchBox from './SearchBox.jsx';

const Icon = ({ d, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
);
const icons = {
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  map: <><path d="M9 4 3 6.5v13.5L9 17.5l6 2.5 6-2.5V4l-6 2.5z" /><path d="M9 4v13.5M15 6.5V20" /></>,
  speed: <><path d="M4 16a8 8 0 1 1 16 0" /><path d="m12 16 4-5" /></>,
  home: <path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z" />,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
};

/* ---------- Top bar ---------- */

export const TopBar = forwardRef(function TopBar({ user, guest, onPick, onMenu }, searchRef) {
  const narrow = useMediaQuery('(max-width:599px)');
  return (
    <Box component="header" sx={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1100, height: 56, px: { xs: 1.5, sm: 2.5 },
      display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 2 }, bgcolor: t.surface, borderBottom: `1px solid ${t.line}`,
    }}>
      <Box sx={{ fontWeight: 700, fontSize: 16, letterSpacing: '-0.01em', flex: { sm: '0 0 180px' }, display: { xs: narrow ? 'none' : 'block' } }}>GitSpace</Box>
      <Box sx={{ flex: 1, display: 'flex', justifyContent: 'center', minWidth: 0 }}>
        <SearchBox ref={searchRef} onPick={onPick} />
      </Box>
      <Box sx={{ flex: { sm: '0 0 180px' }, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 1 }}>
        {user ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }} title={`Signed in as ${user.login}`}>
            <Avatar variant="rounded" src={avatarUrl(user.avatar_url || user.avatar, user.login)} alt="" sx={{ width: 26, height: 26, borderRadius: '6px' }} />
            {!narrow && <Box sx={{ fontSize: 14, fontWeight: 500, maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.login}</Box>}
          </Box>
        ) : guest && <Button variant="contained" size="small" href="/auth/github" sx={{ whiteSpace: 'nowrap' }}>Sign in</Button>}
        <IconButton onClick={e => onMenu(e.currentTarget)} aria-label="Menu" aria-haspopup="menu"><Icon d={icons.menu} /></IconButton>
      </Box>
    </Box>
  );
});

/* ---------- Main menu (top bar and the ring's "More") ----------
   Menu and speed popover anchor to a rect, not an element: the ring button that opened them unmounts when the ring closes. */

export function MainMenu({ anchor, onClose, onAction, user }) {
  const item = (key, label, hint) => (
    <MenuItem key={key} onClick={() => { onClose(); onAction(key); }}>
      <ListItemText primary={label} slotProps={{ primary: { fontSize: 14 } }} />
      {hint && <Box component="kbd" className="num" sx={{ fontSize: 11, color: t.faint }}>{hint}</Box>}
    </MenuItem>
  );
  return (
    <Menu anchorReference="anchorPosition" anchorPosition={anchor ? { top: anchor.bottom, left: anchor.right } : undefined} open={!!anchor} onClose={onClose}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
      <Box sx={{ px: 1.5, pt: 1, pb: 1.25, display: 'flex', alignItems: 'center', gap: 1.25 }}>
        {user && <Avatar variant="rounded" src={avatarUrl(user.avatar_url || user.avatar, user.login)} alt="" sx={{ width: 28, height: 28, borderRadius: '6px' }} />}
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ fontSize: 14, fontWeight: 500 }}>{user ? user.login : 'Exploring as a guest'}</Box>
          {!user && <Box sx={{ fontSize: 12, color: t.muted }}>You can open one developer</Box>}
        </Box>
      </Box>
      <Divider sx={{ my: 0.5 }} />
      {[
        item('home', user ? 'My island' : 'Get my island'),
        item('map', 'Map', 'M'),
        item('speed', 'Ship speed'),
      ]}
      <Divider sx={{ my: 0.5 }} />
      {[
        item('citizens', 'Citizens'),
        item('review', 'Review a repo', 'R'),
        item('shortcuts', 'Keyboard shortcuts', 'H'),
        item('screenshot', 'Screenshot', 'P'),
        user && item('sync', 'Refresh my island'),
      ]}
      <Divider sx={{ my: 0.5 }} />
      {[
        item('howto', 'How it works'),
        item('privacy', 'Privacy'),
        item('auth', user ? 'Sign out' : 'Sign in with GitHub'),
      ]}
    </Menu>
  );
}

/* ---------- Ship speed ---------- */

const SPEED_KEY = 'gitspace_speed';
export function readSpeed() {
  let v = 1;
  try { v = Number(localStorage.getItem(SPEED_KEY)) || 1; } catch (e) { }
  return Math.min(3, Math.max(0.5, v));
}
export function SpeedPopover({ anchor, onClose }) {
  const [v, setV] = useState(readSpeed);
  const set = (e, n) => {
    setV(n);
    window.speedMultiplier = n;
    try { localStorage.setItem(SPEED_KEY, String(n)); } catch (err) { }
  };
  return (
    <Popover open={!!anchor} anchorReference="anchorPosition" anchorPosition={anchor ? { top: anchor.bottom, left: anchor.left + anchor.width / 2 } : undefined} onClose={onClose}
      transformOrigin={{ vertical: 'top', horizontal: 'center' }}
      slotProps={{ paper: { sx: { p: 2, pb: 1.5, width: 260, borderRadius: '10px', mt: 1 } } }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Box id="speed-label" sx={{ fontSize: 14, fontWeight: 500 }}>Ship speed</Box>
        <Box className="num" sx={{ fontSize: 13 }}>{v}x</Box>
      </Box>
      <Slider value={v} min={0.5} max={3} step={0.25} onChange={set} aria-labelledby="speed-label" valueLabelDisplay="off" slotProps={{ input: { autoFocus: true } }}
        sx={{ mt: 1, color: t.accent, '& .MuiSlider-thumb': { width: 14, height: 14, boxShadow: 'none !important' }, '& .MuiSlider-rail': { opacity: 1, bgcolor: t.line } }} />
      <Box sx={{ fontSize: 12, color: t.muted }}>Hold Shift for a boost.</Box>
    </Popover>
  );
}

/* ---------- Ship ring: Space or click the ship ---------- */

export function ShipRing({ open, guest, onClose, onAction }) {
  const box = useRef(null);
  const buttons = useRef([]);
  const items = [
    ['search', 'Search', icons.search],
    ['map', 'Map', icons.map],
    ['speed', 'Ship speed', icons.speed],
    ['home', guest ? 'Get my island' : 'My island', icons.home],
    ['more', 'More', icons.more],
  ];

  // Follow the ship every frame while open.
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const follow = () => {
      const p = shipScreenPos();
      if (box.current) box.current.style.transform = `translate(${p.x}px, ${p.y}px)`;
      raf = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const els = buttons.current.filter(Boolean);
    if (!reduced()) animate(els, { scale: { from: 0.4 }, opacity: { from: 0 }, delay: stagger(30), duration: 420, ease: 'outBack(1.6)' });
    els[0]?.focus();
  }, [open]);

  if (!open) return null;
  const radius = window.innerWidth < 640 ? 68 : 78;
  const onKey = e => {
    const i = buttons.current.indexOf(document.activeElement);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Tab: e.shiftKey ? -1 : 1 }[e.key];
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    else if (step) { e.preventDefault(); e.stopPropagation(); buttons.current[(i + step + items.length) % items.length]?.focus(); }
    else if (['w', 'a', 's', 'd'].includes(e.key.toLowerCase())) onClose(); // flying away closes it; the key still reaches the ship
  };
  return (
    <Box ref={box} role="toolbar" aria-label="Ship controls" onKeyDown={onKey}
      sx={{ position: 'fixed', left: 0, top: 0, zIndex: 1050, width: 0, height: 0 }}>
      {items.map(([key, label, d], i) => {
        const a = (-90 + i * 360 / items.length) * Math.PI / 180;
        return (
          <Tooltip key={key} title={label} placement={Math.cos(a) > 0.3 ? 'right' : Math.cos(a) < -0.3 ? 'left' : Math.sin(a) < 0 ? 'top' : 'bottom'}>
            <IconButton ref={el => { buttons.current[i] = el; }} aria-label={label} data-ring={key}
              onClick={e => onAction(key, e.currentTarget)}
              sx={{
                position: 'absolute', left: Math.round(Math.cos(a) * radius) - 20, top: Math.round(Math.sin(a) * radius) - 20,
                width: 40, height: 40, borderRadius: '50%', bgcolor: t.surface, border: `1px solid ${t.lineStrong}`,
                '&:hover': { bgcolor: t.raised }, '&:focus-visible': { outline: `2px solid ${t.text}`, outlineOffset: 2 },
              }}>
              <Icon d={d} />
            </IconButton>
          </Tooltip>
        );
      })}
    </Box>
  );
}

/* ---------- Bottom-left readout ---------- */

export function Readout() {
  const [s, setS] = useState({ island: null, x: 0, y: 0 });
  useEffect(() => {
    const id = setInterval(() => {
      const h = window.gsHud;
      if (h) setS(p => (p.island === h.island && p.x === h.x && p.y === h.y ? p : { ...h }));
    }, 200);
    return () => clearInterval(id);
  }, []);
  return (
    <Box aria-hidden sx={{
      position: 'fixed', left: { xs: 12, sm: 20 }, bottom: { xs: 72, sm: 20 }, zIndex: 1000, px: 1.5, py: 1,
      bgcolor: t.surface, border: `1px solid ${t.line}`, borderRadius: '8px', pointerEvents: 'none',
    }}>
      <Box sx={{ fontSize: 13, fontWeight: 500 }}>{s.island ? `${s.island}'s island` : 'Open sky'}</Box>
      <Box className="num" sx={{ fontSize: 11, color: t.muted }}>{fmt(s.x)}, {fmt(s.y)}</Box>
    </Box>
  );
}

/* ---------- Arrival title card (render.js fires gs:arrival) ---------- */

export function ArrivalCard() {
  const [info, setInfo] = useState(null);
  const box = useRef(null);
  useEffect(() => {
    const on = e => setInfo({ ...e.detail, key: performance.now() });
    window.addEventListener('gs:arrival', on);
    return () => window.removeEventListener('gs:arrival', on);
  }, []);
  useLayoutEffect(() => {
    if (!info || !box.current) return;
    const parts = [...box.current.children];
    if (reduced()) {
      const id = setTimeout(() => setInfo(null), 2800);
      return () => clearTimeout(id);
    }
    const tl = createTimeline({ onComplete: () => setInfo(null) })
      .add(parts, { opacity: { from: 0 }, translateY: { from: 12 }, delay: stagger(90), duration: 600, ease: 'outExpo' })
      .add(parts, { opacity: 0, translateY: -6, delay: stagger(40), duration: 380, ease: 'inQuad' }, '+=1500');
    return () => tl.pause();
  }, [info]);
  if (!info) return null;
  return (
    <Box ref={box} key={info.key} role="status" sx={{
      position: 'fixed', left: 0, right: 0, top: '18vh', zIndex: 1000, textAlign: 'center', pointerEvents: 'none', px: 2,
    }}>
      <Box sx={{ fontSize: 14, color: 'rgba(255,255,255,.75)' }}>Arriving at</Box>
      <Box sx={{ fontSize: { xs: 34, sm: 48 }, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.1, mt: 0.5 }}>{info.login}</Box>
      <Box className="num" sx={{ fontSize: 13, color: 'rgba(255,255,255,.75)', mt: 1 }}>
        {plural(info.repoCount || 0, 'repo', 'repos')}   {plural(info.totalStars || 0, 'star', 'stars')}
      </Box>
    </Box>
  );
}

/* ---------- One onboarding card after the first sign-in ---------- */

export function Onboarding({ onDone }) {
  const box = useRef(null);
  useLayoutEffect(() => {
    if (!reduced()) animate(box.current, { opacity: { from: 0 }, translateY: { from: 16 }, duration: 600, delay: 400, ease: 'outExpo' });
  }, []);
  return (
    <Box ref={box} role="dialog" aria-label="Welcome" sx={{
      position: 'fixed', left: 0, right: 0, mx: 'auto', bottom: { xs: 140, sm: 32 }, zIndex: 1000,
      width: 'min(400px, calc(100% - 32px))', p: 2.5, bgcolor: t.surface, border: `1px solid ${t.lineStrong}`, borderRadius: '12px',
    }}>
      <Box component="p" sx={{ m: 0, fontSize: 15, lineHeight: 1.55 }}>
        This is your island. Each building is one of your projects. Click one to open it, or search to visit anyone.
      </Box>
      <Button variant="contained" onClick={onDone} sx={{ mt: 2 }} autoFocus>Got it</Button>
    </Box>
  );
}
