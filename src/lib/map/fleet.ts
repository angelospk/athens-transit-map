// One Mover per vehicle, shared by the city layer and the detailed lines' DOM markers, so a
// vehicle never jumps when it moves from one to the other (click, close). Each GPS fix is applied
// once: the same fix again (from the other source) or an older one changes nothing.

import { delayClass, type DelayClass } from "../format";
import { distanceM, JUMP_M, type LngLat } from "../glide";
import { bridge, careful, drive, linePlan, Mover, project, NO_SPEED, pathPlan, planOnto, pointAtLL, walk, type Handoff, type Plan, cumulativeLL } from "../motion";
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
  standing: number;           // fixes in a row that moved less than MOVED_M (up to 2; 2 when new)
  moved: { from: LngLat; at: number } | null;   // the last move to a new fix (motion off: its trail)
  bearing: number | null;
  variant: string | null;
  cls: DelayClass;
  track: Track | null;        // detailed lines only (predict.ts)
  route: RouteGeom | null;
  guess: boolean;             // the shown motion drives on along a path or route (else it stands at the fix)
}

export const GAP_M = 25;   // a guess stays this far behind the vehicle ahead on its line
const MOVED_M = 15;   // GPS jitter below this is not a movement

// What to add to an entry's shown s for its s on its route: exact on the route or a handoff onto it,
// else (a plan kept from the city layer) where its shown point projects onto the route.
function toRoute(e: FleetEntry): number | null {
  const p = e.mover.plan, r = e.route;
  if (!p || !r) return null;
  if (p.geom === r.geom) return 0;
  if (p.base?.geom === r.geom) return p.base.ds;
  return project(r.geom, r.cum, e.mover.pos, e.track?.s).s - e.mover.s;
}

// Zoomed out, tiles carry no path: the same fix with one (zoomed in, a line's data) is worth taking.
const hasPath = (v: CityVehicle | Vehicle) => !!(v.path || v.path_beyond);

const ll = (path: [number, number][]) => path.map(([lat, lon]) => [lon, lat] as LngLat);

// The variant shapes the city layer may drive on (rev 20), by line and variant; null when not loaded.
export type RouteOf = (line: string, variant: string | null) => RouteGeom | null;

export const ALONG_FIX_M = 200;   // the server's point is at most 150 m from the fix; farther: another shape
const ALONG_END_M = 50;           // along_m past the shape's end by more than this: another shape

// A vehicle's s on its route from the server's along_m (contract rev 20): scaled to the client's
// metres by endS / length_m. null when it does not fit (a static file of another GTFS).
export function alongS(r: RouteGeom, along: number, pos: LngLat): number | null {
  const L = r.route.endS, k = r.route.lengthM ? L / r.route.lengthM : 1, s = along * k;
  if (!(s >= 0) || s > L + ALONG_END_M) return null;
  const at = Math.min(s, L);
  return distanceM(pointAtLL(r.geom, r.cum, at), pos) <= ALONG_FIX_M ? at : null;
}

// Along the variant's whole shape from s0 (rev 20): its step speeds when given, else with stop waits
// at path_stops (the server's, scaled), then at the route's stops after them; it stands at the
// shape's end.
function alongPlan(shown: LngLat, r: RouteGeom, s0: number, v: CityVehicle | Vehicle, nowSec: number): Handoff {
  const end = r.route.endS - s0, speed = v.speed ?? NO_SPEED;
  const k = r.route.lengthM ? r.route.endS / r.route.lengthM : 1;
  const near = (v.path_stops ?? []).map(x => x * k), after = near.length ? near[near.length - 1] + 15 : 1;
  const stops = [...near, ...r.route.stopS.map(x => x - s0).filter(x => x > after)];
  const f = v.path_speeds?.length ? walk(v.path_speeds, speed, end) : drive(speed, stops, end);
  return planOnto(shown, { geom: r.geom, cum: r.cum, target: careful(t => s0 + f(t - v.position_at), v.position_at), stops: stops.map(x => x + s0) }, nowSec);
}

// Along the backend `path` and its continuation `path_beyond` (rev 4; it starts at path's end, or
// at the vehicle when path is null) when there is one: its typical step speeds (`path_speeds`, rev 6)
// when given, else without a speed slowly; else straight to the fix.
function ahead(shown: LngLat, v: CityVehicle | Vehicle, pos: LngLat, nowSec: number, r: RouteGeom | null = null) {
  const s0 = r && v.along_m != null ? alongS(r, v.along_m, pos) : null;
  if (r && s0 != null) return alongPlan(shown, r, s0, v, nowSec);
  const geom = v.path && v.path_beyond ? [...v.path, ...v.path_beyond.slice(1)] : v.path ?? v.path_beyond;
  return geom
    ? pathPlan(shown, ll(geom), v.speed ?? NO_SPEED, v.position_at, nowSec, v.path_stops ?? [], v.path_speeds, v.speed)
    : linePlan(shown, pos, v.bearing);
}

export class Fleet {
  entries = new Map<string, FleetEntry>();

