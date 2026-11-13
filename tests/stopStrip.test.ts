import { describe, expect, it } from "vitest";
import { gapText, stopStrip } from "../src/lib/stopStrip";
import type { Segment } from "../src/lib/liveQuality";
import type { V2Pattern, V2Stop, V2Vehicle } from "../src/lib/v2";

// A straight road along the equator: stops A..D every 0.01° of longitude (~1.1 km), shape every 0.0025°.
const st = (id: string, lon: number): V2Stop => ({ id, name: id.slice(5), lat: 0, lon } as V2Stop);
const STOPS: Record<string, V2Stop> = Object.fromEntries(
  [st("oasa:A", 0), st("oasa:B", 0.01), st("oasa:C", 0.02), st("oasa:D", 0.03)].map(s => [s.id, s]));
const line = (from: number, to: number): [number, number][] => {
  const out: [number, number][] = [];
  const step = from < to ? 0.0025 : -0.0025;
  for (let x = from; from < to ? x <= to + 1e-9 : x >= to - 1e-9; x += step) out.push([0, +x.toFixed(4)]);
  return out;
};
const P0: V2Pattern = { id: "oasa:1", headsign: "D", direction: 0, stops: ["oasa:A", "oasa:B", "oasa:C", "oasa:D"], shape: line(0, 0.03) };
const P0short: V2Pattern = { id: "oasa:2", headsign: "C", direction: 0, stops: ["oasa:A", "oasa:B", "oasa:C"], shape: line(0, 0.02) };
const P1: V2Pattern = { id: "oasa:3", headsign: "A", direction: 1, stops: ["oasa:D", "oasa:C", "oasa:B", "oasa:A"], shape: line(0.03, 0) };
const PATS = [P0short, P0, P1];

const veh = (id: string, lon: number, o: Partial<V2Vehicle> = {}): V2Vehicle => ({
  id, line: "oasa:040", run: null, mode: "bus", headsign: "D", label: id.slice(5), delay_s: null, next_stop: null, motion: null, source: "oasa",
  direction: 0, position: { kind: "gps", lat: 0, lon, bearing: null, at: 0 }, ...o,
});
const seg = (o: Partial<Segment>): Segment =>
  ({ pattern: "oasa:1", from: "oasa:B", to: "oasa:C", level: "worse", ratio: 0.7, speed: 3.9, usual_speed: 5.3, n: 3, ...o });

describe("stopStrip: the direction's longest pattern", () => {
  it("takes every stop of the longest pattern of the direction, in order", () => {
    const s = stopStrip(PATS, STOPS, [], [], 0)!;
    expect(s.pattern.id).toBe("oasa:1");
    expect(s.stops).toEqual(["oasa:A", "oasa:B", "oasa:C", "oasa:D"]);
    expect(s.gaps).toHaveLength(3);
    expect(stopStrip(PATS, STOPS, [], [], 1)!.stops[0]).toBe("oasa:D");
  });
  it("no pattern in that direction: null", () => {
    expect(stopStrip([P0], STOPS, [], [], 1)).toBeNull();
  });
});

describe("stopStrip: vehicles between stops", () => {
  it("places a vehicle by its position: stop index plus the fraction to the next stop", () => {
    const s = stopStrip(PATS, STOPS, [veh("oasa:7", 0.015), veh("oasa:8", 0.0025)], [], 0)!;
    expect(s.vehicles.map(x => [x.v.id, Math.round(x.at * 100) / 100])).toEqual([["oasa:8", 0.25], ["oasa:7", 1.5]]);
    expect(s.elsewhere).toEqual([]);
  });
  it("keeps only the vehicles of the shown direction", () => {
    const s = stopStrip(PATS, STOPS, [veh("oasa:7", 0.015), veh("oasa:9", 0.015, { direction: 1, headsign: "A" })], [], 0)!;
    expect(s.vehicles.map(x => x.v.id)).toEqual(["oasa:7"]);
  });
  it("at or before the first stop: 0; past the last: the last index", () => {
    const s = stopStrip(PATS, STOPS, [veh("oasa:1", -0.001), veh("oasa:2", 0.031)], [], 0)!;
    expect(s.vehicles.map(x => x.at)).toEqual([0, 3]);
  });
  it("far off the road (another shape): before its next stop; without one, listed apart", () => {
    const far = (id: string, next: string | null) => veh(id, 0.025, { position: { kind: "gps", lat: 0.01, lon: 0.025, bearing: null, at: 0 }, next_stop: next });
    const s = stopStrip(PATS, STOPS, [far("oasa:5", "oasa:C"), far("oasa:6", null), far("oasa:4", "oasa:Z")], [], 0)!;
    expect(s.vehicles.map(x => [x.v.id, x.at])).toEqual([["oasa:5", 1.5]]);
    expect(s.elsewhere.map(v => v.id)).toEqual(["oasa:6", "oasa:4"]);
  });
});

