// sw.js – Service Worker for Shark-Tooth Detector PWA
// --------------------------------------------------
// 1. すべての実行ファイルを precache してオフライン対応
// 2. cache-first → network fallback 方式
// 3. CACHE_NAME を上げれば旧キャッシュが削除される

const CACHE_NAME = 'tooth-detector-v2';

const FILES_TO_CACHE = [
  '/',                        // ルート（index.html に解決）
  '/index.html',
  '/script.js',
  '/worker.js',
  '/style.css',               // 存在する場合
  '/best.onnx',

  // ONNX Runtime Web 1.22.0 ランタイム一式
  '/ort-web.min.js',
  '/ort-wasm-simd-threaded.wasm',
  '/ort-wasm-simd-threaded.mjs',

  // JSEP (WebGPU/WebNN) 版 － 使わなくても 404 回避用に置く
  '/ort-wasm-simd-threaded.jsep.wasm',
  '/ort-wasm-simd-threaded.jsep.mjs',

  // PWA アイコン・マニフェスト
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// ---------- install ----------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();               // 即座に新 SW を有効化
});

// ---------- activate ----------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME) // 古いキャッシュを削除
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();             // ページを即制御
});

// ---------- fetch ----------
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then(
      (cached) => cached || fetch(event.request)
    )
  );
});
