const CACHE_NAME = 'terra-v3';
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
  if (e.request.url.includes('supabase.co') || e.request.url.includes('googletagmanager')) return;
  // HTML（map.html等の画面）は常に最新を取得する。古いキャッシュを掴ませない。
  var isDoc = e.request.mode === 'navigate'
    || e.request.destination === 'document'
    || e.request.url.endsWith('.html')
    || e.request.url.endsWith('/');
  var req = isDoc ? fetch(e.request, { cache: 'no-cache' }) : fetch(e.request);
  e.respondWith(
    req.then(function(res) {
      var clone = res.clone();
      caches.open(CACHE_NAME).then(function(cache) { cache.put(e.request, clone); });
      return res;
    }).catch(function() {
      return caches.match(e.request);
    })
  );
});
