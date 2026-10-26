// Stop board: the buses coming to one stop, and in about how many minutes. From the server's
// /v1/stops (contract rev 7) when it has one, else estimated in the page from the vehicles' positions
// (docs/superpowers/specs/2026-10-26-stop-board-design.md). Pure, like alerts.ts.

import { directionGroups } from "./directions";
import { distanceM } from "./glide";
import { projectCandidates, shapeLength, stopOffsets } from "./predict";
import { fold } from "./search";
import { MIN_LINE_HOURS, type DayStats } from "./stats";
import type { TripIndex } from "./trip";
import type { LineStatic, StopLive } from "./types";
import type { OasaBoard } from "./oasa";

// Beyond the path_speeds steps, for a line without its own speed (lineCruise): ≈ 12.5 km/h with stops and
// lights, like the lines through the centre in the daily stats (8-12.5 km/h on 2026-10-25). To tune on the history.
export const CRUISE_MS = 3.5;
export const MAX_AHEAD_M = 10_000;   // farther buses: the estimate says little
export const MAX_FIX_AGE_S = 300;    // the city tiles keep fixes this long
const STEP_M = 200;                  // path_speeds step (contract rev 6)
const NO_SPEED_MS = 1.5;             // a step with no history, for a vehicle without speed (as the backend and motion.ts)
const AT_STOP_M = 30;                // GPS noise: a bus this far past a stop is still at it
const PASSED_S = 30;                 // an arrival this far in the past: gone
const TERMINAL_M = 100;              // standing this close to its first stop: waiting to start (backend TerminalRadiusM)
const TWIN_M = 200;                  // a stop of the same name this close: the other side of the street

// What the line feeds and the city tiles both have; next_stop_id only in the line feeds.
export interface BoardVehicle {
  line: string; id: string; variant: string | null; lat: number; lon: number; position_at: number;
  speed?: number | null; path_speeds?: (number | null)[] | null; next_stop_id?: string | null;
}

export interface BoardRow {
  line: string; variant: string;
  vehicle: string | null;    // null: a trip of the timetable with no bus yet (server only)
  etaS: number | null;       // Unix s; null: waiting at its first stop, departure unknown
  ageS: number;              // age of the fix
  stopsAway: number | null;  // 1: the stop is the bus's next one; null: no bus
}

export interface BoardGroup { line: string; to: string; variants: string[]; rows: BoardRow[] }

// The lines that stop here, with the variants that serve the stop (not as their last stop: nobody
// gets on there), and the lines that only end here.
export function stopLines(ix: TripIndex, k: number): { serve: { line: string; variants: string[] }[]; end: string[] } {
  const serve: { line: string; variants: string[] }[] = [], end: string[] = [];
  for (const [line, vs] of Object.entries(ix.l)) {
    const variants: string[] = [];
    let ends = false;
    for (const [id, seq] of Object.entries(vs)) {
      const i = seq.indexOf(k);
      if (i < 0) continue;
      if (i < seq.length - 1) variants.push(id);
      else ends = true;
    }
    if (variants.length) serve.push({ line, variants });
    else if (ends) end.push(line);
  }
  const byId = (a: string, b: string) => a.localeCompare(b, "el", { numeric: true });
  serve.sort((a, b) => byId(a.line, b.line));
  return { serve, end: end.sort(byId) };
}

// Other stops of the same name close by (usually across the street), nearest first.
export function twins(ix: TripIndex, k: number): number[] {
  const [name, lat, lon] = ix.s[k], key = fold(name);
  return ix.s.flatMap((x, j) => (j !== k && fold(x[0]) === key && distanceM([lon, lat], [x[2], x[1]]) <= TWIN_M ? [j] : []))
    .sort((a, b) => distanceM([lon, lat], [ix.s[a][2], ix.s[a][1]]) - distanceM([lon, lat], [ix.s[b][2], ix.s[b][1]]));
}

// Each line's speed over a whole day, stops and lights included (the daily stats), for the stretch past
// the typical speeds ahead. Lines with few samples are left out: they cruise at CRUISE_MS.
export function lineCruise(d: DayStats | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of d?.by_line ?? [])
    if (l.time_s >= MIN_LINE_HOURS * 3600) out[l.line] = Math.min(8, Math.max(2, l.dist_m / l.time_s));
  return out;
}

