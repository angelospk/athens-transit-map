// Trains on the map, from the backend: metro and tram placed from the STASY timetable (no live
// data exists: GET /v1/rail/stasy/vehicles gives the two stops each train runs between, with their
// times, and the client moves it on its own clock), and the Proastiakos with its GPS positions
// (GET /v1/rail/suburban/vehicles, railway.gov.gr's train tracker).

import { API_BASE } from "./config";
import { bearingDeg } from "./heading";
import type { LngLat } from "./glide";
import { headingAt, pointAt } from "./predict";
import { railPlace, railSegment, type Place, type Segment, type Track } from "./rails";
import type { Corridor, SuburbanData, TrainRow } from "./suburban";

export interface StasyPlace { name: string; lat: number; lon: number; at: number }   // at: unix s
export interface StasyVehicle { trip: string; line: string; route_color: string; headsign: string; from: StasyPlace; to: StasyPlace }
export interface StasyTrip { trip: string; line: string; route_color: string; headsign: string; stops: StasyPlace[] }
export interface SuburbanTrain {
  train: string; corridor: string; service: string; lat: number; lon: number; course: number | null; speed_kmh: number;
  delay_min: number | null; from: string; to: string; next_station: string; position_at: number;
}
export interface SuburbanStop { id: string; name: string; t: string; at: number; platform: string | null; delay_min: number | null }
export interface SuburbanRun { train: string; from: string; to: string; status: string; delay_min: number | null; stops: SuburbanStop[] }
export type TrainSel = { kind: "metro" | "suburban"; id: string };
export interface RailMotion { track: Track; knots: [number, number][] }   // knots: [metres along track, unix s]

export const stasyVehiclesUrl = `${API_BASE}/v1/rail/stasy/vehicles`;
export const suburbanVehiclesUrl = `${API_BASE}/v1/rail/suburban/vehicles`;
export const railMotionUrl = `${API_BASE}/v2/vehicles/rail`;
export const stasyTripUrl = (id: string) => `${API_BASE}/v1/rail/stasy/trips/${encodeURIComponent(id)}`;
export const suburbanTrainUrl = (no: string) => `${API_BASE}/v1/rail/suburban/trains/${encodeURIComponent(no)}`;

export const STALE_S = 90;    // an older GPS fix is drawn faded
export const OLD_S = 600;     // an older one is not drawn

// The stretch of track between two stops, found once per pair (the timetable repeats them all day).
const segments = new Map<string, Segment | null>();
function segmentOf(line: string, tracks: Track[], a: LngLat, b: LngLat): Segment | null {
  const key = `${line}|${a}|${b}`;
  if (!segments.has(key)) {
    if (segments.size > 5000) segments.clear();
    segments.set(key, railSegment(tracks, a, b));
  }
  return segments.get(key)!;
}

// Metres along the track at time t from a run's knots: linear between two, held before the first
// and after the last (equal metres on two knots = dwell).
export function knotMetres(knots: [number, number][], t: number): number {
  if (!knots.length) return 0;
  if (t <= knots[0][1]) return knots[0][0];
  for (let i = 1; i < knots.length; i++) {
    const [m0, t0] = knots[i - 1], [m1, t1] = knots[i];
    if (t <= t1) return m0 + (m1 - m0) * (t - t0) / (t1 - t0);
  }
  return knots[knots.length - 1][0];
}

// The runs' tracks and knots from GET /v2/vehicles/rail, by /v1 trip number (the run id's third part).
// Runs without a run id, a motion, knots or a two-point track are left out.
// The /v2 Vehicle id of each metro/tram trip (the Run id, with its service day).
export function runIds(body: unknown): Record<string, string> {
  const list = (body as { vehicles?: unknown } | null)?.vehicles;
  const out: Record<string, string> = {};
  if (Array.isArray(list)) for (const v of list) {
    const trip = typeof v?.run === "string" ? v.run.split(":")[2] : undefined;
    if (trip && typeof v.id === "string") out[trip] = v.id;
  }
  return out;
}

export function railMotions(body: unknown): Record<string, RailMotion> {
  const list = (body as { vehicles?: unknown } | null)?.vehicles;
  const out: Record<string, RailMotion> = {};
  if (!Array.isArray(list)) return out;
  for (const v of list) {
    const trip = typeof v?.run === "string" ? v.run.split(":")[2] : undefined, m = v?.motion;
    if (!trip || !m || !Array.isArray(m.knots) || !m.knots.length) continue;
    const track: Track = [...(m.path ?? []), ...(m.path_beyond ?? [])];
    if (track.length >= 2) out[trip] = { track, knots: m.knots };
  }
  return out;
}

// Where a timetable train is at nowS, by time: along its line's tracks between its two stops, or on
// the straight line when no track passes both. A train standing at a stop has that stop as both,
// and no heading. With `motion` (its run's knots) it is placed by those instead, heading only while moving.
export function stasyPlace(v: StasyVehicle, nowS: number, tracks: Track[] = [], motion?: RailMotion): Place {
  if (motion) {
    const s = knotMetres(motion.knots, nowS);
    return { pos: pointAt(motion.track, s), h: knotMetres(motion.knots, nowS + 1) > s ? headingAt(motion.track, s) : null };
  }
  const a: LngLat = [v.from.lon, v.from.lat], b: LngLat = [v.to.lon, v.to.lat];
  const span = v.to.at - v.from.at;
  const k = span > 0 ? Math.min(1, Math.max(0, (nowS - v.from.at) / span)) : 1;
  const seg = tracks.length ? segmentOf(v.line, tracks, a, b) : null;
  if (seg) return railPlace(seg, k);
  const h = a[0] === b[0] && a[1] === b[1] ? null : bearingDeg(a, b);
  return { pos: k === 0 ? a : k === 1 ? b : [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], h };
}

