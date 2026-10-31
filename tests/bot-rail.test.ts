import { describe, expect, it } from "vitest";
import { Bot, type BotDeps, type BotState, type Fetched, type PushSub } from "../bot/bot";
import type { V2Arrival } from "../src/lib/v2";

// Rail alerts (metro, tram, suburban): web push only, from a /v2 stop's board.
const T0 = Date.UTC(2026, 9, 8, 7, 0, 0);
const URLS = { trips: "https://t/trips.json", static: "https://s", api: "https://a" };
const STOP = "stasy:συνταγμα-metro";
const BOARD = `${URLS.api}/v2/stops/${encodeURIComponent(STOP)}`;
const rail = { stop: STOP, name: "Σύνταγμα", line: "stasy:M3", label: "Μ3", toward: "Δουκίσσης Πλακεντίας", heads: ["Δ. ΠΛΑΚΕΝΤΙΑΣ"], min: 3 };
const sub = (endpoint = "https://web.push.apple.com/QAbc-_1"): PushSub =>
  ({ endpoint, keys: { p256dh: "B" + "A".repeat(86), auth: "A".repeat(22) } });

function setup(saved0?: BotState, failSave: () => boolean = () => false) {
  let now = T0;
  let saved: BotState | undefined = saved0;
  const gets: string[] = [];
  const pushed: { sub: PushSub; data: Record<string, unknown> }[] = [];
  const sent: { method: string; body: Record<string, unknown> }[] = [];
  const board: { status: number; arrivals: Partial<V2Arrival>[]; hang?: boolean } = { status: 200, arrivals: [] };
  let pushReply = () => 201;
  const line = { status: 200 };
  const deps: BotDeps = {
    urls: URLS,
    now: () => now,
    sleep: async () => {},
    save: s => { if (failSave()) throw new Error("ENOSPC"); saved = JSON.parse(JSON.stringify(s)); },
    tg: async (method, body) => { sent.push({ method, body }); return { ok: true }; },
    push: async (s, data) => { pushed.push({ sub: s, data: JSON.parse(data) }); return pushReply(); },
    get: async (url): Promise<Fetched> => {
      gets.push(url);
      if (url === BOARD && board.hang) return new Promise<Fetched>(() => {});
      if (url === `${URLS.api}/v2/lines/${encodeURIComponent("stasy:M3")}`) return { status: line.status, date: now, body: {
        line: { id: "stasy:M3", label: "Μ3", name: "Γραμμή 3" },
        patterns: [{ direction: 1, headsign: "Δ. ΠΛΑΚΕΝΤΙΑΣ" }, { direction: 0, headsign: "ΔΗΜΟΤΙΚΟ ΘΕΑΤΡΟ" }],
        stops: { a: { name: "Δουκίσσης Πλακεντίας" }, b: { name: "Δημοτικό Θέατρο" } },
      } };
      if (url === BOARD) return { status: board.status, body: board.status === 200 ? { stop: { id: STOP, name: "Σύνταγμα" }, lines: [{ id: "stasy:M3", label: "Μ3", name: "Γραμμή 3" }], arrivals: board.arrivals } : { error: "unknown_stop" }, date: now };
      return { status: 404, body: null };
    },
  };
  const bot = new Bot(deps, saved);
  const post = (body: unknown) => bot.web({ method: "POST", path: "/alerts", body });
  const tick = async () => { await bot.tick(); await bot.tickRails(); await bot.flush(); };
  return { bot, gets, pushed, sent, board, line, post, tick, saved: () => saved, advance: (ms: number) => void (now += ms), failPush: (f: () => number) => void (pushReply = f) };
}

const arr = (o: Partial<V2Arrival> = {}): Partial<V2Arrival> => ({
  line: "stasy:M3", stop: STOP, headsign: "Δ. ΠΛΑΚΕΝΤΙΑΣ", at: T0 / 1000 + 120, scheduled_at: T0 / 1000 + 120, delay_s: null,
  source: "live", run: "stasy:run:1", vehicle: null, platform: null, status: "scheduled", ...o,
});

