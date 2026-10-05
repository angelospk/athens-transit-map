// GeoJSON for the map. Contract shapes are [lat, lon]; GeoJSON wants [lon, lat].

import type { FeatureCollection, LineString, Point } from "geojson";
import type { LineStatic } from "../types";

export interface DrawnLine { id: string; color: string; data: LineStatic }

const flip = ([lat, lon]: [number, number]): [number, number] => [lon, lat];

export function routesFC(lines: DrawnLine[]): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: lines.flatMap(({ id, color, data }) =>
      Object.entries(data.variants).map(([variant, v]) => ({
        type: "Feature" as const,
        properties: { line: id, variant, color },
        geometry: { type: "LineString" as const, coordinates: v.shape.map(flip) },
      }))),
  };
}

export function variantFC(line: DrawnLine | undefined, variant: string | null | undefined): FeatureCollection<LineString> {
  const v = variant ? line?.data.variants[variant] : undefined;
  if (!line || !v) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: { color: line.color }, geometry: { type: "LineString", coordinates: v.shape.map(flip) } }],
  };
}

export function stopsFC(line: DrawnLine | undefined, variant: string | null | undefined): FeatureCollection<Point> {
  const v = variant ? line?.data.variants[variant] : undefined;
  if (!line || !v) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: v.stops.flatMap(id => {
      const s = line.data.stops[id];
      return s ? [{ type: "Feature" as const, properties: { id, name: s.name, color: line.color },
        geometry: { type: "Point" as const, coordinates: [s.lon, s.lat] } }] : [];
    }),
  };
}

// [[west, south], [east, north]] of the given lines' shapes, or null.
export function bounds(lines: DrawnLine[]): [[number, number], [number, number]] | null {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const l of lines) for (const v of Object.values(l.data.variants)) for (const [lat, lon] of v.shape) {
    w = Math.min(w, lon); e = Math.max(e, lon); s = Math.min(s, lat); n = Math.max(n, lat);
  }
  return Number.isFinite(w) ? [[w, s], [e, n]] : null;
}
