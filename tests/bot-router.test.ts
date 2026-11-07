// One Telegram poller for every city (web#56): the router hands each update to its city's bot. A start link
// or a button names its city by a 3-letter prefix (pat_…, pat:b:…); no prefix is Athens, so links and
// buttons from before keep working. Free text goes to the chat's last city. /list and /stop see all cities.
import { describe, expect, it } from "vitest";
import { Bot, type BotDeps, type BotState, type Fetched } from "../bot/bot";
import { Router, type RouterState } from "../bot/router";
import { CITYBUS, TG_CITIES } from "../bot/cities";
import { encodeAlert, MAX_PAYLOAD, tgStart } from "../src/lib/tglink";
import type { TripIndex } from "../src/lib/trip";

const T0 = Date.UTC(2026, 9, 8, 7, 0, 0);   // 10:00 in Athens
const ix: TripIndex = {
  v: "2026-07-08",
  s: [["ΣΥΝΤΑΓΜΑ", 37.9755, 23.7348, "100"], ["ΒΟΥΛΗ", 37.9762, 23.7355, "102"], ["ΚΗΦΙΣΙΑ", 38.07, 23.81, "103"]],
  l: { "022": { A: [0, 1, 2] } },
};
const payload = encodeAlert(ix, 3, [{ line: "022", variants: [{ id: "A", i: 2 }] }])!;
const board = (now: number, id: string) => ({ stop: { id, name: "ΣΥΝΤΑΓΜΑ", lat: 37.9755, lon: 23.7348 }, lines: ["022"], updated_at: now / 1000, arrivals: [] });

type Sent = { method: string; body: Record<string, unknown> };
function city(name: string, sent: Sent[], gets: string[], clock: () => number, prefix?: string, failSave?: () => boolean) {
  const urls = { trips: `https://${name}/trips.json`, static: `https://${name}/s`, api: `https://${name}/a` };
  let state: BotState | undefined;
  const deps: BotDeps = {
    urls, ...(prefix && { prefix }), now: clock, sleep: async () => {},
    save: s => { if (failSave?.()) throw new Error("ENOSPC"); state = JSON.parse(JSON.stringify(s)); },
    tg: async (method, body) => { sent.push({ method, body }); return { ok: true, result: { message_id: 9 } }; },
    push: async () => 201,
    get: async (url): Promise<Fetched> => {
      gets.push(url);
      if (url === urls.trips) return { status: 200, body: ix };
      if (url === `${urls.static}/lines.json`) return { status: 200, body: { gtfs_version: ix.v, lines: [] } };
      const m = url.startsWith(`${urls.api}/v1/stops/`) && url.slice(`${urls.api}/v1/stops/`.length);
      if (m) return { status: 200, body: board(clock(), m), date: clock() };
      return { status: 404, body: null };
    },
  };
  return { bot: new Bot(deps), saved: () => state };
}

function setup(o: { saved?: RouterState; offset0?: number; failPat?: () => boolean; failRouter?: () => boolean } = {}) {
  let now = T0;
  const sent: Sent[] = [], gets: string[] = [];
  const clock = () => now;
  const ath = city("ath", sent, gets, clock);
  const pat = city("pat", sent, gets, clock, "pat", o.failPat);
  let rstate: RouterState | undefined = o.saved;
  const router = new Router({
    cities: [{ code: "ath", name: "Αθήνα", bot: ath.bot }, { code: "pat", name: "Πάτρα", bot: pat.bot }],
    save: s => { if (o.failRouter?.()) throw new Error("ENOSPC"); rstate = JSON.parse(JSON.stringify(s)); },
  }, o.saved, o.offset0);
  let id = 100;
  const run = async (...u: object[]) => {
    await router.handle(u.map(x => ({ update_id: id++, ...x })) as never);
    for (const b of [ath.bot, pat.bot]) await b.settle();
    for (const b of [ath.bot, pat.bot]) await b.flush();
  };
  return {
    router, ath, pat, sent, gets, run,
    rsaved: () => rstate,
    advance: (ms: number) => void (now += ms),
    texts: () => sent.filter(s => s.method === "sendMessage").map(s => s.body.text as string),
    last: (method = "sendMessage") => sent.filter(s => s.method === method).at(-1)!,
  };
}

const msg = (text: string, chat = 1) => ({ message: { chat: { id: chat, type: "private" }, from: { id: chat }, text } });
const cb = (data: string, chat = 1) => ({ callback_query: { id: "q", from: { id: chat }, data, message: { chat: { id: chat }, message_id: 9 } } });
const datas = (s: Sent) => JSON.stringify(s.body.reply_markup ?? {}).match(/"callback_data":"[^"]*"/g)?.map(x => x.slice(17, -1)) ?? [];

