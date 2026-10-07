// Trip planner: which lines go from one place to another, with no change. Loaded with the planner
// only (dynamic import), as is public/trips.json, its stop index (scripts/trips.ts).

import { fold } from "./search";
import type { AppState } from "./state.svelte";

export type Pt = [number, number];   // [lat, lon]

// s: every stop [name, lat, lon]; l: line → variant → its stops, as indexes into s.
export interface TripIndex { v: string; s: [string, number, number][]; l: Record<string, Record<string, number[]>> }

// A place to start or end at: stops of one name close together, an address, or the user's location.
export interface Place { label: string; hint?: string; pts: Pt[]; lines: string[] }

export interface TripVariant {
  id: string;
  i: number; j: number;          // board at stops[i], get off at stops[j] of the variant
  from: number; to: number;      // the same stops, as indexes into the index's stop table
  walk: number;                  // metres in a straight line, to the first stop and from the last
  stops: number;                 // stops travelled
}
export interface TripLine { line: string; walk: number; stops: number; variants: TripVariant[] }

export const WALK_M = 500;
const CLUSTER_M = 800;

export function distM(a: Pt, b: Pt): number {
  return Math.hypot((a[1] - b[1]) * Math.cos((a[0] * Math.PI) / 180), a[0] - b[0]) * 111_320;
}
const nearest = (p: Pt, pts: Pt[]) => Math.min(...pts.map(q => distM(p, q)));

export const centre = (pts: Pt[]): Pt =>
  [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];

const byLine = (a: string, b: string) => a.localeCompare(b, "el", { numeric: true });

// Stops grouped by name; one name far apart (ΕΚΚΛΗΣΙΑ) is several places. A stop joins a group only
// near its first stop, so a chain of stops cannot stretch a place across a district. Stops are taken
// south to north, so the result does not depend on their order in the index.
export function places(ix: TripIndex): Place[] {
  const lines = ix.s.map(() => new Set<string>());
  for (const [line, vs] of Object.entries(ix.l)) for (const seq of Object.values(vs)) for (const k of seq) lines[k]?.add(line);
  const order = ix.s.map((_, k) => k).sort((a, b) => ix.s[a][1] - ix.s[b][1] || ix.s[a][2] - ix.s[b][2] || a - b);
  const groups = new Map<string, { seed: Pt; place: Place; lines: Set<string> }[]>();
  for (const k of order) {
    const [name, lat, lon] = ix.s[k];
    const p: Pt = [lat, lon];
    const key = fold(name);
    const list = groups.get(key) ?? [];
    groups.set(key, list);
    let g = list.find(x => distM(x.seed, p) <= CLUSTER_M);
    if (!g) list.push((g = { seed: p, place: { label: name, pts: [], lines: [] }, lines: new Set() }));
    g.place.pts.push(p);
    for (const l of lines[k]) g.lines.add(l);
  }
  return [...groups.values()].flat().map(g => ({ ...g.place, lines: [...g.lines].sort(byLine) }));
}

const folded = new WeakMap<Place, string>();
const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

// Places whose name has the text at a word start ("ταυρ" is not in ΔΙΑΣΤΑΥΡΩΣΗ); whole name first,
// then name start, then busier places.
export function searchPlaces(list: Place[], query: string, max = 6): Place[] {
  const q = fold(query.trim());
  if (!q) return [];
  const rank = (p: Place) => {
    let f = folded.get(p);
    if (f == null) folded.set(p, (f = fold(p.label)));
    if (f === q) return 0;
    for (let at = f.indexOf(q); at >= 0; at = f.indexOf(q, at + 1))
      if (at === 0) return 1;
      else if (!isWordChar(f[at - 1])) return 2;
    return -1;
  };
  return list.map(p => [rank(p), p] as const).filter(([r]) => r >= 0)
    .sort((a, b) => a[0] - b[0] || b[1].lines.length - a[1].lines.length || a[1].label.localeCompare(b[1].label, "el"))
    .slice(0, max).map(([, p]) => p);
}

