// The bot on its own (#36): find a stop by name or location, its live board, 🔔 from the board, ⭐ saved stops, the menu.
import { describe, expect, it } from "vitest";
import { Bot, COMMANDS, type BotDeps, type BotState, type Fetched } from "../bot/bot";
import { encodeAlert } from "../src/lib/tglink";
import type { TripIndex } from "../src/lib/trip";

const T0 = Date.UTC(2026, 9, 8, 7, 0, 0);   // 10:00 in Athens
const URLS = { trips: "https://t/trips.json", static: "https://s", api: "https://a" };
// 100 and 101: one name, across the street (about 25 m). 102: 100 m away. 103, 104: far.
const ix: TripIndex = {
  v: "2026-07-08",
  s: [
    ["ΣΥΝΤΑΓΜΑ", 37.9755, 23.7348, "100"], ["ΣΥΝΤΑΓΜΑ", 37.9757, 23.735, "101"], ["ΒΟΥΛΗ", 37.9762, 23.7355, "102"],
    ["ΚΗΦΙΣΙΑ", 38.07, 23.81, "103"], ["ΠΕΙΡΑΙΑΣ", 37.94, 23.64, "104"], ["ΧΩΡΙΣ ID", 37.9755, 23.7349],
  ],
  l: { "022": { A: [0, 2, 3] }, "550": { B: [4, 1] } },
};
const board = (now: number) => ({
  stop: { id: "100", name: "ΣΥΝΤΑΓΜΑ", lat: 37.9755, lon: 23.7348 }, lines: ["022"], updated_at: now / 1000,
  arrivals: [{ line: "022", headsign: "ΣΥΝΤΑΓΜΑ - ΚΗΦΙΣΙΑ", variant: "A", vehicle: "v1", eta_s: 180, at: now / 1000 + 180, delay_s: 0,
    position_at: now / 1000, source: "live", trip_id: "t1", scheduled: null, stops_away: 3, distance_m: 900 }],
});
const alert022 = encodeAlert(ix, 3, [{ line: "022", variants: [{ id: "A", i: 0 }] }])!;

function setup(saved?: BotState, stopStatus = 200, gate?: Promise<void>) {
  let now = T0;
  const sent: { method: string; body: Record<string, unknown> }[] = [];
  let state: BotState | undefined = saved;
  const gets: string[] = [];
  let tgReply: (m: string) => { ok: boolean; error_code?: number; result?: unknown } = () => ({ ok: true, result: { message_id: 9 } });
  const deps: BotDeps = {
    urls: URLS, now: () => now, sleep: async () => {},
    save: s => void (state = JSON.parse(JSON.stringify(s))),
    tg: async (method, body) => { sent.push({ method, body }); return tgReply(method); },
    push: async () => 201,
    get: async (url): Promise<Fetched> => {
      gets.push(url);
      if (url === URLS.trips) return { status: 200, body: ix };
      if (url === `${URLS.static}/lines.json`) return { status: 200, body: { gtfs_version: ix.v, lines: [] } };
      if (url === `${URLS.api}/v1/stops/102`) return { status: 200, body: { ...board(now), stop: { id: "102", name: "ΒΟΥΛΗ", lat: 0, lon: 0 }, arrivals: [] } };
      if (url.startsWith(`${URLS.api}/v1/stops/`)) await gate;
      if (url.startsWith(`${URLS.api}/v1/stops/`)) return stopStatus === 200 ? { status: 200, body: board(now), date: now } : { status: stopStatus, body: null };
      return { status: 404, body: null };
    },
  };
  const bot = new Bot(deps, saved);
  const run = async (...u: object[]) => { await bot.handle(u as never); await bot.settle(); await bot.flush(); };
  return {
    bot, sent, gets, run,
    saved: () => state,
    advance: (ms: number) => void (now += ms),
    failTg: (f: typeof tgReply) => void (tgReply = f),
    msgs: () => sent.filter(s => s.method === "sendMessage"),
    last: (method = "sendMessage") => sent.filter(s => s.method === method).at(-1)!,
  };
}