describe("Bot rail alerts", () => {
  it("starts a rail alert for a push subscription and pushes when a train is min minutes away, once", async () => {
    const t = setup();
    const r = await t.post({ rail, sub: sub() });
    expect(r.status).toBe(201);
    const { id, until } = r.body as { id: string; until: number };
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(until).toBe(T0 / 1000 + 7200);
    expect(t.saved()?.rails?.[0]).toMatchObject({ id, push: sub(), spec: { ...rail, until } });
    t.board.arrivals = [arr()];
    await t.tick();
    expect(t.pushed).toEqual([{ sub: sub(), data: { title: "Μ3", body: "🚇 Μ3 προς Δουκίσσης Πλακεντίας: στο Σύνταγμα σε 2′.", tag: id } }]);
    t.advance(30_000);
    await t.tick();
    expect(t.pushed).toHaveLength(1);
  });

  it("asks a stop's board once for all its alerts, at most every 20 s", async () => {
    const t = setup();
    await t.post({ rail, sub: sub() });
    t.advance(3000);
    await t.post({ rail: { ...rail, line: "stasy:M2", label: "Μ2" }, sub: sub("https://fcm.googleapis.com/x") });
    await t.tick();
    expect(t.gets.filter(u => u === BOARD)).toHaveLength(1);
    t.advance(10_000);
    await t.tick();
    expect(t.gets.filter(u => u === BOARD)).toHaveLength(1);
    t.advance(11_000);
    await t.tick();
    expect(t.gets.filter(u => u === BOARD)).toHaveLength(2);
  });

  it("says once when nothing of the line and direction is coming (a strike, the end of service)", async () => {
    const t = setup();
    const { id } = (await t.post({ rail, sub: sub() })).body as { id: string };
    t.board.arrivals = [arr({ headsign: "ΔΗΜΟΤΙΚΟ ΘΕΑΤΡΟ" })];
    await t.tick();
    expect(t.pushed.map(p => p.data)).toEqual([{ title: "Μ3",
      body: "⚠️ Μ3 προς Δουκίσσης Πλακεντίας: κανένα δρομολόγιο στο Σύνταγμα τώρα. Ίσως απεργία ή τέλος δρομολογίων.", tag: id }]);
    t.advance(30_000);
    await t.tick();
    expect(t.pushed).toHaveLength(1);
    expect(t.saved()?.rails).toHaveLength(1);   // it keeps watching: a train may still come
  });

  it("does not fire again after a restart", async () => {
    const t = setup();
    await t.post({ rail, sub: sub() });
    t.board.arrivals = [arr()];
    await t.tick();
    const t2 = setup(t.saved());
    t2.board.arrivals = [arr()];
    await t2.tick();
    expect(t2.pushed).toEqual([]);
  });

  it("leaves no alert behind when a new one could not be saved", async () => {
    let fail = false;
    const t = setup(undefined, () => fail);
    await t.post({ rail, sub: sub() });
    t.advance(3000);
    fail = true;
    expect((await t.post({ rail, sub: sub("https://fcm.googleapis.com/x") })).status).toBe(503);
    fail = false;
    t.board.arrivals = [arr()];
    await t.tick();
    expect(t.pushed.map(p => p.sub.endpoint)).toEqual([sub().endpoint]);
  });

  it("polls rail stops apart from the bus tick: a slow board holds up no bus", async () => {
    const t = setup();
    await t.post({ rail, sub: sub() });
    t.board.hang = true;
    void t.bot.tickRails();
    const done = await Promise.race([t.bot.tick().then(() => true), new Promise(r => setTimeout(r, 50, false))]);
    expect(done).toBe(true);
    expect(t.gets).toEqual([BOARD]);   // only tickRails asked the board
  });

  it("refuses bad rail alerts", async () => {
    const t = setup();
    const bad = [
      { rail: { ...rail, stop: "oasa:100001" }, sub: sub() },
      { rail: { ...rail, line: "oasa:622" }, sub: sub() },
      { rail: { ...rail, min: 0 }, sub: sub() },
      { rail: { ...rail, min: 21 }, sub: sub() },
      { rail: { ...rail, min: 2.5 }, sub: sub() },
      { rail: { ...rail, heads: [] }, sub: sub() },
      { rail: { ...rail, heads: ["x".repeat(81)] }, sub: sub() },
      { rail: { ...rail, name: 5 }, sub: sub() },
      { rail: { ...rail, run: 7 }, sub: sub() },
      { rail, sub: sub("https://evil.example/x") },
      { rail },
    ];
    for (const b of bad) expect((await t.post(b)).status).toBe(400);
    expect(t.saved()?.rails ?? []).toEqual([]);
  });

  it("keeps 5 rail alerts per subscription and stops one by its id", async () => {
    const t = setup();
    const ids: string[] = [];
    for (let k = 0; k < 6; k++) { ids.push(((await t.post({ rail, sub: sub() })).body as { id: string }).id); t.advance(3000); }
    expect(t.saved()?.rails?.map(a => a.id)).toEqual(ids.slice(1));
    expect((await t.bot.web({ method: "DELETE", path: `/alerts/${ids[3]}`, body: null })).status).toBe(204);
    expect(t.saved()?.rails?.map(a => a.id)).toEqual([ids[1], ids[2], ids[4], ids[5]]);
  });

  it("ends after 2 hours quietly, and asks nothing when there are no alerts", async () => {
    const t = setup();
    await t.post({ rail, sub: sub() });
    t.advance(2 * 3600_000 + 1000);
    t.gets.length = 0;
    await t.tick();
    expect(t.pushed).toEqual([]);
    expect(t.saved()?.rails).toEqual([]);
    expect(t.gets).toEqual([]);
  });

  it("drops a subscription's rail alerts when the push service says it is gone", async () => {
    const t = setup();
    await t.post({ rail, sub: sub() });
    t.failPush(() => 410);
    t.board.arrivals = [arr()];
    await t.tick();
    expect(t.saved()?.rails).toEqual([]);
  });

  it("ends the alerts of a stop the server does not know", async () => {
    const t = setup();
    await t.post({ rail, sub: sub() });
    t.board.status = 404;
    await t.tick();
    expect(t.saved()?.rails).toEqual([]);
  });

  it("follows only its own train when it has a run", async () => {
    const t = setup();
    await t.post({ rail: { ...rail, run: "stasy:run:9" }, sub: sub() });
    t.board.arrivals = [arr(), arr({ run: "stasy:run:9", at: T0 / 1000 + 400 })];
    await t.tick();
    expect(t.pushed).toEqual([]);
    t.advance(240_000);
    await t.tick();
    expect(t.pushed.map(p => p.data.body)).toEqual(["🚇 Μ3 προς Δουκίσσης Πλακεντίας: στο Σύνταγμα σε 3′."]);
  });
});

