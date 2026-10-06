// Metro, ISAP and tram: a static layer (no live data exists). public/metro.json comes from
// scripts/metro.ts. A focused station shows its lines; the rest of the network fades.

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

export async function loadMetro(): Promise<MetroData> {
  const r = await fetch(`${import.meta.env.BASE_URL}metro.json`);
  if (!r.ok) throw new Error(`metro.json: HTTP ${r.status}`);
  return r.json();
}

// Lines and stations; `on` is false for what the focused station's lines do not reach.
export function metroFC(data: MetroData, focus: string | null): GeoJSON.FeatureCollection {
  const lit = new Set(data.stations.find(s => s.name === focus)?.lines ?? data.lines.map(l => l.id));
  const color = new Map(data.lines.map(l => [l.id, l.color]));
  return {
    type: "FeatureCollection",
    features: [
      ...data.lines.map((l): GeoJSON.Feature => ({ type: "Feature", geometry: { type: "MultiLineString", coordinates: l.paths },
        properties: { kind: "line", id: l.id, color: l.color, on: lit.has(l.id) } })),
      ...data.stations.map((s): GeoJSON.Feature => ({ type: "Feature", geometry: { type: "Point", coordinates: [s.lon, s.lat] },
        properties: { kind: "station", name: s.name, lines: s.lines.join(" "), color: color.get(s.lines[0]) ?? "#666666",
          hub: s.lines.length > 1, on: s.lines.some(id => lit.has(id)) } })),
    ],
  };
}