// Seconds to drive d metres: the typical speeds ahead first (a step without one at the bus's own
// speed), the rest at `cruise`.
export function travelS(d: number, steps: (number | null)[] | null | undefined, speed: number | null | undefined, cruise = CRUISE_MS): number {
  const own = speed != null && speed > 0 ? speed : NO_SPEED_MS;
  let t = 0, left = Math.max(0, d);
  for (const st of steps ?? []) {
    if (left <= 0) break;
    const m = Math.min(STEP_M, left);
    t += m / (st != null && st > 0 ? st : own);
    left -= m;
  }
  return t + left / cruise;
}

// s of each stop of a variant, built once per static file; null when a stop has no position.
const geoms = new WeakMap<LineStatic, Map<string, number[] | null>>();
function stopSOf(st: LineStatic, variant: string): number[] | null {
  let m = geoms.get(st);
  if (!m) geoms.set(st, (m = new Map()));
  let r = m.get(variant);
  if (r === undefined) {
    const v = st.variants[variant];
    r = v && v.shape.length >= 2 && v.stops.every(id => st.stops[id]) && shapeLength(v.shape) > 0
      ? stopOffsets(v.shape, v.stops.map(id => [st.stops[id].lon, st.stops[id].lat])) : null;
    m.set(variant, r);
  }
  return r;
}

// Where the bus is on its variant: s, and the index of the first stop ahead. null: off the shape, or on
// a stretch the shape passes twice that the next stop does not settle.
function locate(v: BoardVehicle, shape: [number, number][], stops: string[], stopS: number[]): { s: number; next: number } | null {
  const cands = projectCandidates(shape, [v.lon, v.lat]);
  if (!cands.length) return null;
  if (v.next_stop_id) {
    for (let k = stops.indexOf(v.next_stop_id); k >= 0; k = stops.indexOf(v.next_stop_id, k + 1)) {
      const lo = k ? stopS[k - 1] - AT_STOP_M : -Infinity, hi = stopS[k] + AT_STOP_M;
      const c = cands.find(x => x.s >= lo && x.s <= hi);
      if (c) return { s: c.s, next: k };
    }
  }
  if (cands.length !== 1) return null;
  const s = cands[0].s, next = stopS.findIndex(x => x >= s - AT_STOP_M);
  return next < 0 ? null : { s, next };
}

// Every bus on its way to the stop, soonest first (the ones waiting at their first stop last). cruise:
// lineCruise.
export function boardRows(stopId: string, statics: Record<string, LineStatic>, vehicles: BoardVehicle[], nowS: number,
  cruise: Record<string, number> = {}): BoardRow[] {
  const rows: BoardRow[] = [];
  for (const v of vehicles) {
    const st = statics[v.line], variant = v.variant ? st?.variants[v.variant] : undefined;
    const ageS = nowS - v.position_at;
    if (!st || !variant || !(ageS <= MAX_FIX_AGE_S)) continue;
    const stops = variant.stops, last = stops.length - 1;
    if (!stops.includes(stopId)) continue;
    const stopS = stopSOf(st, v.variant!);
    const at = stopS && locate(v, variant.shape, stops, stopS);
    if (!stopS || !at) continue;
    const i = stops.indexOf(stopId, at.next);
    if (i < 0 || i === last) continue;   // passed, or it ends here
    const d = Math.max(0, stopS[i] - at.s);
    if (d > MAX_AHEAD_M) continue;
    const waiting = at.next === 0 && Math.abs(at.s - stopS[0]) <= TERMINAL_M && !(v.speed != null && v.speed > 0);
    const etaS = waiting ? null : v.position_at + travelS(d, v.path_speeds, v.speed, cruise[v.line]);
    if (etaS != null && etaS < nowS - PASSED_S) continue;
    rows.push({ line: v.line, variant: v.variant!, vehicle: v.id, etaS, ageS, stopsAway: i - at.next + 1 });
  }
  return rows.sort((a, b) => (a.etaS ?? Infinity) - (b.etaS ?? Infinity));
}

export function isStopLive(b: unknown): b is StopLive {
  const d = b as StopLive;
  return !!d && typeof d === "object" && typeof d.stop_id === "string" && Number.isFinite(d.updated_at)
    && Number.isFinite(d.next_update_at) && Array.isArray(d.lines) && Array.isArray(d.arrivals);
}

