// sw.js – Service Worker for Offline Shark Tooth Detector PWA
// -----------------------------------------------------------
// • Precaches all runtime files (HTML/JS/WASM/ONNX/icons)
// • Serves them from cache-first, falling back to network
// • Cleans up old caches on activate

const CACHE_NAME = 'tooth-detector-v1';
const FILES_TO_CACHE = [
  '/',               // root → index.html (below)
  '/index.html',
  '/script.js',
  '/worker.js',
  '/style.css',      // if exists
  '/best.onnx',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/ort-web.min.js',
  '/ort-wasm-simd.wasm',
  '/ort-wasm-simd-threaded.wasm'
];

// -----------------------------------------------------------
// Install: cache all required assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();
});

// -----------------------------------------------------------
// Activate: clear old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// -----------------------------------------------------------
// Fetch: cache‑first, then network
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
