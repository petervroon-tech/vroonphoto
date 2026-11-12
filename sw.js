/**
 * sw.js
 * Service Worker for vroonphoto
 * Ensures instant offline operation and detects new versions upon application launch.
 */

const CACHE_NAME = 'vroonphoto-v1.0.0';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './version.json',
    './manifest.webmanifest',
    './src/css/styles.css',
    './src/wasm/vroonphoto_core.wasm',
    './src/js/wasm_engine.js',
    './src/js/raw_decoder.js',
    './src/js/color_bleed_fix.js',
    './src/js/denoise.js',
    './src/js/punchy_bw.js',
    './src/js/super_resolution.js',
    './src/js/inpaint.js',
    './src/js/tone_curve.js',
    './src/js/histogram.js',
    './src/js/version_checker.js',
    './src/js/app.js'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('📦 Service Worker caching app assets for offline use');
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Network-first for version.json and HTML so version updates are detected immediately
    if (url.pathname.endsWith('version.json') || url.pathname.endsWith('index.html') || url.pathname === '/' || url.pathname.endsWith('/')) {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    const cloned = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    // Cache-first for WASM, JS, and CSS with background revalidation
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                // Background update
                fetch(event.request).then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
                    }
                }).catch(() => {});
                return cachedResponse;
            }
            return fetch(event.request);
        })
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.action === 'skipWaiting') {
        self.skipWaiting();
    }
});