describe("Router: start links", () => {
  it("a link without a prefix (links already shared) is an Athens alert, as before", async () => {
    const t = setup();
    await t.run(msg(`/start ${payload}`));
    expect(t.ath.saved()?.alerts).toHaveLength(1);
    expect(t.pat.saved()?.alerts ?? []).toEqual([]);
    expect(t.texts()[0]).toMatch(/022 στη στάση ΚΗΦΙΣΙΑ/);
    expect(datas(t.last())).toEqual([expect.stringMatching(/^stop:/), "all"]);   // Athens buttons keep no prefix
  });

  it("pat_<payload> is an alert of that city, with its buttons prefixed, and sets the chat's city", async () => {
    const t = setup();
    await t.run(msg(`/start pat_${payload}`));
    expect(t.pat.saved()?.alerts).toHaveLength(1);
    expect(t.ath.saved()?.alerts ?? []).toEqual([]);
    expect(datas(t.last())).toEqual([expect.stringMatching(/^pat:stop:/), "all"]);
    expect(t.rsaved()?.city).toEqual({ "1": "pat" });
    expect(t.gets.some(u => u.startsWith("https://ath/"))).toBe(false);
  });

  it("an unknown prefix is a bad link, not another city", async () => {
    const t = setup();
    await t.run(msg(`/start zzz_${payload}`));
    expect(t.texts()[0]).toMatch(/δεν είναι σωστός/);
    expect(t.pat.saved()?.alerts ?? []).toEqual([]);
  });
});

describe("Router: the chat's city", () => {
  it("free text searches Athens by default, and the last link's city after it", async () => {
    const t = setup();
    await t.run(msg("ΣΥΝΤΑΓΜΑ"));
    expect(datas(t.last())).toEqual(["b:100"]);
    t.advance(3000);
    await t.run(msg(`/start pat_${payload}`), msg("ΣΥΝΤΑΓΜΑ"));
    expect(datas(t.last())).toEqual(["pat:b:100"]);
  });

  it("/city lists the cities; a choice sets the chat's city and survives a restart", async () => {
    const t = setup();
    await t.run(msg("/city"));
    expect(datas(t.last())).toEqual(["city:ath", "city:pat"]);
    await t.run(cb("city:pat"));
    expect(t.last("answerCallbackQuery").body.text).toMatch(/Πάτρα/);
    const again = setup({ saved: t.rsaved() });
    await again.run(msg("ΣΥΝΤΑΓΜΑ"));
    expect(datas(again.last())).toEqual(["pat:b:100"]);
  });
});

describe("Router: buttons", () => {
  it("pat:b:<stop> asks that city's board; b:<stop> (old messages) asks Athens", async () => {
    const t = setup();
    await t.run(cb("pat:b:100"));
    expect(t.gets).toContain("https://pat/a/v1/stops/100");
    expect(datas(t.last())).toContain("pat:r:100");
    expect(datas(t.last())).toContain("pat:f:100");
    await t.run(cb("b:100"));
    expect(t.gets).toContain("https://ath/a/v1/stops/100");
    expect(datas(t.last())).toContain("r:100");
  });

  it("🔔 on a city's board starts an alert in that city", async () => {
    const t = setup();
    await t.run(cb("pat:b:100"));
    const bell = datas(t.last()).find(d => d.startsWith("pat:a:"))!;
    expect(bell).toBeTruthy();
    await t.run(cb(bell));
    expect(t.pat.saved()?.alerts).toHaveLength(1);
  });
});

describe("Router: /list and /stop across cities", () => {
  it("/list is one message with every city's alerts, each line named by its city", async () => {
    const t = setup();
    await t.run(msg(`/start ${payload}`));
    t.advance(3000);
    await t.run(msg(`/start pat_${payload}`));
    await t.run(msg("/list"));
    const text = t.last().body.text as string;
    expect(text.split("\n")).toEqual([expect.stringMatching(/^Αθήνα · 🔔/), expect.stringMatching(/^Πάτρα · 🔔/)]);
    const d = datas(t.last());
    expect(d).toEqual([expect.stringMatching(/^stop:/), expect.stringMatching(/^pat:stop:/), "all"]);
    await t.run(cb(d[1]));
    expect(t.pat.saved()?.alerts).toEqual([]);
    expect(t.ath.saved()?.alerts).toHaveLength(1);
  });

  it("/list names no city when all alerts are in one", async () => {
    const t = setup();
    await t.run(msg(`/start pat_${payload}`), msg("/list"));
    expect(t.last().body.text).toMatch(/^🔔/);
  });

  it("/list with no alert anywhere says so once", async () => {
    const t = setup();
    await t.run(msg("/list"));
    expect(t.texts()).toEqual(["Δεν έχεις ειδοποιήσεις."]);
  });

  it("/stop stops the chat's alerts in every city, with one answer", async () => {
    const t = setup();
    await t.run(msg(`/start ${payload}`));
    t.advance(3000);
    await t.run(msg(`/start pat_${payload}`));
    const before = t.texts().length;
    await t.run(msg("/stop"));
    expect(t.texts().slice(before)).toEqual([expect.stringMatching(/Σταμάτησαν/)]);
    expect(t.ath.saved()?.alerts).toEqual([]);
    expect(t.pat.saved()?.alerts).toEqual([]);
  });

  it("«Απεγγραφή από όλα» (all) stops every city, answered once", async () => {
    const t = setup();
    await t.run(msg(`/start ${payload}`));
    t.advance(3000);
    await t.run(msg(`/start pat_${payload}`), msg(`/start ${payload}`, 2));
    await t.run(cb("all"));
    expect(t.ath.saved()?.alerts.map(a => a.chat)).toEqual([2]);
    expect(t.pat.saved()?.alerts).toEqual([]);
    expect(t.sent.filter(s => s.method === "answerCallbackQuery")).toHaveLength(1);
  });
});

