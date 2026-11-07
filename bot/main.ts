// Runs @oasa_bus_bot (bot.ts) with Telegram long polling, plain fetch and a state file. Built to one file
// for node 22 (`bun run bot:build` → dist-bot/oasa-bus-bot.mjs); deployed by bot/deploy.sh.
//
// Env: TELEGRAM_TOKEN (required), STATE_DIR (default ~/.local/state/oasa-bus-bot), and the data URLs
// TRIPS_URL, STATIC_BASE, API_BASE. Never log the token: it is in every Telegram URL.
// Thessaloniki: a second bot with its own state file and data, from its own atrt instance (THESS_API_BASE,
// which serves its static/v1 too) and the map's THESS_TRIPS_URL; never OASTH itself.
// citybus.gr cities (bot/cities.ts): one bot each, with its own state file, from the one staseis-rt
// instance (CITYBUS_API_BASE) and the map's trips-<slug>.json (MAP_BASE).
// Telegram (web#56): one getUpdates loop; bot/router.ts hands each update to its city's bot (router.json
// keeps the offset and each chat's city). Every city sends through one gate: about 25 messages a second in all.
// Web push (off without the keys): VAPID_PUBLIC, VAPID_PRIVATE (`npx web-push generate-vapid-keys`),
// PUSH_PORT (default 8188, on 127.0.0.1 behind the Cloudflare tunnel), ORIGINS (default the map's: staseis.gr and the old bus.haroldpoi.dev).

import { createServer } from "node:http";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import webpush from "web-push";
import { byCity, pushApi } from "./http";
import { CITYBUS, citybusUrls } from "./cities";
import { Bot, type BotState, type Fetched, type PushSub, type TgResult } from "./bot";
import { Router, type RouterState } from "./router";

const token = process.env.TELEGRAM_TOKEN?.trim();
if (!token) {
  console.error("TELEGRAM_TOKEN is not set");
  process.exit(2);
}
const dir = process.env.STATE_DIR || join(homedir(), ".local/state/oasa-bus-bot");
const file = join(dir, "state.json");
mkdirSync(dir, { recursive: true, mode: 0o700 });

function load<T = BotState>(f: string): T | undefined {
  try { return JSON.parse(readFileSync(f, "utf8")); } catch { return undefined; }
}

// Written whole and renamed: a crash leaves the old file or the new one, never half of one.
const saver = (f: string) => (s: BotState | RouterState) => {
  writeFileSync(`${f}.tmp`, JSON.stringify(s), { mode: 0o600 });
  renameSync(`${f}.tmp`, f);
};

async function tg(method: string, body: Record<string, unknown>): Promise<TgResult> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(method === "getUpdates" ? 65_000 : 15_000),
    });
    return (await r.json()) as TgResult;
  } catch {
    return { ok: false };
  }
}

async function get(url: string): Promise<Fetched> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "user-agent": "oasa-bus-bot (+https://bus.haroldpoi.dev)" } });
    let body: unknown = null;
    try { body = await r.json(); } catch { /* an error page */ }
    const date = Date.parse(r.headers.get("date") ?? "");
    return Number.isFinite(date) ? { status: r.status, body, date } : { status: r.status, body };
  } catch {
    return { status: 0, body: null };
  }
}

const vapid = { pub: process.env.VAPID_PUBLIC?.trim(), priv: process.env.VAPID_PRIVATE?.trim() };
if (vapid.pub && vapid.priv) webpush.setVapidDetails("https://bus.haroldpoi.dev", vapid.pub, vapid.priv);

