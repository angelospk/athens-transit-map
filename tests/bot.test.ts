import { describe, expect, it } from "vitest";
import { Bot, type BotDeps, type BotState, type Fetched } from "../bot/bot";
import { encodeAlert } from "../src/lib/tglink";
import type { TripIndex } from "../src/lib/trip";

const T0 = Date.UTC(2026, 9, 8, 7, 0, 0);   // 10:00 in Athens
const URLS = { trips: "https://t/trips.json", static: "https://s", api: "https://a" };
const stops = ["s0", "s1", "s2", "s3", "s4", "s5"];
const ix: TripIndex = { v: "2026-07-08", s: stops.map((id, k) => [`ΣΤΑΣΗ ${k}`, 38, 23.7]), l: { "622": { A: [0, 1, 2, 3, 4, 5] } } };
const lineStatic = { id: "622", variants: { A: { headsign: "", direction: 0, shape: [], stops } },
  stops: Object.fromEntries(stops.map((id, k) => [id, { name: `ΣΤΑΣΗ ${k}`, lat: 38, lon: 23.7 }])) };
const payload = encodeAlert(ix, 3, [{ line: "622", variants: [{ id: "A", i: 4 }] }])!;

function setup(opts: { saved?: BotState; trips?: TripIndex; staticVer?: string; gate?: Promise<void>; failSave?: () => boolean } = {}) {
  let now = T0;
  const sent: { method: string; body: Record<string, unknown> }[] = [];
  let saved: BotState | undefined = opts.saved;
  let tgReply: (m: string) => { ok: boolean; error_code?: number; parameters?: { retry_after?: number }; result?: unknown } =
    () => ({ ok: true, result: { message_id: 7 } });
  const live: { vehicles: object[] } = { vehicles: [] };
  const gets: string[] = [];
  const deps: BotDeps = {
    urls: URLS,
    now: () => now,
    sleep: async () => {},
    save: s => {
      if (opts.failSave?.()) throw new Error("ENOSPC");
      saved = JSON.parse(JSON.stringify(s));
    },
    tg: async (method, body) => { sent.push({ method, body }); return tgReply(method); },
    get: async (url): Promise<Fetched> => {
      gets.push(url);
      if (url === URLS.trips) { await opts.gate; return { status: 200, body: opts.trips ?? ix }; }
      if (url === `${URLS.static}/lines.json`) return { status: 200, body: { gtfs_version: opts.staticVer ?? ix.v, lines: [] } };
      if (url === `${URLS.static}/lines/622.json`) return { status: 200, body: lineStatic };
      if (url === `${URLS.api}/v1/lines/622`)
        return { status: 200, body: { line: "622", updated_at: now / 1000, next_update_at: now / 1000 + 30, vehicles: live.vehicles }, date: now };
      return { status: 404, body: null };
    },
  };
  const bot = new Bot(deps, saved);
  return {
    bot, sent, gets, live,
    saved: () => saved,
    texts: () => sent.filter(s => s.method === "sendMessage").map(s => s.body.text as string),
    advance: (ms: number) => void (now += ms),
    failTg: (f: typeof tgReply) => void (tgReply = f),
  };
}

const msg = (text: string, chat = 1, type = "private") => ({ update_id: 1, message: { chat: { id: chat, type }, from: { id: chat }, text } });
const cb = (data: string, chat = 1) => ({ update_id: 2, callback_query: { id: "q", from: { id: chat }, data, message: { chat: { id: chat }, message_id: 7 } } });
const bus = (next: string, o: object = {}) => ({ id: "v1", lat: 0, lon: 0, bearing: null, position_at: T0 / 1000, route_code: "", variant: "A",
  trip_id: "t1", trip_label: null, delay_s: 180, next_stop_id: next, ...o });

describe("Bot /start", () => {
  it("starts an alert from a link and says what it watches", async () => {
    const t = setup();
    await t.bot.handle([msg(`/start ${payload}`)]);
    await t.bot.flush();
    expect(t.texts()[0]).toMatch(/622 στη στάση ΣΤΑΣΗ 4/);
    expect(t.texts()[0]).toMatch(/Έως 12:00\./);
    expect(JSON.stringify(t.sent[0].body.reply_markup)).toMatch(/Σταμάτα/);
    expect(t.saved()?.alerts).toHaveLength(1);
    expect(t.saved()?.offset).toBe(2);
  });

  it("refuses group chats, broken links and links from other stop data", async () => {
    const t = setup();
    await t.bot.handle([msg(`/start ${payload}`, -5, "group"), msg("/start zzz"), msg(`/start ${payload.replace(/^1.../, "1aaa")}`)]);
    await t.bot.flush();
    expect(t.texts()).toEqual([
      expect.stringMatching(/μόνο σε προσωπική/),
      expect.stringMatching(/δεν είναι σωστός/),
      expect.stringMatching(/παλιότερα δεδομένα/),
    ]);
    expect(t.gets.filter(u => u === URLS.trips)).toHaveLength(2);   // loaded, then refreshed once for the old link
    expect(t.saved()?.alerts ?? []).toEqual([]);
  });

  it("waits while the backend's data and the stop index differ", async () => {
    const t = setup({ staticVer: "2026-10-08" });
    await t.bot.handle([msg(`/start ${payload}`)]);
    await t.bot.flush();
    expect(t.texts()[0]).toMatch(/ενημερώνονται/);
  });

  it("keeps 5 alerts per chat, dropping the oldest", async () => {
    const t = setup();
    for (let k = 0; k < 6; k++) { await t.bot.handle([msg(`/start ${payload}`)]); t.advance(3000); }
    expect(t.saved()?.alerts).toHaveLength(5);
  });

  it("explains itself on /start alone and stops everything on /stop", async () => {
    const t = setup();
    await t.bot.handle([msg(`/start ${payload}`), msg("/start"), msg("/stop")]);
    await t.bot.flush();
    expect(t.texts()[1]).toMatch(/bus\.haroldpoi\.dev/);
    expect(t.texts()[2]).toMatch(/Σταμάτησαν/);
    expect(t.saved()?.alerts).toEqual([]);
  });
});

