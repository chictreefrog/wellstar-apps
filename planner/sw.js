const CACHE_NAME = '5min-planner-v1';
const ASSETS = [
  '/planner/',
  '/planner/index.html',
  '/planner/manifest.json',
  '/planner/icon-192.png',
  '/planner/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap'
];

// Install — cache core assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — cache first, fallback to network
self.addEventListener('fetch', e => {
  // Skip non-GET
  if (e.request.method !== 'GET') return;
  
  // For font/CSS from Google — network first, cache fallback
  if (e.request.url.includes('fonts.googleapis.com') || e.request.url.includes('fonts.gstatic.com')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  
  // For app assets — cache first
  e.respondWith(
    caches.match(e.request)
      .then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          // Cache successful responses
          if (res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          }
          return res;
        });
      })
      .catch(() => {
        // Offline fallback for navigation
        if (e.request.mode === 'navigate') {
          return caches.match('/planner/index.html');
        }
      })
  );
});

// Push notification handler (future)
self.addEventListener('push', e => {
  if (!e.data) return;
  const data = e.data.json();
  e.waitUntil(
    self.registration.showNotification(data.title || '5분법칙 플래너', {
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
