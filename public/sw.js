// service worker เล็กที่สุด: ส่งต่อเครือข่ายตรง ๆ ไม่ cache (Android ต้องมีถึงจะขึ้นปุ่มติดตั้ง)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).pathname.startsWith('/socket.io/')) return;
  e.respondWith(fetch(e.request));
});
