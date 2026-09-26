/*
 * Service worker: makes the app installable and usable offline.
 *
 * Strategy: "stale-while-revalidate" for our own files.
 *  - A request is answered from the cache immediately (fast, works offline).
 *  - In the background the file is fetched again and the cache updated,
 *    so the next app start picks up a new version after a deploy.
 * Bump CACHE_VERSION with every release (see js/version.js).
 */
const CACHE_VERSION = 'bfit-v1.1';

const APP_SHELL = [
  './',
  'index.html',
  'manifest.json',
  'css/style.css',
  'js/app.js',
  'js/db.js',
  'js/util.js',
  'js/record.js',
  'js/history.js',
  'js/exercises.js',
  'js/settings.js',
  'js/chart.js',
  'js/stats.js',
  'js/filters.js',
  'js/version.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

// Pre-cache the app shell when the service worker is installed.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// Remove caches from older versions.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only handle GET requests to our own origin.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // Page navigations are always served by index.html (single page app).
    const cached = req.mode === 'navigate'
      ? await cache.match('index.html')
      : await cache.match(req, { ignoreSearch: true });

    const network = fetch(req)
      .then((res) => {
        if (res.ok) cache.put(req.mode === 'navigate' ? 'index.html' : req, res.clone());
        return res;
      })
      .catch(() => cached); // offline: fall back to the cached copy

    if (cached) {
      event.waitUntil(network); // refresh the cache in the background
      return cached;
    }
    return network;
  })());
});
