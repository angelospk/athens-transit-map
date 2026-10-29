import { describe, expect, it } from "vitest";
import { arrivalGroups, toward, linesAt, busStopsFC, stopIndex, twins, type StopArrival } from "../src/lib/stops";
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
  it("at most 3 times a group", () => {
    const many = [1, 2, 3, 4].map(k => a("040", "Π", k * 120, String(k)));
    expect(arrivalGroups(many, now)[0].times.map(t => t.vehicle)).toEqual(["1", "2", "3"]);
  });
});

describe("toward", () => {
  it("the last stop of an end-to-end headsign", () => {
    expect(toward("Α. ΠΑΤΗΣΙΑ - Ν. ΠΑΓΚΡΑΤΙ - Ν. ΕΛΒΕΤΙΑ")).toBe("Ν. ΕΛΒΕΤΙΑ");
    expect(toward("ΠΕΙΡΑΙΑΣ - ΣΥΝΤΑΓΜΑ(ΠΡΟΣΩΡΙΝΗ ΛΟΓΩ ΕΡΓΩΝ)")).toBe("ΣΥΝΤΑΓΜΑ(ΠΡΟΣΩΡΙΝΗ ΛΟΓΩ ΕΡΓΩΝ)");
    expect(toward("ΚΥΚΛΙΚΗ")).toBe("ΚΥΚΛΙΚΗ");
  });
});
