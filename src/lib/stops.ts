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

export interface ArrivalGroup { line: string; headsign: string; variant: string; times: { min: number; vehicle: string; late: number }[] }

// Arrivals by line and headsign, soonest first, each with up to 3 times in minutes from `at` (so an
// answer cached a while still counts down); late: the delay in whole minutes. A bus more than GONE_MS past its
// time is left out.
export function arrivalGroups(arrivals: StopArrival[], nowMs: number): ArrivalGroup[] {
  const groups = new Map<string, ArrivalGroup>();
  for (const a of [...arrivals].sort((x, y) => x.at - y.at)) {
    if (a.at * 1000 < nowMs - GONE_MS) continue;   // an old answer kept through failed refreshes
    const key = `${a.line}|${a.headsign}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { line: a.line, headsign: a.headsign, variant: a.variant, times: [] }));
    if (g.times.length < 3)
      g.times.push({ min: Math.max(0, Math.round((a.at * 1000 - nowMs) / 60_000)), vehicle: a.vehicle, late: Math.round(a.delay_s / 60) });
  }
  return [...groups.values()];
}
