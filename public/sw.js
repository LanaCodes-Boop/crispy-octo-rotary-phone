// Service worker for the installable appointment book (registered by admin.js, scope /admin).
// Shell assets are served cache-first; the API is never cached. Bump VERSION when the shell list changes.

const VERSION = 'younique-admin-v2';
const SHELL = [
  '/admin',
  '/css/styles.css',
  '/css/admin.css',
  '/js/admin.js',
  '/js/slots.js',
  '/js/designer-art.js',
  '/config.json',
  '/admin.webmanifest',
  '/images/favicon.svg',
  '/images/icons/icon-192.png',
];
const ALIASES = { '/admin/': '/admin', '/admin.html': '/admin' };

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  const stale = (key) => key.startsWith('younique-admin-') && key !== VERSION;
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter(stale).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;
  // Network only: bookings must always be live, so API responses never touch the cache.
  if (url.pathname.startsWith('/api/')) return;

  const key = ALIASES[url.pathname] || url.pathname;
  if (!SHELL.includes(key)) return;

  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(key);
      // Refresh in the background so the next visit picks up a new deploy.
      const network = fetch(request)
        .then((res) => {
          if (res.ok && res.type === 'basic') cache.put(key, res.clone());
          return res;
        })
        .catch(() => cached);
      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      return network;
    }),
  );
});
