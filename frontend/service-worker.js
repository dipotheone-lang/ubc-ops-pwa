/**
 * service-worker.js — app-shell caching for offline launch.
 *
 * Strategy:
 *   - App shell (HTML/CSS/JS/icons): cache-first, updated in the background.
 *   - API calls (Apps Script /exec): never cached here — the app's own
 *     IndexedDB queue + read cache handle offline data. We pass them through.
 */
var CACHE = 'ubc-ops-v1';
var SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/config.js',
  './js/db.js',
  './js/api.js',
  './js/image.js',
  './js/sync.js',
  './js/ui.js',
  './js/app.js',
  './assets/icons/icon.svg'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { if (k !== CACHE) return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                 // never intercept writes

  var url = new URL(req.url);
  // Pass-through for the backend API (Apps Script) and cross-origin POST-likes.
  if (url.hostname.indexOf('script.google.com') !== -1 ||
      url.hostname.indexOf('googleusercontent.com') !== -1) {
    return; // let the network handle it; app layer manages offline
  }

  // App shell: cache-first with background refresh.
  e.respondWith(
    caches.match(req).then(function (cached) {
      var network = fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return cached; });
      return cached || network;
    })
  );
});
