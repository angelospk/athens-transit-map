// Web push for stop alerts: the bot on the VPS (bot/main.ts) watches the alert and pushes each hit, so it
// comes with the page closed. The link payload is the Telegram one (tglink.ts). Loaded with the planner.

export const PUSH_URL = (import.meta.env.VITE_PUSH_URL || "https://push.haroldpoi.dev").replace(/\/+$/, "");

// iPhones have PushManager only in a web app opened from the Home Screen.
export const canPush = () =>
  typeof navigator !== "undefined" && "serviceWorker" in navigator && typeof PushManager !== "undefined" &&
  typeof Notification !== "undefined" && Notification.permission !== "denied";

const bytes = (b64url: string) => Uint8Array.from(atob(b64url.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const same = (a: ArrayBuffer | null | undefined, b: Uint8Array) => !!a && a.byteLength === b.length && new Uint8Array(a).every((x, k) => x === b[k]);

// The alert's id and end (Unix s), or null: no permission, no push service, or the server refused.
export async function startPush(reg: ServiceWorkerRegistration, payload: string): Promise<{ id: string; until: number } | null> {
  try {
    const signal = AbortSignal.timeout(15_000);
    const k = await fetch(`${PUSH_URL}/key`, { signal });
    const key = k.ok ? ((await k.json()) as { key?: unknown }).key : null;
    if (typeof key !== "string") return null;
    const want = bytes(key);
    let sub = await reg.pushManager.getSubscription();
    if (sub && !same(sub.options.applicationServerKey, want)) { await sub.unsubscribe(); sub = null; }   // the server's key changed
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
    const r = await fetch(`${PUSH_URL}/alerts`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ p: payload, sub: sub.toJSON() }), signal,
    });
    if (r.status !== 201) return null;
    const b = (await r.json()) as { id?: unknown; until?: unknown };
    return typeof b.id === "string" && typeof b.until === "number" ? { id: b.id, until: b.until } : null;
  } catch {
    return null;
  }
}

// keepalive: the request goes out even when the page is closing. Each stop is written down first and
// crossed out when the server confirms it; one left over is sent again on the next load (retryStops),
// until its alert would have ended anyway.
const STOPS = "pushStops", KEEP_MS = 2 * 3600_000;
const pending = (): [string, number][] => {
  try {
    const v = JSON.parse(localStorage.getItem(STOPS) ?? "[]");
    return Array.isArray(v) ? v.filter(x => Array.isArray(x) && typeof x[0] === "string" && Date.now() - x[1] < KEEP_MS) : [];
  } catch { return []; }
};
const keep = (list: [string, number][]) => { try { localStorage.setItem(STOPS, JSON.stringify(list)); } catch { /* private mode */ } };

// Read again after each answer: another stop may have been written down meanwhile.
async function send(id: string) {
  try {
    const r = await fetch(`${PUSH_URL}/alerts/${encodeURIComponent(id)}`, { method: "DELETE", keepalive: true });
    if (r.ok) keep(pending().filter(x => x[0] !== id));
  } catch { /* offline: kept for the next load */ }
}

export async function stopPush(id: string) {
  keep([...pending().filter(x => x[0] !== id), [id, Date.now()]]);
  await send(id);
}

export async function retryStops() {
  try { if ((localStorage.getItem(STOPS) ?? "[]") === "[]") return; } catch { return; }
  const list = pending();
  keep(list);   // drops the expired ones
  for (const [id] of list) await send(id);
}
