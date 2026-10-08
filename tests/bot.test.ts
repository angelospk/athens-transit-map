import { describe, expect, it } from "vitest";
import { Bot, type BotDeps, type BotState, type Fetched, type PushSub } from "../bot/bot";
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
  const pushed: { sub: PushSub; data: Record<string, unknown> }[] = [];
  let pushReply = () => 201;
  const deps: BotDeps = {
    urls: URLS,
    now: () => now,
    sleep: async () => {},
    save: s => {
      if (opts.failSave?.()) throw new Error("ENOSPC");
      saved = JSON.parse(JSON.stringify(s));
    },
    tg: async (method, body) => { sent.push({ method, body }); return tgReply(method); },
    push: async (sub, data) => { pushed.push({ sub, data: JSON.parse(data) }); return pushReply(); },
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
    bot, sent, gets, live, pushed,
    failPush: (f: () => number) => void (pushReply = f),
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

describe("Bot web push", () => {
  const sub = (endpoint = "https://web.push.apple.com/QAbc-_1"): PushSub =>
    ({ endpoint, keys: { p256dh: "B" + "A".repeat(86), auth: "A".repeat(22) } });
  const post = (t: ReturnType<typeof setup>, body: unknown) => t.bot.web({ method: "POST", path: "/alerts", body });

  it("starts an alert for a push subscription and pushes each hit, not to Telegram", async () => {
    const t = setup();
    const r = await post(t, { p: payload, sub: sub() });
    expect(r.status).toBe(201);
    const { id, until } = r.body as { id: string; until: number };
    expect(id).toMatch(/^[0-9a-f]{32}$/);   // the id is all it takes to stop the alert
    expect(until).toBe(T0 / 1000 + 7200);
    expect(t.saved()?.alerts[0]).toMatchObject({ id, push: sub() });
    t.live.vehicles = [bus("s2")];
    await t.bot.tick();
    await t.bot.flush();
    expect(t.sent).toEqual([]);
    expect(t.pushed).toEqual([{ sub: sub(), data: { title: "Λεωφορείο", body: "🚌 Το 622 είναι 3 στάσεις πριν από ΣΤΑΣΗ 4 (καθυστέρηση 3′).", tag: id } }]);
  });

  it("refuses other push hosts, bad keys, bad links and links from other stop data", async () => {
    const t = setup();
    const bad = [
      { p: payload, sub: sub("https://evil.example/x") },
      { p: payload, sub: sub("http://fcm.googleapis.com/x") },
      { p: payload, sub: { ...sub(), keys: { p256dh: "short", auth: "A".repeat(22) } } },
      { p: "zzz", sub: sub() },
      null,
    ];
    for (const b of bad) expect((await post(t, b)).status).toBe(400);
    expect((await post(t, { p: payload.replace(/^1.../, "1aaa"), sub: sub() })).status).toBe(409);
    for (const host of ["fcm.googleapis.com", "updates.push.services.mozilla.com", "db5p.notify.windows.com"])
      { t.advance(3000); expect((await post(t, { p: payload, sub: sub(`https://${host}/x`) })).status).toBe(201); }
    expect(t.saved()?.alerts).toHaveLength(3);
  });

  it("keeps 5 alerts per subscription and stops one by its id", async () => {
    const t = setup();
    const ids: string[] = [];
    for (let k = 0; k < 6; k++) { ids.push(((await post(t, { p: payload, sub: sub() })).body as { id: string }).id); t.advance(3000); }
    expect(t.saved()?.alerts.map(a => a.id)).toEqual(ids.slice(1));
    expect((await t.bot.web({ method: "DELETE", path: `/alerts/${ids[3]}`, body: null })).status).toBe(204);
    expect((await t.bot.web({ method: "DELETE", path: "/alerts/nope", body: null })).status).toBe(204);
    expect(t.saved()?.alerts.map(a => a.id)).toEqual([ids[1], ids[2], ids[4], ids[5]]);
  });

  it("drops a subscription's alerts when the push service says it is gone", async () => {
    const t = setup();
    await post(t, { p: payload, sub: sub() });
    t.advance(3000);
    await post(t, { p: payload, sub: sub("https://fcm.googleapis.com/other") });
    t.failPush(() => 410);
    t.live.vehicles = [bus("s2")];
    await t.bot.tick();
    await t.bot.flush();
    expect(t.saved()?.alerts.map(a => a.push?.endpoint)).toEqual([]);   // both hit and both are gone
  });

  it("ends a push alert after 2 hours without a push", async () => {
    const t = setup();
    await post(t, { p: payload, sub: sub() });
    t.advance(2 * 3600_000 + 1000);
    await t.bot.tick();
    await t.bot.flush();
    expect(t.pushed).toEqual([]);
    expect(t.saved()?.alerts).toEqual([]);
  });

  it("sends nothing more for an alert stopped while its push waited in the queue", async () => {
    const t = setup();
    const { id } = (await post(t, { p: payload, sub: sub() })).body as { id: string };
    t.live.vehicles = [bus("s2")];
    await t.bot.tick();   // a hit is queued, not sent yet
    await t.bot.web({ method: "DELETE", path: `/alerts/${id}`, body: null });
    await t.bot.flush();
    expect(t.pushed).toEqual([]);
  });

  it("keeps the older alerts when a new one could not be saved", async () => {
    let fail = false;
    const t = setup({ failSave: () => fail });
    const ids: string[] = [];
    for (let k = 0; k < 5; k++) { ids.push(((await post(t, { p: payload, sub: sub() })).body as { id: string }).id); t.advance(3000); }
    fail = true;
    expect((await post(t, { p: payload, sub: sub() })).status).toBe(503);
    fail = false;
    t.live.vehicles = [bus("s2", { position_at: (T0 + 15_000) / 1000 })];
    await t.bot.tick();
    await t.bot.flush();
    expect(t.pushed.map(x => x.data.tag)).toEqual(ids);   // the oldest one too: it was not given up
  });

  it("says when a stop could not be saved, so the page tries again", async () => {
    let fail = false;
    const t = setup({ failSave: () => fail });
    const { id } = (await post(t, { p: payload, sub: sub() })).body as { id: string };
    fail = true;
    expect((await t.bot.web({ method: "DELETE", path: `/alerts/${id}`, body: null })).status).toBe(503);
    fail = false;
    expect((await t.bot.web({ method: "DELETE", path: `/alerts/${id}`, body: null })).status).toBe(204);
    expect(t.saved()?.alerts).toEqual([]);
  });

  it("answers 404 to other paths", async () => {
    expect((await setup().bot.web({ method: "GET", path: "/x", body: null })).status).toBe(404);
  });
});
