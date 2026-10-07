import { describe, expect, it } from "vitest";
import { AlertWatch, approaching } from "../src/lib/alerts";
import type { Vehicle } from "../src/lib/types";

const NOW = 1_000_000;
const veh = (o: Partial<Vehicle>): Vehicle => ({ id: "v1", lat: 0, lon: 0, bearing: null, position_at: NOW - 10, route_code: "",
  variant: "A", trip_id: "t1", trip_label: null, delay_s: 0, next_stop_id: null, ...o });
const stops = ["s0", "s1", "s2", "s3", "s4", "s5", "s6"];

describe("approaching", () => {
  it("counts the stops left to the boarding stop, the boarding stop included", () => {
    expect(approaching(stops, 5, veh({ next_stop_id: "s5" }), NOW)).toBe(1);
    expect(approaching(stops, 5, veh({ next_stop_id: "s3" }), NOW)).toBe(3);
    expect(approaching(stops, 5, veh({ next_stop_id: "s0" }), NOW)).toBe(6);
  });
  it("gives null once the bus has passed the stop, or when it cannot tell", () => {
    expect(approaching(stops, 5, veh({ next_stop_id: "s6" }), NOW)).toBeNull();
    expect(approaching(stops, 5, veh({ next_stop_id: null }), NOW)).toBeNull();
    expect(approaching(stops, 5, veh({ next_stop_id: "x" }), NOW)).toBeNull();
    expect(approaching(stops, 5, veh({ next_stop_id: "s3", position_at: NOW - 121 }), NOW)).toBeNull();   // old fix
  });
  it("cannot tell on a stop the line passes twice: no answer until the next stop", () => {
    const loop = ["s0", "s1", "s2", "s0", "s3", "s4"];   // s0 is passed twice
    expect(approaching(loop, 5, veh({ next_stop_id: "s0" }), NOW)).toBeNull();
    expect(approaching(loop, 5, veh({ next_stop_id: "s3" }), NOW)).toBe(2);
    expect(approaching(loop, 1, veh({ next_stop_id: "s0" }), NOW)).toBeNull();   // before or after stop 1?
  });
  it("counts age and stops at the exact limits", () => {
    expect(approaching(stops, 5, veh({ next_stop_id: "s5", position_at: NOW - 120 }), NOW)).toBe(1);
    expect(approaching(stops, 0, veh({ next_stop_id: "s0" }), NOW)).toBe(1);
    expect(approaching(stops, 9, veh({ next_stop_id: "s0" }), NOW)).toBeNull();   // no stop 9
  });
});

describe("AlertWatch", () => {
  const spec = { n: 3, until: NOW + 7200, lines: [{ line: "622", variants: [{ id: "A", i: 5 }] }] };
  const live = (vs: Vehicle[]) => ({ "622": { line: "622", updated_at: NOW, next_update_at: NOW + 30, vehicles: vs } });
  const statics = { "622": { id: "622", stops: {}, variants: { A: { headsign: "", direction: 0, shape: [], stops } } } };

  it("fires once per trip when a bus comes within n stops, even after skipping stops", () => {
    const w = new AlertWatch();
    expect(w.check(spec, live([veh({ next_stop_id: "s1" })]), statics, NOW)).toEqual([]);   // 5 left
    const hit = w.check(spec, live([veh({ next_stop_id: "s4" })]), statics, NOW);            // 4 → 2: skipped 3
    expect(hit).toEqual([{ line: "622", vehicle: "v1", left: 2, stop: "s5", delay_s: 0 }]);
    expect(w.check(spec, live([veh({ next_stop_id: "s5" })]), statics, NOW)).toEqual([]);   // same trip
    expect(w.check(spec, live([veh({ id: "v2", trip_id: "t2", next_stop_id: "s3" })]), statics, NOW)).toHaveLength(1);
  });

  it("checks the boarding stop's name against the planner's: other GTFS data, no alert", () => {
    const named1 = { ...spec, lines: [{ line: "622", variants: [{ id: "A", i: 5, name: "ΑΛΛΗ" }] }] };
    const named2 = { ...spec, lines: [{ line: "622", variants: [{ id: "A", i: 5, name: "ΑΓΟΡΑ" }] }] };
    const w = new AlertWatch();
    const named = { "622": { ...statics["622"], stops: { s5: { name: "ΑΓΟΡΑ", lat: 0, lon: 0 } } } };
    expect(w.check(named1, live([veh({ next_stop_id: "s4" })]), named, NOW)).toEqual([]);
    const ok = new AlertWatch();
    expect(ok.check(named2, live([veh({ next_stop_id: "s4" })]), named, NOW)).toHaveLength(1);
  });

  it("stops firing once expired", () => {
    const w = new AlertWatch();
    expect(w.check({ ...spec, until: NOW }, live([veh({ next_stop_id: "s4" })]), statics, NOW + 1)).toEqual([]);
  });

  it("ignores buses on other variants, and lines without static data yet", () => {
    const w = new AlertWatch();
    expect(w.check(spec, live([veh({ variant: "B", next_stop_id: "s4" })]), statics, NOW)).toEqual([]);
    expect(w.check(spec, live([veh({ next_stop_id: "s4" })]), {}, NOW)).toEqual([]);
  });

  it("starts over for a new alert", () => {
    const w = new AlertWatch();
    expect(w.check(spec, live([veh({ next_stop_id: "s4" })]), statics, NOW)).toHaveLength(1);
    expect(w.check({ ...spec, until: spec.until + 1 }, live([veh({ next_stop_id: "s4" })]), statics, NOW)).toHaveLength(1);
  });

  it("keeps its fired trips across a save and restore", () => {
    const w = new AlertWatch();
    expect(w.check(spec, live([veh({ next_stop_id: "s4" })]), statics, NOW)).toHaveLength(1);
    const back = new AlertWatch(JSON.parse(JSON.stringify(w.snapshot())));
    expect(back.check(spec, live([veh({ next_stop_id: "s4" })]), statics, NOW)).toEqual([]);
  });

  it("tells a trip without trip_id by vehicle and variant", () => {
    const w = new AlertWatch();
    expect(w.check(spec, live([veh({ trip_id: null, next_stop_id: "s4" })]), statics, NOW)).toHaveLength(1);
    expect(w.check(spec, live([veh({ trip_id: null, next_stop_id: "s5" })]), statics, NOW)).toEqual([]);
  });
});
