import { describe, expect, it } from "vitest";
import { CityTiles, loadTiles, mergeVehicles, tileOf, tileUrlPath, viewTiles, type TileData } from "../src/lib/tiles";
import type { CityVehicle } from "../src/lib/types";

const T = 1_791_100_000;
const veh = (id: string, extra: Partial<CityVehicle> = {}): CityVehicle => ({
  line: "040", id, lat: 37.9755, lon: 23.7348, bearing: null, position_at: T, variant: null,
  delay_s: null, speed: null, path: null, ...extra,
});
const data = (updated_at: number, vehicles: CityVehicle[], next = updated_at + 30): TileData => ({
  updated_at, next_update_at: next, vehicles,
});
const around = (lat: number, lon: number, dLat: number, dLon = dLat) =>
  ({ south: lat - dLat, north: lat + dLat, west: lon - dLon, east: lon + dLon });

describe("tile math", () => {
  it("matches the contract's examples (Syntagma)", () => {
    expect(tileOf(37.9755, 23.7348, 13)).toEqual({ z: 13, x: 4636, y: 3160 });
    expect(tileOf(37.9755, 23.7348, 9)).toEqual({ z: 9, x: 289, y: 197 });
  });

  it("gives the box's tile range of the contract at both zooms", () => {
    expect(tileOf(38.5, 22.9, 9)).toMatchObject({ x: 288, y: 196 });
    expect(tileOf(37.5, 24.5, 9)).toMatchObject({ x: 290, y: 198 });
    expect(tileOf(38.5, 22.9, 13)).toMatchObject({ x: 4617, y: 3145 });
    expect(tileOf(37.5, 24.5, 13)).toMatchObject({ x: 4653, y: 3174 });
  });

  it("builds the path of the endpoint", () => {
    expect(tileUrlPath({ z: 13, x: 4636, y: 3160 })).toBe("/v1/vehicles/tiles/13/4636/3160");
  });
});

describe("tile set of a view", () => {
  it("uses z 9 below MapLibre zoom 13 and z 13 from 13", () => {
    const v = around(37.9755, 23.7348, 0.01);
    expect(viewTiles(v, 12.99).z).toBe(9);
    expect(viewTiles(v, 13).z).toBe(13);
    expect(viewTiles(v, 16).z).toBe(13);
  });

  it("takes every tile from the north-west corner's tile to the south-east corner's", () => {
    // z 13 tiles are ~0.035° tall and ~0.045° wide here; this view crosses 2 columns and 2 rows.
    const t13 = tileOf(37.9755, 23.7348, 13);
    const nw = { lat: 37.9755 + 0.02, lon: 23.7348 - 0.02 }, se = { lat: 37.9755 - 0.02, lon: 23.7348 + 0.02 };
    const s = viewTiles({ north: nw.lat, west: nw.lon, south: se.lat, east: se.lon }, 14);
    const a = tileOf(nw.lat + 300 / 111_320, nw.lon - 300 / 111_320 / Math.cos(nw.lat * Math.PI / 180), 13);
    const b = tileOf(se.lat - 300 / 111_320, se.lon + 300 / 111_320 / Math.cos(se.lat * Math.PI / 180), 13);
    expect(s.tiles).toHaveLength((b.x - a.x + 1) * (b.y - a.y + 1));
    expect(s.tiles).toContainEqual(t13);
    expect(s.tiles[0]).toEqual(a);
    expect(s.tiles.at(-1)).toEqual(b);
  });

  it("pads the view by 300 m: a tile 100 m past the edge is in, one 600 m past is not", () => {
    // The east edge of tile x 4636 at z 13.
    const edgeLon = (4637 / 2 ** 13) * 360 - 180;
    const mPerDegLon = 111_320 * Math.cos(37.9755 * Math.PI / 180);
    const base = { south: 37.97, north: 37.98, west: edgeLon - 0.02 };
    const xs = (east: number) => new Set(viewTiles({ ...base, east }, 14).tiles.map(t => t.x));
    expect(xs(edgeLon - 100 / mPerDegLon).has(4637)).toBe(true);
    expect(xs(edgeLon - 600 / mPerDegLon).has(4637)).toBe(false);
  });

  it("clamps a wide view to the box: 9 tiles at z 9, the contract's ranges at z 13", () => {
    const wide = { south: 30, north: 45, west: 15, east: 35 };
    const z9 = viewTiles(wide, 8);
    expect(z9.tiles).toHaveLength(9);
    expect(Math.min(...z9.tiles.map(t => t.x))).toBe(288);
    expect(Math.max(...z9.tiles.map(t => t.y))).toBe(198);
    const z13 = viewTiles(wide, 13);
    expect(z13.tiles).toHaveLength(37 * 30);
  });

  it("never returns a tile outside the box, even for a view far away", () => {
    const far = viewTiles(around(50, 10, 0.01), 14);
    expect(far.tiles).toHaveLength(1);
    expect(far.tiles[0].x).toBeGreaterThanOrEqual(4617);
    expect(far.tiles[0].x).toBeLessThanOrEqual(4653);
  });
});

