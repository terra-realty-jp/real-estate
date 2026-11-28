const CACHE_NAME = 'terra-v5';
const PRECACHE = [
  '/real-estate/',
  '/real-estate/inage/',
  '/real-estate/inage/index.html',
  '/real-estate/supabase-client.js'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(PRECACHE).catch(function() {});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE_NAME; }).map(function(k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  // 自サイト以外（Supabase・CDN・解析タグ・地図タイル等）はキャッシュしない（容量の肥大化防止）
  if (url.origin !== self.location.origin) return;
  // トークン入りURL（登録確認・配信停止）は端末に残さない
  if (url.pathname.indexOf('/subscription.html') !== -1) return;
  // HTML・JS・データ（geojson/json）も含め、オンライン時は常に最新を取得する。
  // 古いキャッシュを掴ませない（ヒートマップ計算ロジック等の更新が即反映されるように）。
  // キャッシュはオフライン時のフォールバックとしてのみ使う。
  var req = fetch(e.request, { cache: 'no-cache' });
  e.respondWith(
    req.then(function(res) {
      if (res.ok) {
        var clone = res.clone();
        caches.open(CACHE_NAME).then(function(cache) { cache.put(e.request, clone); });
      }
      return res;
    }).catch(function() {
      return caches.match(e.request);
    })
  );
});
