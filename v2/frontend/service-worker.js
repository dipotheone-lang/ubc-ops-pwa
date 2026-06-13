/**
 * service-worker.js — v2 PWA.
 * NETWORK-FIRST for the app shell so a new deploy is picked up immediately when
 * online (no more stale-bundle trap); falls back to cache only when offline.
 * API calls (script.google.com / googleusercontent) are never intercepted.
 */
var CACHE = 'ubc-ops-v2-9';
var SHELL = ['./', './index.html', './manifest.webmanifest', './css/styles.css',
  './js/i18n.js', './js/api.js', './js/ui.js', './js/dashboard.js', './js/admin.js', './js/notifications.js', './js/app.js'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { if (k !== CACHE) return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('message', function (e) { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.hostname.indexOf('script.google.com') !== -1 || url.hostname.indexOf('googleusercontent.com') !== -1) return;
  if (url.origin !== self.location.origin) return;
  // network-first: always try the live file; cache the fresh copy; fall back when offline
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.status === 200 && (res.type === 'basic' || res.type === 'default')) {
        var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (c) { return c || caches.match('./index.html'); });
    })
  );
});
