import { describe, expect, it } from "vitest";
import { distanceM, type LngLat } from "../src/lib/glide";
import { Fleet, routeGeom } from "../src/lib/map/fleet";
import { shapeLength } from "../src/lib/predict";
import type { CityVehicle, Vehicle } from "../src/lib/types";

// 0.01° lon at 37.97° ≈ 877 m. Shapes and paths are [lat, lon].
const M = 877.4;
const T = 1_791_100_000;
const shape: [number, number][] = [[37.97, 23.70], [37.97, 23.71], [37.97, 23.72]];
const route = routeGeom({ shape, stopIds: [], stopS: [], endS: shapeLength(shape) });
const lonAt = (m: number) => 23.70 + (m / M) * 0.01;
const pathFrom = (m: number): [number, number][] => [[37.97, lonAt(m)], [37.97, lonAt(m + 1000)]];

const city = (m: number, at: number, extra: Partial<CityVehicle> = {}): CityVehicle => ({
  line: "040", id: "1", lat: 37.97, lon: lonAt(m), bearing: 90, position_at: at, variant: "v", delay_s: 0,
  speed: 8, path: pathFrom(m), ...extra,
});
const line = (m: number, at: number, extra: Partial<Vehicle> = {}): Vehicle => ({
  id: "1", lat: 37.97, lon: lonAt(m), bearing: 90, position_at: at, route_code: "r", variant: "v", trip_id: "t",
  trip_label: null, delay_s: 0, next_stop_id: null, speed: 8, path: pathFrom(m), ...extra,
});
const run = (f: Fleet, from: number, to: number) => {
  let p: LngLat = [0, 0];
  for (let t = from; t <= to + 1e-9; t += 0.05) p = f.entries.get("040/1")!.mover.step(t).pos;
  return p;
};

describe("Fleet", () => {
  it("keeps the motion when a clicked vehicle's line brings the fix the city layer already shows", () => {
    const f = new Fleet();
    f.city([city(100, T)], new Set(), T + 20);
    const before = run(f, T + 20, T + 25);
    f.line("040", [{ v: line(100, T), route }], T + 25);   // same position_at
    const next = run(f, T + 25.05, T + 25.05);
    expect(distanceM(before, next)).toBeLessThan(1);         // no jump, no restart
    expect(f.entries.get("040/1")!.track).not.toBeNull();    // the route track still starts
  });

  it("does not rewind when the city layer takes a closed line back with an older fix", () => {
    const f = new Fleet();
    f.line("040", [{ v: line(300, T + 30), route }], T + 30);
    const shown = run(f, T + 30, T + 35);
    f.city([city(100, T)], new Set(), T + 35);               // older fix from the city snapshot
    const after = run(f, T + 35.05, T + 35.05);
    expect(distanceM(shown, after)).toBeLessThan(1);
  });

  it("moves on smoothly to a newer fix slightly ahead", () => {
    const f = new Fleet();
    f.city([city(100, T)], new Set(), T);
    const a = run(f, T, T + 30);
    f.city([city(400, T + 30)], new Set(), T + 30);          // it was a bit faster than guessed
    let prev = a, maxStep = 0;
    for (let t = T + 30.05; t < T + 40; t += 0.05) {
      const p = f.entries.get("040/1")!.mover.step(t).pos;
      maxStep = Math.max(maxStep, distanceM(prev, p));
      expect(p[0]).toBeGreaterThanOrEqual(prev[0] - 1e-9);  // never backwards (east)
      prev = p;
    }
    expect(maxStep).toBeLessThan(1.5);                       // ≤ 30 m/s at 20 fps
  });

  it("leaves owned lines to their own data and drops vehicles that are gone", () => {
    const f = new Fleet();
    f.line("040", [{ v: line(100, T), route }], T);
    f.city([city(500, T + 60)], new Set(["040"]), T + 60);
    expect(f.entries.get("040/1")!.at).toBe(T);              // the line drives it
    f.city([], new Set(["040"]), T + 90);
    expect(f.entries.size).toBe(1);
    f.city([], new Set(), T + 120);
    expect(f.entries.size).toBe(0);
    f.line("040", [{ v: line(100, T + 150), route }], T + 150);
    f.line("040", [], T + 180);
    expect(f.entries.size).toBe(0);
  });

  it("keeps the same id on two lines apart", () => {
    const f = new Fleet();
    f.city([city(100, T), city(100, T, { line: "550" })], new Set(), T);
    expect(f.entries.size).toBe(2);
  });

  it("does not disturb a running handoff when the same line data comes again", () => {
    const f = new Fleet();
    const north: [number, number][] = [[37.97015, lonAt(100)], [37.97015, lonAt(1100)]];
    f.city([city(100, T, { lat: 37.97015, path: north })], new Set(), T);   // driven ~17 m off the route
    run(f, T, T + 30);
    f.line("040", [{ v: line(300, T + 30), route }], T + 30);   // newer fix a bit ahead: hand over, offset fades
    let prev = run(f, T + 30, T + 30.5), max = 0;
    for (let i = 1; i < 70; i++) {
      const t = T + 30.5 + i * 0.05;
      if (i === 10) f.line("040", [{ v: line(300, T + 30), route }], t);   // the same data again
      const p = f.entries.get("040/1")!.mover.step(t).pos;
      max = Math.max(max, distanceM(prev, p));
      prev = p;
    }
    expect(max).toBeLessThan(1.5);
  });
});