const msg = (text: string, chat = 1) => ({ update_id: 1, message: { chat: { id: chat, type: "private" }, from: { id: chat }, text } });
const loc = (lat: number, lon: number, chat = 1) => ({ update_id: 1, message: { chat: { id: chat, type: "private" }, from: { id: chat }, location: { latitude: lat, longitude: lon } } });
const cb = (data: string, chat = 1) => ({ update_id: 2, callback_query: { id: "q", from: { id: chat }, data, message: { chat: { id: chat }, message_id: 9 } } });
type Btn = { text: string; callback_data?: string; request_location?: boolean };
const buttons = (m: { body: Record<string, unknown> }): Btn[] =>
  ((m.body.reply_markup as { inline_keyboard?: Btn[][]; keyboard?: Btn[][] }).inline_keyboard ?? (m.body.reply_markup as { keyboard: Btn[][] }).keyboard).flat();
const data = (m: { body: Record<string, unknown> }) => buttons(m).map(b => b.callback_data);

describe("menu and keyboard", () => {
  it("init() sets the command menu", async () => {
    const t = setup();
    t.bot.init();
    await t.bot.flush();
    expect(t.last("setMyCommands").body).toEqual({ commands: COMMANDS });
    expect(COMMANDS.map(c => c.command)).toEqual(["stasi", "fav", "list", "stop"]);
  });

  it("/start with no link greets with the keyboard: location and saved stops", async () => {
    const t = setup();
    await t.run(msg("/start"));
    const b = buttons(t.last());
    expect(b[0]).toMatchObject({ text: "📍 Κοντά μου", request_location: true });
    expect(b[1].text).toBe("⭐ Οι στάσεις μου");
    expect((t.last().body.reply_markup as { resize_keyboard?: boolean }).resize_keyboard).toBe(true);
  });

  it("/stasi with no name asks for a name or a location", async () => {
    const t = setup();
    await t.run(msg("/stasi"));
    expect(t.last().body.text).toMatch(/όνομα/);
    expect(buttons(t.last())[0].request_location).toBe(true);
  });
});

describe("finding a stop", () => {
  it("by name: every stop of that name, each to its board", async () => {
    const t = setup();
    await t.run(msg("συνταγ"));
    expect(data(t.last())).toEqual(["b:100", "b:101"]);
    expect(buttons(t.last())[0].text).toMatch(/ΣΥΝΤΑΓΜΑ · 022/);
    expect(buttons(t.last())[1].text).toMatch(/ΣΥΝΤΑΓΜΑ · 550/);
  });

  it("/stasi <name> does the same", async () => {
    const t = setup();
    await t.run(msg("/stasi Βουλή"));
    expect(data(t.last())).toEqual(["b:102"]);
  });

  it("an unknown name says so", async () => {
    const t = setup();
    await t.run(msg("ζζζζ"));
    expect(t.last().body.text).toMatch(/Δεν βρήκα/);
  });

  it("by location: stops within 400 m, nearest first, with the distance; none without a GTFS id", async () => {
    const t = setup();
    await t.run(loc(37.9755, 23.7348));
    expect(data(t.last())).toEqual(["b:100", "b:101", "b:102"]);
    expect(buttons(t.last())[0].text).toMatch(/ΣΥΝΤΑΓΜΑ · 0 μ/);
    expect(buttons(t.last())[2].text).toMatch(/ΒΟΥΛΗ · \d+ μ/);
  });

  it("a location far from every stop says so", async () => {
    const t = setup();
    await t.run(loc(40.6, 22.9));
    expect(t.last().body.text).toMatch(/Καμία στάση/);
  });
});

