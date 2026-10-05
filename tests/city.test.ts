import { describe, expect, it } from "vitest";
import { alongPath, cityFC, CityMotion, cityPosition, cleanCity, cumulative, isCityLive, MAX_AHEAD_S } from "../src/lib/city";
import { distanceM } from "../src/lib/glide";
import type { CityVehicle } from "../src/lib/types";

// 0.01° lon at 37.97° ≈ 877 m. Paths are [lat, lon].
const M = 877.4;
const path: [number, number][] = [[37.97, 23.70], [37.97, 23.71], [37.98, 23.71]];
const T = 1_791_100_000;

const veh = (extra: Partial<CityVehicle> = {}): CityVehicle => ({
  line: "040", id: "1", lat: 37.97, lon: 23.70, bearing: null, position_at: T, variant: "v",
  delay_s: 30, speed: 10, path, ...extra,
});

describe("alongPath", () => {
  it("walks metres along the path, round the corner, clamped to the ends", () => {
    expect(alongPath(path, 0)).toEqual([23.70, 37.97]);
    expect(alongPath(path, -5)).toEqual([23.70, 37.97]);
    expect(distanceM(alongPath(path, M / 2), [23.705, 37.97])).toBeLessThan(1);
    const corner = alongPath(path, M + 100);
    expect(corner[0]).toBeCloseTo(23.71, 6);
    expect(corner[1]).toBeGreaterThan(37.97);
    expect(alongPath(path, 1e6)).toEqual([23.71, 37.98]);
  });
});

describe("cityPosition", () => {
  it("moves at speed along the path from position_at", () => {
    expect(distanceM(cityPosition(veh(), T + 10), alongPath(path, 100))).toBeLessThan(0.5);
  });
  it("stays at the GPS fix without speed or path, and before position_at", () => {
    expect(cityPosition(veh({ speed: null }), T + 10)).toEqual([23.70, 37.97]);
    expect(cityPosition(veh({ speed: 0 }), T + 10)).toEqual([23.70, 37.97]);
    expect(cityPosition(veh({ path: null, lon: 23.8 }), T + 10)).toEqual([23.8, 37.97]);
    expect(cityPosition(veh({ path: [[37.97, 23.7]] }), T + 10)).toEqual([23.70, 37.97]);
    expect(cityPosition(veh(), T - 30)).toEqual([23.70, 37.97]);
  });
  it("extrapolates at most MAX_AHEAD_S", () => {
    expect(cityPosition(veh({ speed: 1 }), T + 1000)).toEqual(cityPosition(veh({ speed: 1 }), T + MAX_AHEAD_S));
  });
});

describe("CityMotion", () => {
  it("blends from the shown point to new data instead of jumping", () => {
    const m = new CityMotion();
    m.update([veh({ speed: 0 })], T * 1000);
    expect(m.positions(T * 1000).get("040/1")).toEqual([23.70, 37.97]);
    // New fix 100 m ahead.
    const next = veh({ speed: 0, lon: 23.70 + 100 / M * 0.01, position_at: T + 30 });
    m.update([next], (T + 30) * 1000);
    const start = m.positions((T + 30) * 1000).get("040/1")!;
    expect(distanceM(start, [23.70, 37.97])).toBeLessThan(0.5);
    const mid = m.positions((T + 30) * 1000 + 750).get("040/1")!;
    expect(distanceM(mid, [23.70, 37.97])).toBeGreaterThan(30);
    expect(m.positions((T + 30) * 1000 + 2000).get("040/1")).toEqual([next.lon, next.lat]);
  });
  it("jumps over long moves and places new vehicles at once", () => {
    const m = new CityMotion();
    m.update([veh({ speed: 0 })], T * 1000);
    m.positions(T * 1000);
    m.update([veh({ speed: 0, lon: 23.75, position_at: T + 30 }), veh({ id: "2", speed: 0, lon: 23.72 })], T * 1000 + 100);
    const p = m.positions(T * 1000 + 100);
    expect(p.get("040/1")).toEqual([23.75, 37.97]);
    expect(p.get("040/2")).toEqual([23.72, 37.97]);
  });
  it("drops vehicles that left the data", () => {
    const m = new CityMotion();
    m.update([veh()], T * 1000);
    m.positions(T * 1000);
    m.update([], T * 1000 + 30_000);
    expect(m.positions(T * 1000 + 30_000).size).toBe(0);
  });
});

describe("cityFC and isCityLive", () => {
  it("leaves out excluded lines and carries the delay class", () => {
    const vs = [veh(), veh({ line: "550", id: "9", delay_s: null })];
    const pos = new Map([["040/1", [23.7, 37.97] as [number, number]], ["550/9", [23.8, 37.97] as [number, number]]]);
    const fc = cityFC(vs, pos, new Set(["040"]));
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties).toEqual({ line: "550", id: "9", cls: "none" });
  });
  it("accepts the contract body only", () => {
    expect(isCityLive({ updated_at: T, next_update_at: T + 30, vehicles: [] })).toBe(true);
    expect(isCityLive({ updated_at: T, vehicles: [] })).toBe(false);
    expect(isCityLive({ error: "unknown" })).toBe(false);
    expect(isCityLive(null)).toBe(false);
  });
});

describe("freshness and cleaning", () => {
  it("ignores older or repeated fixes: no rewind, no restarted blend", () => {
    const m = new CityMotion();
    const a = veh({ speed: 0, position_at: T + 30, lon: 23.701 });
    m.update([a], (T + 30) * 1000);
    m.positions((T + 30) * 1000);
    m.update([veh({ speed: 0, position_at: T, lon: 23.70 })], (T + 31) * 1000);   // older
    expect(m.positions((T + 31) * 1000).get("040/1")).toEqual([23.701, 37.97]);
    // A newer fix starts a blend; the same snapshot again does not restart it.
    const b = veh({ speed: 0, position_at: T + 60, lon: 23.702 });
    m.update([b], (T + 60) * 1000);
    m.positions((T + 60) * 1000 + 1000);
    m.update([b], (T + 60) * 1000 + 1000);
    expect(m.positions((T + 60) * 1000 + 1600).get("040/1")).toEqual([23.702, 37.97]);
  });
  it("keeps the same id on different lines apart", () => {
    const m = new CityMotion();
    m.update([veh({ speed: 0 }), veh({ line: "550", speed: 0, lon: 23.8 })], T * 1000);
    expect(m.positions(T * 1000).size).toBe(2);
  });
  it("drops malformed rows and nulls bad optional fields", () => {
    const rows = [veh(), { ...veh(), lat: "x" }, { ...veh(), id: 5 }, null,
      { ...veh(), id: "2", speed: -1, path: [[1, 2], [3]], delay_s: "late", bearing: NaN }];
    const out = cleanCity(rows);
    expect(out.map(v => v.id)).toEqual(["1", "2"]);
    expect(out[1]).toMatchObject({ speed: null, path: null, delay_s: null, bearing: null });
  });
  it("precomputed distances give the same point", () => {
    expect(alongPath(path, 1000, cumulative(path))).toEqual(alongPath(path, 1000));
  });
});
