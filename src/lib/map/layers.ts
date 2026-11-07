// GeoJSON for the map. Contract shapes are [lat, lon]; GeoJSON wants [lon, lat].

import type { FeatureCollection, LineString, Point } from "geojson";
import type { LineStatic } from "../types";

export interface DrawnLine { id: string; color: string; data: LineStatic; visible?: Set<string> }   // visible: focused variants

const flip = ([lat, lon]: [number, number]): [number, number] => [lon, lat];

/** A route drawn smooth: each corner becomes a short curve that starts and ends at most `cut` metres from it (and
 *  never past the middle of a segment), so a line stays on its street while its sharp elbows round off. The first
 *  and last points stay. For drawing only: vehicles still move along the shape itself. [lon, lat] in and out. */
export function smoothLine(pts: [number, number][], cut = 14, steps = 6): [number, number][] {
  if (pts.length < 3) return pts;
  const kx = 111320 * Math.cos((pts[0][1] * Math.PI) / 180), ky = 110540;
  const out: [number, number][] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]];
    const l1 = Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * ky), l2 = Math.hypot((c[0] - b[0]) * kx, (c[1] - b[1]) * ky);
    if (!l1 || !l2) continue;
    const d = Math.min(cut, l1 / 2, l2 / 2);
    const p: [number, number] = [b[0] + ((a[0] - b[0]) * d) / l1, b[1] + ((a[1] - b[1]) * d) / l1];
    const q: [number, number] = [b[0] + ((c[0] - b[0]) * d) / l2, b[1] + ((c[1] - b[1]) * d) / l2];
    // A quadratic curve from p to q with the corner as its control point.
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, u = 1 - t;
      out.push([u * u * p[0] + 2 * u * t * b[0] + t * t * q[0], u * u * p[1] + 2 * u * t * b[1] + t * t * q[1]]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function routesFC(lines: DrawnLine[]): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: lines.flatMap(({ id, color, data, visible }) =>
      Object.entries(data.variants).filter(([variant]) => !visible || visible.has(variant)).map(([variant, v]) => ({
        type: "Feature" as const,
        properties: { line: id, variant, color },
        geometry: { type: "LineString" as const, coordinates: smoothLine(v.shape.map(flip)) },
      }))),
  };
}

export function variantFC(line: DrawnLine | undefined, variant: string | null | undefined): FeatureCollection<LineString> {
  const v = variant ? line?.data.variants[variant] : undefined;
  if (!line || !v) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: { color: line.color }, geometry: { type: "LineString", coordinates: smoothLine(v.shape.map(flip)) } }],
  };
}

// The stops of one variant, or with `all` (no direction focused) of every variant of the line, each stop once.
export function stopsFC(line: DrawnLine | undefined, variant: string | null | undefined, all = false): FeatureCollection<Point> {
  const v = variant ? line?.data.variants[variant] : undefined;
  if (!line || (!v && !all)) return { type: "FeatureCollection", features: [] };
  const stops = all ? [...new Set(Object.values(line.data.variants).flatMap(x => x.stops))] : v!.stops;
  return {
    type: "FeatureCollection",
    features: stops.flatMap(id => {
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
