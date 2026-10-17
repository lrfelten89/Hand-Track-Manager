// MeetManager service worker.
// CACHE_VERSION must be bumped with every release (it is tied to the app
// version) — this is what invalidates stale cached clients after a deploy.
const CACHE_VERSION = 'meetmanager-v0.4.11';
const APP_SHELL = [
  './',
  'index.html',
  'styles.css',
  'domain.mjs',
  'manifest.json',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Never intercept cross-origin (Firebase, gstatic, CDNs) or the Netlify
  // functions endpoint — those must always hit the network.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/.netlify/')) return;

  // Network-first for the app shell: fresh deploys take effect on the next
  // load, with the cached copy as the offline fallback. This ordering exists
  // because cache-first previously caused stale-build confusion at meets.
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined))
      )
  );
});
