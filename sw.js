// sw.js – Service Worker for Shark-Tooth Detector PWA
// ---------------------------------------------------
// 1. 必要ファイルをすべて precache
// 2. cache-first → network fallback でオフライン対応
// 3. v 番号を上げれば旧キャッシュが自動で削除される

const CACHE_NAME = 'tooth-detector-v1';
const FILES_TO_CACHE = [
  '/',                       // index.html が返る
  '/index.html',
  '/script.js',
  '/worker.js',
  '/best.onnx',
  '/ort-web.min.js',
  '/ort-wasm-simd-threaded.wasm',
  // ↓ 必要なら追加
  // '/icon-192.png',
  // '/icon-512.png',
  // '/manifest.json',
];

// ----- install -----
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();             // 即時アクティブ化
});

// ----- activate -----
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME) // 古いキャッシュ名を削除
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();           // クライアント即制御
});

// ----- fetch: cache-first -----
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
