const CACHE_NAME = 'dino-main-v14';
const APP_PATH = '/main/';

// ── 푸시 알림 수신 ──
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch {}
  const title = data.title || '옆집디노';
  const options = {
    body: data.body || '',
    icon: data.icon || '/main/icon-192.png',
    badge: data.badge || '/main/icon-192.png',
    tag: data.tag || 'dino-default',
    data: { url: data.url || '/main/' },
    vibrate: [80, 50, 80]
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// 알림 클릭 시 해당 URL 열기 (이미 열려있으면 그 탭 포커스)
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const targetUrl = e.notification.data?.url || '/main/';
  e.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of allClients) {
      if (c.url.includes(targetUrl) && 'focus' in c) return c.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
  })());
});

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

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || (e.request.mode === 'navigate' ? caches.match(APP_PATH + 'index.html') : undefined)))
  );
});