describe("the stop board", () => {
  it("shows the live arrivals with refresh, save, a bell per line and the stop across", async () => {
    const t = setup();
    await t.run(cb("b:100"));
    const m = t.last();
    expect(m.body.chat_id).toBe(1);
    expect(m.body.text).toMatch(/🚏 ΣΥΝΤΑΓΜΑ/);
    expect(m.body.text).toMatch(/022 → ΚΗΦΙΣΙΑ: 3–4′/);
    expect(m.body.text).toMatch(/10:00/);
    expect(data(m)).toEqual(expect.arrayContaining(["r:100", "f:100", `a:${alert022}`, "b:101"]));
    expect(buttons(m).find(b => b.callback_data === `a:${alert022}`)!.text).toBe("🔔 022");
    expect(buttons(m).find(b => b.callback_data === "b:101")!.text).toMatch(/Απέναντι/);
    expect(t.gets.filter(u => u === `${URLS.api}/v1/stops/100`)).toHaveLength(1);
    expect(t.last("answerCallbackQuery").body.callback_query_id).toBe("q");
  });

  it("says when no bus is on its way", async () => {
    const t = setup();
    await t.run(cb("b:102"));
    expect(t.last().body.text).toMatch(/🚏 ΒΟΥΛΗ/);
    expect(t.last().body.text).toMatch(/Κανένα λεωφορείο/);
  });

  it("a board that does not load says so", async () => {
    const t = setup(undefined, 503);
    await t.run(cb("b:100"));
    expect(t.last().body.text).toMatch(/Δεν φορτώνουν οι αφίξεις/);
  });

  it("an unknown stop id answers the button and fetches nothing", async () => {
    const t = setup();
    await t.run(cb("b:999"));
    expect(t.msgs()).toHaveLength(0);
    expect(t.last("answerCallbackQuery").body.text).toMatch(/στάση/);
    expect(t.gets.some(u => u.includes("/v1/stops/"))).toBe(false);
  });

  it("one stop is fetched once per 15 s, for all chats", async () => {
    const t = setup();
    await t.run(cb("b:100", 1));
    await t.run(cb("b:100", 2));
    expect(t.gets.filter(u => u.includes("/v1/stops/100"))).toHaveLength(1);
    t.advance(16_000);
    await t.run(cb("b:100", 2));
    expect(t.gets.filter(u => u.includes("/v1/stops/100"))).toHaveLength(2);
  });

  it("🔄 edits the board in place, at most once per 3 s per chat", async () => {
    const t = setup();
    await t.run(cb("b:100"));
    t.advance(16_000);
    await t.run(cb("r:100"));
    const e = t.last("editMessageText");
    expect(e.body).toMatchObject({ chat_id: 1, message_id: 9 });
    expect(e.body.text).toMatch(/10:00/);
    const edits = t.sent.filter(s => s.method === "editMessageText").length;
    t.advance(1000);
    await t.run(cb("r:100"));
    expect(t.sent.filter(s => s.method === "editMessageText")).toHaveLength(edits);
    expect(t.last("answerCallbackQuery").body.text).toMatch(/Μόλις/);
  });

  it("does not hold up other updates while a board loads", async () => {
    let open!: () => void;
    const t = setup(undefined, 200, new Promise<void>(r => (open = r)));
    await t.bot.handle([cb("b:100") as never, msg("/list") as never]);
    expect(t.bot.offset).toBe(3);
    await t.bot.flush();
    expect(t.msgs().map(m => m.body.text)).toEqual([expect.stringMatching(/Δεν έχεις ειδοποιήσεις/)]);
    open();
    await t.bot.settle();
    await t.bot.flush();
    expect(t.msgs().some(m => /🚏/.test(m.body.text as string))).toBe(true);
  });

  it("chats asking one stop at once share one request", async () => {
    let open!: () => void;
    const t = setup(undefined, 200, new Promise<void>(r => (open = r)));
    await t.bot.handle([cb("b:100", 1), cb("b:100", 2), cb("b:100", 3)] as never);
    open();
    await t.bot.settle();
    expect(t.gets.filter(u => u.includes("/v1/stops/100"))).toHaveLength(1);
  });
});

