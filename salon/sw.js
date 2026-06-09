const CACHE_NAME = 'salon-v2-phone-gate';
const APP_PATH = '/salon/';

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

self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  // API 호출은 절대 캐시하지 않음 (디노 언니 응답이 굳어버리면 안 됨)
  if (url.includes('/api/')) return;

  const isNav = e.request.mode === 'navigate'
    || url.endsWith('/index.html')
    || url.endsWith('/salon/');
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
