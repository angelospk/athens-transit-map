// One Mover per vehicle, shared by the city layer and the detailed lines' DOM markers, so a
// vehicle never jumps when it moves from one to the other (click, close). Each GPS fix is applied
// once: the same fix again (from the other source) or an older one changes nothing.

import { delayClass, type DelayClass } from "../format";
import { distanceM, JUMP_M, type LngLat } from "../glide";
import { linePlan, Mover, pathPlan, planOnto, type Plan, cumulativeLL } from "../motion";
import { predictS, updateTrack, type Route, type Track } from "../predict";
import type { CityVehicle, Vehicle } from "../types";

export interface RouteGeom { route: Route; geom: LngLat[]; cum: number[] }

export function routeGeom(route: Route): RouteGeom {
  const geom = route.shape.map(([lat, lon]) => [lon, lat] as LngLat);
  return { route, geom, cum: cumulativeLL(geom) };
}

export interface FleetEntry {
  key: string; line: string; id: string;
  mover: Mover;
  at: number;                 // position_at of the fix being shown
  pos: LngLat;                // that fix
  prev: LngLat | null;        // the fix before (heading without a bearing)
  bearing: number | null;
  variant: string | null;
  cls: DelayClass;
  track: Track | null;        // detailed lines only (predict.ts)
  route: RouteGeom | null;
}

const ll = (path: [number, number][]) => path.map(([lat, lon]) => [lon, lat] as LngLat);

export class Fleet {
  entries = new Map<string, FleetEntry>();

  // The city snapshot. Lines in `owned` are driven by their own data (and keep their vehicles).
  city(vehicles: CityVehicle[], owned: Set<string>, nowSec: number) {
    const seen = new Set<string>();
    for (const v of vehicles) {
      if (owned.has(v.line)) continue;
      const k = `${v.line}/${v.id}`;
      seen.add(k);
      const e = this.fix(k, v.line, v.id, v, nowSec);
      if (!e) continue;
      e.cls = delayClass(v.delay_s);
      const pos: LngLat = [v.lon, v.lat];
      const h = v.path && v.speed != null
        ? pathPlan(e.mover.pos, ll(v.path), v.speed, v.position_at, nowSec)
        : linePlan(e.mover.pos, pos, v.bearing);
      this.apply(e, h.plan, h.s0, nowSec, h.off, h.fix);
    }
    for (const [k, e] of this.entries) if (!owned.has(e.line) && !seen.has(k)) this.entries.delete(k);
  }

  // A detailed line's data. Its vehicles not in it are dropped.
  line(line: string, samples: { v: Vehicle; route: RouteGeom | null }[], nowSec: number) {
    const seen = new Set<string>();
    for (const { v, route } of samples) {
      const k = `${line}/${v.id}`;
      seen.add(k);
      const old = this.entries.get(k);
      const sameFix = old && v.position_at === old.at;
      const e = this.fix(k, line, v.id, v, nowSec, true);
      if (!e) continue;
      e.cls = delayClass(v.delay_s);
      const pos: LngLat = [v.lon, v.lat];
      const before = e.track;
      e.track = route
        ? updateTrack(e.route === route ? e.track : null,
          { pos, at: v.position_at, key: `${v.variant}/${v.trip_id}`, nextStop: v.next_stop_id, speed: v.speed }, route.route, nowSec)
        : null;
      const keepRoute = e.route === route && !!before && before.key === e.track?.key;
      e.route = e.track ? route : null;
      // The fix already shown (by the city layer, or this same data again): keep the motion as it
      // is, with any running handoff (no restart on click, no reset of a fading offset).
      if (sameFix && e.mover.plan && (!e.track || e.track === before)) continue;
      if (e.track && route) {
        const track = e.track;
        const plan: Plan = { geom: route.geom, cum: route.cum, target: t => predictS(track, t) };
        if (keepRoute && e.mover.plan?.geom === route.geom) e.mover.retarget(plan, nowSec);
        else {
          const h = planOnto(e.mover.pos, plan, nowSec);
          if (sameFix && !h.fix) continue;   // same fix, different geometry: do not disturb the motion
          this.apply(e, h.plan, h.s0, nowSec, h.off, h.fix);
        }
      } else {
        const h = v.path && v.speed != null
          ? pathPlan(e.mover.pos, ll(v.path), v.speed, v.position_at, nowSec)
          : linePlan(e.mover.pos, pos, v.bearing);
        this.apply(e, h.plan, h.s0, nowSec, h.off, h.fix);
      }
    }
    for (const [k, e] of this.entries) if (e.line === line && !seen.has(k)) this.entries.delete(k);
  }

  // The entry for a fix, or null when the fix is older than the one shown (or, unless `same`, equal).
  private fix(k: string, line: string, id: string, v: { lat: number; lon: number; position_at: number;
    bearing: number | null; variant: string | null }, nowSec: number, same = false): FleetEntry | null {
    const pos: LngLat = [v.lon, v.lat];
    let e = this.entries.get(k);
    if (!e) {
      e = { key: k, line, id, mover: new Mover(pos), at: v.position_at, pos, prev: null, bearing: v.bearing,
        variant: v.variant, cls: "none", track: null, route: null };
      this.entries.set(k, e);
      return e;
    }
    if (v.position_at < e.at || (v.position_at === e.at && !same)) return null;
    if (v.position_at > e.at) {
      // Heading from GPS fixes; forget them on a new trip or a jump.
      e.prev = e.variant !== v.variant || distanceM(e.pos, pos) > JUMP_M ? null
        : e.pos[0] !== pos[0] || e.pos[1] !== pos[1] ? e.pos : e.prev;
    }
    e.at = v.position_at;
    e.pos = pos;
    e.bearing = v.bearing;
    e.variant = v.variant;
    return e;
  }

  // A new entry starts where its plan says (no glide from nowhere); others hand over.
  private apply(e: FleetEntry, plan: Plan, s0: number, nowSec: number, off?: LngLat, fix = false) {
    if (!e.mover.plan) e.mover.setPlan(plan, plan.target(nowSec), nowSec);
    else e.mover.setPlan(plan, s0, nowSec, off, fix);
  }
}