describe("🔔 from the board", () => {
  it("starts the same alert a map link would", async () => {
    const t = setup();
    await t.run(cb(`a:${alert022}`));
    expect(t.saved()?.alerts).toHaveLength(1);
    expect(t.saved()?.alerts[0].chat).toBe(1);
    expect(t.msgs().at(-1)!.body.text).toMatch(/022 στη στάση ΣΥΝΤΑΓΜΑ/);
    expect(t.last("answerCallbackQuery")).toBeTruthy();
  });
});

describe("callbacks that change state", () => {
  it("🔔 and ⭐ are saved with the update offset, before handle() returns", async () => {
    const t = setup();
    await t.bot.handle([cb(`a:${alert022}`), cb("f:100", 2)] as never);
    expect(t.saved()?.alerts).toHaveLength(1);
    expect(t.saved()?.favs).toEqual({ "2": [{ id: "100", name: "ΣΥΝΤΑΓΜΑ" }] });
    expect(t.saved()?.offset).toBe(3);
  });

  it("/stop right after 🔔 in one batch leaves no alert", async () => {
    const t = setup();
    await t.run(cb(`a:${alert022}`), msg("/stop"));
    expect(t.saved()?.alerts).toHaveLength(0);
  });
});

describe("⭐ saved stops", () => {
  it("saves and removes a stop, and flips the star on the board", async () => {
    const t = setup();
    await t.run(cb("f:100"));
    expect(t.saved()?.favs).toEqual({ "1": [{ id: "100", name: "ΣΥΝΤΑΓΜΑ" }] });
    expect(t.last("answerCallbackQuery").body.text).toMatch(/Αποθηκεύτηκε/);
    expect(JSON.stringify(t.last("editMessageReplyMarkup").body.reply_markup)).toMatch(/Αφαίρεση/);
    await t.run(cb("f:100"));
    expect(t.saved()?.favs?.["1"] ?? []).toEqual([]);
    expect(t.last("answerCallbackQuery").body.text).toMatch(/Αφαιρέθηκε/);
  });

  it("a saved stop's board shows ★ Αφαίρεση", async () => {
    const t = setup({ offset: 0, alerts: [], favs: { "1": [{ id: "100", name: "ΣΥΝΤΑΓΜΑ" }] } });
    await t.run(cb("b:100"));
    expect(buttons(t.last()).find(b => b.callback_data === "f:100")!.text).toMatch(/Αφαίρεση/);
  });

  it("/fav and the keyboard button list them; none says so", async () => {
    const t = setup();
    await t.run(msg("/fav"));
    expect(t.last().body.text).toMatch(/Δεν έχεις αποθηκευμένες/);
    await t.run(cb("f:100"), cb("f:102"));
    await t.run(msg("⭐ Οι στάσεις μου"));
    expect(data(t.last())).toEqual(["b:100", "b:102"]);
    expect(buttons(t.last()).map(b => b.text)).toEqual(["ΣΥΝΤΑΓΜΑ", "ΒΟΥΛΗ"]);
  });

  it("keeps at most 8 per chat", async () => {
    const favs = { "1": Array.from({ length: 8 }, (_, k) => ({ id: `x${k}`, name: `X${k}` })) };
    const t = setup({ offset: 0, alerts: [], favs });
    await t.run(cb("f:100"));
    expect(t.saved()?.favs?.["1"]).toHaveLength(8);
    expect(t.saved()?.favs?.["1"].some(f => f.id === "100")).toBe(false);
    expect(t.last("answerCallbackQuery").body.text).toMatch(/8/);
  });

  it("survive a restart and go when the user blocks the bot", async () => {
    const t = setup({ offset: 0, alerts: [], favs: { "1": [{ id: "100", name: "ΣΥΝΤΑΓΜΑ" }], "2": [{ id: "101", name: "ΣΥΝΤΑΓΜΑ" }] } });
    t.failTg(m => (m === "sendMessage" ? { ok: false, error_code: 403 } : { ok: true }));
    await t.run(msg("/fav"));
    expect(t.saved()?.favs).toEqual({ "2": [{ id: "101", name: "ΣΥΝΤΑΓΜΑ" }] });
  });
});
