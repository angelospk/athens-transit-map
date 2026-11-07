// What a bus in 3D says about itself (MapView's labels over the models, Route3D's panel): its line, where it goes,
// how late it is, the stop it passed and every stop ahead with its time. A followed line's vehicle knows its next
// stop; a city vehicle does not, but the server sends the road ahead of it with the metres to its next stops
// (path, path_stops): the next stop is the line's stop at the first of those. Needs the line's static data (stops,
// variants); without it, null. Pure: no DOM, no map.

import { upcomingStops } from "./eta";
import { projectCandidates, stopOffsets } from "./predict";
import { delayClass, type DelayClass } from "./format";
import { placeNote, toward } from "./stops";
import { titleCase } from "./nearby";
import type { CityVehicle, LineStatic, Vehicle } from "./types";

export interface Ahead { id: string; name: string; at: number }
export interface BusRoute {
  line: string;
  id: string;
  head: string;              // where it goes
  from: string;              // where its route starts
  delay: number | null;      // seconds
  cls: DelayClass;
  passed: string | null;     // the stop before the next
  ahead: Ahead[];            // the next stop first, the last stop last
  at: number;                // its position's time
}

type Pt = [number, number];   // [lat, lon]
const metres = (a: Pt, b: Pt) => Math.hypot((a[0] - b[0]) * 110_540, (a[1] - b[1]) * 111_320 * Math.cos((a[0] * Math.PI) / 180));

/** The point `d` metres along a line ([lat, lon]), or its end. */
export function along(line: Pt[], d: number): Pt | null {
  if (!line.length) return null;
  let left = d;
  for (let i = 1; i < line.length; i++) {
    const L = metres(line[i - 1], line[i]);
    if (left <= L && L > 0) { const t = left / L; return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t]; }
    left -= L;
  }
  return line[line.length - 1];
}

/** A city vehicle's next stop: the stop of its variant nearest the first stop on the road ahead of it (within 60 m). */
export function nextStopByPath(v: Pick<CityVehicle, "path" | "path_beyond" | "path_stops">, stopIds: string[], stops: LineStatic["stops"]): string | null {
  const d = v.path_stops?.[0];
  if (d == null || !v.path?.length) return null;
  const p = along([...v.path, ...(v.path_beyond ?? [])], d);
  if (!p) return null;
  let best: string | null = null, bd = 60;
  for (const id of stopIds) {
    const s = stops[id];
    if (!s) continue;
    const m = metres(p, [s.lat, s.lon]);
    if (m < bd) { bd = m; best = id; }
  }
  return best;
}

// Where each stop of a variant lies along its shape: worked out once per variant.
const placed = new WeakMap<object, { known: string[]; offs: number[] }>();

/** A city vehicle's next stop without the road ahead: where it is on its variant's shape (on a loop, the pass that
 *  runs its way: its bearing), and the first stop of the variant after that. */
export function nextStopByShape(v: { lat: number; lon: number; bearing: number | null }, variant: { shape: Pt[]; stops: string[] }, stops: LineStatic["stops"]): string | null {
  const cands = projectCandidates(variant.shape, [v.lon, v.lat]);
  if (!cands.length) return null;
  let s = cands[0].s;
  if (v.bearing != null && cands.length > 1) {
    // The shape's way at each candidate: the first one that runs within 60° of the bearing.
    const way = (at: number) => {
      let run = 0;
      for (let i = 1; i < variant.shape.length; i++) {
        const a = variant.shape[i - 1], b = variant.shape[i], L = metres(a, b);
        if (run + L >= at) return (Math.atan2((b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180), b[0] - a[0]) * 180) / Math.PI;
        run += L;
      }
      return null;
    };
    const fit = cands.find(c => { const w = way(c.s); return w != null && Math.abs((((w - v.bearing!) % 360) + 540) % 360 - 180) < 60; });
    if (fit) s = fit.s;
  }
  let o = placed.get(variant);
  if (!o) {
    const known = variant.stops.filter(id => stops[id]);
    placed.set(variant, (o = { known, offs: stopOffsets(variant.shape, known.map(id => [stops[id].lon, stops[id].lat] as [number, number])) }));
  }
  const { known, offs } = o;
  const k = offs.findIndex(o => Number.isFinite(o) && o > s + 5);
  return k >= 0 ? known[k] : null;
}

/** A bus's route from here on; null without its line's data or its variant. */
export function busRoute(line: string, id: string, v: Vehicle | CityVehicle | null | undefined, st: LineStatic | undefined): BusRoute | null {
  if (!v || !st || !v.variant) return null;
  const variant = st.variants[v.variant];
  if (!variant) return null;
  const next = "next_stop_id" in v && v.next_stop_id ? v.next_stop_id
    : nextStopByPath(v as CityVehicle, variant.stops, st.stops) ?? nextStopByShape(v, variant, st.stops);
  if (!next) return null;
  const ahead = upcomingStops(variant, st.stops, { ...v, next_stop_id: next, path_speeds: v.path_speeds ?? null })
    .map(a => ({ id: a.id, name: titleCase(a.name), at: a.at }));
  if (!ahead.length) return null;
  const i = variant.stops.indexOf(ahead[0].id), prev = i > 0 ? st.stops[variant.stops[i - 1]] : undefined;
  const first = st.stops[variant.stops[0]];
  return {
    line, id,
    head: titleCase(placeNote(toward(variant.headsign)).place),
    from: first ? titleCase(first.name) : "",
    delay: v.delay_s ?? null,
    cls: delayClass(v.delay_s ?? null),
    passed: prev ? titleCase(prev.name) : null,
    ahead,
    at: v.position_at,
  };
}

/** Minutes to a time, as the labels say them: «τώρα» under half a minute. */
export const minsTo = (at: number, now: number) => (at - now < 30 ? "τώρα" : `${Math.max(1, Math.round((at - now) / 60))}′`);

/** How late, in words and the colour's name: green on time (or early), orange late, red very late. */
export function lateness(delay: number | null): { text: string; short: string; tone: "ok" | "late" | "bad" | "none" } {
  if (delay == null) return { text: "", short: "", tone: "none" };
  const m = Math.round(Math.abs(delay) / 60);
  if (delay <= -120) return { text: `${m}′ νωρίς`, short: `${m}′ νωρίς`, tone: "ok" };
  if (delay <= 120) return { text: "στην ώρα", short: "στην ώρα", tone: "ok" };
  return { text: `+${m}′ καθυστέρηση`, short: `+${m}′`, tone: delay > 600 ? "bad" : "late" };
}
