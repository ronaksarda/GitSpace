// ── Lazy Chunk Loading with Retry & Offline Detection ──
const CHUNK_SIZE = 4000;
let isOffline = false;

// Offline detection banner
function setOfflineStatus(offline) {
  if (isOffline === offline) return;
  isOffline = offline;
  const banner = document.getElementById('offline-banner');
  if (!banner) return;
  if (offline) {
    banner.classList.remove('hidden');
    banner.classList.add('visible');
  } else {
    banner.classList.remove('visible');
    banner.classList.add('hidden');
  }
}

window.addEventListener('online', () => setOfflineStatus(false));
window.addEventListener('offline', () => setOfflineStatus(true));

// Fetch with exponential backoff retry
async function fetchWithRetry(url, maxRetries = 3) {
  let delay = 500;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok && res.status >= 500 && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
        continue;
      }
      setOfflineStatus(false);
      return res;
    } catch (err) {
      if (attempt === maxRetries) {
        setOfflineStatus(true);
        throw err;
      }
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
    }
  }
}

async function checkChunks() {
  if (isOffline) return;

  const cx = Math.floor(player.x / CHUNK_SIZE);
  const cy = Math.floor(player.y / CHUNK_SIZE);

  const viewWidth = window.innerWidth / camera.zoom;
  const viewHeight = window.innerHeight / camera.zoom;
  const chunksX = Math.min(3, Math.ceil((viewWidth / 2) / CHUNK_SIZE) + 1);
  const chunksY = Math.min(3, Math.ceil((viewHeight / 2) / CHUNK_SIZE) + 1);

  for (let x = cx - chunksX; x <= cx + chunksX; x++) {
    for (let y = cy - chunksY; y <= cy + chunksY; y++) {
      const chunkId = `${x}_${y}`;
      if (!loadedChunks.has(chunkId)) {
        loadedChunks.add(chunkId);
        fetchWithRetry(`/api/chunk?minX=${x * CHUNK_SIZE}&minY=${y * CHUNK_SIZE}&maxX=${(x + 1) * CHUNK_SIZE}&maxY=${(y + 1) * CHUNK_SIZE}`)
          .then(res => res.json())
          .then(data => {
            if (data && data.users) {
              // Check if player is still near before processing to avoid stuttering during high-speed warp
              const currentCx = Math.floor(player.x / CHUNK_SIZE);
              const currentCy = Math.floor(player.y / CHUNK_SIZE);
              if (Math.abs(currentCx - x) <= chunksX + 1 && Math.abs(currentCy - y) <= chunksY + 1) {
                for (const [login, user] of Object.entries(data.users)) {
                  if (!islands.find(i => i.login === login)) {
                    islands.push(buildIsland(login, user));
                  }
                }
              } else {
                // We moved away too fast, discard the chunk so it can be re-requested later if needed
                loadedChunks.delete(chunkId);
              }
            }
          })
          .catch(err => {
            // Remove from loaded so it retries next cycle
            loadedChunks.delete(chunkId);
          });
      }
    }
  }

  // Garbage collection: remove islands too far away
  const maxDist = Math.max(chunksX, chunksY) * CHUNK_SIZE + CHUNK_SIZE * 2;
  islands = islands.filter(island => {
    const dist = Math.max(Math.abs(island.cx - player.x), Math.abs(island.cy - player.y));
    const isNear = dist < maxDist;
    if (!isNear) {
      const cX = Math.floor(island.cx / CHUNK_SIZE);
      const cY = Math.floor(island.cy / CHUNK_SIZE);
      loadedChunks.delete(`${cX}_${cY}`);
    }
    return isNear;
  });
}

setInterval(checkChunks, 1000);
