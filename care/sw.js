const CACHE_NAME = 'care-v2-no-auto-skip';
const APP_PATH = '/care/';

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
  const isNav = e.request.mode === 'navigate'
    || e.request.url.endsWith('/index.html')
    || e.request.url.endsWith('/care/');
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

// ═══ 약 복용 알림 (로컬 + 향후 Web Push 대응) ═══
// 클라이언트가 postMessage로 약 시간 알림 요청 → SW가 즉시 notification 표시
self.addEventListener('message', e => {
  const d = e.data;
  if (d?.type === 'SHOW_MED_NOTIFICATION') {
    self.registration.showNotification(d.title || '💊 약 드실 시간이에요', {
      body: d.body || '',
      icon: APP_PATH + 'icon-192.png',
      badge: APP_PATH + 'icon-192.png',
      tag: d.tag || 'med-' + Date.now(),
      renotify: true,
      requireInteraction: true,
      vibrate: [200, 100, 200],
      data: { url: APP_PATH }
    });
  }
});

// 알림 클릭 → 앱 열기 (또는 이미 열린 창 포커스)
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || APP_PATH;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const c of clients) {
        if (c.url.includes('/care/') && 'focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

// 향후 Web Push 대응 — 서버에서 푸시 전송 시 알림 표시
self.addEventListener('push', e => {
  let payload = {};
  try { payload = e.data ? e.data.json() : {}; } catch { payload = { title: e.data?.text() || '안심케어 알림' }; }
  const title = payload.title || '💊 약 드실 시간이에요';
  const options = {
    body: payload.body || '',
    icon: APP_PATH + 'icon-192.png',
    badge: APP_PATH + 'icon-192.png',
    tag: payload.tag || 'med',
    renotify: true,
    requireInteraction: true,
    vibrate: [200, 100, 200],
    data: { url: payload.url || APP_PATH }
  };
  e.waitUntil(self.registration.showNotification(title, options));
});