describe("Router: update offset", () => {
  it("starts from the Athens bot's offset and saves its own", async () => {
    const t = setup({ offset0: 100 });
    expect(t.router.offset).toBe(100);
    await t.run(msg("ΣΥΝΤΑΓΜΑ"));
    expect(t.router.offset).toBe(101);
    expect(t.rsaved()?.offset).toBe(101);
  });

  it("stops at an update whose city could not save it: Telegram sends it again", async () => {
    const t = setup({ failPat: () => true });
    await t.run(msg("ΣΥΝΤΑΓΜΑ"), msg(`/start pat_${payload}`), msg("ΒΟΥΛΗ"));
    expect(t.router.offset).toBe(101);
  });
});

describe("Router: failed saves", () => {
  it("saves the offset after each update, so a crash replays at most the one in flight", async () => {
    const t = setup();
    const saves: number[] = [];
    const r = new Router({ cities: [{ code: "ath", name: "Αθήνα", bot: t.ath.bot }], save: s => void saves.push(s.offset) });
    await r.handle([{ update_id: 5, ...msg("ΣΥΝΤΑΓΜΑ") }, { update_id: 6, ...msg("ΒΟΥΛΗ") }] as never);
    expect(saves).toEqual([6, 7]);
  });

  it("an update a city saved before a crash, but the router did not, is not done twice", async () => {
    const t = setup();
    await t.run(msg(`/start pat_${payload}`));
    const sent = t.texts().length, offset = t.router.offset;
    t.advance(3000);
    // A restart before the router's save: the router is back at the update, the city bot already has it.
    const again = new Router({ cities: [{ code: "ath", name: "Αθήνα", bot: t.ath.bot }, { code: "pat", name: "Πάτρα", bot: t.pat.bot }], save: () => {} }, { offset: offset - 1 });
    await again.handle([{ update_id: offset - 1, ...msg(`/start pat_${payload}`) }] as never);
    await t.pat.bot.flush();
    expect(t.pat.saved()?.alerts).toHaveLength(1);
    expect(t.texts()).toHaveLength(sent);
    expect(again.offset).toBe(offset);
  });

  it("a /city choice it could not save is not confirmed, and its update comes again", async () => {
    const t = setup({ failRouter: () => true });
    await t.run(cb("city:pat"));
    expect(t.sent).toEqual([]);
    expect(t.router.offset).toBe(0);
    await t.run(msg("ΣΥΝΤΑΓΜΑ", 1));
    expect(t.router.offset).toBe(0);
  });

  it("/stop that a city could not save is not reported done, and its update comes again", async () => {
    let fail = false;
    const t = setup({ failPat: () => fail });
    await t.run(msg(`/start pat_${payload}`));
    const before = t.texts().length, offset = t.router.offset;
    fail = true;
    await t.run(msg("/stop"));
    expect(t.texts().slice(before)).toEqual([]);
    expect(t.router.offset).toBe(offset);
    expect(t.pat.saved()?.alerts).toHaveLength(1);
  });

  it("a long /list is split into messages within Telegram's limits, none left out", async () => {
    const t = setup();
    const many = new Router({
      cities: Array.from({ length: 30 }, (_, k) => ({ code: `c${String(k).padStart(2, "0")}`.replace(/\d/g, d => "abcdefghij"[+d]), name: `Πόλη ${k}`, bot: {
        chatAlerts: () => ({ lines: Array.from({ length: 15 }, (_, j) => `🔔 έως 12:00 · ${"Χ".repeat(40)} · ${k}-${j}`),
          buttons: Array.from({ length: 15 }, (_, j) => [{ text: `Σταμάτα ${k}-${j}`, callback_data: `x:stop:${k}-${j}` }]) }),
        out: (method: string, body: Record<string, unknown>) => void t.sent.push({ method, body }),
      } as never })),
      save: () => {},
    });
    await many.handle([{ update_id: 1, ...msg("/list") }] as never);
    const out = t.sent.filter(s => s.method === "sendMessage");
    expect(out.length).toBeGreaterThan(1);
    for (const m of out) {
      expect((m.body.text as string).length).toBeLessThanOrEqual(4096);
      expect(datas(m).length).toBeLessThanOrEqual(100);
    }
    expect(out.flatMap(m => (m.body.text as string).split("\n"))).toHaveLength(450);
    expect(out.flatMap(datas).filter(d => d.includes(":stop:"))).toHaveLength(450);
    expect(datas(out.at(-1)!).at(-1)).toBe("all");
  });
});

