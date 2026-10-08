// City layer from map tiles: GET /v1/vehicles/tiles/{z}/{x}/{y} (docs/CONTRACT.md rev 5, "Client rules").
// Which tiles a view needs, a store of the loaded ones, and the merge. Network access is in api.ts.

import { cleanCity, isCityLive } from "./city";
import type { FetchResult } from "./poller";
import type { CityLive, CityVehicle } from "./types";

export interface Tile { z: number; x: number; y: number }
export interface TileSet { z: number; tiles: Tile[] }
export interface View { north: number; south: number; east: number; west: number }
export interface TileData { updated_at: number; next_update_at: number; vehicles: CityVehicle[] }
export type TileGet = (t: Tile, signal?: AbortSignal) => Promise<FetchResult>;

const BOX = { south: 37.5, north: 38.5, west: 22.9, east: 24.5 };   // the only area with tiles
const RANGE: Record<number, { x: [number, number]; y: [number, number] }> = {
  9: { x: [288, 290], y: [196, 198] },
  13: { x: [4617, 4653], y: [3145, 3174] },
};
const PAD_M = 300;               // ≈ 30 s of driving: a vehicle about to enter the view is loaded
const M_PER_DEG = 111_320;
const DETAIL_ZOOM = 13;          // MapLibre zoom from which the tiles carry paths (z 13)

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const tileKey = (t: Tile) => `${t.z}/${t.x}/${t.y}`;
export const tileUrlPath = (t: Tile) => `/v1/vehicles/tiles/${t.z}/${t.x}/${t.y}`;

export function tileOf(lat: number, lon: number, z: number): Tile {
  const n = 2 ** z, r = lat * Math.PI / 180;
  return {
    z,
    x: Math.floor((lon + 180) / 360 * n),
    y: Math.floor((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2 * n),
  };
}

// Every tile from the north-west corner's tile to the south-east corner's, of the view padded and clamped to the box.
export function viewTiles(v: View, zoom: number): TileSet {
  const z = zoom >= DETAIL_ZOOM ? 13 : 9, r = RANGE[z];
  const lat = (x: number) => clamp(x, BOX.south, BOX.north), lon = (x: number) => clamp(x, BOX.west, BOX.east);
  const perLon = (la: number) => M_PER_DEG * Math.cos(la * Math.PI / 180);
  const nw = tileOf(lat(v.north + PAD_M / M_PER_DEG), lon(v.west - PAD_M / perLon(v.north)), z);
  const se = tileOf(lat(v.south - PAD_M / M_PER_DEG), lon(v.east + PAD_M / perLon(v.south)), z);
  const x0 = clamp(nw.x, ...r.x), x1 = clamp(se.x, ...r.x), y0 = clamp(nw.y, ...r.y), y1 = clamp(se.y, ...r.y);
  const tiles: Tile[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.push({ z, x, y });
  return { z, tiles };
}

// Newer position_at wins; on a tie the response with the newer updated_at (the first one if equal too).
export function mergeVehicles(parts: TileData[]): CityVehicle[] {
  const best = new Map<string, { v: CityVehicle; at: number }>();
  for (const p of parts) {
    for (const v of p.vehicles) {
      const b = best.get(v.id);
      if (!b || v.position_at > b.v.position_at || (v.position_at === b.v.position_at && p.updated_at > b.at))
        best.set(v.id, { v, at: p.updated_at });
    }
  }
  return [...best.values()].map(b => b.v);
}

// Pacing fields of a set of tiles: the newest build, and the earliest next one.
const pacing = (parts: TileData[]) => ({
  updated_at: Math.max(...parts.map(p => p.updated_at)),
  next_update_at: Math.min(...parts.map(p => p.next_update_at)),
});

// The tiles of the current view and what was loaded of them.
export class CityTiles {
  private z = 0;
  private wanted = new Map<string, Tile>();
  private have = new Map<string, TileData>();

  get tiles(): Tile[] { return [...this.wanted.values()]; }

  // Sets the tiles to show; returns those not loaded yet. Tiles that left are dropped; a new z drops all.
  want(set: TileSet): Tile[] {
    if (set.z !== this.z) this.have.clear();
    this.z = set.z;
    this.wanted = new Map(set.tiles.map(t => [tileKey(t), t]));
    for (const k of this.have.keys()) if (!this.wanted.has(k)) this.have.delete(k);
    return set.tiles.filter(t => !this.have.has(tileKey(t)));
  }

  // A late answer for a tile that left, or an older copy of a loaded one, is ignored.
  put(t: Tile, d: TileData) {
    const k = tileKey(t), held = this.have.get(k);
    if (this.wanted.has(k) && !(held && d.updated_at < held.updated_at)) this.have.set(k, d);
  }

  // The merged city, or null until every tile of the view is loaded (a part would drop vehicles from the map).
  snapshot(): CityLive | null {
    if (!this.wanted.size || this.have.size < this.wanted.size) return null;
    const parts = [...this.have.values()];
    return { ...pacing(parts), vehicles: mergeVehicles(parts) };
  }
}

// Fetches tiles into the store. Answers like one feed (for the poller): 200 with the pacing of the tiles,
// or the first failure. The tiles that did arrive stay in the store.
export async function loadTiles(store: CityTiles, tiles: Tile[], get: TileGet, signal?: AbortSignal): Promise<FetchResult> {
  if (!tiles.length) return { status: 0, body: null };   // no pacing to report
  const rs = await Promise.all(tiles.map(t => get(t, signal)));
  const parts: TileData[] = [];
  let bad: FetchResult | undefined;
  rs.forEach((r, i) => {
    if (r.status === 200 && isCityLive(r.body)) {
      const d = { updated_at: r.body.updated_at, next_update_at: r.body.next_update_at, vehicles: cleanCity(r.body.vehicles) };
      store.put(tiles[i], d);
      parts.push(d);
    } else bad ??= r.status === 200 ? { status: 0, body: null } : r;
  });
  // 404 means "not for this view", not "never again": the poller would stop for good on it.
  if (bad) return { status: bad.status === 404 ? 0 : bad.status, body: bad.body };
  const dates = rs.map(r => r.date).filter((d): d is number => d != null && Number.isFinite(d));
  const res: FetchResult = { status: 200, body: { ...pacing(parts), vehicles: [] } };
  if (dates.length) res.date = Math.max(...dates);
  return res;
}