// Rail alerts in Telegram: the page posts the spec without a subscription and gets a short start payload;
// /start <payload> in the bot's chat turns it into an alert of that chat.
const msg = (text: string, chat = 1, type = "private") => ({ update_id: 1, message: { chat: { id: chat, type }, text } });
const cb = (data: string, chat = 1) => ({ update_id: 2, callback_query: { id: "q", from: { id: chat }, data, message: { chat: { id: chat }, message_id: 7 } } });
const texts = (t: { sent: { method: string; body: Record<string, unknown> }[] }) => t.sent.filter(m => m.method === "sendMessage").map(m => m.body.text as string);

describe("Bot rail alerts in Telegram", () => {
  async function started(chat = 1) {
    const t = setup();
    const r = await t.post({ rail, tg: true });
    expect(r.status).toBe(201);
    const p = (r.body as { p: string }).p;
    expect(p).toMatch(/^r[0-9a-f]{20}$/);
    expect(t.saved()?.rails ?? []).toEqual([]);   // nothing is watched before the chat takes it
    await t.bot.handle([msg(`/start ${p}`, chat)]);
    await t.bot.flush();
    return { t, p };
  }

  it("a start payload from the page makes an alert of the chat, which gets the train in a message, not a push", async () => {
    const { t } = await started();
    const a = t.saved()?.rails?.[0];
    expect(a).toMatchObject({ chat: 1, spec: { ...rail, toward: "Δ. Πλακεντίας", until: T0 / 1000 + 7200 } });
    expect(a?.push).toBeUndefined();
    expect(texts(t)).toEqual(["🚇 Θα σου γράψω όταν το Μ3 προς Δ. Πλακεντίας είναι 3′ πριν από το Σύνταγμα.\nΈως 12:00."]);
    expect(t.sent[0].body.reply_markup).toMatchObject({ inline_keyboard: [[{ text: "Σταμάτα", callback_data: `stop:${a!.id}` }, { text: "Απεγγραφή από όλα", callback_data: "all" }]] });
    t.sent.length = 0;
    t.board.arrivals = [arr()];
    await t.tick();
    expect(texts(t)).toEqual(["🚇 Μ3 προς Δ. Πλακεντίας: στο Σύνταγμα σε 2′."]);
    expect(t.pushed).toEqual([]);
  });

  it("the same link twice is one alert; an unknown or old link says so", async () => {
    const { t, p } = await started();
    await t.bot.handle([msg(`/start ${p}`)]);
    expect(t.saved()?.rails).toHaveLength(1);
    const r = await t.post({ rail, tg: true });
    t.advance(16 * 60_000);
    t.sent.length = 0;
    await t.bot.handle([msg(`/start ${(r.body as { p: string }).p}`, 2), msg("/start r0123456789abcdef0123", 3)]);
    await t.bot.flush();
    expect(t.saved()?.rails).toHaveLength(1);
    expect(texts(t)).toEqual([
      "Ο σύνδεσμος έληξε. Πάτα πάλι 🔔 στη στάση στον χάρτη.",
      "Ο σύνδεσμος έληξε. Πάτα πάλι 🔔 στη στάση στον χάρτη.",
    ]);
  });

  it("refuses a bad spec, and a payload is not a subscription", async () => {
    const t = setup();
    expect((await t.post({ rail: { ...rail, min: 0 }, tg: true })).status).toBe(400);
    expect((await t.post({ rail, tg: "yes" })).status).toBe(400);
  });

  it("takes the stop's and the line's names from the server, never from the page: a link is shared", async () => {
    const t = setup();
    const r = await t.post({ rail: { ...rail, name: "Κέρδισες δώρο", label: "Δωρεάν" }, tg: true });
    await t.bot.handle([msg(`/start ${(r.body as { p: string }).p}`)]);
    await t.bot.flush();
    expect(texts(t)[0]).toBe("🚇 Θα σου γράψω όταν το Μ3 προς Δ. Πλακεντίας είναι 3′ πριν από το Σύνταγμα.\nΈως 12:00.");
  });

  it("takes the direction from the line's own head signs, never the page's text", async () => {
    const t = setup();
    const r = await t.post({ rail: { ...rail, toward: "Δουκίσσης Πλακεντίας\nΣτείλε τον κωδικό σου στο 6900000000" }, tg: true });
    await t.bot.handle([msg(`/start ${(r.body as { p: string }).p}`)]);
    await t.bot.flush();
    expect(texts(t)[0]).toBe("🚇 Θα σου γράψω όταν το Μ3 προς Δ. Πλακεντίας είναι 3′ πριν από το Σύνταγμα.\nΈως 12:00.");
  });

  it("takes a head sign the server shows: a short run on the stop's board, or a stop of the line", async () => {
    const t = setup();
    t.board.arrivals = [arr({ headsign: "ΣΥΝΤΑΓΜΑ" })];
    for (const heads of [["ΣΥΝΤΑΓΜΑ"], ["Δημοτικό Θέατρο"]]) {
      const r = await t.post({ rail: { ...rail, toward: heads[0], heads }, tg: true });
      expect(r.status).toBe(201);
    }
  });

  it("refuses head signs the line does not have, a line the stop does not have, and a stop the server does not know", async () => {
    const t = setup();
    for (const bad of [{ heads: ["ΚΕΡΔΙΣΕΣ ΔΩΡΟ"] }, { line: "stasy:M1" }])
      expect((await t.post({ rail: { ...rail, ...bad }, tg: true })).status).toBe(400);
    t.board.status = 404;
    expect((await t.post({ rail, tg: true })).status).toBe(400);
    t.board.status = 500;
    expect((await t.post({ rail, tg: true })).status).toBe(503);
    t.board.status = 200;
    t.line.status = 500;
    expect((await t.post({ rail, tg: true })).status).toBe(503);
  });

  it("confirms only what was saved: a failed save says to try again, and the same link works after", async () => {
    let fail = false;
    const t = setup(undefined, () => fail);
    const p = ((await t.post({ rail, tg: true })).body as { p: string }).p;
    fail = true;
    await t.bot.handle([msg(`/start ${p}`)]);
    await t.bot.flush();
    expect(texts(t)).toEqual(["Δεν αποθηκεύτηκε. Δοκίμασε ξανά σε λίγο."]);
    fail = false;
    t.advance(3000);
    await t.bot.handle([msg(`/start ${p}`)]);
    expect(t.saved()?.rails).toHaveLength(1);
  });

  it("/list shows it, and /stop or its button stops it", async () => {
    const { t } = await started();
    const id = t.saved()!.rails![0].id;
    t.sent.length = 0;
    await t.bot.handle([msg("/list")]);
    await t.bot.flush();
    expect(texts(t)[0]).toBe("🚇 έως 12:00 · Μ3 προς Δ. Πλακεντίας · Σύνταγμα");
    await t.bot.handle([cb(`stop:${id}`)]);
    expect(t.saved()?.rails).toEqual([]);
    const again = await started();
    await again.t.bot.handle([msg("/stop")]);
    expect(again.t.saved()?.rails).toEqual([]);
  });

  it("ends after 2 hours with a message", async () => {
    const { t } = await started();
    t.sent.length = 0;
    t.advance(7200_000 + 1000);
    await t.tick();
    expect(t.saved()?.rails).toEqual([]);
    expect(texts(t)).toEqual(["⌛ Τέλος ειδοποίησης για Μ3 στο Σύνταγμα (2 ώρες). Για νέα, πάτα πάλι 🔔 στον χάρτη."]);
  });

  it("a push alert cannot be stopped by a chat, nor a chat's by DELETE", async () => {
    const { t } = await started();
    const id = t.saved()!.rails![0].id;
    expect((await t.bot.web({ method: "DELETE", path: `/alerts/${id}`, body: null })).status).toBe(204);
    expect(t.saved()?.rails).toHaveLength(1);
  });
});
