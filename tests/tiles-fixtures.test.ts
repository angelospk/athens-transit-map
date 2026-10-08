import { describe, expect, it } from "vitest";
import all from "../src/fixtures/vehicles.json";
import z13 from "../src/fixtures/vehicles-tile-13-4636-3160.json";
import z9 from "../src/fixtures/vehicles-tile-9-289-197.json";
import { CityTiles, loadTiles, mergeVehicles, tileOf, viewTiles } from "../src/lib/tiles";

// The backend's own examples (docs/CONTRACT.md rev 5), copied to src/fixtures.
const T13 = { z: 13, x: 4636, y: 3160 }, T9 = { z: 9, x: 289, y: 197 };
const ok = (body: unknown) => ({ status: 200, body });

describe("tile fixtures of the contract", () => {
  it("every vehicle lies in its tile", () => {
    for (const v of z13.vehicles) expect(tileOf(v.lat, v.lon, 13)).toEqual(T13);
    for (const v of z9.vehicles) expect(tileOf(v.lat, v.lon, 9)).toEqual(T9);
  });

  it("z 13 entries are the entries of /v1/vehicles; z 9 entries have no path keys", () => {
    for (const v of z13.vehicles) expect(all.vehicles).toContainEqual(v);
    for (const v of z9.vehicles) {
      expect(v).not.toHaveProperty("path");
      expect(v).not.toHaveProperty("path_beyond");
      expect(v).not.toHaveProperty("path_stops");
    }
  });

  it("the z 13 tile loads with its paths, the z 9 tile loads without", async () => {
    const hi = new CityTiles(), lo = new CityTiles();
    hi.want({ z: 13, tiles: [T13] });
    lo.want({ z: 9, tiles: [T9] });
    await loadTiles(hi, [T13], async () => ok(z13));
    await loadTiles(lo, [T9], async () => ok(z9));
    const a = hi.snapshot()!, b = lo.snapshot()!;
    expect(a.vehicles.length).toBe(z13.vehicles.length);
    expect(a.vehicles.every(v => v.path && v.path.length >= 2)).toBe(true);
    expect(b.vehicles.length).toBe(z9.vehicles.length);
    expect(b.vehicles.every(v => v.path === null)).toBe(true);
    expect(a).toMatchObject({ updated_at: z13.updated_at, next_update_at: z13.next_update_at });
  });

  it("the same tile twice, or a vehicle in two tiles, shows once", () => {
    const part = { updated_at: z13.updated_at, next_update_at: z13.next_update_at, vehicles: [] as never[] };
    const a = { ...part, vehicles: z13.vehicles.map(v => ({ ...v, path: null, speed: v.speed })) as never[] };
    const merged = mergeVehicles([a, a]);
    expect(merged.map(v => v.id).sort()).toEqual(z13.vehicles.map(v => v.id).sort());
  });

  it("a view around Syntagma at zoom 15 needs this tile (z 13) and a wide one needs the z 9 tile", () => {
    const small = viewTiles({ south: 37.97, north: 37.98, west: 23.73, east: 23.74 }, 15);
    expect(small.tiles).toContainEqual(T13);
    expect(small.tiles.length).toBeLessThanOrEqual(2);
    const wide = viewTiles({ south: 37.8, north: 38.2, west: 23.5, east: 24.0 }, 10);
    expect(wide.tiles).toContainEqual(T9);
  });
});
