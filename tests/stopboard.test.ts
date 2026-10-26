import { describe, expect, it } from "vitest";
import type { DayStats } from "../src/lib/stats";
import {
  boardRows, CRUISE_MS, etaLabel, groupRows, lineCruise, stopLines, travelS, twins, type BoardVehicle,
} from "../src/lib/stopboard";
import type { TripIndex } from "../src/lib/trip";
import type { LineStatic } from "../src/lib/types";

// Shapes are [lat, lon]. 0.01° lon at 37.97° ≈ 877 m.
const M = 877.4;
const T = 1_791_100_000;
const stop = (lon: number, lat = 37.97) => ({ name: `S${lon}`, lat, lon });

// 040: east along one street (A..E), back on the other side (E2..A2). 550: a loop that passes Q twice.
const L040: LineStatic = {
  id: "040",
  variants: {
    east: { headsign: "→ E", direction: 0, shape: [[37.97, 23.70], [37.97, 23.73]], stops: ["A", "B", "C", "D", "E"] },
    west: { headsign: "→ A", direction: 1, shape: [[37.9702, 23.73], [37.9702, 23.70]], stops: ["E2", "C2", "A2"] },
  },
  stops: {
    A: stop(23.700), B: stop(23.705), C: stop(23.710), D: stop(23.720), E: stop(23.730),
    E2: stop(23.730, 37.9702), C2: stop(23.710, 37.9702), A2: stop(23.700, 37.9702),
  },
};
const L550: LineStatic = {
  id: "550",
  variants: {
    loop: { headsign: "loop", direction: 0, shape: [[37.97, 23.70], [37.97, 23.71], [37.97001, 23.71], [37.97001, 23.70]],
      stops: ["P", "Q", "R", "Q", "S"] },
  },
  stops: { P: stop(23.700), Q: stop(23.705), R: stop(23.710), S: stop(23.700, 37.97001) },
};
const statics = { "040": L040, "550": L550 };
const bus = (id: string, lon: number, extra: Partial<BoardVehicle> = {}): BoardVehicle =>
  ({ line: "040", id, variant: "east", lat: 37.97, lon, position_at: T, speed: 5, ...extra });

describe("travel time", () => {
  it("walks the typical speeds ahead, a step without one at the bus's speed, then cruises", () => {
    expect(travelS(500, [5, null, 10], 2)).toBeCloseTo(200 / 5 + 200 / 2 + 100 / 10);
    expect(travelS(1000, [5], null)).toBeCloseTo(40 + 800 / CRUISE_MS);
    expect(travelS(300, null, 0)).toBeCloseTo(300 / CRUISE_MS);
    expect(travelS(200, [null], 0)).toBeCloseTo(200 / 1.5);   // standing, no history: the backend's fallback
    expect(travelS(-5, [5], 5)).toBe(0);
    expect(travelS(1000, null, 5, 2.5)).toBeCloseTo(400);
  });

  it("takes each line's speed from the daily stats, for lines with enough samples, within bounds", () => {
    const line = (id: string, km: number, hours: number) => ({ line: id, fixes: 1, vehicles: 1, dist_m: km * 1000, time_s: hours * 3600 });
    const day = { by_line: [line("040", 180, 15), line("550", 10, 1), line("Χ95", 1000, 20), line("2", 20, 20)] } as DayStats;
    expect(lineCruise(day)).toEqual({ "040": 180 / 54, "Χ95": 8, "2": 2 });
    expect(lineCruise(null)).toEqual({});
  });

  it("uses a line's own speed past the typical speeds ahead", () => {
    const [own] = boardRows("D", statics, [bus("1", 23.702)], T, { "040": 2 });
    expect(own.etaS! - T).toBeCloseTo(1.8 * M / 2, -1);
  });
});

