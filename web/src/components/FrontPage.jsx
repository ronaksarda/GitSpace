// Front page for signed-out visitors (and "How it works" from the menu).
// Opaque, on the same black sky as the world. The hero is the product itself: a real island, and a box to build anyone's.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Box, Button, InputAdornment, OutlinedInput } from '@mui/material';
import { t } from '../theme.js';
import { animate, createTimeline, reduced, stagger, utils, Count } from '../motion.js';
import { getJSON } from '../lib.js';
import { Brand } from './common.jsx';
import FrontSky from './FrontSky.jsx';
import { Compare, Postcards, getUser, toIsland } from './FrontExamples.jsx';

const STEPS = [
  { when: 'Right away', title: 'Sign in with GitHub', body: 'We read your public repos and profile. Nothing private, and we never post anything for you.' },
  { when: 'A few seconds later', title: 'Your island appears', body: 'Each public repo becomes a building. The more stars a repo has, the taller it stands.' },
  { when: 'Any time', title: 'Visit anyone', body: 'Search a developer or a repo and fly there. Open a building to read the repo and run a health check on it.' },
  { when: 'Any time', title: 'Share yours', body: 'Download a postcard of your island, or copy a link that flies people straight to it.' },
  { when: 'When you ship', title: 'Your island grows', body: 'Refresh your island after you publish something. New repos show up as new buildings.' },
  { when: 'Not built yet', title: 'Your first open-source PR', body: 'Beginner-friendly issues in the languages you already use, with a plain note on where to start.', soon: true },
  { when: 'Not built yet', title: 'People like you', body: 'Developers from your city or college, or who build with the same tools.', soon: true },
];
const HEADLINE = ['Every GitHub', 'account is', 'an island.'];
const LOGIN_RE = /^[a-z\d](?:[a-z\d-]{0,38})$/i;
const EXAMPLE = 'ronaksarda'; // the owner's account; no other person's island is shown unprompted
const FIT = 3; // the island stands above its centre, so less than ~2.9 crops the top

const wrap = { width: '100%', maxWidth: 1200, mx: 'auto', px: { xs: 2, sm: 4 } };

function previewError(e) {
  if (e.status === 429) return 'Too many lookups from here. Wait a minute and try again.';
  if (e.status && e.message && !e.message.startsWith('Status')) return e.message; // the server's own plain message (400, 404, 503, 502)
  return 'Could not build that island. Check your connection and try again.';
}

