import { describe, expect, it } from "vitest";
import { arrivalGroups, timeText, toward, linesAt, busStopsFC, stopIndex, twins, alertLinesAt, arrivalNote, stopBack, mineFirst, boardLines, linesToWarm, type StopArrival } from "../src/lib/stops";
import type { TripIndex } from "../src/lib/trip";

// 0 and 1: one stop on both sides of a street (~44 m), 2: the same name 1 km away, 3: another name close by.
const ix: TripIndex = {
  v: "t",
  s: [
    ["Άγιος Νικόλαος", 37.98, 23.7, "100"],
    ["ΑΓΙΟΣ ΝΙΚΟΛΑΟΣ", 37.9804, 23.7, "101"],
    ["Άγιος Νικόλαος", 37.99, 23.7, "102"],
    ["Πλατεία", 37.9801, 23.7001, "103"],
  ],
  l: {
    "040": { a: [0, 3], b: [1] },
    "10": { c: [3, 0, 2] },
    "Α1": { d: [2] },
  },
};

describe("busStopsFC", () => {
  it("one point per stop, keyed by its index, with its GTFS id", () => {
    const fc = busStopsFC(ix);
    expect(fc.features).toHaveLength(4);
    expect(fc.features[1]).toEqual({ type: "Feature", id: 1, geometry: { type: "Point", coordinates: [23.7, 37.9804] },
      properties: { i: 1, name: "ΑΓΙΟΣ ΝΙΚΟΛΑΟΣ" } });
  });
});

describe("stopIndex", () => {
  it("a GTFS id to its index; an unknown id is -1", () => {
    expect(stopIndex(ix, "102")).toBe(2);
    expect(stopIndex(ix, "nope")).toBe(-1);
  });
});

describe("linesAt", () => {
  it("the lines that call at a stop and their variants through it, by line number", () => {
    expect(linesAt(ix, 0)).toEqual([{ line: "10", variants: ["c"] }, { line: "040", variants: ["a"] }]);
    expect(linesAt(ix, 1)).toEqual([{ line: "040", variants: ["b"] }]);
  });
});

describe("twins", () => {
  it("the stop of the same name across the street, nearest first; far ones and other names are not", () => {
    expect(twins(ix, 0)).toEqual([{ i: 1, m: 44 }]);
    expect(twins(ix, 1)).toEqual([{ i: 0, m: 44 }]);
    expect(twins(ix, 3)).toEqual([]);
  });
});