// The trains to draw: the metro ones in their line's colour, the suburban ones of a known corridor
// in its colour (other trains of Greece are left out). `sel` marks the tapped one.
// tracks: each metro/tram line's tracks; glide: a GPS train's place on its corridor (rails.ts), if known.
export function trainsFC(o: { stasy: StasyVehicle[]; suburban: SuburbanTrain[]; corridors: Record<string, Corridor>;
  nowS: number; sel: TrainSel | null; tracks?: Record<string, Track[]>; motions?: Record<string, RailMotion>; glide?: (t: SuburbanTrain) => Place | null }): GeoJSON.FeatureCollection {
  const isSel = (kind: string, id: string) => o.sel?.kind === kind && o.sel.id === id;
  const point = (pos: LngLat, properties: Record<string, unknown>): GeoJSON.Feature =>
    ({ type: "Feature", geometry: { type: "Point", coordinates: pos }, properties });
  return {
    type: "FeatureCollection",
    features: [
      ...o.stasy.map(v => {
        const p = stasyPlace(v, o.nowS, o.tracks?.[v.line], o.motions?.[v.trip]);
        return point(p.pos, { kind: "metro", id: v.trip, color: v.route_color, ...(p.h == null ? {} : { h: p.h }), stale: false,
          sel: isSel("metro", v.trip) });
      }),
      ...o.suburban.flatMap(t => {
        const c = o.corridors[t.corridor], age = o.nowS - t.position_at;
        if (!c || age > OLD_S) return [];
        const g = o.glide?.(t), h = g?.h ?? t.course;
        return [point(g?.pos ?? [t.lon, t.lat], { kind: "suburban", id: t.train, color: c.color, ...(h == null ? {} : { h }),
          stale: age > STALE_S, sel: isSel("suburban", t.train) })];
      }),
    ],
  };
}

const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export const clockHM = (s: number) => fmt.format(s * 1000);

export interface StopRow { name: string; t: string; gone: boolean; next: boolean; delay: number }

// A run's stops at nowS, with their expected times (a stop's own delay, else the run's); the
// first stop still to come is `next`.
export function stopRows(stops: { name: string; at: number; delay?: number | null }[], nowS: number, runDelay: number | null = 0): StopRow[] {
  let seen = false;
  return stops.map(s => {
    const delay = s.delay ?? runDelay ?? 0, at = s.at + delay * 60, gone = at < nowS;
    const next = !gone && !seen;
    if (next) seen = true;
    return { name: s.name, t: clockHM(at), gone, next, delay };
  });
}

// A board's rows grouped by destination, in the order of each one's first train, at most `max` times each.
export function byDestination(rows: TrainRow[], max = 3): { to: string; times: { in: number; delay: number | null; live: boolean }[] }[] {
  const out = new Map<string, { in: number; delay: number | null; live: boolean }[]>();
  for (const r of rows) {
    const list = out.get(r.to) ?? [];
    if (list.length < max) list.push({ in: r.in, delay: r.delay, live: r.live });
    out.set(r.to, list);
  }
  return [...out].map(([to, times]) => ({ to, times }));
}

const norm = (s: string) => s.trim().toLocaleLowerCase("el").normalize("NFD").replace(/\p{M}/gu, "");

// The colour of a destination at a station: of the corridor they share, else the station's first.
export function destColor(data: SuburbanData, stationId: string, to: string): string {
  const here = data.stations.find(s => s.id === stationId), there = data.stations.find(s => norm(s.name) === norm(to));
  const id = here?.corridors.find(c => there?.corridors.includes(c)) ?? here?.corridors[0];
  return (id && data.corridors[id]?.color) || "#666666";
}

// The trains of one line now, for its card: where each goes, its next stop and (metro/tram) when it is
// there, grouped by destination in the order of their next time. at: unix s; null for the Proastiakos,
// whose GPS gives no time. pos: where to look on the map ([lon, lat]; the metro's by its knots, else its two stops' times).
export interface LineTrain { sel: TrainSel; to: string; next: string; at: number | null; delay: number | null; pos: LngLat }
export function lineTrains(line: { kind: "metro" | "suburban"; id: string }, stasy: StasyVehicle[], suburban: SuburbanTrain[], nowS: number,
  motions: Record<string, RailMotion> = {}): LineTrain[] {
  const out: LineTrain[] = line.kind === "metro"
    ? stasy.filter(v => v.line === line.id).map(v => ({ sel: { kind: "metro", id: v.trip }, to: v.headsign, next: v.to.name,
      at: v.to.at, delay: null, pos: stasyPlace(v, nowS, [], motions[v.trip]).pos }))
    : suburban.filter(t => t.corridor === line.id && nowS - t.position_at <= OLD_S).map(t => ({ sel: { kind: "suburban", id: t.train },
      to: t.to, next: t.next_station, at: null, delay: t.delay_min, pos: [t.lon, t.lat] }));
  const first = new Map<string, number>();
  for (const t of out) first.set(t.to, Math.min(first.get(t.to) ?? Infinity, t.at ?? Infinity));
  return out.sort((a, b) => (first.get(a.to)! - first.get(b.to)!) || a.to.localeCompare(b.to, "el") || (a.at ?? 0) - (b.at ?? 0));
}