  // The city snapshot. Lines in `owned` are driven by their own data (and keep their vehicles).
  // routeOf: the loaded variant shapes, for vehicles with along_m (rev 20).
  city(vehicles: CityVehicle[], owned: Set<string>, nowSec: number, routeOf?: RouteOf) {
    const seen = new Set<string>();
    for (const v of vehicles) {
      if (owned.has(v.line)) continue;
      const k = `${v.line}/${v.id}`;
      seen.add(k);
      const old = this.entries.get(k);
      if (old) old.track = old.route = null;   // a closed detailed line: its order no longer applies
      const r = v.along_m != null ? routeOf?.(v.line, v.variant) ?? null : null;
      const onShape = !!r && alongS(r, v.along_m!, [v.lon, v.lat]) != null;
      const moves = hasPath(v) || onShape;
      const late = !!old && !old.guess && moves && old.at === v.position_at;
      // The shape came in after this fix (its line file loaded): take it now, not at the next fix.
      const plan = old?.mover.plan;
      const promote = !!old && onShape && old.at === v.position_at && !!plan && plan.geom !== r!.geom && plan.base?.geom !== r!.geom;
      const e = this.fix(k, v.line, v.id, v, nowSec, late || promote);
      if (!e) continue;
      const pos: LngLat = [v.lon, v.lat];
      this.apply(e, bridge(e.mover, ahead(e.mover.pos, v, pos, nowSec, r)), nowSec, moves, late);
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
      const pos: LngLat = [v.lon, v.lat];
      const before = e.track;
      e.track = route
        ? updateTrack(e.route === route ? e.track : null,
          { pos, at: v.position_at, key: `${v.variant}/${v.trip_id}`, speed: v.speed, steps: v.path_speeds,
            along: v.along_m != null ? alongS(route, v.along_m, pos) : null }, route.route, nowSec)
        : null;
      const keepRoute = e.route === route && !!before && before.key === e.track?.key;
      e.route = e.track ? route : null;
      // The fix already shown (by the city layer, or this same data again): keep the motion as it
      // is, with any running handoff (no restart on click, no reset of a fading offset).
      if (sameFix && e.mover.plan && (e.guess || !(e.track || hasPath(v))) && (!e.track || e.track === before)) continue;
      if (e.track && route) {
        const track = e.track;
        const plan: Plan = { geom: route.geom, cum: route.cum, target: careful(t => predictS(track, t), track.at), stops: route.route.stopS };
        if (keepRoute && e.mover.plan?.geom === route.geom) e.mover.retarget(plan, nowSec);
        else {
          const h = bridge(e.mover, planOnto(e.mover.pos, plan, nowSec));
          // Same fix, different geometry: do not disturb the motion, unless the fix brought step speeds only now.
          const newSteps = !!track.steps?.length && !before?.steps?.length;
          if (sameFix && !h.fix && e.guess && !newSteps) continue;
          this.apply(e, h, nowSec, true, sameFix);
        }
        e.guess = true;
      } else this.apply(e, bridge(e.mover, ahead(e.mover.pos, v, pos, nowSec)), nowSec, hasPath(v), !!sameFix);
    }
    for (const [k, e] of this.entries) if (e.line === line && !seen.has(k)) this.entries.delete(k);
  }

  // Detailed lines: a vehicle whose last fix is behind another's on the same route does not pass it
  // on a guess (the fixes decide the order); it stays GAP_M behind the other's guess, and behind
  // where the other is shown. Tracks not resolved on the route take no part. Call before each step.
  spacing(nowSec: number) {
    const groups = new Map<RouteGeom, FleetEntry[]>();
    for (const e of this.entries.values()) {
      e.mover.cap = null;
      if (e.track && !e.track.alts && e.route) {
        const g = groups.get(e.route);
        if (g) g.push(e); else groups.set(e.route, [e]);
      }
    }
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      g.sort((a, b) => b.track!.s - a.track!.s);
      for (let i = 1; i < g.length; i++) {
        const lead = g[i - 1], ds = toRoute(g[i]), lds = toRoute(lead);
        const bound = Math.min(predictS(lead.track!, nowSec), lds == null ? Infinity : lead.mover.s + lds) - GAP_M;
        if (ds != null) g[i].mover.cap = bound - ds;
      }
    }
  }

  // The entry for a fix, or null when the fix is older than the one shown (or, unless `same`, equal).
  // The same fix may come with a new delay: its class is updated all the same.
  private fix(k: string, line: string, id: string, v: { lat: number; lon: number; position_at: number;
    bearing: number | null; variant: string | null; delay_s: number | null }, nowSec: number, same = false): FleetEntry | null {
    const pos: LngLat = [v.lon, v.lat];
    let e = this.entries.get(k);
    if (!e) {
      e = { key: k, line, id, mover: new Mover(pos), at: v.position_at, pos, prev: null, moved: null, standing: 2, bearing: v.bearing,
        variant: v.variant, cls: delayClass(v.delay_s), track: null, route: null, guess: false };
      this.entries.set(k, e);
      return e;
    }
    if (v.position_at < e.at) return null;
    e.cls = delayClass(v.delay_s);
    if (v.position_at === e.at && !same) return null;
    if (v.position_at > e.at) {
      if (e.pos[0] !== pos[0] || e.pos[1] !== pos[1]) e.moved = { from: e.pos, at: nowSec };
      e.standing = distanceM(e.pos, pos) >= MOVED_M ? 0 : Math.min(2, e.standing + 1);
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

  // A new entry starts where its plan says (no glide from nowhere); so does one that stood at a fix
  // only for want of a path (`late`: that fix again, now with one; a race to the guess would skip
  // stops). It snaps on its next step, so the spacing cap holds it behind the vehicle ahead.
  // Others hand over.
  private apply(e: FleetEntry, h: Handoff, nowSec: number, guess: boolean, late = false) {
    const start = late && !e.guess && guess;
    e.guess = guess;
    if (!e.mover.plan) e.mover.setPlan(h.plan, h.plan.target(nowSec), nowSec);
    else e.mover.apply(h, nowSec);
    if (start) e.mover.snap();
  }
}