describe("arrivalGroups", () => {
  const now = 1_000_000_000_000;
  const a = (line: string, headsign: string, inS: number, vehicle: string, delay = 0): StopArrival =>
    ({ line, headsign, variant: line + headsign, vehicle, eta_s: inS, at: now / 1000 + inS, delay_s: delay, position_at: 0 });
  it("by line and headsign, soonest first, in minutes from `at` (an answer cached a while ages)", () => {
    const g = arrivalGroups([a("040", "ΠΕΙΡΑΙΑΣ", 60, "1"), a("10", "ΧΑΛΑΝΔΡΙ", 30, "2", 400), a("040", "ΠΕΙΡΑΙΑΣ", 600, "3"),
      a("040", "ΣΥΝΤΑΓΜΑ", 900, "4")], now + 30_000);
    expect(g).toEqual([
      { line: "10", headsign: "ΧΑΛΑΝΔΡΙ", variant: "10ΧΑΛΑΝΔΡΙ", times: [{ min: 0, vehicle: "2", late: 7 }] },
      { line: "040", headsign: "ΠΕΙΡΑΙΑΣ", variant: "040ΠΕΙΡΑΙΑΣ", times: [{ min: 1, vehicle: "1", late: 0 }, { min: 10, vehicle: "3", late: 0 }] },
      { line: "040", headsign: "ΣΥΝΤΑΓΜΑ", variant: "040ΣΥΝΤΑΓΜΑ", times: [{ min: 15, vehicle: "4", late: 0 }] },
    ]);
  });
  it("a bus more than a minute past its time is gone (an old answer after failed refreshes)", () => {
    const g = arrivalGroups([a("040", "Π", 0, "1"), a("040", "Π", 300, "2")], now + 61_000);
    expect(g[0].times.map(t => t.vehicle)).toEqual(["2"]);
    expect(arrivalGroups([a("040", "Π", 0, "1")], now + 61_000)).toEqual([]);
  });
  it("only buses: a timetable trip with no bus yet (source schedule) is left out", () => {
    const sch = { ...a("040", "Π", 120, ""), source: "schedule" as const };
    expect(arrivalGroups([sch, { ...a("040", "Π", 300, "2"), source: "live" as const }], now)[0].times.map(t => t.vehicle)).toEqual(["2"]);
    expect(arrivalGroups([sch], now)).toEqual([]);
  });
  it("rev 8: at the stop (next stop, ≤ 50 m), stops away from 2 on, and an estimate without a trip (~, never late)", () => {
    const live = (inS: number, v: string, extra: Partial<StopArrival>, delay = 0): StopArrival =>
      ({ ...a("040", "Π", inS, v, delay), source: "live", trip_id: "t" + v, scheduled: now / 1000 + inS, ...extra });
    const g = arrivalGroups([
      live(10, "1", { stops_away: 1, distance_m: 40 }),
      live(200, "2", { stops_away: 1, distance_m: 600 }),
      live(400, "3", { stops_away: 4, distance_m: 1500 }),
    ], now);
    expect(g[0].times).toEqual([
      { min: 0, vehicle: "1", late: 0, here: true },
      { min: 3, vehicle: "2", late: 0 },
      { min: 7, vehicle: "3", late: 0, away: 4 },
    ]);
    const est = arrivalGroups([live(420, "9", { trip_id: null, scheduled: null, stops_away: 2, distance_m: 900 }, 300)], now);
    expect(est[0].times).toEqual([{ min: 7, vehicle: "9", late: 0, away: 2, est: true }]);
  });
  it("an old server without the rev 8 fields: no hint, no estimate mark", () => {
    expect(arrivalGroups([a("040", "Π", 0, "1"), a("040", "Π", 300, "2", 180)], now)[0].times)
      .toStrictEqual([{ min: 0, vehicle: "1", late: 0 }, { min: 5, vehicle: "2", late: 3 }]);
  });
  it("at most 3 times a group", () => {
    const many = [1, 2, 3, 4].map(k => a("040", "Π", k * 120, String(k)));
    expect(arrivalGroups(many, now)[0].times.map(t => t.vehicle)).toEqual(["1", "2", "3"]);
  });
});

describe("timeText", () => {
  it("at the stop, now, minutes; an estimate without a trip carries ~, now too", () => {
    expect(timeText({ min: 0, vehicle: "1", late: 0, here: true })).toBe("στη στάση");
    expect(timeText({ min: 0, vehicle: "1", late: 0 })).toBe("τώρα");
    expect(timeText({ min: 0, vehicle: "1", late: 0, est: true })).toBe("~τώρα");
    expect(timeText({ min: 7, vehicle: "1", late: 0 })).toBe("7′");
    expect(timeText({ min: 7, vehicle: "1", late: 0, est: true })).toBe("~7′");
  });
});

describe("toward", () => {
  it("the last stop of an end-to-end headsign", () => {
    expect(toward("Α. ΠΑΤΗΣΙΑ - Ν. ΠΑΓΚΡΑΤΙ - Ν. ΕΛΒΕΤΙΑ")).toBe("Ν. ΕΛΒΕΤΙΑ");
    expect(toward("ΠΕΙΡΑΙΑΣ - ΣΥΝΤΑΓΜΑ(ΠΡΟΣΩΡΙΝΗ ΛΟΓΩ ΕΡΓΩΝ)")).toBe("ΣΥΝΤΑΓΜΑ(ΠΡΟΣΩΡΙΝΗ ΛΟΓΩ ΕΡΓΩΝ)");
    expect(toward("ΚΥΚΛΙΚΗ")).toBe("ΚΥΚΛΙΚΗ");
  });
});

describe("alertLinesAt", () => {
  const ix: TripIndex = { v: "2026-10-06", s: [["Α", 0, 0], ["Β", 0, 0.001], ["Γ", 0, 0.002]],
    l: { "040": { "1": [0, 1, 2], "2": [2, 1, 0] }, "550": { "9": [1, 2, 1] } } };
  it("boards every variant through the stop at the stop", () => {
    expect(alertLinesAt(ix, 1)).toEqual([
      { line: "040", variants: [{ id: "1", i: 1, from: 1 }, { id: "2", i: 1, from: 1 }] },
      { line: "550", variants: [{ id: "9", i: 0, from: 1 }] },
    ]);
  });
  it("keeps only the given lines, and takes the hinted pass of a loop", () => {
    expect(alertLinesAt(ix, 1, ["550"], { "9": 2 })).toEqual([{ line: "550", variants: [{ id: "9", i: 2, from: 1 }] }]);
    expect(alertLinesAt(ix, 1, ["550"], { "9": 1 })).toEqual([{ line: "550", variants: [{ id: "9", i: 0, from: 1 }] }]);
  });
});

