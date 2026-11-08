// Real examples on the front page: a repo list against the same island, islands already on the map, and postcards.
// Every island here is built in the browser with the engine's own buildIsland + renderIslandSnapshot.
import { useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { t } from '../theme.js';
import { fmt, getJSON, plural, topRepos } from '../lib.js';
import { renderPostcard } from '../postcard.js';

const userFetches = new Map();
export const getUser = login => {
  if (!userFetches.has(login)) userFetches.set(login, getJSON('/api/user/' + encodeURIComponent(login)).catch(e => { userFetches.delete(login); throw e; }));
  return userFetches.get(login);
};

// d: /api/user or /api/preview data.
export const toIsland = d => window.buildIsland?.(d.login, {
  cx: d.cx || 0, cy: d.cy || 0, avatar: d.avatar, primaryLanguage: d.primaryLanguage, repos: d.repos || [], isActive: true,
}) || null;

// Where a building sits inside a snapshot of size w x h (CSS px), matching renderIslandSnapshot's camera.
export function buildingPoint(island, b, w, h, fit) {
  const z = Math.min(w, h) / (island.islandRadius * fit);
  return { x: w / 2 + (b.x - island.cx) * z, y: h / 2 + (b.y - island.cy - island.islandRadius * 0.28) * z - b.height * z };
}

const mostly = (lang, n) => (lang && lang !== 'Other' ? `${plural(n, 'project', 'projects')}, mostly ${lang}` : plural(n, 'project', 'projects'));

const h2 = { m: 0, fontSize: { xs: 32, md: 48 }, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.05 };
const lede = { m: 0, mt: 2, color: t.muted, fontSize: { xs: 16, md: 18 }, lineHeight: 1.55, maxWidth: 520 };

/* ---------- Profile vs island ---------- */

export function Compare({ dev }) {
  const [split, setSplit] = useState(50);
  const box = useRef(null);
  const [labels, setLabels] = useState([]);
  const FIT = 3.1;

  useEffect(() => {
    const el = box.current;
    if (!dev || !el) return;
    const island = toIsland(dev);
    if (!island) return;
    const paint = () => {
      const w = el.clientWidth, h = el.clientHeight;
      const c = window.renderIslandSnapshot(island, w, h, { sky: false, sign: false, fit: FIT });
      if (!c) return;
      el.replaceChildren(c);
      const [top] = topRepos(island.buildings, 1);
      const other = island.buildings.find(b => b !== top && b.language !== top.language && b.language !== 'Other') || island.buildings.find(b => b !== top);
      const clampX = x => Math.max(70, Math.min(w - 70, x));
      const out = [];
      if (top) { const p = buildingPoint(island, top, w, h, FIT); out.push({ ...p, lx: clampX(p.x), text: `Most stars: ${top.name}`, above: true }); }
      if (other) { const p = buildingPoint(island, other, w, h, FIT); out.push({ ...p, y: p.y + other.height * Math.min(w, h) / (island.islandRadius * FIT), lx: clampX(p.x), text: `Roof colour = ${other.language}`, above: false }); }
      setLabels(out);
    };
    paint();
    let tm = 0;
    const onResize = () => { clearTimeout(tm); tm = setTimeout(paint, 150); };
    window.addEventListener('resize', onResize);
    return () => { clearTimeout(tm); window.removeEventListener('resize', onResize); };
  }, [dev]);

  const repos = dev ? topRepos(dev.repos.filter(r => !r.isfork && !r.isFork), 6) : [];
  return (
    <Box component="section" aria-labelledby="cmp-title" sx={{ py: { xs: 9, md: 14 } }}>
      <Box component="h2" id="cmp-title" sx={h2}>Same developer, two views</Box>
      <Box component="p" sx={lede}>
        On GitHub a profile is a list you scroll. Here it is a place: every repo is a building, the most-starred
        stand tallest, and you can tell what someone builds from across the map. Drag the line to compare.
      </Box>

      <Box sx={{
        position: 'relative', mt: { xs: 4, md: 6 }, height: { xs: 440, md: 520 }, borderRadius: '14px',
        border: `1px solid ${t.line}`, overflow: 'hidden', userSelect: 'none', touchAction: 'pan-y',
      }}>
        {/* Left: a plain repo list, deliberately dull. */}
        <Box sx={{ position: 'absolute', inset: 0, bgcolor: '#0D0E11', clipPath: `inset(0 ${100 - split}% 0 0)`, p: { xs: 2, md: 4 }, fontFamily: 'system-ui, sans-serif' }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, pb: 1.5, borderBottom: '1px solid #24262C', maxWidth: { md: '46%' } }}>
            <Box sx={{ fontSize: 14, color: '#C9CDD4', fontWeight: 600 }}>Repositories</Box>
            <Box sx={{ fontSize: 12, color: '#7D8590' }}>{dev ? fmt(dev.repos.length) : ''}</Box>
          </Box>
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, maxWidth: { md: '46%' } }}>
            {(dev ? repos : Array.from({ length: 6 }, (_, i) => ({ name: '', i }))).map((r, i) => (
              <Box component="li" key={r.name || i} sx={{ py: { xs: 1.25, md: 1.6 }, borderBottom: '1px solid #24262C' }}>
                <Box sx={{ fontSize: { xs: 13, md: 15 }, color: '#7AA2D6', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minHeight: 20 }}>{r.name}</Box>
                {dev && (
                  <Box sx={{ mt: 0.5, fontSize: 12, color: '#7D8590', display: 'flex', gap: 2 }}>
                    {r.language && r.language !== 'Other' && <span>{r.language}</span>}
                    <span>{fmt(r.stars || 0)} {r.stars === 1 ? 'star' : 'stars'}</span>
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        </Box>

        {/* Right: the same repos as an island, floating on the page's sky. */}
        <Box sx={{ position: 'absolute', inset: 0, clipPath: `inset(0 0 0 ${split}%)` }}>
          <Box sx={{ position: 'absolute', top: 0, bottom: 0, left: { xs: '38%', md: '45%' }, right: 0 }}>
            <Box ref={box} sx={{ position: 'absolute', inset: 0 }} />
            {labels.map(l => (
              <Box key={l.text} sx={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
                <Box sx={{ position: 'absolute', left: l.x, top: l.above ? l.y - 34 : l.y + 4, width: '1px', height: 30, bgcolor: 'rgba(255,255,255,.5)' }} />
                <Box className="num" sx={{
                  position: 'absolute', left: l.lx, top: l.above ? l.y - 34 : l.y + 34, transform: l.above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
                  whiteSpace: 'nowrap', fontSize: 11, px: 1, py: 0.5, borderRadius: '6px', bgcolor: 'rgba(0,0,0,.85)', border: `1px solid ${t.lineStrong}`, color: t.text,
                  maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{l.text}</Box>
              </Box>
            ))}
          </Box>
          {dev && <Box className="num" sx={{ position: 'absolute', right: 16, bottom: 14, fontSize: 12, color: t.muted }}>@{dev.login}</Box>}
        </Box>

        {/* Divider: a native range input on top, so drag, click and arrow keys all work. */}
        <Box aria-hidden sx={{ position: 'absolute', top: 0, bottom: 0, left: `${split}%`, width: 0, pointerEvents: 'none' }}>
          <Box sx={{ position: 'absolute', top: 0, bottom: 0, left: -0.5, width: '1px', bgcolor: t.text }} />
          <Box className="grip" sx={{
            position: 'absolute', top: '50%', left: -18, width: 36, height: 36, mt: '-18px', borderRadius: '50%',
            bgcolor: t.text, color: '#000', display: 'grid', placeItems: 'center',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l-6 6 6 6M15 6l6 6-6 6" /></svg>
          </Box>
        </Box>
        <Box component="input" type="range" min={4} max={96} value={split} onChange={e => setSplit(Number(e.target.value))}
          aria-label="Divider between the repo list and the island" sx={{
            position: 'absolute', inset: 0, width: '100%', height: '100%', m: 0, opacity: 0, cursor: 'ew-resize',
            '&:focus-visible ~ div .grip, &:focus-visible + div .grip': { outline: `2px solid ${t.accent}`, outlineOffset: 3 },
          }} />
      </Box>
    </Box>
  );
}

/* ---------- Islands already on the map ---------- */

function IslandCard({ c, onFly }) {
  const face = useRef(null);
  const [n, setN] = useState(null);
  useEffect(() => {
    let alive = true;
    getUser(c.login).then(d => {
      if (!alive || !face.current) return;
      const island = toIsland(d);
      const cv = island && window.renderIslandSnapshot(island, 420, 280, { sky: true, sign: false, fit: 3.2 });
      if (!cv) return;
      cv.style.width = '100%'; cv.style.height = '100%'; cv.style.display = 'block';
      face.current.replaceChildren(cv);
      setN(island.repoCount);
    }).catch(() => {});
    return () => { alive = false; };
  }, [c.login]);
  return (
    <Box component="button" type="button" onClick={() => onFly(c.x, c.y)} aria-label={`Fly to ${c.login}'s island`} sx={{
      all: 'unset', boxSizing: 'border-box', cursor: 'pointer', display: 'block', borderRadius: '14px', overflow: 'hidden',
      border: `1px solid ${t.line}`, bgcolor: '#050506', scrollSnapAlign: 'start',
      transition: 'transform .35s cubic-bezier(.2,.7,.2,1), border-color .35s',
      '& .face canvas': { transition: 'transform .6s cubic-bezier(.2,.7,.2,1)' },
      '&:hover, &:focus-visible': { transform: 'translateY(-6px)', borderColor: t.lineStrong },
      '&:hover .face canvas, &:focus-visible .face canvas': { transform: 'scale(1.06)' },
      '&:focus-visible': { outline: `2px solid ${t.text}`, outlineOffset: 2 },
      '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover, &:focus-visible': { transform: 'none' }, '& .face canvas': { transition: 'none', transform: 'none !important' } },
    }}>
      <Box className="face" ref={face} sx={{ aspectRatio: '3 / 2', bgcolor: '#000', overflow: 'hidden' }} />
      <Box sx={{ px: 2, py: 1.75, borderTop: `1px solid ${t.line}` }}>
        <Box className="num" sx={{ fontSize: 14, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.login}</Box>
        <Box sx={{ mt: 0.5, fontSize: 14, color: t.muted }}>{mostly(c.primaryLanguage, n ?? c.repoCount)}</Box>
      </Box>
    </Box>
  );
}

export function Gallery({ people, total, onFly }) {
  return (
    <Box component="section" aria-labelledby="gal-title" sx={{ py: { xs: 9, md: 14 } }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 3 }}>
        <Box>
          <Box component="h2" id="gal-title" sx={h2}>Islands already on the map</Box>
          <Box component="p" sx={lede}>
            {total > 0 ? `${fmt(total)} developers so far. Here are six, picked at random. ` : 'Six developers, picked at random. '}
            Pick one to fly there.
          </Box>
        </Box>
      </Box>
      <Box sx={{
        mt: { xs: 4, md: 6 }, display: 'grid', gap: { xs: 1.5, md: 2.5 },
        gridTemplateColumns: { sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
        // Phones: one swipeable row instead of a tall stack.
        '@media (max-width:599px)': {
          gridAutoFlow: 'column', gridAutoColumns: '78%', overflowX: 'auto', scrollSnapType: 'x mandatory',
          mx: -2, px: 2, pb: 1, scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' },
        },
      }}>
        {people.map(c => <IslandCard key={c.login} c={c} onFly={onFly} />)}
      </Box>
    </Box>
  );
}

/* ---------- Postcards ---------- */

function Postcard({ c, i }) {
  const holder = useRef(null);
  useEffect(() => {
    let alive = true;
    getUser(c.login).then(async d => {
      const island = toIsland(d);
      if (!island || !alive) return;
      const cv = await renderPostcard(island, {}, island);
      if (!alive || !holder.current) return;
      cv.style.width = '100%'; cv.style.height = '100%'; cv.style.display = 'block';
      cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', `Postcard of ${c.login}'s island`);
      holder.current.replaceChildren(cv);
    }).catch(() => {});
    return () => { alive = false; };
  }, [c.login]);
  return <Box ref={holder} className={`card c${i}`} sx={{ bgcolor: t.surface }} />;
}

export function Postcards({ people }) {
  return (
    <Box component="section" aria-labelledby="pc-title" sx={{ py: { xs: 9, md: 14 }, textAlign: { md: 'center' } }}>
      <Box component="h2" id="pc-title" sx={h2}>Every island comes with a postcard</Box>
      <Box component="p" sx={{ ...lede, mx: { md: 'auto' } }}>
        Download a picture of your island with your top projects on it. Share yours on LinkedIn, X, or your README.
      </Box>
      <Box tabIndex={0} aria-label="Example postcards" sx={{
        '--w': { xs: '230px', sm: '360px', md: '420px' }, '--rest': { xs: '46px', sm: '110px', md: '150px' }, '--open': { xs: '70px', sm: '200px', md: '330px' },
        position: 'relative', height: { xs: 230, sm: 330, md: 380 }, mt: { xs: 5, md: 8 }, outline: 'none',
        '& .card': {
          position: 'absolute', left: '50%', top: '50%', width: 'var(--w)', aspectRatio: '1440 / 840', borderRadius: '10px', overflow: 'hidden',
          border: '1px solid rgba(255,255,255,.14)', boxShadow: '0 24px 50px rgba(0,0,0,.6)', // printed cards lift off the page
          transition: 'transform .55s cubic-bezier(.2,.7,.2,1)',
        },
        '& .c0': { transform: 'translate(calc(-50% - var(--rest)), -46%) rotate(-9deg)', zIndex: 1 },
        '& .c1': { transform: 'translate(-50%, -54%) rotate(1deg)', zIndex: 3 },
        '& .c2': { transform: 'translate(calc(-50% + var(--rest)), -46%) rotate(8deg)', zIndex: 2 },
        '&:hover .c0, &:focus-visible .c0': { transform: 'translate(calc(-50% - var(--open)), -44%) rotate(-5deg)' },
        '&:hover .c1, &:focus-visible .c1': { transform: 'translate(-50%, -58%) rotate(0deg)' },
        '&:hover .c2, &:focus-visible .c2': { transform: 'translate(calc(-50% + var(--open)), -44%) rotate(5deg)' },
        '@media (prefers-reduced-motion: reduce)': { '& .card': { transition: 'none' } },
      }}>
        {people.slice(0, 3).map((c, i) => <Postcard key={c.login} c={c} i={i} />)}
      </Box>
    </Box>
  );
}
