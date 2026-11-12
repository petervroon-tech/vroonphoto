// vroonphoto Service Worker - Unregister & Clean v1.0.0
self.addEventListener('install', e => {
  self.skipWaiting();
  caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  self.registration.unregister();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Stuur elk verzoek direct door naar het live netwerk, nooit uit de cache
  e.respondWith(fetch(e.request));
});
