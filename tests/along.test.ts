// Contract rev 20: vehicles with `along_m` move along their variant's static shape, past the end of
// path_beyond, from the server's place on it (no projection of the fix on loops).
import { describe, expect, it } from "vitest";
import type { LngLat } from "../src/lib/glide";
import { alongS, Fleet, routeGeom, type RouteGeom } from "../src/lib/map/fleet";
import { shapeLength, updateTrack } from "../src/lib/predict";
import type { CityVehicle, Vehicle } from "../src/lib/types";

const M = 877.4;   // metres per 0.01° lon at 37.97°
const T = 1_791_100_000;
const lonAt = (m: number) => 23.70 + (m / M) * 0.01;
const pt = (m: number): [number, number] => [37.97, lonAt(m)];
// A straight 10 km shape, a point every 500 m.
const long: [number, number][] = Array.from({ length: 21 }, (_, i) => pt(i * 500));
const mk = (shape: [number, number][], lengthM?: number): RouteGeom =>
  routeGeom({ shape, stopIds: [], stopS: [], endS: shapeLength(shape), lengthM });
const route = mk(long);
const routes = (r: RouteGeom | null) => (line: string, variant: string | null) => (line === "040" && variant === "v" ? r : null);

// At m metres, with path to m+300 and path_beyond on to m+800 (today's median).
const city = (m: number, at: number, extra: Partial<CityVehicle> = {}): CityVehicle => ({
  line: "040", id: "1", lat: 37.97, lon: lonAt(m), bearing: 90, position_at: at, variant: "v", delay_s: 0,
  speed: 10, path: [pt(m), pt(m + 300)], path_beyond: [pt(m + 300), pt(m + 800)], path_stops: null, path_speeds: null,
  along_m: m, ...extra,
});
const stepTo = (f: Fleet, from: number, to: number, each?: (p: LngLat) => void) => {
  let p: LngLat = [0, 0];
  for (let t = from; t <= to + 1e-9; t += 0.05) { p = f.entries.get("040/1")!.mover.step(t).pos; each?.(p); }
  return p;
};

