// Service worker: only for reminders (Web Push). No offline caching — the temple is a live place.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { body: e.data?.text() || '' }; }
  e.waitUntil(self.registration.showNotification(m.title || '雲上寺', {
    body: m.body || '', tag: m.tag || undefined, data: { url: m.url || '/' },
    icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', lang: 'zh-Hant',
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin !== self.location.origin) continue;
      try { await w.navigate(url); } catch { /* not controlled yet */ }
      return w.focus();
    }
    return self.clients.openWindow(url);
  })());
});
