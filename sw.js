/* QR Attendance v7 — service worker */
const CACHE = 'qratt-v7';
const PRECACHE = [
  '/',
  'index.html',
  'manifest.json',
  'frontend/css/styles.css',
  'frontend/js/app.js',
  'backend/auth/AuthService.js',
  'backend/db/DataService.js',
  'backend/middleware/Middleware.js',
  'backend/utils/Utils.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  // Always network-first for Firebase/Google APIs
  if (u.hostname.includes('google') || u.hostname.includes('firebase') || u.hostname.includes('gstatic') || u.hostname.includes('cloudflare')) {
    e.respondWith(
      fetch(e.request).catch(() => new Response('{}', { headers: { 'Content-Type': 'application/json' } }))
    );
    return;
  }
  // Cache-first for everything else
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok && e.request.method === 'GET') {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        }
        return res;
      }).catch(() => caches.match('index.html'));
    })
  );
});