describe("stopStrip: slow gaps", () => {
  it("a worse or much_worse segment of any pattern colours the gap of the same two stops", () => {
    const s = stopStrip(PATS, STOPS, [], [seg({ pattern: "oasa:2" }), seg({ from: "oasa:C", to: "oasa:D", level: "much_worse", speed: 1.9, usual_speed: null })], 0)!;
    expect(s.gaps).toEqual([null, { level: "worse", text: "πιο αργό: 14 km/h, συνήθως 19" }, { level: "much_worse", text: "πολύ πιο αργό: 7 km/h" }]);
  });
  it("normal and unknown segments, or a pair that is not next to each other here: nothing", () => {
    const s = stopStrip(PATS, STOPS, [], [seg({ level: "normal" }), seg({ from: "oasa:A", to: "oasa:B", level: "unknown" }), seg({ from: "oasa:A", to: "oasa:C" })], 0)!;
    expect(s.gaps).toEqual([null, null, null]);
  });
});

describe("gapText", () => {
  it("short: «πιο αργό: N km/h, συνήθως M»", () => {
    expect(gapText({ level: "worse", speed: 3.9, usual_speed: 5.3 })).toBe("πιο αργό: 14 km/h, συνήθως 19");
    expect(gapText({ level: "much_worse", speed: 1.9, usual_speed: 5 })).toBe("πολύ πιο αργό: 7 km/h, συνήθως 18");
    expect(gapText({ level: "worse", speed: 3.9, usual_speed: null })).toBe("πιο αργό: 14 km/h");
  });
});

describe("stopStrip: review cases", () => {
  // Out and back on one road: A → B → C → B' → A' (B' and A' at the same places as B and A).
  const LOOP: V2Pattern = { id: "oasa:9", headsign: "A", direction: 0, stops: ["oasa:A", "oasa:B", "oasa:C", "oasa:B2", "oasa:A2"],
    shape: [...line(0, 0.02), ...line(0.02, 0).slice(1)] };
  const S2 = { ...STOPS, "oasa:B2": st("oasa:B2", 0.01), "oasa:A2": st("oasa:A2", 0) };
  it("stops of an out-and-back pattern keep their order along it", () => {
    const s = stopStrip([LOOP], S2, [veh("oasa:1", 0.015, { next_stop: "oasa:C" }), veh("oasa:2", 0.015, { next_stop: "oasa:B2" })], [], 0)!;
    expect(s.vehicles.map(x => [x.v.id, Math.round(x.at * 100) / 100])).toEqual([["oasa:1", 1.5], ["oasa:2", 2.5]]);
  });
  it("a stop without coordinates: the fraction spans every row it skips", () => {
    const { "oasa:B": _, ...noB } = STOPS;
    const s = stopStrip([{ ...P0 }], noB, [veh("oasa:7", 0.01)], [], 0)!;
    expect(Math.round(s.vehicles[0].at * 100) / 100).toBe(1);
  });
});

describe("stopStrip: review cases, round 2", () => {
  it("a long leg of the shape: a vehicle on the way back lands between the stops of the way back", () => {
    // Shape with two legs only (out to 0.02, back to 0); stops out at 0, 0.01, turn 0.015, back at 0.01, 0.
    const P: V2Pattern = { id: "oasa:11", headsign: "A", direction: 0, stops: ["oasa:A", "oasa:B", "oasa:T", "oasa:B2", "oasa:A2"],
      shape: [[0, 0], [0, 0.02], [0, 0]] };
    const S = { ...STOPS, "oasa:T": st("oasa:T", 0.015), "oasa:B2": st("oasa:B2", 0.01), "oasa:A2": st("oasa:A2", 0) };
    const s = stopStrip([P], S, [veh("oasa:1", 0.0125, { next_stop: "oasa:B2" })], [], 0)!;
    // T at 1650 m, the turn at 2200 m, B2 at 3300 m: the vehicle at 3025 m is 1375 of the 1650 m from T to B2.
    expect(s.vehicles[0].at).toBeCloseTo(2 + 1375 / 1650, 2);
  });
  it("a stop that comes twice (a loop A → B → C → A): the vehicle takes the occurrence it is near on the shape", () => {
    const P: V2Pattern = { id: "oasa:12", headsign: "A", direction: 0, stops: ["oasa:A", "oasa:B", "oasa:C", "oasa:A"],
      shape: [...line(0, 0.02), ...line(0.02, 0).slice(1)] };
    const s = stopStrip([P], STOPS, [veh("oasa:1", 0.005, { next_stop: "oasa:A" })], [], 0)!;
    expect(Math.round(s.vehicles[0].at * 100) / 100).toBe(2.75);
  });
});