describe("Bot buttons", () => {
  it("stops one alert from its own chat only", async () => {
    const t = setup();
    await t.bot.handle([msg(`/start ${payload}`)]);
    const id = t.saved()!.alerts[0].id;
    await t.bot.handle([cb(`stop:${id}`, 99)]);
    expect(t.saved()?.alerts).toHaveLength(1);
    await t.bot.handle([cb(`stop:${id}`)]);
    expect(t.saved()?.alerts).toEqual([]);
    await t.bot.flush();
    expect(t.sent.some(s => s.method === "answerCallbackQuery")).toBe(true);
  });
});

describe("Bot crash safety", () => {
  it("saves the update offset only with what the updates changed", async () => {
    let open!: () => void;
    const gate = new Promise<void>(r => (open = r));
    const old = { offset: 5, alerts: [{ id: "x", chat: 2, ver: ix.v, label: "", watch: { until: 0, fired: [] },
      spec: { n: 3, until: T0 / 1000 - 1, lines: [{ line: "622", variants: [{ id: "A", i: 4 }] }] } }] };
    const t = setup({ saved: old, gate });
    const start = t.bot.handle([{ ...msg(`/start ${payload}`), update_id: 10 }]);
    await t.bot.tick();   // ends the old alert and saves, while /start waits for data
    expect(t.saved()?.offset).toBe(5);
    open();
    await start;
    expect(t.saved()?.offset).toBe(11);
    expect(t.saved()?.alerts).toHaveLength(1);
  });

  it("sends no alert it could not save", async () => {
    let fail = false;
    const t = setup({ failSave: () => fail });
    await t.bot.handle([msg(`/start ${payload}`)]);
    await t.bot.flush();
    fail = true;
    t.live.vehicles = [bus("s2")];
    await t.bot.tick();
    await t.bot.flush();
    expect(t.texts().filter(x => x.startsWith("🚌"))).toEqual([]);
  });
});

describe("Bot alerts", () => {
  it("sends one message per trip when a bus comes within n stops, also after a restart", async () => {
    const t = setup();
    await t.bot.handle([msg(`/start ${payload}`)]);
    t.live.vehicles = [bus("s2")];   // 3 stops left
    await t.bot.tick();
    await t.bot.flush();
    expect(t.texts().at(-1)).toBe("🚌 Το 622 είναι 3 στάσεις πριν από ΣΤΑΣΗ 4 (καθυστέρηση 3′).");
    t.advance(35_000);
    t.live.vehicles = [bus("s3", { position_at: T0 / 1000 + 35 })];
    await t.bot.tick();
    const again = setup({ saved: t.saved() });
    again.advance(70_000);
    again.live.vehicles = [bus("s4", { position_at: T0 / 1000 + 70 })];
    await again.bot.tick();
    await t.bot.flush();
    await again.bot.flush();
    expect(t.texts().filter(x => x.startsWith("🚌"))).toHaveLength(1);
    expect(again.texts()).toEqual([]);
  });

  it("asks a line no sooner than its next update, one request at a time", async () => {
    const t = setup();
    await t.bot.handle([msg(`/start ${payload}`)]);
    await Promise.all([t.bot.tick(), t.bot.tick()]);
    t.advance(10_000);
    await t.bot.tick();
    const live = () => t.gets.filter(u => u.endsWith("/v1/lines/622")).length;
    expect(live()).toBe(1);
    t.advance(23_000);   // 33 s: past next_update_at + 2 s
    await t.bot.tick();
    expect(live()).toBe(2);
  });

  it("drops a chat's alerts when the user blocked the bot", async () => {
    const t = setup();
    await t.bot.handle([msg(`/start ${payload}`)]);
    t.failTg(() => ({ ok: false, error_code: 403 }));
    await t.bot.flush();
    expect(t.saved()?.alerts).toEqual([]);
  });

  it("ends an alert after 2 hours with one message", async () => {
    const t = setup();
    await t.bot.handle([msg(`/start ${payload}`)]);
    t.advance(2 * 3600_000 + 1000);
    await t.bot.tick();
    await t.bot.tick();
    await t.bot.flush();
    expect(t.texts().filter(x => x.startsWith("⌛"))).toHaveLength(1);
    expect(t.saved()?.alerts).toEqual([]);
  });
});
