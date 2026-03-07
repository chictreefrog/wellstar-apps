const CACHE_NAME = '5min-planner-v6';
const ASSETS = [
  '/planner/',
  '/planner/index.html',
  '/planner/manifest.json',
  '/planner/icon-192.png',
  '/planner/icon-512.png'
];

// Install — cache core assets, activate immediately
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate — delete ALL old caches, take control immediately
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — NETWORK FIRST, cache fallback (always get latest)
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
      .catch(() => {
        return caches.match(e.request).then(cached => {
          if (cached) return cached;
          if (e.request.mode === 'navigate') {
            return caches.match('/planner/index.html');
          }
        });
      })
  );
});

// Push notification handler
self.addEventListener('push', e => {
  if (!e.data) return;
  const data = e.data.json();
  e.waitUntil(
    self.registration.showNotification(data.title || '5분법칙플래너', {
      body: data.body || '',
      icon: '/planner/icon-192.png',
      badge: '/planner/icon-192.png',
      tag: data.tag || 'planner',
      vibrate: [200, 100, 200]
    })
  );
});

// Notification click — open app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then(list => {
      for (const client of list) {
        if (client.url.includes('/planner') && 'focus' in client) return client.focus();
      }
      return clients.openWindow('/planner/');
    })
  );
});
