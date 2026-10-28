// Trains on the map, from the backend: metro and tram placed from the STASY timetable (no live
// data exists: GET /v1/rail/stasy/vehicles gives the two stops each train runs between, with their
// times, and the client moves it on its own clock), and the Proastiakos with its GPS positions
// (GET /v1/rail/suburban/vehicles, railway.gov.gr's train tracker).

import { API_BASE } from "./config";
import { bearingDeg } from "./heading";
import type { LngLat } from "./glide";
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

export const stasyVehiclesUrl = `${API_BASE}/v1/rail/stasy/vehicles`;
export const suburbanVehiclesUrl = `${API_BASE}/v1/rail/suburban/vehicles`;
export const stasyTripUrl = (id: string) => `${API_BASE}/v1/rail/stasy/trips/${encodeURIComponent(id)}`;
export const suburbanTrainUrl = (no: string) => `${API_BASE}/v1/rail/suburban/trains/${encodeURIComponent(no)}`;

export const STALE_S = 90;    // an older GPS fix is drawn faded
export const OLD_S = 600;     // an older one is not drawn

// Where a timetable train is at nowS: on the straight line between its two stops, by time. A train
// standing at a stop has that stop as both, and no heading.
export function stasyPlace(v: StasyVehicle, nowS: number): { pos: LngLat; h: number | null } {
  const a: LngLat = [v.from.lon, v.from.lat], b: LngLat = [v.to.lon, v.to.lat];
  const span = v.to.at - v.from.at;
  const k = span > 0 ? Math.min(1, Math.max(0, (nowS - v.from.at) / span)) : 1;
  const h = a[0] === b[0] && a[1] === b[1] ? null : bearingDeg(a, b);
  return { pos: k === 0 ? a : k === 1 ? b : [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], h };
}

// The trains to draw: the metro ones in their line's colour, the suburban ones of a known corridor
// in its colour (other trains of Greece are left out). `sel` marks the tapped one.
export function trainsFC(o: { stasy: StasyVehicle[]; suburban: SuburbanTrain[]; corridors: Record<string, Corridor>;
  nowS: number; sel: TrainSel | null }): GeoJSON.FeatureCollection {
  const isSel = (kind: string, id: string) => o.sel?.kind === kind && o.sel.id === id;
  const point = (pos: LngLat, properties: Record<string, unknown>): GeoJSON.Feature =>
    ({ type: "Feature", geometry: { type: "Point", coordinates: pos }, properties });
  return {
    type: "FeatureCollection",
    features: [
      ...o.stasy.map(v => {
        const p = stasyPlace(v, o.nowS);
        return point(p.pos, { kind: "metro", id: v.trip, color: v.route_color, ...(p.h == null ? {} : { h: p.h }), stale: false,
          sel: isSel("metro", v.trip) });
      }),
      ...o.suburban.flatMap(t => {
        const c = o.corridors[t.corridor], age = o.nowS - t.position_at;
        if (!c || age > OLD_S) return [];
        return [point([t.lon, t.lat], { kind: "suburban", id: t.train, color: c.color, ...(t.course == null ? {} : { h: t.course }),
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
export function byDestination(rows: TrainRow[], max = 3): { to: string; times: { in: number; delay: number | null }[] }[] {
  const out = new Map<string, { in: number; delay: number | null }[]>();
  for (const r of rows) {
    const list = out.get(r.to) ?? [];
    if (list.length < max) list.push({ in: r.in, delay: r.delay });
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
