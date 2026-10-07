// Track shapes of the metro and tram lines from OpenStreetMap route relations (used by
// scripts/metro-osm.ts). A line's shape is the track ways of all its relations, each way once,
// joined end to end where they meet, then simplified.

import type { LngLat } from "../src/lib/glide";

export interface OsmElement {
  type: "node" | "way" | "relation";
  id: number;
  tags?: Record<string, string>;
  geometry?: { lon: number; lat: number }[];
  members?: { type: string; ref: number; role: string }[];
}

// OSM refs use Greek capitals (Μ1, Τ6); the GTFS ids use Latin ones.
const lineId = (ref: string) => ref.replaceAll("Μ", "M").replaceAll("Τ", "T");
const round = (x: number) => +x.toFixed(6);
const TRACK = new Set(["", "forward", "backward"]);
const SIMPLIFY_M = 3;   // the map draws lines 2-6 px wide: detail under this is not visible

// Douglas-Peucker in metres (local flat projection): drops points within `tol` of the simplified line.
export function simplify(path: LngLat[], tol: number): LngLat[] {
  if (path.length < 3) return path;
  const kx = 111_320 * Math.cos((path[0][1] * Math.PI) / 180), ky = 110_540;
  const xy = path.map(([lon, lat]) => [lon * kx, lat * ky]);
  const keep = new Uint8Array(path.length);
  keep[0] = keep[path.length - 1] = 1;
  const stack: [number, number][] = [[0, path.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = xy[a], [bx, by] = xy[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let far = -1, max = tol;
    for (let i = a + 1; i < b; i++) {
      // Distance to the segment, not the line through it: a turnback lies on that line.
      const [px, py] = xy[i];
      const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const d = Math.hypot(px - ax - t * dx, py - ay - t * dy);
      if (d > max) { max = d; far = i; }
    }
    if (far < 0) continue;
    keep[far] = 1;
    stack.push([a, far], [far, b]);
  }
  return path.filter((_, i) => keep[i]);
}

// Joins paths that share an end point into longer ones; a branch stays a path of its own.
export function joinWays(ways: LngLat[][]): LngLat[][] {
  const key = (p: LngLat) => `${p[0]},${p[1]}`;
  const left = [...ways];
  const out: LngLat[][] = [];
  while (left.length) {
    let path = left.shift()!;
    for (let grew = true; grew; ) {
      grew = false;
      for (let i = 0; i < left.length; i++) {
        const w = left[i], a = key(w[0]), b = key(w[w.length - 1]);
        const head = key(path[0]), tail = key(path[path.length - 1]);
        if (a === tail) path = [...path, ...w.slice(1)];
        else if (b === tail) path = [...path, ...[...w].reverse().slice(1)];
        else if (b === head) path = [...w, ...path.slice(1)];
        else if (a === head) path = [...[...w].reverse(), ...path.slice(1)];
        else continue;
        left.splice(i, 1);
        grew = true;
        break;
      }
    }
    out.push(path);
  }
  return out;
}

// Line id → its joined track paths, from an Overpass answer with the relations and their ways.
export function osmPaths(elements: OsmElement[]): Map<string, LngLat[][]> {
  const ways = new Map(elements.filter(e => e.type === "way" && e.geometry).map(e => [e.id, e.geometry!]));
  const byLine = new Map<string, Set<number>>();
  for (const r of elements) {
    if (r.type !== "relation" || !r.tags?.ref) continue;
    const id = lineId(r.tags.ref);
    const set = byLine.get(id) ?? new Set<number>();
    // Track ways have no role (or a one-way one); platforms and stops have their own roles.
    for (const m of r.members ?? []) if (m.type === "way" && TRACK.has(m.role) && ways.has(m.ref)) set.add(m.ref);
    byLine.set(id, set);
  }
  return new Map([...byLine].map(([id, set]) =>
    [id, joinWays([...set].map(w => ways.get(w)!.map((p): LngLat => [round(p.lon), round(p.lat)]))).map(p => simplify(p, SIMPLIFY_M))]));
}
