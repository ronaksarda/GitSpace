// Postcard PNG: a picture of the island on the left, the developer on the right.
import { avatarUrl, islandLanguages, plural, topRepos } from './lib.js';
import { t } from './theme.js';

function wrapText(g, text, x, y, maxW, lineH, maxLines) {
  const words = String(text).split(/\s+/);
  let line = '', lines = 0;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (g.measureText(test).width > maxW && line) {
      if (lines === maxLines - 1) { g.fillText(line + '...', x, y); return y + lineH; }
      g.fillText(line, x, y); y += lineH; lines++; line = w;
    } else line = test;
  }
  if (line) { g.fillText(line, x, y); y += lineH; }
  return y;
}

function loadImage(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Draws the postcard. snapTarget: a login on the map (default) or an island object from buildIsland.
export async function renderPostcard(island, profile, snapTarget = island.login) {
  const login = island.login;
  const p = profile || {};
  await Promise.all(['700 52px Satoshi', '400 24px Satoshi', '400 20px "Space Mono"'].map(f => document.fonts?.load(f)));
  const W = 1440, H = 840, pad = 40;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = t.surface; g.fillRect(0, 0, W, H);

  const picW = 680, picH = H - pad * 2;
  const snap = window.renderIslandSnapshot?.(snapTarget, picW / 2, picH / 2);
  g.save();
  g.beginPath(); g.roundRect(pad, pad, picW, picH, 16); g.clip();
  if (snap) g.drawImage(snap, pad, pad, picW, picH);
  else { g.fillStyle = t.bg; g.fillRect(pad, pad, picW, picH); }
  g.restore();

  const x = pad + picW + 64, right = W - pad - 24;
  const avatar = await loadImage(avatarUrl(p.avatar || island.avatar, login, 160));
  let y = pad + 24;
  if (avatar) {
    g.save(); g.beginPath(); g.roundRect(x, y, 88, 88, 14); g.clip(); g.drawImage(avatar, x, y, 88, 88); g.restore();
    y += 88;
  }
  y += 72;
  g.fillStyle = t.text; g.font = '700 52px Satoshi';
  y = wrapText(g, p.name || login, x, y, right - x, 58, 2);
  g.fillStyle = t.muted; g.font = '400 22px "Space Mono"';
  g.fillText('@' + login, x, y); y += 56;
  if (p.bio) { g.fillStyle = '#C9C9D1'; g.font = '400 24px Satoshi'; y = wrapText(g, p.bio, x, y, right - x, 34, 3) + 18; }

  const buildings = island.buildings || [];
  g.fillStyle = t.muted; g.font = '400 20px "Space Mono"';
  g.fillText(`${plural(island.repoCount || buildings.length, 'repo', 'repos')}   ${plural(island.totalStars || 0, 'star', 'stars')}`, x, y); y += 34;
  const langs = islandLanguages(buildings).map(l => l.lang).join(', ');
  if (langs) { g.fillText(langs, x, y); y += 50; }
  g.fillStyle = t.text; g.font = '400 22px "Space Mono"';
  for (const r of topRepos(buildings, 3)) { g.fillText(r.name, x, y); y += 36; }

  g.fillStyle = t.faint; g.font = '400 18px "Space Mono"';
  g.fillText(`${window.location.host}/?fly=${login}`, x, H - pad - 8);
  return c;
}

export async function downloadPostcard(island, profile) {
  const login = island.login;
  const c = await renderPostcard(island, profile);
  const blob = await new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('empty'))), 'image/png'));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gitspace-${login}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
