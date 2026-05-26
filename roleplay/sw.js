const CACHE_NAME = 'roleplay-v10';
const APP_PATH = '/roleplay/';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll([APP_PATH, APP_PATH + 'index.html']))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 클라이언트에서 SKIP_WAITING 메시지 → 즉시 새 SW로 전환
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // index.html / navigate 요청은 항상 네트워크 먼저 (캐시는 fallback)
  const isNav = e.request.mode === 'navigate' || e.request.url.endsWith('/index.html') || e.request.url.endsWith('/roleplay/');
  e.respondWith(
    fetch(e.request, isNav ? { cache: 'no-store' } : undefined)
      .then(res => {
        if (res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || (isNav ? caches.match(APP_PATH + 'index.html') : undefined)))
  );
});
