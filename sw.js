/* SK 항법지도 2.0 — 서비스워커 (오프라인 캐싱) */
var CACHE_NAME = 'sk-navmap-4534cb9';
var ASSET_URLS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/calc.js',
  './js/data.js',
  './js/map.js',
  './js/ui.js',
  './js/app.js',
  './navmap_data.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(ASSET_URLS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 구글 맵스 등 외부 요청은 그대로 통과

  // 데이터 파일: 네트워크 우선(최신 데이터), 실패 시 캐시로 대체
  if (url.pathname.endsWith('navmap_data.json')) {
    event.respondWith(
      fetch(req)
        .then(function (res) {
          var clone = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, clone); });
          return res;
        })
        .catch(function () { return caches.match(req); })
    );
    return;
  }

  // 나머지 정적 자산: 캐시 우선, 없으면 네트워크
  event.respondWith(
    caches.match(req).then(function (cached) {
      return cached || fetch(req).then(function (res) {
        var clone = res.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(req, clone); });
        return res;
      });
    })
  );
});