describe("Telegram limits with prefixes", () => {
  it("every city has a unique 3-letter code; Athens is ath; the citybus codes are staseis-rt's", () => {
    const codes = TG_CITIES.map(c => c.code);
    expect(codes[0]).toBe("ath");
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c).toMatch(/^[a-z]{3}$/);
    expect(TG_CITIES.find(c => c.slug === "thessaloniki")?.code).toBe("skg");
    for (const c of CITYBUS) expect(TG_CITIES.find(x => x.slug === c.slug)?.code).toBe(c.code);
    expect(TG_CITIES).toHaveLength(30);
  });

  it("a start parameter stays within 64 characters, also at the longest payload", () => {
    const big: TripIndex = { v: "2026-07-08", s: Array.from({ length: 40 }, (_, k) => [`S${k}`, 38, 23, `${k}`] as [string, number, number, string]),
      l: Object.fromEntries(Array.from({ length: 20 }, (_, k) => [`L${k}`, { A: Array.from({ length: 40 }, (_, j) => j) }])) };
    const lines = Object.keys(big.l).map(line => ({ line, variants: [{ id: "A", i: 39 }] }));
    const athens = encodeAlert(big, 3, lines)!;
    expect(athens.length).toBeGreaterThan(MAX_PAYLOAD - 5);
    expect(tgStart("athens", big, 3, lines)).toBe(athens);   // Athens: no prefix, the payload as it was
    for (const c of TG_CITIES.slice(1)) {
      const p = tgStart(c.slug, big, 3, lines)!;
      expect(p.startsWith(`${c.code}_`)).toBe(true);
      expect(p.length).toBeLessThanOrEqual(64);
      expect(p).toMatch(/^[A-Za-z0-9_-]+$/);
    }
    const rep = { days: 31, start: 480, len: 60 };
    expect(tgStart("patras", big, 3, lines, rep)!.length).toBeLessThanOrEqual(64);
    expect(tgStart("nowhere", big, 3, lines)).toBeNull();
  });

  it("a city's buttons stay within 64 bytes at the longest stop id, bells too", async () => {
    const long = "x".repeat(58);   // pat:b: + 58 = 64
    const many = Object.fromEntries(Array.from({ length: 12 }, (_, k) => [`V${k}`, [0, 1]]));
    const bix: TripIndex = { v: "2026-07-08", s: [["ΜΑΚΡΥ", 38, 23, long], ["ΑΛΛΗ", 38.001, 23, "1234567"]], l: { "1": many, "2": { A: [0, 1] } } };
    const sent: Sent[] = [], gets: string[] = [];
    const urls = { trips: "https://p/t", static: "https://p/s", api: "https://p/a" };
    const bot = new Bot({
      urls, prefix: "pat", now: () => T0, sleep: async () => {}, save: () => {}, push: async () => 201,
      tg: async (method, body) => { sent.push({ method, body }); return { ok: true }; },
      get: async (url) => {
        gets.push(url);
        if (url === urls.trips) return { status: 200, body: bix };
        if (url === `${urls.static}/lines.json`) return { status: 200, body: { gtfs_version: bix.v } };
        if (url.startsWith(`${urls.api}/v1/stops/`)) return { status: 200, body: board(T0, long) };
        return { status: 404, body: null };
      },
    });
    await bot.handle([{ update_id: 1, ...cb(`b:${long}`) } as never]);
    await bot.settle();
    await bot.flush();
    const all = sent.flatMap(datas);
    expect(all.length).toBeGreaterThan(0);
    for (const d of all) expect(new TextEncoder().encode(d).length).toBeLessThanOrEqual(64);
    expect(all).toContain(`pat:r:${long}`);
    expect(all.filter(d => d.startsWith("pat:a:")).map(d => d.slice(6).length).every(n => n <= 58)).toBe(true);
    expect(all).toContain("pat:a:" + encodeAlert(bix, 3, [{ line: "2", variants: [{ id: "A", i: 0 }] }])!);
  });
});