describe("stop board rows", () => {
  it("lists the buses coming, soonest first, with the stops left; not the ones past the stop", () => {
    const rows = boardRows("D", statics, [bus("far", 23.702), bus("near", 23.712), bus("past", 23.725)], T);
    expect(rows.map(r => [r.vehicle, r.stopsAway])).toEqual([["near", 1], ["far", 3]]);
    expect(rows[1].etaS! - T).toBeCloseTo(1.8 * M / CRUISE_MS, -1);
    expect(rows.every(r => r.line === "040" && r.variant === "east" && r.ageS === 0)).toBe(true);
  });

  it("skips the other direction, unknown variants, lines without static data and old fixes", () => {
    const vs = [bus("w", 23.72, { variant: "west", lat: 37.9702 }), bus("x", 23.702, { variant: "nope" }),
      bus("y", 23.702, { line: "999" }), bus("old", 23.702, { position_at: T - 301 }), bus("ok", 23.702, { position_at: T - 299 })];
    expect(boardRows("D", statics, vs, T).map(r => r.vehicle)).toEqual(["ok"]);
  });

  it("counts the fix's age: an arrival well before now is gone, a recent one is now", () => {
    const at = 23.7195;   // ≈ 44 m before D
    expect(boardRows("D", statics, [bus("1", at, { position_at: T - 120 })], T)).toEqual([]);
    const [r] = boardRows("D", statics, [bus("1", at, { position_at: T - 20 })], T);
    expect(etaLabel(r.etaS, T)).toBe("τώρα");
  });

  it("does not list buses at a stop where they end", () => {
    expect(boardRows("E", statics, [bus("1", 23.712)], T)).toEqual([]);
  });

  it("shows a bus standing at its first stop as waiting, after the moving ones", () => {
    const rows = boardRows("C", statics, [bus("wait", 23.7001, { speed: 0 }), bus("go", 23.702)], T);
    expect(rows.map(r => [r.vehicle, r.etaS == null])).toEqual([["go", false], ["wait", true]]);
    expect(etaLabel(rows[1].etaS, T)).toBe("αφετηρία");
    expect(boardRows("C", statics, [bus("leaving", 23.7001, { speed: 3 })], T)[0].etaS).not.toBeNull();
  });

  it("on a loop, the next stop settles which pass the bus is on; without it, no guess", () => {
    const loop = (extra: Partial<BoardVehicle>) => ({ ...bus("1", 23.7075, { line: "550", variant: "loop" }), ...extra });
    const [r] = boardRows("Q", statics, [loop({ next_stop_id: "R" })], T);
    expect(r.stopsAway).toBe(2);   // R, then Q on the way back
    expect(r.etaS! - T).toBeCloseTo((0.25 + 0.5) * M / CRUISE_MS, -1);
    expect(boardRows("Q", statics, [loop({ next_stop_id: null })], T)).toEqual([]);
  });
});

describe("stop lines and groups", () => {
  // Stops: 0 A, 1 B, 2 C (end of 040 east), 3 C across the street, 4 another C far away.
  const ix: TripIndex = {
    v: "x",
    s: [["Α", 37.97, 23.70, "A"], ["Β", 37.97, 23.705, "B"], ["Γ", 37.97, 23.71, "C"], ["γ", 37.9702, 23.71, "C2"], ["Γ", 37.99, 23.71, "C9"]],
    l: { "040": { east: [0, 1, 2], west: [3, 1, 0] }, "550": { loop: [1, 2, 1] }, "10": { x: [4, 2] } },
  };

  it("lists the lines and variants that serve a stop, and those that only end there", () => {
    expect(stopLines(ix, 1)).toEqual({ serve: [{ line: "040", variants: ["east", "west"] }, { line: "550", variants: ["loop"] }], end: [] });
    expect(stopLines(ix, 2)).toEqual({ serve: [{ line: "550", variants: ["loop"] }], end: ["10", "040"] });
  });

  it("finds the stop of the same name across the street", () => {
    expect(twins(ix, 2)).toEqual([3]);
    expect(twins(ix, 0)).toEqual([]);
  });

  it("groups by direction, the ones with a bus coming first", () => {
    const rows = boardRows("C", statics, [bus("1", 23.702)], T);
    const groups = groupRows(rows, [{ line: "040", variants: ["east", "west"] }, { line: "622", variants: ["v"] }], statics);
    // Directions are named by their last stop: E (S23.73) and A2 (S23.7). 622 has no static data yet.
    expect(groups.map(g => [g.line, g.to, g.rows.length])).toEqual([["040", "S23.73", 1], ["040", "S23.7", 0], ["622", "", 0]]);
  });
});
