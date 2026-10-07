// Only for stop alerts: phones show notifications through a service worker. No fetch handler, so
// nothing is cached and the site loads as before. A tap on a notification brings the map back.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true })
    .then(cs => (cs[0] ? cs[0].focus() : self.clients.openWindow(self.registration.scope))));
});
