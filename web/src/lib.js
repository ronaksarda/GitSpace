// Small shared helpers: formatting, fetch, and reading the canvas engine (public/js) through window.gsWorld.

export const world = () => window.gsWorld;
export const islandByLogin = login => world()?.islands.find(i => i.login === login) || null;

export const fmt = n => (Number(n) || 0).toLocaleString('en-US');
export const plural = (n, one, many) => `${fmt(n)} ${Number(n) === 1 ? one : many}`;

export function avatarUrl(url, login, size = 80) {
  if (url && (url.startsWith('https://') || url.startsWith('data:image/'))) return url;
  return `https://avatars.githubusercontent.com/${encodeURIComponent(login || '')}?s=${size}`;
}

export function safeHttpUrl(u) {
  if (!u) return null;
  const url = /^https?:\/\//i.test(u) ? u : 'https://' + u;
  try { const p = new URL(url); return /^https?:$/.test(p.protocol) ? p.href : null; } catch (e) { return null; }
}


export async function getJSON(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Status ' + res.status), { status: res.status });
  return data;
}

export function formatSize(kb) {
  if (!kb) return '0 KB';
  if (kb < 1024) return kb + ' KB';
  if (kb < 1024 * 1024) return (kb / 1024).toFixed(1) + ' MB';
  return (kb / 1024 / 1024).toFixed(1) + ' GB';
}

export function timeAgo(dateStr) {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return 'Unknown';
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 3600) return 'Within the hour';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  if (s < 2592000) return Math.floor(s / 86400) + ' d ago';
  if (s < 31536000) return Math.floor(s / 2592000) + ' mo ago';
  return Math.floor(s / 31536000) + ' y ago';
}

// Screen position of a world point, in CSS pixels.
export function worldToScreen(wx, wy) {
  const { canvas, camera } = world();
  const r = canvas.getBoundingClientRect();
  const k = r.width / canvas.width;
  return {
    x: r.left + (canvas.width / 2 + (wx - camera.x) * camera.zoom) * k,
    y: r.top + (canvas.height / 2 + (wy - camera.y) * camera.zoom) * k,
  };
}
export const shipScreenPos = () => worldToScreen(world().player.x, world().player.y);

// Languages on an island, most-used first.
export function islandLanguages(buildings, max = 3) {
  const counts = {};
  for (const b of buildings || []) counts[b.language || 'Other'] = (counts[b.language || 'Other'] || 0) + 1;
  const total = (buildings || []).length || 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, max)
    .map(([lang, n]) => ({ lang, n, pct: Math.round(n / total * 100) }));
}
// The owner's GitHub pinned repos come first, in their pinned order; then the most starred.
export const topRepos = (buildings, n) => [...(buildings || [])]
  .sort((a, b) => (a.pin ?? 99) - (b.pin ?? 99) || (b.stars || 0) - (a.stars || 0)).slice(0, n);

export const toast = msg => window.showToast?.(msg);
