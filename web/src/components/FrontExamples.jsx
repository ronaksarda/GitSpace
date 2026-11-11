// Real examples on the front page: a repo list against the same island, islands already on the map, and postcards.
// Every island here is built in the browser with the engine's own buildIsland + renderIslandSnapshot.
import { useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { t } from '../theme.js';
import { fmt, getJSON, topRepos } from '../lib.js';
import { renderPostcard } from '../postcard.js';

const userFetches = new Map();
export const getUser = login => {
  if (!userFetches.has(login)) {
    if (userFetches.size >= 50) userFetches.delete(userFetches.keys().next().value); // keep memory flat
    userFetches.set(login, getJSON('/api/user/' + encodeURIComponent(login)).catch(e => { userFetches.delete(login); throw e; }));
  }
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


const h2 = { m: 0, fontSize: { xs: 32, md: 48 }, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.05 };
const lede = { m: 0, mt: 2, color: t.muted, fontSize: { xs: 16, md: 18 }, lineHeight: 1.55, maxWidth: 520 };

/* ---------- Profile vs island ---------- */

export function Compare({ dev }) {
  const [split, setSplit] = useState(() => (window.innerWidth < 600 ? 34 : 50)); // phones: more room for the island
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
      // Chips sit in the empty sky (one above the island, one beside the keel) with a leader line to the roof.
      const out = [];
      if (top) out.push({ ...buildingPoint(island, top, w, h, FIT), cx: Math.max(8, w / 2 - 90), cy: 8, text: `Top project: ${top.name}` });
      if (other) out.push({ ...buildingPoint(island, other, w, h, FIT), cx: Math.max(8, Math.min(w * 0.58, w - 200)), cy: h * 0.74, text: `Roof colour = ${other.language}` });
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
          <Box sx={{ position: 'absolute', top: 0, bottom: 0, left: { xs: '28%', md: '45%' }, right: 0 }}>
            <Box ref={box} sx={{ position: 'absolute', inset: 0 }} />
            <Box component="svg" aria-hidden sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}>
              {labels.map(l => (
                <g key={l.text}>
                  <line x1={l.cx + Math.min(l.text.length * 6.6 + 18, 220) / 2} y1={l.cy + (l.cy < l.y ? 26 : 0)} x2={l.x} y2={l.y} stroke="rgba(255,255,255,.6)" strokeWidth="1" />
                  <circle cx={l.x} cy={l.y} r="3" fill={t.text} />
                </g>
              ))}
            </Box>
            {labels.map(l => (
              <Box key={l.text} className="num" sx={{
                position: 'absolute', left: l.cx, top: l.cy, pointerEvents: 'none', whiteSpace: 'nowrap', fontSize: 11, lineHeight: '16px',
                px: 1, py: 0.5, borderRadius: '6px', bgcolor: '#000', border: `1px solid ${t.lineStrong}`, color: t.text,
                maxWidth: 'calc(100% - 16px)', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{l.text}</Box>
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

/* ---------- Postcards ---------- */

// One card per person; all with the sky.
const VARIANTS = [{}, {}, {}];

function Postcard({ dev, profile, i }) {
  const holder = useRef(null);
  useEffect(() => {
    let alive = true;
    const island = toIsland(dev);
    if (!island) return;
    renderPostcard(island, profile, island, VARIANTS[i]).then(cv => {
      if (!alive || !holder.current) return;
      cv.style.width = '100%'; cv.style.height = '100%'; cv.style.display = 'block';
      holder.current.replaceChildren(cv);
    }).catch(() => {});
    return () => { alive = false; };
  }, [dev, profile, i]);
  return <Box ref={holder} className={`card c${i}`} sx={{ bgcolor: t.surface }} />;
}

export function Postcards({ devs }) {
  const [profiles, setProfiles] = useState(null);
  useEffect(() => {
    if (!devs || !devs.length) return;
    Promise.all(devs.map(d => getJSON('/api/profile/' + encodeURIComponent(d.login)).catch(() => ({})))).then(setProfiles);
  }, [devs]);
  return (
    <Box component="section" aria-labelledby="pc-title" sx={{ py: { xs: 9, md: 14 }, textAlign: { md: 'center' } }}>
      <Box component="h2" id="pc-title" sx={h2}>Every island comes with a postcard</Box>
      <Box component="p" sx={{ ...lede, mx: { md: 'auto' } }}>
        Download a picture of your island with your top projects on it. Share yours on LinkedIn, X, or your README.
      </Box>
      <Box tabIndex={0} role="img" aria-label={devs && devs.length ? `Example postcards: ${devs.map(d => d.login).join(', ')}` : 'Example postcards'} sx={{
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
        {profiles && devs.slice(0, 3).map((d, i) => <Postcard key={d.login} dev={d} profile={profiles[i] || {}} i={i} />)}
      </Box>
    </Box>
  );
}