// Every line with a variant that stops within `radius` of the start and later within `radius` of the
// end. Per variant, the pair of stops with the least walking, then the fewest stops. Lines come
// best first; `known` (the current line list) leaves out lines the index has but OASA dropped.
export function findTrips(ix: TripIndex, from: Pt[], to: Pt[], radius = WALK_M, known?: Set<string>): TripLine[] {
  if (Math.min(...from.map(p => nearest(p, to))) < radius) return [];   // close enough to walk
  const dFrom = new Map<number, number>(), dTo = new Map<number, number>();
  const d = (cache: Map<number, number>, pts: Pt[], k: number) => {
    let v = cache.get(k);
    if (v == null) cache.set(k, (v = nearest([ix.s[k][1], ix.s[k][2]], pts)));
    return v;
  };
  const out: TripLine[] = [];
  for (const [line, vs] of Object.entries(ix.l)) {
    if (known && !known.has(line)) continue;
    const variants: TripVariant[] = [];
    for (const [id, seq] of Object.entries(vs)) {
      let best: TripVariant | null = null;
      for (let i = 0; i < seq.length; i++) {
        const a = d(dFrom, from, seq[i]);
        if (a > radius) continue;
        for (let j = i + 1; j < seq.length; j++) {
          const b = d(dTo, to, seq[j]);
          if (b > radius) continue;
          const walk = a + b;
          if (!best || walk < best.walk || (walk === best.walk && j - i < best.stops))
            best = { id, i, j, from: seq[i], to: seq[j], walk, stops: j - i };
        }
      }
      if (best) variants.push(best);
    }
    if (!variants.length) continue;
    variants.sort((a, b) => a.walk - b.walk || a.stops - b.stops || a.id.localeCompare(b.id));
    out.push({ line, walk: variants[0].walk, stops: variants[0].stops, variants });
  }
  return out.sort((a, b) => a.walk - b.walk || a.stops - b.stops || byLine(a.line, b.line));
}

// A result tapped in the planner: hidden, or shown again only on the variants that make the trip.
export function toggleTripLine(app: AppState, t: TripLine) {
  const was = app.selected.includes(t.line);
  app.toggleLine(t.line);
  if (!was && app.selected.includes(t.line)) app.setFocus(t.line, t.variants.map(v => v.id));
}

// Nominatim answers: name = first part of the address, hint = the next two (district, municipality).
// A long street comes in pieces with the same name and area: the first one stands for all.
export function parseNominatim(body: unknown): Place[] {
  if (!Array.isArray(body)) return [];
  const seen = new Set<string>();
  return body.flatMap((r): Place[] => {
    const lat = Number(r?.lat), lon = Number(r?.lon);
    if (typeof r?.display_name !== "string" || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return [];
    const parts = r.display_name.split(", ");
    const place: Place = { label: parts[0], hint: parts.slice(1, 3).join(", "), pts: [[lat, lon]], lines: [] };
    const key = `${place.label}|${place.hint}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [place];
  });
}

let index: Promise<TripIndex> | null = null;
export function loadTripIndex(): Promise<TripIndex> {
  if (index) return index;
  const p = fetch(`${import.meta.env.BASE_URL}trips.json`).then(r => {
    if (!r.ok) throw new Error(`trips.json: HTTP ${r.status}`);
    return r.json() as Promise<TripIndex>;
  });
  p.catch(() => { if (index === p) index = null; });   // the next call tries again
  return (index = p);
}

// Addresses and areas (Ταύρος has no stop of its name), from OpenStreetMap's Nominatim. Its usage
// policy: no search as you type, at most one request a second, results cached.
const GEOCODE_URL = import.meta.env.VITE_GEOCODE_URL || "https://nominatim.openstreetmap.org/search";
const geocoded = new Map<string, Place[]>();
let geocodeAt = 0;
export async function geocode(query: string, signal?: AbortSignal): Promise<Place[]> {
  const q = query.trim();
  const hit = geocoded.get(fold(q));
  if (hit) return hit;
  const wait = geocodeAt + 1100 - Date.now();
  geocodeAt = Date.now() + Math.max(0, wait);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  signal?.throwIfAborted();
  const u = new URL(GEOCODE_URL);
  // Attica, only.
  Object.entries({ q, format: "jsonv2", countrycodes: "gr", viewbox: "23.35,38.25,24.15,37.65", bounded: "1",
    limit: "5", "accept-language": "el" }).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u, { signal });
  if (!r.ok) throw new Error(r.status === 429 ? "busy" : `HTTP ${r.status}`);
  const found = parseNominatim(await r.json());
  geocoded.set(fold(q), found);
  return found;
}
