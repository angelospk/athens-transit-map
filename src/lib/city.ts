// City layer data: every live vehicle from /v1/vehicles (docs/superpowers/specs/2026-10-06-city-layer-design.md).
// Motion lives in motion.ts and map/fleet.ts.

import type { CityLive, CityVehicle } from "./types";

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
