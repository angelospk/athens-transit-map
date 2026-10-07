// Runs @oasa_bus_bot (bot.ts) with Telegram long polling, plain fetch and a state file. Built to one file
// for node 22 (`bun run bot:build` → dist-bot/oasa-bus-bot.mjs); deployed by bot/deploy.sh.
//
// Env: TELEGRAM_TOKEN (required), STATE_DIR (default ~/.local/state/oasa-bus-bot), and the data URLs
// TRIPS_URL, STATIC_BASE, API_BASE. Never log the token: it is in every Telegram URL.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Bot, type BotState, type Fetched, type TgResult } from "./bot";

const token = process.env.TELEGRAM_TOKEN?.trim();
if (!token) {
  console.error("TELEGRAM_TOKEN is not set");
  process.exit(2);
}
const dir = process.env.STATE_DIR || join(homedir(), ".local/state/oasa-bus-bot");
const file = join(dir, "state.json");
mkdirSync(dir, { recursive: true, mode: 0o700 });

function load(): BotState | undefined {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return undefined; }
}

// Written whole and renamed: a crash leaves the old file or the new one, never half of one.
function save(s: BotState) {
  writeFileSync(`${file}.tmp`, JSON.stringify(s), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

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

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const strip = (s: string) => s.replace(/\/+$/, "");

const bot = new Bot({
  urls: {
    trips: process.env.TRIPS_URL || "https://bus.haroldpoi.dev/trips.json",
    static: strip(process.env.STATIC_BASE || "https://angelospk.github.io/athens-transit-rt/static/v1"),
    api: strip(process.env.API_BASE || "https://transit.haroldpoi.dev"),
  },
  now: Date.now, sleep, save, tg, get,
}, load());

async function updates() {
  for (;;) {
    const r = await tg("getUpdates", { offset: bot.offset, timeout: 50, allowed_updates: ["message", "callback_query"] });
    if (r.ok && Array.isArray(r.result)) {
      await bot.handle(r.result);
      void bot.flush();
    } else {
      console.error(`getUpdates: ${r.error_code ?? "network"}`);
      await sleep(r.error_code === 401 ? 600_000 : 5000);   // 401: wrong token
    }
  }
}

let ticking = false;
setInterval(() => {
  if (ticking) return;
  ticking = true;
  // Sending runs apart from the tick: a slow send or a Telegram wait must not pause polling.
  bot.tick().catch(e => console.error("tick:", (e as Error).message)).finally(() => {
    ticking = false;
    void bot.flush();
  });
}, 1000);

console.log(`oasa-bus-bot started, state in ${file}`);
void updates();
