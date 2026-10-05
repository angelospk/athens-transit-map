// City layer: every live vehicle from /v1/vehicles, moved along its `path` between updates
// (docs/superpowers/specs/2026-10-06-city-layer-design.md). Paths are [lat, lon]; points [lon, lat].

import type { FeatureCollection, Point } from "geojson";
import { delayClass } from "./format";
import { distanceM, ease, GLIDE_MS, JUMP_M, type LngLat } from "./glide";
import type { CityLive, CityVehicle } from "./types";

export const MAX_AHEAD_S = 150;   // as predict.ts: longest extrapolation

export function isCityLive(b: unknown): b is CityLive {
  const d = b as CityLive;
  return !!d && typeof d === "object" && Number.isFinite(d.updated_at) && Number.isFinite(d.next_update_at)
    && Array.isArray(d.vehicles);
}

export const cityKey = (v: { line: string; id: string }) => `${v.line}/${v.id}`;

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isPair = (p: unknown) => Array.isArray(p) && p.length >= 2 && finite(p[0]) && finite(p[1]);

// Rows a renderer can trust: malformed ones are dropped, bad optional fields become null.
export function cleanCity(rows: unknown[]): CityVehicle[] {
  const out: CityVehicle[] = [];
  for (const r of rows as Partial<CityVehicle>[]) {
    if (!r || typeof r.line !== "string" || typeof r.id !== "string" || !finite(r.lat) || !finite(r.lon)
      || !finite(r.position_at)) continue;
    out.push({
      line: r.line, id: r.id, lat: r.lat, lon: r.lon, position_at: r.position_at,
      bearing: finite(r.bearing) ? r.bearing : null,
      variant: typeof r.variant === "string" ? r.variant : null,
      delay_s: finite(r.delay_s) ? r.delay_s : null,
      speed: finite(r.speed) && r.speed >= 0 ? r.speed : null,
      path: Array.isArray(r.path) && r.path.length >= 2 && r.path.every(isPair) ? r.path : null,
    });
  }
  return out;
}

// Metres from the start to each point of a path.
export function cumulative(path: [number, number][]): number[] {
  const out = [0];
  for (let i = 1; i < path.length; i++)
    out.push(out[i - 1] + distanceM([path[i - 1][1], path[i - 1][0]], [path[i][1], path[i][0]]));
  return out;
}

// The point `m` metres along a path (clamped to its ends).
export function alongPath(path: [number, number][], m: number, cum = cumulative(path)): LngLat {
  for (let i = 1; i < path.length; i++) {
    const len = cum[i] - cum[i - 1];
    if (len > 0 && cum[i] >= m) {
      const k = Math.max(0, m - cum[i - 1]) / len;
      return [path[i - 1][1] + (path[i][1] - path[i - 1][1]) * k, path[i - 1][0] + (path[i][0] - path[i - 1][0]) * k];
    }
  }
  const last = path[path.length - 1];
  return [last[1], last[0]];
}

// Where the vehicle should be at nowSec (server time): along its path at its speed, else its GPS fix.
export function cityPosition(v: CityVehicle, nowSec: number, cum?: number[]): LngLat {
  if (!v.speed || !v.path || v.path.length < 2) return [v.lon, v.lat];
  const dt = Math.min(Math.max(nowSec - v.position_at, 0), MAX_AHEAD_S);
  return alongPath(v.path, v.speed * dt, cum);
}

const lerp = (a: LngLat, b: LngLat, k: number): LngLat => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];

// Shown positions. New data blends from the shown point to the new one over GLIDE_MS, so a
// correction never jumps (except moves over JUMP_M: a new trip or a GPS glitch).
// A fix older than the one shown changes nothing; the same fix again does not restart a blend.
export class CityMotion {
  vehicles: CityVehicle[] = [];
  private cum = new Map<string, number[]>();
  private shown = new Map<string, LngLat>();
  private blend = new Map<string, { from: LngLat; t0: number }>();

  // nowMs: server time in ms.
  update(vehicles: CityVehicle[], nowMs: number) {
    const old = new Map(this.vehicles.map(v => [cityKey(v), v]));
    const kept: CityVehicle[] = [], cum = new Map<string, number[]>(), blend = new Map<string, { from: LngLat; t0: number }>();
    for (let v of vehicles) {
      const k = cityKey(v), was = old.get(k);
      if (was && v.position_at <= was.position_at) {
        v = was;   // not newer: keep the vehicle and any running blend
        const b = this.blend.get(k);
        if (b) blend.set(k, b);
      }
      const c = v === was ? this.cum.get(k) : v.path && v.path.length > 1 ? cumulative(v.path) : undefined;
      if (c) cum.set(k, c);
      const from = this.shown.get(k);
      if (v !== was && from && distanceM(from, cityPosition(v, nowMs / 1000, c)) <= JUMP_M) blend.set(k, { from, t0: nowMs });
      kept.push(v);
    }
    this.vehicles = kept;
    this.cum = cum;
    this.blend = blend;
  }

  positions(nowMs: number): Map<string, LngLat> {
    const out = new Map<string, LngLat>();
    for (const v of this.vehicles) {
      const k = cityKey(v);
      let p = cityPosition(v, nowMs / 1000, this.cum.get(k));
      const b = this.blend.get(k);
      if (b) {
        const t = (nowMs - b.t0) / GLIDE_MS;
        if (t >= 1 || t < 0) this.blend.delete(k);
        else p = lerp(b.from, p, ease(t));
      }
      out.set(k, p);
    }
    this.shown = out;
    return out;
  }
}

// Features for the city source; vehicles of lines shown in detail (DOM markers) are left out.
export function cityFC(vehicles: CityVehicle[], pos: Map<string, LngLat>, exclude: Set<string>): FeatureCollection<Point> {
  const features = [];
  for (const v of vehicles) {
    const p = pos.get(cityKey(v));
    if (!p || exclude.has(v.line)) continue;
    features.push({
      type: "Feature" as const,
      properties: { line: v.line, id: v.id, cls: delayClass(v.delay_s) },
      geometry: { type: "Point" as const, coordinates: p },
    });
  }
  return { type: "FeatureCollection", features };
}
