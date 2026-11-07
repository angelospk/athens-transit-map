import { describe, expect, it } from "vitest";
import { cityKey, cleanCity, isCityLive } from "../src/lib/city";
import type { CityVehicle } from "../src/lib/types";

const T = 1_791_100_000;
const path: [number, number][] = [[37.97, 23.70], [37.97, 23.71]];
const veh = (extra: Partial<CityVehicle> = {}): CityVehicle => ({
  line: "040", id: "1", lat: 37.97, lon: 23.70, bearing: null, position_at: T, variant: "v",
  delay_s: 30, speed: 10, path, ...extra,
});

describe("city data", () => {
  it("accepts the contract body only", () => {
    expect(isCityLive({ updated_at: T, next_update_at: T + 30, vehicles: [] })).toBe(true);
    expect(isCityLive({ updated_at: T, vehicles: [] })).toBe(false);
    expect(isCityLive({ error: "unknown" })).toBe(false);
    expect(isCityLive(null)).toBe(false);
  });
  it("drops malformed rows and nulls bad optional fields", () => {
    const rows = [veh(), { ...veh(), lat: "x" }, { ...veh(), id: 5 }, null,
      { ...veh(), id: "2", speed: -1, path: [[1, 2], [3]], delay_s: "late", bearing: NaN }];
    const out = cleanCity(rows);
    expect(out.map(v => v.id)).toEqual(["1", "2"]);
    expect(out[1]).toMatchObject({ speed: null, path: null, delay_s: null, bearing: null });
  });
  it("keys vehicles by line and id", () => {
    expect(cityKey(veh())).not.toBe(cityKey(veh({ line: "550" })));
  });
});

describe("cleanCity motion fields (rev 4, 6, 20)", () => {
  const base = { line: "040", id: "1", lat: 37.97, lon: 23.7, position_at: 5, bearing: null, variant: "v", delay_s: 0, speed: 3,
    path: [[37.97, 23.7], [37.97, 23.71]] };
  it("keeps along_m, path_beyond, path_stops and path_speeds", () => {
    const [v] = cleanCity([{ ...base, along_m: 4210, path_beyond: [[37.97, 23.71], [37.97, 23.72]], path_stops: [300, 900],
      path_speeds: [6.2, null, 4] }]);
    expect(v.along_m).toBe(4210);
    expect(v.path_beyond).toEqual([[37.97, 23.71], [37.97, 23.72]]);
    expect(v.path_stops).toEqual([300, 900]);
    expect(v.path_speeds).toEqual([6.2, null, 4]);
  });
  it("turns bad ones into null", () => {
    const [v] = cleanCity([{ ...base, along_m: -3, path_beyond: [[1]], path_stops: ["x"], path_speeds: "fast" }]);
    expect([v.along_m, v.path_beyond, v.path_stops, v.path_speeds]).toEqual([null, null, null, null]);
    const [w] = cleanCity([base]);
    expect([w.along_m, w.path_beyond, w.path_stops, w.path_speeds]).toEqual([null, null, null, null]);
  });
});
