// Metro, ISAP and tram: a static layer (no live data exists). public/metro.json comes from
// scripts/metro.ts and scripts/metro-osm.ts (track shapes). Stations always show; a line's track
// shows once it is pinned (layers menu, or a tapped station's card).

import { distanceM, type LngLat } from "./glide";

export interface MetroLine { id: string; name: string; color: string; paths: LngLat[][] }   // one per direction
export interface MetroStation { name: string; lon: number; lat: number; lines: string[] }
export interface MetroData { source: string; lines: MetroLine[]; stations: MetroStation[] }

// Interchanges the feed names differently per line (ΣΥΝΤΑΓΜΑ / Σύνταγμα (Κέντρο), 76 m): a station
// also lists the lines of every other station this close.
export const TRANSFER_M = 150;
export function linkTransfers(stations: MetroStation[]): MetroStation[] {
  return stations.map(s => {
    const lines = [...s.lines];
    for (const o of stations)
      if (o !== s && distanceM([s.lon, s.lat], [o.lon, o.lat]) <= TRANSFER_M)
        for (const id of o.lines) if (!lines.includes(id)) lines.push(id);
    return { ...s, lines };
  });
}

// "ΠΕΙΡΑΙΑΣ – ΚΗΦΙΣΙΑ": the line's stations nearest to the two ends of its first track, or null.
export function termini(data: MetroData, id: string): [string, string] | null {
  const line = data.lines.find(l => l.id === id), path = line?.paths[0];
  const own = data.stations.filter(s => s.lines.includes(id));
  if (!path?.length || !own.length) return null;
  const nearest = (p: LngLat) => own.reduce((a, b) => (distanceM(p, [b.lon, b.lat]) < distanceM(p, [a.lon, a.lat]) ? b : a)).name;
  return [nearest(path[0]), nearest(path[path.length - 1])];
}

export async function loadMetro(): Promise<MetroData> {
  const r = await fetch(`${import.meta.env.BASE_URL}metro.json`);
  if (!r.ok) throw new Error(`metro.json: HTTP ${r.status}`);
  return r.json();
}

// The pinned lines' tracks and every station; `sel` marks the tapped one.
export function metroFC(data: MetroData, shown: string[], station: string | null): GeoJSON.FeatureCollection {
  const color = new Map(data.lines.map(l => [l.id, l.color]));
  return {
    type: "FeatureCollection",
    features: [
      ...data.lines.filter(l => shown.includes(l.id)).map((l): GeoJSON.Feature => ({ type: "Feature",
        geometry: { type: "MultiLineString", coordinates: l.paths }, properties: { kind: "line", id: l.id, color: l.color } })),
      ...data.stations.map((s): GeoJSON.Feature => ({ type: "Feature", geometry: { type: "Point", coordinates: [s.lon, s.lat] },
        properties: { kind: "station", name: s.name, lines: s.lines.join(" "), color: color.get(s.lines[0]) ?? "#666666",
          hub: s.lines.length > 1, sel: s.name === station } })),
    ],
  };
}