// The server's board (contract rev 7) as rows. It ages in the cache: an arrival well past is gone.
export function serverRows(b: StopLive, nowS: number): BoardRow[] {
  return b.arrivals.flatMap(a => (a.eta != null && a.eta < nowS - PASSED_S ? [] : [{
    line: a.line, variant: a.variant ?? "", vehicle: a.vehicle, etaS: a.eta,
    ageS: a.position_at != null ? Math.max(0, nowS - a.position_at) : 0, stopsAway: a.stops_away,
  }]));
}

// OASA route codes and GTFS shape ids are separate namespaces. Only OASA identifies the line.
export function oasaRows(b: OasaBoard, vehicles: { id: string; line: string }[], nowS: number): BoardRow[] {
  return b.arrivals.flatMap(a => {
    const line = b.routes.find(r => r.code === a.route_code)?.line;
    const etaS = b.updated_at + a.minutes * 60;
    if (!line || etaS < nowS - PASSED_S) return [];
    const norm = (s: string) => s.replace(/^0+(?=\d)/, "");
    const vehicle = vehicles.find(v => v.line === line && norm(v.id) === norm(a.veh_code))?.id ?? a.veh_code;
    return [{ line, variant: a.route_code, vehicle, etaS, ageS: 0, stopsAway: null }];
  });
}

// Official routes determine groups; a single static direction may supply the shorter destination.
// Ambiguous directions retain OASA's description rather than guessing a timetable variant.
export function oasaGroups(b: OasaBoard, rows: BoardRow[], serve: { line: string; variants: string[] }[], statics: Record<string, LineStatic>): BoardGroup[] {
  const out: BoardGroup[] = [];
  for (const r of b.routes) {
    let group = out.find(g => g.line === r.line && g.to === r.description);
    if (!group) out.push(group = { line: r.line, to: r.description, variants: [], rows: [] });
    if (!group.variants.includes(r.code)) group.variants.push(r.code);
  }
  for (const g of out) {
    g.rows = rows.filter(r => r.line === g.line && g.variants.includes(r.variant));
    const serving = serve.find(l => l.line === g.line);
    const directions = statics[g.line] ? directionGroups(statics[g.line]).filter(d => d.variants.some(v => serving?.variants.includes(v))) : [];
    if (directions.length === 1 && out.filter(o => o.line === g.line).length === 1) g.to = directions[0].to;
  }
  out.push(...groupRows([], serve.filter(l => !b.routes.some(r => r.line === l.line)), statics));
  return out.sort((a, b) => (a.rows[0]?.etaS ?? Infinity) - (b.rows[0]?.etaS ?? Infinity));
}

// Rows by line and direction ("→ ΣΥΝΤΑΓΜΑ"), for the directions that serve the stop: ones with a bus
// coming first (soonest first), then the rest by line. A line whose static file is not loaded yet has
// one group with no direction.
export function groupRows(rows: BoardRow[], serve: { line: string; variants: string[] }[], statics: Record<string, LineStatic>): BoardGroup[] {
  const out: BoardGroup[] = [];
  for (const { line, variants } of serve) {
    const st = statics[line];
    if (!st) { out.push({ line, to: "", variants, rows: rows.filter(r => r.line === line) }); continue; }
    for (const g of directionGroups(st)) {
      const vs = g.variants.filter(id => variants.includes(id));
      if (vs.length) out.push({ line, to: g.to, variants: vs, rows: rows.filter(r => r.line === line && vs.includes(r.variant)) });
    }
  }
  const first = (g: BoardGroup) => (g.rows.length ? g.rows[0].etaS ?? Infinity : NaN);
  const coming = out.filter(g => g.rows.length).sort((a, b) => first(a) - first(b));
  return [...coming, ...out.filter(g => !g.rows.length)];
}

// "τώρα", "3′"; null (waiting at its first stop) "αφετηρία".
export function etaLabel(etaS: number | null, nowS: number): string {
  if (etaS == null) return "αφετηρία";
  const min = Math.round((etaS - nowS) / 60);
  return min < 1 ? "τώρα" : `${min}′`;
}