describe("arrivalNote", () => {
  it("says where the bus is and whether it is on time", () => {
    expect(arrivalNote({ min: 4, vehicle: "v", late: 0 })).toEqual({ text: "στην ώρα του", tone: "ok" });
    expect(arrivalNote({ min: 4, vehicle: "v", late: 1 })).toEqual({ text: "στην ώρα του", tone: "ok" });
    expect(arrivalNote({ min: 9, vehicle: "v", late: 3, away: 4 })).toEqual({ text: "4 στάσεις πριν · αργεί 3′", tone: "late" });
    expect(arrivalNote({ min: 0, vehicle: "v", late: 0, here: true })).toEqual({ text: "στη στάση", tone: "ok" });
  });
  it("says estimate, never a delay, for a bus with no trip", () => {
    expect(arrivalNote({ min: 6, vehicle: "v", late: 0, est: true, away: 2 })).toEqual({ text: "2 στάσεις πριν · εκτίμηση", tone: "muted" });
  });
  it("counts an early bus as on time", () => {
    expect(arrivalNote({ min: 6, vehicle: "v", late: -3 })).toEqual({ text: "στην ώρα του", tone: "ok" });
  });
});

describe("stopBack", () => {
  it("names the stop n stops before place i of a variant", () => {
    expect(stopBack(ix, "10", "c", 2, 1)).toBe("Άγιος Νικόλαος");
    expect(stopBack(ix, "10", "c", 2, 2)).toBe("Πλατεία");
  });
  it("is null before the first stop or for an unknown line or variant", () => {
    expect(stopBack(ix, "10", "c", 1, 2)).toBeNull();
    expect(stopBack(ix, "99", "c", 2, 1)).toBeNull();
    expect(stopBack(ix, "10", "z", 2, 1)).toBeNull();
  });
});

describe("mineFirst", () => {
  const g = (line: string) => ({ line, headsign: "Α - Β", variant: "x", times: [] });
  it("splits the groups into the user's lines and the others, keeping their order", () => {
    expect(mineFirst([g("10"), g("040"), g("Α1"), g("040")], ["040"])).toEqual({ mine: [g("040"), g("040")], also: [g("10"), g("Α1")] });
  });
});

describe("boardLines (the card before the stop index loads)", () => {
  const a = (line: string, variant: string, eta_s: number, source: "live" | "schedule" = "live"): StopArrival =>
    ({ line, headsign: "h", variant, vehicle: "v", eta_s, at: 0, delay_s: 0, position_at: 0, source });
  it("lists every line of the board, in line order, with the variants its arrivals name", () => {
    const b = { stop: { id: "1", name: "Σ", lat: 0, lon: 0 }, lines: ["Χ95", "040", "10"], updated_at: 0,
      arrivals: [a("040", "b", 60), a("040", "a", 30), a("040", "a", 90), a("Χ95", "x", 10)] };
    expect(boardLines(b)).toEqual([
      { line: "10", variants: [] },
      { line: "040", variants: ["a", "b"] },
      { line: "Χ95", variants: ["x"] },
    ]);
  });
});

describe("linesToWarm (line files loaded ahead from a stop's board)", () => {
  const a = (line: string, eta_s: number, source: "live" | "schedule" = "live"): StopArrival =>
    ({ line, headsign: "h", variant: "v", vehicle: "v", eta_s, at: 0, delay_s: 0, position_at: 0, source });
  it("takes the lines with a live bus on its way, soonest first, each once, at most max", () => {
    const arr = [a("040", 300), a("10", 60), a("Α1", 30, "schedule"), a("040", 20), a("Χ95", 900), a("B", 100)];
    expect(linesToWarm(arr, 3)).toEqual(["040", "10", "B"]);
  });
  it("is empty for an empty board", () => expect(linesToWarm([])).toEqual([]));
});
