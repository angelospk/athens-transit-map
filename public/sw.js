// The site's service worker: stop alerts (web push from the bot, bot/bot.ts: {title, body, tag}), and use without a
// connection. What it keeps is only what does not go stale in minutes:
// - the app itself: the page (from the network first, so a new deploy always wins), its hashed code and icons;
// - timetables and line data (/schedule, the static line files, the /v2 line and stop lists, trips.json), from the
//   network first and kept for when there is none;
// - the base map's style and tiles, the same way, at most MAP_MAX of them; the typeface.
// Never live data (arrivals, vehicles, a train's run): from a cache they would show old times as if they were now.
const PAGE = "staseis-page-v1", SHELL = "staseis-shell-v1", DATA = "staseis-data-v1", MAP = "staseis-map-v1";
const MAP_MAX = 2500, SHELL_MAX = 400;   // old builds' code files go once there are more
const WAIT_MS = 6000;   // a network that does not answer in this long counts as none

self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(PAGE).then(c => c.add(new Request(self.registration.scope, { cache: "reload" }))).catch(() => {}));
});
self.addEventListener("activate", e => e.waitUntil((async () => {
  const keep = new Set([PAGE, SHELL, DATA, MAP]);
  for (const k of await caches.keys()) if (k.startsWith("staseis-") && !keep.has(k)) await caches.delete(k);
  await self.clients.claim();
})()));

// The timetable and line requests worth keeping, by their path (any of the city's API or static hosts).
const DATA_PATH = [
  /\/v1\/lines\/[^/]+\/schedule$/,   // a bus line's timetable
  /\/static\/v1\//,                  // the static line files and lists
  /\/v2\/lines$/, /\/v2\/stops$/,    // the lists of lines and stops (the search)
  /\/v2\/lines\/[^/]+$/,             // a line's stops and patterns (not /vehicles)
];

self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET") return;
  const u = new URL(r.url);
  if (r.mode === "navigate") { e.respondWith(page(r)); return; }
  if (u.origin === location.origin) {
    if (/\.(js|css|woff2?|png|svg|webp|ico|webmanifest)$/.test(u.pathname)) e.respondWith(cacheFirst(r, SHELL));
    else if (u.pathname.endsWith(".json")) e.respondWith(networkFirst(r, DATA));   // trips.json, metro.json, …
    return;
  }
  if (DATA_PATH.some(p => p.test(u.pathname))) { e.respondWith(networkFirst(r, DATA)); return; }
  // The app's typeface: its files never change (cache first), its stylesheet may (network first).
  if (u.hostname === "fonts.gstatic.com") { e.respondWith(cacheFirst(r, SHELL)); return; }
  if (u.hostname === "fonts.googleapis.com") { e.respondWith(networkFirst(r, SHELL)); return; }
  if (u.hostname.endsWith("openfreemap.org")) e.respondWith(networkFirst(r, MAP, true));
});

async function page(r) {
  try {
    const res = await timed(fetch(r));
    if (res.ok) { const c = await caches.open(PAGE); await c.put(r, res.clone()); void trimCache(c, 40); }
    return res;
  } catch {
    // Offline: this page as it was, else the app's start page (it opens on any of its paths).
    return (await caches.match(r)) || (await caches.match(self.registration.scope)) || Response.error();
  }
}

let puts = 0;
async function cacheFirst(r, name) {
  const hit = await caches.match(r);
  if (hit) return hit;
  const res = await fetch(r);
  if (keepable(res)) { const c = await caches.open(name); await c.put(r, res.clone()); if (++puts % 50 === 0) void trimCache(c, SHELL_MAX); }
  return res;
}

// An answer worth keeping: a whole one, or a cross-origin one the page asked for without CORS (a stylesheet).
const keepable = res => res.ok || res.type === "opaque";

async function networkFirst(r, name, trim = false) {
  try {
    const res = await timed(fetch(r));
    if (keepable(res)) {
      const c = await caches.open(name);
      await c.put(r, res.clone());
      if (trim && ++puts % 100 === 0) void trimCache(c, MAP_MAX);
    }
    return res;
  } catch {
    const hit = await caches.match(r);
    if (hit) return hit;
    return new Response(JSON.stringify({ offline: true }), { status: 503, headers: { "Content-Type": "application/json" } });
  }
}

// The oldest entries go first (a cache lists its keys in the order they were put).
// The start page stays: it is what opens any path offline.
async function trimCache(c, max) {
  const keys = (await c.keys()).filter(k => k.url !== self.registration.scope);
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

function timed(p) {
  return new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error("timeout")), WAIT_MS);
    p.then(v => { clearTimeout(t); ok(v); }, err => { clearTimeout(t); no(err); });
  });
}

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
