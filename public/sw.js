// Only for stop alerts: phones show notifications through a service worker, and web push from the bot
// (bot/bot.ts: {title, body, tag}) arrives here. No fetch handler, so nothing is cached and the site
// loads as before. A tap on a notification brings the map back.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { /* not ours */ }
  e.waitUntil(self.registration.showNotification(d.title || "Λεωφορείο",
    { body: d.body || "", tag: d.tag, renotify: !!d.tag, icon: new URL("icon-192.png", self.registration.scope).href }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true })
    .then(cs => (cs[0] ? cs[0].focus() : self.clients.openWindow(self.registration.scope))));
});