describe("along_m (rev 20)", () => {
  it("drives on along the static shape past the end of path_beyond", () => {
    const f = new Fleet();
    f.city([city(1000, T)], new Set(), T, routes(route));
    const p = stepTo(f, T, T + 150);
    expect(p[0]).toBeGreaterThan(lonAt(2000));   // 0.85 x 10 m/s x 150 s ≈ 1275 m on, not stopped at 1800
  });

  it("stops at the end of path_beyond without the shape (the rev 4 rule)", () => {
    const f = new Fleet();
    f.city([city(1000, T)], new Set(), T, routes(null));
    const p = stepTo(f, T, T + 150);
    expect(p[0]).toBeLessThan(lonAt(1801));
  });

  it("walks path_speeds from along_m, a null step at speed, and stops at the shape's end", () => {
    const f = new Fleet();
    f.city([city(9000, T, { path_speeds: [5, null], speed: 12 })], new Set(), T, routes(route));
    const p = stepTo(f, T, T + 170);
    expect(p[0]).toBeLessThan(lonAt(10000) + 1e-7);
    expect(p[0]).toBeGreaterThan(lonAt(9990));   // 200 m at 5, then 12 m/s: at the end by ~110 s
  });

  it("waits at path_stops on a loop, not at the other pass's stops", () => {
    const back: [number, number][] = [pt(0), pt(1000), pt(0)];
    // The route's stops as the client snapped them: the return stop on the way out (300 m).
    const r = routeGeom({ shape: back, stopIds: ["a"], stopS: [300], endS: shapeLength(back) });
    const f = new Fleet();
    // At 1400 m (going back west), the server's next stop 300 m ahead (1700 m), no step speeds.
    f.city([city(600, T, { along_m: 1400, speed: 8, path: null, path_beyond: null, path_stops: [300] })], new Set(), T,
      (l, vr) => (vr === "v" ? r : null));
    const mv = f.entries.get("040/1")!.mover;
    const at = (t: number) => mv.plan!.target(t);
    // It stands at 1700 m for a while (a stop wait), then moves on.
    const stood = [T + 40, T + 45].map(at);
    expect(Math.abs(stood[0] - stood[1])).toBeLessThan(0.5);
    expect(Math.abs(stood[0] - (at(T) + 300))).toBeLessThan(2);
  });

  it("scales along_m by the client's length over length_m", () => {
    const r = mk(long, shapeLength(long) * 1.01);
    const s = alongS(r, 5050, [lonAt(5000), 37.97])!;
    expect(Math.abs(s - 5000)).toBeLessThan(2);
  });

  it("takes the shape when it loads after the fix, on the same fix again", () => {
    const f = new Fleet();
    let r: RouteGeom | null = null;
    const of = (line: string, variant: string | null) => (variant === "v" ? r : null);
    f.city([city(1000, T)], new Set(), T, of);   // no shape yet: path + path_beyond
    stepTo(f, T, T + 10);
    r = route;
    f.city([city(1000, T)], new Set(), T + 10, of);   // the next refresh, same fix
    const p = stepTo(f, T + 10.05, T + 150);
    expect(p[0]).toBeGreaterThan(lonAt(2000));
  });

  it("ignores along_m that does not fit the shape or the fix (another GTFS)", () => {
    expect(alongS(route, 5000, [lonAt(5600), 37.97])).toBeNull();   // 600 m from the fix
    expect(alongS(route, 20_000, [lonAt(10000), 37.97])).toBeNull(); // past the shape's end
    expect(alongS(route, 10_020, [lonAt(10000), 37.97])).toBeCloseTo(shapeLength(long), 0);   // rounding: clamped
  });

  it("glides on to a new fix a little behind the guess without going backwards", () => {
    const f = new Fleet();
    f.city([city(1000, T)], new Set(), T, routes(route));
    stepTo(f, T, T + 30);   // the guess is ~255 m on
    f.city([city(1230, T + 30)], new Set(), T + 30, routes(route));
    let last = -Infinity, back = 0;
    stepTo(f, T + 30.05, T + 60, p => { back = Math.max(back, last - p[0]); last = p[0]; });
    expect(back).toBeLessThan(1e-7);
    expect(last).toBeGreaterThan(lonAt(1300));
  });

  it("starts the new shape on a new variant", () => {
    const other = mk(long.map(([la, lo]) => [la + 0.001, lo] as [number, number]));
    const f = new Fleet();
    const of = (line: string, variant: string | null) => (variant === "w" ? other : variant === "v" ? route : null);
    f.city([city(1000, T)], new Set(), T, of);
    stepTo(f, T, T + 20);
    f.city([city(3000, T + 20, { variant: "w", lat: 37.971, path: null, path_beyond: null })], new Set(), T + 20, of);
    const p = stepTo(f, T + 20.05, T + 40);
    expect(p[1]).toBeCloseTo(37.971, 4);
    expect(p[0]).toBeGreaterThan(lonAt(3000));
  });

  it("takes the pass along_m names on an out-and-back shape (no projection of the fix)", () => {
    const back: [number, number][] = [pt(0), pt(1000), pt(0)];
    const r = { shape: back, stopIds: [], stopS: [], endS: shapeLength(back) };
    const fix: Vehicle = { id: "1", lat: 37.97, lon: lonAt(300), bearing: null, position_at: T, route_code: "r", variant: "v",
      trip_id: "t", trip_label: null, delay_s: 0, next_stop_id: null, speed: 5, along_m: 1700 };
    const t = updateTrack(null, { pos: [fix.lon, fix.lat], at: T, key: "v/t", speed: 5, along: 1700 }, r, T)!;
    expect(t.alts).toBeUndefined();
    expect(Math.abs(t.s - 1700)).toBeLessThan(2);
    // Without along_m the same fix is ambiguous (300 or 1700): held.
    expect(updateTrack(null, { pos: [fix.lon, fix.lat], at: T, key: "v/t", speed: 5 }, r, T)!.alts).toHaveLength(2);
  });

  it("moves a detailed line's vehicle from its along_m on an out-and-back shape", () => {
    const back: [number, number][] = [pt(0), pt(1000), pt(0)];
    const r = mk(back);
    const f = new Fleet();
    const v: Vehicle = { id: "1", lat: 37.97, lon: lonAt(300), bearing: 270, position_at: T, route_code: "r", variant: "v",
      trip_id: "t", trip_label: null, delay_s: 0, next_stop_id: null, speed: 5, path: null, along_m: 1700 };
    f.line("040", [{ v, route: r }], T);
    expect(f.entries.get("040/1")!.track!.alts).toBeUndefined();
    const p = stepTo(f, T, T + 20);
    expect(p[0]).toBeLessThan(lonAt(300));   // heading west, back to the start
  });
});