describe("merge by id", () => {
  it("newer position_at wins", () => {
    const m = mergeVehicles([
      data(100, [veh("1", { position_at: T + 5, lat: 1 })]),
      data(100, [veh("1", { position_at: T + 9, lat: 2 })]),
    ]);
    expect(m).toHaveLength(1);
    expect(m[0].lat).toBe(2);
  });

  it("on a tie the response with the newer updated_at wins, in either order", () => {
    const old = data(100, [veh("1", { lat: 1 })]), fresh = data(130, [veh("1", { lat: 2 })]);
    expect(mergeVehicles([old, fresh])[0].lat).toBe(2);
    expect(mergeVehicles([fresh, old])[0].lat).toBe(2);
  });

  it("keeps vehicles with different ids and a vehicle seen in one tile only", () => {
    const m = mergeVehicles([data(100, [veh("1")]), data(100, [veh("2"), veh("3")])]);
    expect(m.map(v => v.id).sort()).toEqual(["1", "2", "3"]);
  });
});

describe("tile set diff", () => {
  const k = (x: number, y = 1) => ({ z: 13, x, y });

  it("wants only tiles not loaded and drops those that left", () => {
    const s = new CityTiles();
    expect(s.want({ z: 13, tiles: [k(1), k(2)] })).toEqual([k(1), k(2)]);
    s.put(k(1), data(100, [veh("a")]));
    s.put(k(2), data(100, [veh("b")]));
    expect(s.want({ z: 13, tiles: [k(2), k(3)] })).toEqual([k(3)]);
    expect(s.snapshot()).toBeNull();               // k(3) is not loaded yet
    s.put(k(3), data(100, [veh("c")]));
    expect(s.snapshot()!.vehicles.map(v => v.id).sort()).toEqual(["b", "c"]);   // "a" left with its tile
  });

  it("replaces the whole set when z changes", () => {
    const s = new CityTiles();
    s.want({ z: 9, tiles: [{ z: 9, x: 289, y: 197 }] });
    s.put({ z: 9, x: 289, y: 197 }, data(100, [veh("a")]));
    expect(s.want({ z: 13, tiles: [k(1)] })).toEqual([k(1)]);
    s.put(k(1), data(100, []));
    expect(s.snapshot()!.vehicles).toEqual([]);
  });

  it("ignores a tile that is not wanted (late answer), and an older copy of a loaded tile", () => {
    const s = new CityTiles();
    s.want({ z: 13, tiles: [k(1)] });
    s.put(k(9), data(100, [veh("x")]));
    s.put(k(1), data(130, [veh("a")]));
    s.put(k(1), data(100, [veh("old")]));
    expect(s.snapshot()!.vehicles.map(v => v.id)).toEqual(["a"]);
  });

  it("takes max updated_at and min next_update_at over the tiles", () => {
    const s = new CityTiles();
    s.want({ z: 13, tiles: [k(1), k(2)] });
    s.put(k(1), data(100, [], 130));
    s.put(k(2), data(110, [], 140));
    expect(s.snapshot()).toMatchObject({ updated_at: 110, next_update_at: 130 });
  });
});

describe("loadTiles", () => {
  const k = (x: number) => ({ z: 13, x, y: 1 });
  const ok = (updated_at: number, vehicles: unknown[] = [], date?: number) =>
    ({ status: 200, body: { updated_at, next_update_at: updated_at + 30, vehicles }, date });

  it("stores every tile and answers with the pacing of the set", async () => {
    const s = new CityTiles();
    const tiles = [k(1), k(2)];
    s.want({ z: 13, tiles });
    const r = await loadTiles(s, tiles, async t => ok(t.x === 1 ? 100 : 110, [veh(String(t.x))], t.x));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ updated_at: 110, next_update_at: 130 });
    expect(r.date).toBe(2);
    expect(s.snapshot()!.vehicles.map(v => v.id).sort()).toEqual(["1", "2"]);
  });

  it("fails as a whole when one tile fails, but keeps the tiles that came", async () => {
    const s = new CityTiles();
    const tiles = [k(1), k(2)];
    s.want({ z: 13, tiles });
    const r = await loadTiles(s, tiles, async t => (t.x === 1 ? ok(100, [veh("1")]) : { status: 503, body: null }));
    expect(r.status).toBe(503);
    expect(s.snapshot()).toBeNull();   // incomplete: nothing to publish, the last good city stays
  });

  it("turns a 404 into a retryable failure (the poller must not give up on the city)", async () => {
    const s = new CityTiles();
    s.want({ z: 13, tiles: [k(1)] });
    const r = await loadTiles(s, [k(1)], async () => ({ status: 404, body: { error: "not_found" } }));
    expect(r.status).toBe(0);
  });

  it("fails without tiles (no pacing to report)", async () => {
    const r = await loadTiles(new CityTiles(), [], async () => ok(100));
    expect(r.status).toBe(0);
  });

  it("treats a malformed body as a failure", async () => {
    const s = new CityTiles();
    s.want({ z: 13, tiles: [k(1)] });
    const r = await loadTiles(s, [k(1)], async () => ({ status: 200, body: { nope: 1 } }));
    expect(r.status).not.toBe(200);
  });

  it("drops rows a renderer cannot trust, like the full feed does", async () => {
    const s = new CityTiles();
    s.want({ z: 13, tiles: [k(1)] });
    await loadTiles(s, [k(1)], async () => ok(100, [veh("1"), { line: "040" }]));
    expect(s.snapshot()!.vehicles.map(v => v.id)).toEqual(["1"]);
  });
});
