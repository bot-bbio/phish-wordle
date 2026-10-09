// Service worker: makes Phishle installable and playable offline.
//
// Two caching strategies, chosen per request:
//   data/*.json   network-first  -> fresh gaps after every data refresh,
//                                   cached copy when offline
//   everything    stale-while-revalidate -> instant load from cache, with the
//   else                          cache quietly updated for the next visit
//                                 (album covers are cached this way the first
//                                 time a guess shows them)
//
// Bump CACHE_VERSION to force every client to drop its old cache.

const CACHE_VERSION = 'phishle-v2';

const APP_SHELL = [
  './',
  'index.html',
  'css/style.css',
  'fonts/inter-latin.woff2',
  'js/app.js',
  'js/game.js',
  'js/normalize.js',
  'js/storage.js',
  'manifest.json',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'data/songs.json',
  'data/schedule.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Only handle our own GET requests; outbound links (phish.net, phish.in) pass through.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.pathname.includes('/data/')) {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(staleWhileRevalidate(request, event));
  }
});

/** @param {Request} request */
async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error('offline and not cached');
  }
}

/** @param {Request} request @param {FetchEvent} event */
async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request, { ignoreSearch: true });
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  if (cached) {
    event.waitUntil(refresh); // keep the worker alive until the cache update lands
    return cached;
  }
  return refresh;
}