// TTL 2 min: a late "the bus is coming" is worse than none.
async function push(sub: PushSub, data: string): Promise<number> {
  if (!vapid.pub) return 0;
  try {
    return (await webpush.sendNotification(sub, data, { TTL: 120, urgency: "high", timeout: 15_000 })).statusCode;
  } catch (e) {
    return (e as { statusCode?: number }).statusCode ?? 0;
  }
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// Sends of all cities one after the other, 40 ms apart (getUpdates does not wait here).
let gate: Promise<unknown> = Promise.resolve();
function send(method: string, body: Record<string, unknown>): Promise<TgResult> {
  const r = gate.then(() => tg(method, body));
  gate = r.then(() => sleep(40));
  return r;
}
const strip = (s: string) => s.replace(/\/+$/, "");

const bot = new Bot({
  urls: {
    trips: process.env.TRIPS_URL || "https://bus.haroldpoi.dev/trips.json",
    static: strip(process.env.STATIC_BASE || "https://angelospk.github.io/staseis-rt/static/v1"),
    api: strip(process.env.API_BASE || "https://transit.haroldpoi.dev"),
  },
  now: Date.now, sleep, save: saver(file), tg: send, get, push,
}, load(file));

const thessFile = join(dir, "state-thessaloniki.json");
const thessApi = strip(process.env.THESS_API_BASE || "https://transit-thess.haroldpoi.dev");
const thess = new Bot({
  urls: { trips: process.env.THESS_TRIPS_URL || "https://staseis.gr/trips-thessaloniki.json", static: `${thessApi}/static/v1`, api: thessApi },
  agency: "ΟΑΣΘ", prefix: "skg", now: Date.now, sleep, save: saver(thessFile), tg: send, get, push,
}, load(thessFile));
const cityApi = process.env.CITYBUS_API_BASE || "https://staseis-rt.haroldpoi.dev";
const mapBase = process.env.MAP_BASE || "https://staseis.gr";
const citybus = CITYBUS.map((c): [string, Bot] => {
  const f = join(dir, `state-${c.slug}.json`);
  return [c.slug, new Bot({ urls: citybusUrls(cityApi, mapBase, c), agency: "Αστικού ΚΤΕΛ", prefix: c.code, now: Date.now, sleep,
    save: saver(f), tg: send, get, push }, load(f))];
});
const cities: [string, Bot][] = [["athens", bot], ["thessaloniki", thess], ...citybus];
const bots = cities.map(([, b]) => b);
const flushAll = () => { for (const b of bots) void b.flush(); };

const routerFile = join(dir, "router.json");
const router = new Router({
  cities: [{ code: "ath", name: "Αθήνα", bot }, { code: "skg", name: "Θεσσαλονίκη", bot: thess },
    ...CITYBUS.map((c, k) => ({ code: c.code, name: c.name, bot: citybus[k][1] }))],
  save: saver(routerFile),
}, load<RouterState>(routerFile), bot.offset);   // the first start: on from the Athens bot's offset

const ORIGINS = (process.env.ORIGINS || "https://staseis.gr,https://bus.haroldpoi.dev").split(",").map(s => s.trim());
if (vapid.pub && vapid.priv)
  createServer(pushApi(byCity(Object.fromEntries(cities), "athens"), { key: vapid.pub, origins: ORIGINS }, flushAll))
    .listen(Number(process.env.PUSH_PORT) || 8188, "127.0.0.1");
else console.log("web push off: no VAPID keys");

async function updates() {
  for (;;) {
    const r = await tg("getUpdates", { offset: router.offset, timeout: 50, allowed_updates: ["message", "callback_query"] });
    if (r.ok && Array.isArray(r.result)) {
      await router.handle(r.result);
      flushAll();
    } else {
      console.error(`getUpdates: ${r.error_code ?? "network"}`);
      await sleep(r.error_code === 401 ? 600_000 : 5000);   // 401: wrong token
    }
  }
}

// One gate per city: a slow city does not pause the other.
for (const [name, b] of cities) {
  let ticking = false;
  setInterval(() => {
    if (ticking) return;
    ticking = true;
    // Sending runs apart from the tick: a slow send or a Telegram wait must not pause polling.
    b.tick().catch(e => console.error(`tick ${name}:`, (e as Error).message)).finally(() => {
      ticking = false;
      void b.flush();
    });
  }, 1000);
}

// Rail stops on their own gate: a slow /v2 board does not pause the bus lines.
let railTicking = false;
setInterval(() => {
  if (railTicking) return;
  railTicking = true;
  bot.tickRails().catch(e => console.error("rail tick:", (e as Error).message)).finally(() => {
    railTicking = false;
    void bot.flush();
  });
}, 1000);

console.log(`oasa-bus-bot started, ${cities.length} cities, state in ${dir}`);
bot.init();
void updates();
