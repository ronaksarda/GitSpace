// Front page for signed-out visitors (and "How it works" from the menu).
// Opaque, so the world behind it does not show. The timeline rail fills as you scroll and is the page's scroll indicator.
import { useEffect, useRef } from 'react';
import { Box, Button } from '@mui/material';
import { t } from '../theme.js';
import { animate, stagger, reduced, Count } from '../motion.js';

const STEPS = [
  { when: 'Right away', title: 'Sign in with GitHub', body: 'We read your public repos and profile. Nothing private, and we never post anything for you.' },
  { when: 'A few seconds later', title: 'Your island appears', body: 'Each public repo becomes a building. The more stars a repo has, the taller it stands.' },
  { when: 'Any time', title: 'Visit anyone', body: 'Search a developer or a repo and fly there. Open a building to read the repo and run a health check on it.' },
  { when: 'Any time', title: 'Share yours', body: 'Download a postcard of your island, or copy a link that flies people straight to it.' },
  { when: 'When you ship', title: 'Your island grows', body: 'Refresh your island after you publish something. New repos show up as new buildings.' },
  { when: 'Not built yet', title: 'Your first open-source PR', body: 'Beginner-friendly issues in the languages you already use, with a plain note on where to start.', soon: true },
  { when: 'Not built yet', title: 'People like you', body: 'Developers from your city or college, or who build with the same tools.', soon: true },
];

const wrap = { width: '100%', maxWidth: 1080, mx: 'auto', px: { xs: 2, sm: 4 } };

export default function FrontPage({ signedIn, stats, onExplore, onClose }) {
  const root = useRef(null);
  const rail = useRef(null);
  const fill = useRef(null);

  // One staggered entrance for the hero.
  useEffect(() => {
    const items = root.current.querySelectorAll('[data-enter]');
    if (reduced()) return;
    animate(items, { opacity: { from: 0 }, translateY: { from: 14 }, delay: stagger(70, { start: 60 }), duration: 700, ease: 'outExpo' });
  }, []);

  // Scroll: fill the rail to the middle of the screen; each step lights up once the fill reaches its marker.
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

  const actions = (
    <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
      {signedIn
        ? <Button variant="contained" size="large" onClick={onClose}>Back to the map</Button>
        : <>
          <Button variant="contained" size="large" href="/auth/github">Sign in with GitHub</Button>
          <Button variant="outlined" size="large" onClick={onExplore}>Look around first</Button>
        </>}
    </Box>
  );

  return (
    <Box ref={root} tabIndex={-1} role="region" aria-label="About GitSpace" sx={{
      position: 'fixed', inset: 0, zIndex: 1200, overflowY: 'auto', overflowX: 'hidden', bgcolor: t.bg, color: t.text,
      scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' }, outline: 'none',
    }}>
      <Box component="header" sx={{ ...wrap, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ fontWeight: 700, fontSize: 17, letterSpacing: '-0.01em' }}>GitSpace</Box>
        {signedIn
          ? <Button onClick={onClose}>Close</Button>
          : <Button href="/auth/github">Sign in</Button>}
      </Box>

      <Box component="section" sx={{ ...wrap, pt: { xs: 9, md: 16 }, pb: { xs: 10, md: 14 } }}>
        <Box component="h1" data-enter sx={{
          m: 0, maxWidth: 820, fontWeight: 700, letterSpacing: '-0.035em', lineHeight: 1.02,
          fontSize: { xs: 44, sm: 64, md: 80 },
        }}>
          Your GitHub as a place people can visit.
        </Box>
        <Box component="p" data-enter sx={{ m: 0, mt: 3, maxWidth: 560, fontSize: { xs: 17, md: 19 }, lineHeight: 1.55, color: t.muted }}>
          Each of your public repos becomes a building on your own island, and stars make it taller.
          Fly to anyone else's island and open what they have built.
        </Box>
        <Box data-enter sx={{ mt: 5 }}>{actions}</Box>
        {stats.totalUsers > 0 && (
          <Box component="p" data-enter sx={{ m: 0, mt: 4, fontSize: 14, color: t.muted }}>
            <Count value={stats.totalUsers} /> developers and <Count value={stats.totalRepos} /> repos on the map so far.
          </Box>
        )}
      </Box>

      <Box component="section" aria-labelledby="tl-title" sx={{
        ...wrap, py: { xs: 8, md: 12 }, borderTop: `1px solid ${t.line}`,
        display: 'grid', gridTemplateColumns: { xs: '1fr', md: '320px 1fr' }, gap: { xs: 5, md: 8 },
      }}>
        <Box sx={{ position: { md: 'sticky' }, top: { md: 96 }, alignSelf: 'start' }}>
          <Box component="h2" id="tl-title" sx={{ m: 0, fontSize: { xs: 28, md: 32 }, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
            What happens after you sign in
          </Box>
          <Box component="p" sx={{ m: 0, mt: 1.5, color: t.muted, lineHeight: 1.55, maxWidth: 320 }}>
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
                '&.on .tl-dot': { bgcolor: s.soon ? t.bg : t.text, borderColor: t.text },
              }}>
                <Box className="tl-dot" aria-hidden sx={{
                  position: 'absolute', left: 0, top: 6, width: 12, height: 12, borderRadius: '50%',
                  bgcolor: t.bg, border: `2px solid ${t.lineStrong}`, transition: 'background-color .3s, border-color .3s',
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

      <Box component="section" sx={{ ...wrap, py: { xs: 10, md: 14 }, borderTop: `1px solid ${t.line}` }}>
        <Box component="h2" sx={{ m: 0, fontSize: { xs: 32, md: 44 }, fontWeight: 700, letterSpacing: '-0.03em' }}>
          {signedIn ? 'Your island is waiting.' : 'Make yours.'}
        </Box>
        <Box component="p" sx={{ m: 0, mt: 1.5, mb: 4, color: t.muted, fontSize: 17 }}>
          {signedIn ? 'The last two are not built yet. Everything else works today.' : 'It takes one click and a few seconds.'}
        </Box>
        {actions}
      </Box>

      <Box component="footer" sx={{ ...wrap, py: 4, borderTop: `1px solid ${t.line}`, display: 'flex', gap: 3, fontSize: 14 }}>
        <Box component="a" href="/privacy.html" sx={{ color: t.muted, textDecoration: 'none', '&:hover': { color: t.text } }}>What we read from GitHub</Box>
      </Box>
    </Box>
  );
}
