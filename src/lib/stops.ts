// Bus and trolley stops on the map (from zoom STOPS_ZOOM), out of public/trips.json, and what a tapped
// stop's card shows: the lines that call there, the stop of the same name across the street, and the
// live arrivals (backend GET /v1/stops/{id}) grouped by line and headsign.

// No value import of trip.ts: it loads with the planner only.
import { distanceM } from "./glide";
import { fold } from "./search";
import type { TripIndex } from "./trip";

export const STOPS_ZOOM = 15;
export const TWIN_M = 200;   // the same name closer than this is the stop across the street

export interface StopArrival {
  line: string; headsign: string; variant: string; vehicle: string;
  eta_s: number; at: number; delay_s: number; position_at: number;
  source?: "live" | "schedule";   // contract rev 8; "schedule": a trip with no bus yet
  // rev 8; null: unmatched (trip_id, scheduled) or unknown; missing: an older server
  trip_id?: string | null; scheduled?: number | null; stops_away?: number | null; distance_m?: number | null;
}
export interface StopBoard {
  stop: { id: string; name: string; lat: number; lon: number };
  lines: string[];
  arrivals: StopArrival[];
  updated_at: number;
}

export function busStopsFC(ix: TripIndex): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return { type: "FeatureCollection", features: ix.s.map(([name, lat, lon], i) =>
    ({ type: "Feature", id: i, geometry: { type: "Point", coordinates: [lon, lat] }, properties: { i, name } })) };
}

// The index of the stop with a GTFS id (a picked line's stops carry ids), or -1.
const byId = new WeakMap<TripIndex, Map<string, number>>();
export function stopIndex(ix: TripIndex, id: string): number {
  let m = byId.get(ix);
  if (!m) byId.set(ix, (m = new Map(ix.s.flatMap(([, , , sid], i) => (sid ? [[sid, i] as [string, number]] : [])))));
  return m.get(id) ?? -1;
}

const byLine = (a: string, b: string) => a.localeCompare(b, "el", { numeric: true });

// The lines that call at stop i, with their variants through it.
export function linesAt(ix: TripIndex, i: number): { line: string; variants: string[] }[] {
  const out: { line: string; variants: string[] }[] = [];
  for (const [line, vs] of Object.entries(ix.l)) {
    const variants = Object.keys(vs).filter(v => vs[v].includes(i));
    if (variants.length) out.push({ line, variants });
  }
  return out.sort((a, b) => byLine(a.line, b.line));
}

// The same from the board alone, until the stop index loads: its lines, with the variants of their arrivals.
export function boardLines(b: StopBoard): { line: string; variants: string[] }[] {
  return b.lines.map(line => ({ line, variants: [...new Set(b.arrivals.filter(a => a.line === line).map(a => a.variant))].sort() }))
    .sort((a, b) => byLine(a.line, b.line));
}

// The lines with a bus on its way, soonest first: their files are loaded ahead, so a tapped bus shows its stops at once.
export function linesToWarm(arrivals: StopArrival[], max = 4): string[] {
  const out: string[] = [];
  for (const a of [...arrivals].sort((x, y) => x.eta_s - y.eta_s)) {
    if (a.source !== "schedule" && !out.includes(a.line)) out.push(a.line);
  }
  return out.slice(0, max);
}

// Stops of the same name within TWIN_M of stop i (the other direction), nearest first; m in metres.
export function twins(ix: TripIndex, i: number): { i: number; m: number }[] {
  const [name, lat, lon] = ix.s[i], key = fold(name);
  const out: { i: number; m: number }[] = [];
  ix.s.forEach(([n, la, lo], j) => {
    if (j === i) return;
    const m = distanceM([lon, lat], [lo, la]);
    if (m <= TWIN_M && fold(n) === key) out.push({ i: j, m: Math.round(m) });
  });
  return out.sort((a, b) => a.m - b.m);
}

// Where a bus runs to: OASA headsigns name the route end to end ("ΠΕΙΡΑΙΑΣ - ΣΥΝΤΑΓΜΑ"), the last is the end.
export const toward = (headsign: string) => headsign.split(" - ").pop()!.trim() || headsign;

