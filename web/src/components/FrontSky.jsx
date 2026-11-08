// Front-page background: the same real sky as the world (public/data/sky.json) on pure black.
// Faint stars and bright stars scroll at two speeds; constellation lines draw themselves in as they come into view.
import { useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import { animate, reduced, stagger } from '../motion.js';

let skyFetch = null;
const loadSky = () => (skyFetch ||= fetch('/data/sky.json').then(r => (r.ok ? r.json() : null)).catch(() => null));
const wrapN = (v, m) => ((v % m) + m) % m;
const NEAR = 0.09, FAR = 0.035; // parallax: px of sky movement per px scrolled
const EXTRA = 1000; // sky height below the fold that lines are built for (covers ~11000px of scroll)

export default function FrontSky({ scroller }) {
  const cv = useRef(null);
  const svgRef = useRef(null);

  useEffect(() => {
    let alive = true, raf = 0, sky = null, data = null, first = true;
    const still = reduced();
    const canvas = cv.current, ctx = canvas.getContext('2d');

    const build = () => {
      const W = window.innerWidth, H = window.innerHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      const s = Math.max(W / 150, 5.2), SW = 360 * s, SH = 180 * s;
      const ox = (70 + 180) / 360 * SW - W * 0.62; // Taurus and Orion sit behind the hero island
      const oy = (90 - 52) * s; // the top of the screen is declination +52
      const rx = ra => (ra + 180) / 360 * SW - ox, ry = dec => (90 - dec) * s - oy;
      const stars = data.stars.map(([ra, dec, mag, col]) => ({
        x: wrapN(rx(ra), SW), y: wrapN(ry(dec), SH), col, near: mag < 4.3,
        r: Math.max(0.5, (6.3 - mag) * 0.46), a: Math.min(1, Math.max(0.28, (6.8 - mag) / 4.5)),
      }));
      // Constellation lines: copies across the wrap so the sky tiles like the star layer does.
      const groups = [];
      const ymax = H + EXTRA;
      for (const c of data.lines) {
        for (let kx = -1; kx <= 1; kx++) for (let ky = -1; ky * SH < ymax + SH; ky++) {
          const paths = [];
          let y0 = Infinity, y1 = -Infinity, inside = false;
          for (const seg of c.l) {
            let d = '';
            for (let i = 0; i < seg.length; i++) {
              const [ra, dec] = seg[i];
              const x = rx(ra) + kx * SW, y = ry(dec) + ky * SH;
              const jump = i > 0 && Math.abs(ra - seg[i - 1][0]) > 180; // crosses the RA seam
              d += (i === 0 || jump ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
              y0 = Math.min(y0, y); y1 = Math.max(y1, y);
              if (x > -40 && x < W + 40 && y > -40 && y < ymax) inside = true;
            }
            paths.push(d);
          }
          if (inside) groups.push({ paths, y0, y1 });
        }
      }
      const svg = svgRef.current;
      svg.setAttribute('viewBox', `0 0 ${W} ${ymax}`);
      svg.style.width = W + 'px'; svg.style.height = ymax + 'px';
      svg.innerHTML = groups.map(g => `<g>${g.paths.map(d => `<path d="${d}" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="${still ? 0 : 1}"/>`).join('')}</g>`).join('');
      [...svg.children].forEach((el, i) => { groups[i].el = el; groups[i].shown = still; });
      sky = { W, H, dpr, SH, stars, groups };
    };

    const reveal = shift => {
      const due = sky.groups.filter(g => !g.shown && g.y0 - shift < sky.H * 0.9 && g.y1 - shift > 0);
      if (!due.length) return;
      due.forEach(g => { g.shown = true; });
      animate(due.flatMap(g => [...g.el.children]), {
        strokeDashoffset: [1, 0], duration: 1600, ease: 'inOutQuad',
        delay: stagger(first ? 35 : 20, { start: first ? 500 : 0 }),
      });
      first = false;
    };

    const draw = () => {
      raf = 0;
      if (!sky) return;
      const { W, H, dpr, SH, stars } = sky;
      const S = still ? 0 : scroller.current?.scrollTop || 0;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      for (const st of stars) {
        if (st.x > W + 3) continue;
        ctx.globalAlpha = st.a;
        ctx.fillStyle = st.col;
        for (let y = wrapN(st.y - S * (st.near ? NEAR : FAR), SH); y < H + 3; y += SH) {
          ctx.beginPath(); ctx.arc(st.x, y, st.r, 0, 6.2832); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      svgRef.current.style.transform = `translate3d(0, ${-S * NEAR}px, 0)`;
      if (!still) reveal(S * NEAR);
    };
    const queue = () => { if (!raf) raf = requestAnimationFrame(draw); };
    let resizeT = 0;
    const onResize = () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (data) { build(); draw(); } }, 150); };

    loadSky().then(d => {
      if (!alive || !d) return;
      data = d;
      build(); draw();
      if (!still) animate(canvas, { opacity: [0, 1], duration: 1200, ease: 'outQuad' });
      else canvas.style.opacity = 1;
    });
    const sc = scroller.current;
    sc?.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      alive = false; cancelAnimationFrame(raf); clearTimeout(resizeT);
      sc?.removeEventListener('scroll', queue); window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <Box aria-hidden sx={{ position: 'fixed', inset: 0, zIndex: 0, bgcolor: '#000', overflow: 'hidden', pointerEvents: 'none' }}>
      <Box component="canvas" ref={cv} sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0 }} />
      <Box component="svg" ref={svgRef} xmlns="http://www.w3.org/2000/svg" sx={{
        position: 'absolute', left: 0, top: 0, overflow: 'visible', willChange: 'transform',
        '& path': { fill: 'none', stroke: 'rgba(175,195,255,.2)', strokeWidth: 1, vectorEffect: 'non-scaling-stroke' },
      }} />
    </Box>
  );
}