export default function FrontPage({ signedIn, stats, onExplore, onClose }) {
  const root = useRef(null);
  const rail = useRef(null);
  const fill = useRef(null);
  const stage = useRef(null);
  const shownIsland = useRef(null);
  const riseToken = useRef(0);

  const [example, setExample] = useState(null); // the owner's own account, the only example shown
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shown, setShown] = useState(null); // { login, onMap, x, y, projects, stars, lang, of }

  const go = (x, y) => { if (signedIn) onClose(); else onExplore(); window.flyTo(x, y, null); };

  // Privacy: the page only ever shows the owner's island until a visitor types a name themselves.
  useEffect(() => {
    getUser(EXAMPLE)
      .then(d => ({ ...d, onMap: true }))
      .catch(() => getJSON('/api/preview/' + EXAMPLE).then(d => ({ ...d, onMap: false })))
      .then(d => {
        setExample(d);
        showIsland(toIsland(d), { login: d.login, onMap: d.onMap, x: d.cx, y: d.cy });
      })
      .catch(() => {});
  }, []);

  // Draw an island into the hero. The old one sinks away, then the new one's buildings rise one by one.
  const paint = (island, born) => {
    const el = stage.current;
    const c = el.querySelector('canvas') || document.createElement('canvas');
    window.renderIslandSnapshot(island, el.clientWidth, el.clientHeight, { sky: false, sign: false, fit: FIT, canvas: c, born });
    return c;
  };
  async function showIsland(island, meta) {
    const el = stage.current;
    if (!island || !el) return;
    const token = ++riseToken.current;
    const old = el.querySelector('canvas');
    const still = reduced();
    if (old && !still) await animate(old, { translateY: 70, opacity: 0, scale: 0.94, duration: 420, ease: 'inQuad' });
    if (token !== riseToken.current) return;
    el.replaceChildren();
    shownIsland.current = island;
    const born = performance.now() + 120;
    const c = paint(island, still ? undefined : born);
    el.appendChild(c);
    setShown({ ...meta, projects: island.repoCount, stars: island.totalStars || 0, lang: island.primaryLanguage });
    if (still) return;
    animate(c, { opacity: [0, 1], translateY: [40, 0], scale: [0.96, 1], duration: 900, ease: 'outExpo' });
    const tick = () => {
      if (token !== riseToken.current) return;
      const done = performance.now() - born > 1900;
      paint(island, done ? undefined : born);
      if (!done) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // Keep the hero island sharp when the window changes size.
  useEffect(() => {
    let tm = 0;
    const onResize = () => { clearTimeout(tm); tm = setTimeout(() => { if (shownIsland.current) paint(shownIsland.current); }, 150); };
    window.addEventListener('resize', onResize);
    return () => { clearTimeout(tm); window.removeEventListener('resize', onResize); riseToken.current++; };
  }, []);

  const submit = async e => {
    e.preventDefault();
    const login = value.trim().replace(/^@/, '').replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '').split(/[/?#]/)[0];
    if (!login) { setError('Type a GitHub username first.'); return; }
    if (!LOGIN_RE.test(login)) { setError('That is not a valid GitHub username.'); return; }
    setBusy(true); setError('');
    try {
      const d = await getJSON('/api/preview/' + encodeURIComponent(login));
      let x, y;
      if (d.onMap) { const u = await getUser(d.login).catch(() => null); if (u) { x = u.cx; y = u.cy; } }
      const island = toIsland(d);
      await showIsland(island, { login: d.login, onMap: d.onMap && x !== undefined, x, y, of: d.publicRepos > island.repoCount ? d.publicRepos : 0 });
    } catch (err) {
      setError(previewError(err));
    } finally {
      setBusy(false);
    }
  };

  // One entrance: the headline lines slide up, then the box and the island caption follow. The sky runs its own fade.
  useLayoutEffect(() => {
    if (reduced()) return;
    const lines = root.current.querySelectorAll('.hl-line');
    const rest = root.current.querySelectorAll('[data-enter]');
    utils.set(lines, { translateY: '108%' });
    utils.set(rest, { opacity: 0, translateY: 16 });
    createTimeline({ delay: 250 })
      .add(lines, { translateY: '0%', duration: 900, ease: 'outExpo', delay: stagger(90) })
      .add(rest, { opacity: 1, translateY: 0, duration: 700, ease: 'outExpo', delay: stagger(80) }, '-=600');
  }, []);

  // Scroll: fill the timeline rail to 60% of the screen; each step lights up once the fill reaches its marker.
  useEffect(() => {
    const el = root.current;
    const steps = [...el.querySelectorAll('.tl-step')];
    const seen = new Set();
    const onScroll = () => {
      const r = rail.current.getBoundingClientRect();
      const mid = window.innerHeight * 0.6;
      const filled = Math.max(0, Math.min(r.height, mid - r.top));
      fill.current.style.transform = `scaleY(${r.height ? filled / r.height : 0})`;
      steps.forEach((s, i) => {
        const dot = s.querySelector('.tl-dot').getBoundingClientRect();
        const on = dot.top + dot.height / 2 <= mid;
        s.classList.toggle('on', on);
        if (on && !seen.has(i)) {
          seen.add(i);
          if (!reduced()) animate(s.querySelectorAll('.tl-text > *'), { opacity: { from: 0.3 }, translateY: { from: 8 }, delay: stagger(50), duration: 520, ease: 'outCubic' });
        }
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    onScroll();
    el.focus({ preventScroll: true });
    return () => { el.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); };
  }, []);

  const signIn = (label, variant = 'contained') => <Button variant={variant} size="large" href="/auth/github">{label}</Button>;

  let heroActions = null;
  if (shown?.onMap) heroActions = <><Button variant="contained" size="large" onClick={() => go(shown.x, shown.y)}>Fly to it</Button>{!signedIn && signIn('Sign in with GitHub', 'outlined')}</>;
  else if (shown && !signedIn) heroActions = signIn('Put it on the map');

  return (
    <Box ref={root} tabIndex={-1} role="region" aria-label="About GitSpace" sx={{
      position: 'fixed', inset: 0, zIndex: 1200, overflowY: 'auto', overflowX: 'hidden', bgcolor: '#000', color: t.text,
      scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' }, outline: 'none',
    }}>
      <FrontSky scroller={root} />

      <Box sx={{ position: 'relative', zIndex: 1 }}>
        <Box component="header" sx={{ ...wrap, height: 68, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Brand full size={34} fontSize={17} />
          {signedIn ? <Button onClick={onClose}>Close</Button> : <Button href="/auth/github">Sign in</Button>}
        </Box>

        {/* Hero */}
        <Box component="section" sx={{
          ...wrap, minHeight: { md: 'calc(100svh - 68px)' }, pt: { xs: 5, md: 2 }, pb: { xs: 8, md: 6 },
          display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1.25fr' }, alignItems: 'center', columnGap: 4,
        }}>
          <Box sx={{ position: 'relative', zIndex: 2 }}>
            <Box component="h1" aria-label={HEADLINE.join(' ')} sx={{
              m: 0, fontWeight: 900, letterSpacing: '-0.045em', lineHeight: 0.95, fontSize: 'clamp(44px, 5.6vw, 84px)', '& .hl-line': { whiteSpace: 'nowrap' },
            }}>
              {HEADLINE.map(l => (
                <Box component="span" key={l} aria-hidden sx={{ display: 'block', overflow: 'hidden', pb: '0.06em' }}>
                  <Box component="span" className="hl-line" sx={{ display: 'block' }}>{l}</Box>
                </Box>
              ))}
            </Box>
            <Box component="p" data-enter sx={{ m: 0, mt: { xs: 2.5, md: 3.5 }, maxWidth: 460, fontSize: { xs: 17, md: 19 }, lineHeight: 1.55, color: '#B4B4BF' }}>
              Each public repo becomes a building. More stars make it taller, and the roof colour is its language.
              Type a username to see theirs.
            </Box>

            <Box component="form" data-enter onSubmit={submit} noValidate sx={{ mt: { xs: 3.5, md: 5 }, maxWidth: 480 }}>
              <Box component="label" htmlFor="gs-login" sx={{ display: 'block', fontSize: 14, color: t.muted, mb: 1 }}>GitHub username, yours or anyone's</Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <OutlinedInput id="gs-login" value={value} onChange={e => { setValue(e.target.value); setError(''); }}
                  placeholder="Type your GitHub username" autoComplete="off" spellCheck={false}
                  inputProps={{ autoCapitalize: 'none', 'aria-describedby': 'gs-login-msg', 'aria-invalid': !!error }}
                  startAdornment={<InputAdornment position="start" sx={{ mr: 0, display: { xs: 'none', sm: 'flex' }, '& p': { fontFamily: t.mono, fontSize: 14, color: t.faint } }}>github.com/</InputAdornment>}
                  sx={{ flex: 1, minWidth: 0, height: 48, bgcolor: '#050506', '& input': { fontFamily: t.mono, fontSize: 15, pl: { xs: 0, sm: 0.25 } }, '& input::placeholder': { fontFamily: t.sans } }} />
                <Button type="submit" variant="outlined" disabled={busy} sx={{ height: 48, px: 2.25, whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {busy ? 'Building' : 'Show island'}
                </Button>
              </Box>
              <Box id="gs-login-msg" role="status" aria-live="polite" sx={{ minHeight: 24, mt: 1.25, fontSize: 14, color: error ? t.warn : t.muted }}>
                {error || (busy ? 'Reading their public repos from GitHub.' : '')}
              </Box>
            </Box>
          </Box>

          {/* The island stage. It drifts gently; the caption under it says whose island it is. */}
          <Box sx={{ position: 'relative', minWidth: 0, mr: { md: -4 } }}>
            <Box sx={{
              animation: 'gsDrift 6s ease-in-out infinite alternate',
              '@keyframes gsDrift': { from: { transform: 'translateY(0)' }, to: { transform: 'translateY(-12px)' } },
              '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
            }}>
              <Box ref={stage} role="img" aria-label={shown ? `${shown.login}'s island` : 'An island'} sx={{
                height: { xs: 330, sm: 440, md: 'min(70svh, 660px)' }, position: 'relative', '& canvas': { position: 'absolute', left: 0, top: 0, display: 'block' },
              }} />
            </Box>
            <Box data-enter sx={{
              mt: { xs: 0, md: -1 }, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 2.5,
              opacity: shown ? 1 : 0, transition: 'opacity .4s',
            }}>
              <Box sx={{ minWidth: 0 }}>
                <Box className="num" sx={{ fontSize: 15, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{shown?.login || ''}</Box>
                <Box sx={{ mt: 0.25, fontSize: 13, color: t.muted }}>
                  {shown ? (shown.onMap ? 'On the map now.' : 'Not on the map yet. It goes on when its owner signs in.') : ''}
                </Box>
                <Box sx={{ mt: 1.5, display: 'flex', gap: { xs: 2.5, sm: 4 }, flexWrap: 'wrap' }}>
                  <Stat n={<Count value={shown?.projects || 0} />} label={shown?.of ? `projects (top of ${shown.of.toLocaleString('en-US')})` : 'projects'} />
                  <Stat n={<Count value={shown?.stars || 0} />} label="stars" />
                  {shown?.lang && shown.lang !== 'Other' && <Stat n={<span className="num">{shown.lang}</span>} label="top language" />}
                </Box>
              </Box>
              {heroActions && <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap' }}>{heroActions}</Box>}
            </Box>
          </Box>
        </Box>

        <Box sx={wrap}>
          <Compare dev={example} />
          <Postcards dev={example} />
        </Box>

        {/* Timeline */}
        <Box component="section" aria-labelledby="tl-title" sx={{
          ...wrap, py: { xs: 9, md: 14 },
          display: 'grid', gridTemplateColumns: { xs: '1fr', md: '360px 1fr' }, gap: { xs: 5, md: 8 },
        }}>
          <Box sx={{ position: { md: 'sticky' }, top: { md: 96 }, alignSelf: 'start' }}>
            <Box component="h2" id="tl-title" sx={{ m: 0, fontSize: { xs: 32, md: 48 }, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.05 }}>
              What happens after you sign in
            </Box>
            <Box component="p" sx={{ m: 0, mt: 2, color: t.muted, lineHeight: 1.55, maxWidth: 340, fontSize: { xs: 16, md: 18 } }}>
              From the first minute to the things we are still building.
            </Box>
          </Box>

          <Box sx={{ position: 'relative' }}>
            <Box ref={rail} aria-hidden sx={{ position: 'absolute', left: 5, top: 10, bottom: 10, width: 2, bgcolor: t.line }}>
              <Box ref={fill} sx={{ position: 'absolute', inset: 0, bgcolor: t.text, transformOrigin: 'top', transform: 'scaleY(0)' }} />
            </Box>
            <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
              {STEPS.map(s => (
                <Box component="li" key={s.title} className="tl-step" sx={{
                  position: 'relative', pl: 5, pb: { xs: 6, md: 9 }, '&:last-of-type': { pb: 0 },
                  '& .tl-text': { opacity: 0.4, transition: 'opacity .3s' },
                  '&.on .tl-text': { opacity: 1 },
                  '&.on .tl-dot': { bgcolor: s.soon ? '#000' : t.text, borderColor: s.soon ? t.accent : t.text },
                }}>
                  <Box className="tl-dot" aria-hidden sx={{
                    position: 'absolute', left: 0, top: 6, width: 12, height: 12, borderRadius: '50%',
                    bgcolor: '#000', border: `2px solid ${t.lineStrong}`, transition: 'background-color .3s, border-color .3s',
                  }} />
                  <Box className="tl-text">
                    <Box component="p" className="num" sx={{ m: 0, fontSize: 12, color: s.soon ? t.accent : t.muted }}>{s.when}</Box>
                    <Box component="h3" sx={{ m: 0, mt: 1, fontSize: { xs: 22, md: 26 }, fontWeight: 700, letterSpacing: '-0.015em' }}>{s.title}</Box>
                    <Box component="p" sx={{ m: 0, mt: 1, maxWidth: 520, color: t.muted, fontSize: 16, lineHeight: 1.6 }}>{s.body}</Box>
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
        </Box>

        {/* Closing */}
        <Box component="section" sx={{ ...wrap, py: { xs: 10, md: 16 }, display: 'flex', flexDirection: 'column', alignItems: { xs: 'flex-start', md: 'center' }, textAlign: { md: 'center' } }}>
          <Box component="img" src="/logo.svg" alt="" aria-hidden sx={{ width: { xs: 200, md: 280 }, height: 'auto', mb: { xs: 4, md: 5 } }} />
          <Box component="h2" sx={{ m: 0, fontSize: { xs: 40, md: 64 }, fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1 }}>
            {signedIn ? 'Your island is waiting.' : 'Make yours.'}
          </Box>
          <Box component="p" sx={{ m: 0, mt: 2, mb: 4, color: t.muted, fontSize: 17 }}>
            {signedIn ? 'The last two steps are not built yet. Everything else works today.' : 'One click with GitHub, and it is on the map a few seconds later.'}
          </Box>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
            {signedIn
              ? <Button variant="contained" size="large" onClick={onClose}>Back to the map</Button>
              : <>{signIn('Sign in with GitHub')}<Button variant="outlined" size="large" onClick={onExplore}>Look around first</Button></>}
          </Box>
        </Box>

        <Box component="footer" sx={{ ...wrap, py: 4, borderTop: `1px solid ${t.line}`, display: 'flex', gap: 3, fontSize: 14 }}>
          <Box component="a" href="/privacy.html" sx={{ color: t.muted, textDecoration: 'none', '&:hover': { color: t.text } }}>What we read from GitHub</Box>
        </Box>
      </Box>
    </Box>
  );
}

function Stat({ n, label }) {
  return (
    <Box>
      <Box className="num" sx={{ fontSize: { xs: 20, md: 24 }, lineHeight: 1.1, color: t.text }}>{n}</Box>
      <Box sx={{ fontSize: 13, color: t.muted, mt: 0.25 }}>{label}</Box>
    </Box>
  );
}
