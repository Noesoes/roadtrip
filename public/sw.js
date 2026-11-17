// Offline support: app shell + map tiles you've already seen.
// Trip data itself (route + suggestions) is saved by the app in localStorage.
const SHELL = 'shell-v2';
const TILES = 'tiles-v1';
const TILE_LIMIT = 1500;

// Cache the page and everything it links to up front, so the very first visit
// is enough to reopen the app later with no signal.
async function precache() {
  const cache = await caches.open(SHELL);
  const res = await fetch('./', { cache: 'no-cache' });
  const html = await res.clone().text();
  await cache.put('./', res);
  const urls = [...html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)].map((m) => m[1]);
  await Promise.all(urls.map((u) => cache.add(u).catch(() => {})));
}

self.addEventListener('install', (e) => {
  e.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== TILES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - TILE_LIMIT; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'tile.openstreetmap.org') {
    e.respondWith(
      caches.open(TILES).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) {
          cache.put(req, res.clone());
          trim(cache);
        }
        return res;
      }),
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Same-origin: fresh when online, cached when not.
  e.respondWith(
    caches.open(SHELL).then(async (cache) => {
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch (err) {
        const hit = (await cache.match(req)) || (req.mode === 'navigate' && (await cache.match('./')));
        if (hit) return hit;
        throw err;
      }
    }),
  );
});