const GONE_MS = 60_000;

// here: at the stop (it is the bus's next one, at most HERE_M away); away: stops to go, from 2;
// est: no trip, a time from speed only. Each is left out when not so or not known.
export interface ArrivalTime { min: number; vehicle: string; late: number; here?: true; away?: number; est?: true }
export interface ArrivalGroup { line: string; headsign: string; variant: string; times: ArrivalTime[] }
export const HERE_M = 50;

export const timeText = (t: ArrivalTime) =>
  t.here ? "στη στάση" : `${t.est ? "~" : ""}${t.min === 0 ? "τώρα" : `${t.min}′`}`;

// Arrivals by line and headsign, soonest first, each with up to 3 times in minutes from `at` (so an
// answer cached a while still counts down); late: the delay in whole minutes. A bus more than GONE_MS past its
// time is left out.
export function arrivalGroups(arrivals: StopArrival[], nowMs: number): ArrivalGroup[] {
  const groups = new Map<string, ArrivalGroup>();
  for (const a of [...arrivals].sort((x, y) => x.at - y.at)) {
    if (a.at * 1000 < nowMs - GONE_MS) continue;   // an old answer kept through failed refreshes
    if (a.source === "schedule") continue;          // the card lists buses only
    const key = `${a.line}|${a.headsign}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { line: a.line, headsign: a.headsign, variant: a.variant, times: [] }));
    if (g.times.length >= 3) continue;
    const t: ArrivalTime = { min: Math.max(0, Math.round((a.at * 1000 - nowMs) / 60_000)), vehicle: a.vehicle, late: Math.round(a.delay_s / 60) };
    if (a.stops_away === 1 && a.distance_m != null && a.distance_m <= HERE_M) t.here = true;
    if (a.stops_away != null && a.stops_away >= 2) t.away = a.stops_away;
    if (a.trip_id === null) { t.est = true; t.late = 0; }
    g.times.push(t);
  }
  return [...groups.values()];
}

// What an alert at stop k watches, per line (AlertForm): each variant through the stop, boarded there.
// i: the stop's place in the variant (near `hint` when it passes twice: a loop), from: k itself.
export function alertLinesAt(ix: TripIndex, k: number, lines?: string[], hint?: Record<string, number>): { line: string; variants: { id: string; i: number; from: number }[] }[] {
  return linesAt(ix, k).filter(l => !lines || lines.includes(l.line)).map(l => ({
    line: l.line,
    variants: l.variants.map(id => {
      const seq = ix.l[l.line][id], h = hint?.[id];
      return { id, i: h != null && seq[h] === k ? h : seq.indexOf(k), from: k };
    }),
  }));
}

// The line under an arrival's headsign: where the bus is (stops to go) and how it runs. est: no trip,
// so no delay to tell; late of 2 minutes or more is late (an early bus is on time).
export function arrivalNote(t: ArrivalTime): { text: string; tone: "ok" | "late" | "muted" } {
  if (t.here) return { text: "στη στάση", tone: "ok" };
  const where = t.away ? [`${t.away} στάσεις πριν`] : [];
  if (t.est) return { text: [...where, "εκτίμηση"].join(" · "), tone: "muted" };
  if (t.late >= 2) return { text: [...where, `αργεί ${t.late}′`].join(" · "), tone: "late" };
  return { text: [...where, "στην ώρα του"].join(" · "), tone: "ok" };
}

// The name of the stop n stops before place i of a line's variant (where the bus is when an alert
// n stops before fires), or null.
export function stopBack(ix: TripIndex, line: string, variant: string, i: number, n: number): string | null {
  const seq = ix.l[line]?.[variant], k = i - n;
  return seq && k >= 0 && k < seq.length ? ix.s[seq[k]]?.[0] ?? null : null;
}

// A stop's arrival groups split into the user's lines (favourites and lines on the map) and the others.
export function mineFirst<G extends { line: string }>(groups: G[], mine: string[]): { mine: G[]; also: G[] } {
  return { mine: groups.filter(g => mine.includes(g.line)), also: groups.filter(g => !mine.includes(g.line)) };
}
