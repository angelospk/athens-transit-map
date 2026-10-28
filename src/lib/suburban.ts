// Suburban rail (Προαστιακός): stations and corridors from public/suburban.json (a copy of the
// Android app's assets/suburban.json: railway.gov.gr corridors, places from OpenStreetMap), and the
// live departure board of a station through the backend (railway.gov.gr has no CORS):
// GET /v1/rail/suburban/stations/{id}/departures.

import { API_BASE } from "./config";

// path: [lat, lon] points, as the app's file has them. stations: in line order.
export interface Corridor { name: string; color: string; stations: string[]; path: [number, number][] }
export interface RailStation { id: string; name: string; en: string; lat: number; lon: number; corridors: string[] }
export interface SuburbanData { corridors: Record<string, Corridor>; stations: RailStation[] }
export interface Train { train: string; from: string; to: string; t: string; delay_min: number | null; platform: string | null; status: string }
export interface TrainRow { t: string; expected: string; delay: number | null; to: string; platform: string | null }

export const suburbanUrl = (id: string) => `${API_BASE}/v1/rail/suburban/stations/${encodeURIComponent(id)}/departures?n=6`;

export async function loadSuburban(): Promise<SuburbanData> {
  const r = await fetch(`${import.meta.env.BASE_URL}suburban.json`);
  if (!r.ok) throw new Error(`suburban.json: HTTP ${r.status}`);
  return r.json();
}

// Every corridor and every station; `sel` marks the tapped one (by id).
export function suburbanFC(data: SuburbanData, sel: string | null): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      ...Object.entries(data.corridors).map(([id, c]): GeoJSON.Feature => ({ type: "Feature",
        geometry: { type: "LineString", coordinates: c.path.map(([lat, lon]) => [lon, lat]) }, properties: { kind: "line", id, color: c.color } })),
      ...data.stations.map((s): GeoJSON.Feature => ({ type: "Feature", geometry: { type: "Point", coordinates: [s.lon, s.lat] },
        properties: { kind: "station", id: s.id, name: s.name, color: data.corridors[s.corridors[0]]?.color ?? "#666666", sel: s.id === sel } })),
    ],
  };
}

const hm = (min: number) => {
  const m = ((min % 1440) + 1440) % 1440;   // the evening before is negative
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

// The board's trains still to leave at `nowMin` (minutes since Athens midnight), by expected time
// (scheduled + delay). A time over 12 h before now is after midnight, one over 12 h after it is of the
// evening before. Completed runs, and trains gone more than a minute ago, are left out.
export function trainRows(deps: Train[], nowMin: number): TrainRow[] {
  return deps.flatMap(d => {
    const [h, m] = d.t.split(":").map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m) || d.status === "completed") return [];
    let min = h * 60 + m;
    if (min < nowMin - 720) min += 1440;          // after midnight
    else if (min > nowMin + 720) min -= 1440;     // the evening before, seen after midnight
    const exp = min + Math.max(0, d.delay_min ?? 0);
    return exp < nowMin - 1 ? [] : [{ exp, row: { t: d.t, expected: hm(exp), delay: d.delay_min, to: d.to, platform: d.platform } }];
  }).sort((a, b) => a.exp - b.exp).map(x => x.row);
}
