// Where lines meet: from a place (a stop, a station, the end of a ride), the metro, tram and suburban stations and the
// bus stops a short walk away, with their lines. All from the static data the app already has: the stop index
// (public/trips.json: every stop and the lines through it) and the stations (public/metro.json, suburban.json).
// The stop card lists them («Αλλαγές εδώ»), the line card marks its stops with them («Μόνο αλλαγές»), and the map
// shows the open line's interchanges.

import type { TripIndex } from "./trip";
import { fold } from "./search";

export type LatLon = [number, number];
export type RailMode = "metro" | "tram" | "suburban";
export interface RailLine { id: string; label: string; color: string; mode: RailMode }
// A station: its lines (metro.json: M1…T7; a suburban station: the corridor ids, shown as one «Π»).
export interface RailPoint { name: string; lat: number; lon: number; lines: string[]; mode: RailMode; id?: string }

// How far counts as a change: a station within RAIL_M, a bus stop within BUS_M (the walk is about a third longer
// than the straight line: WALK_DETOUR, at WALK_MPM metres a minute).
export const RAIL_M = 300, BUS_M = 200, SAME_M = 40;
const WALK_DETOUR = 1.3, WALK_MPM = 80;
export const walkMin = (m: number) => Math.max(1, Math.round((m * WALK_DETOUR) / WALK_MPM));

export function metresBetween(a: LatLon, b: LatLon): number {
  const kx = 111_320 * Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180), ky = 110_540;
  return Math.hypot((a[1] - b[1]) * kx, (a[0] - b[0]) * ky);
}

// The index's stops by grid cell (about 220 m), and each stop's lines: built once per index.
const CELL = 0.002;
interface Grid { cells: Map<string, number[]>; lines: string[][] }
const grids = new WeakMap<TripIndex, Grid>();
const cellOf = (lat: number, lon: number) => `${Math.floor(lat / CELL)}:${Math.floor(lon / CELL)}`;
function grid(ix: TripIndex): Grid {
  let g = grids.get(ix);
  if (g) return g;
  const cells = new Map<string, number[]>(), lines: string[][] = ix.s.map(() => []);
  ix.s.forEach((s, i) => { const k = cellOf(s[1], s[2]); (cells.get(k) ?? cells.set(k, []).get(k)!).push(i); });
  for (const [line, vs] of Object.entries(ix.l)) {
    const at = new Set<number>();
    for (const seq of Object.values(vs)) for (const i of seq) at.add(i);
    for (const i of at) lines[i].push(line);
  }
  g = { cells, lines };
  grids.set(ix, g);
  return g;
}
export const linesOfStop = (ix: TripIndex, i: number) => grid(ix).lines[i] ?? [];

// The index's stops within r metres of a place, nearest first.
export function stopsNear(ix: TripIndex, at: LatLon, r: number): { i: number; m: number }[] {
  const g = grid(ix), n = Math.ceil(r / (CELL * 110_000)) + 1;
  const [cy, cx] = [Math.floor(at[0] / CELL), Math.floor(at[1] / CELL)];
  const out: { i: number; m: number }[] = [];
  for (let y = cy - n; y <= cy + n; y++) for (let x = cx - n; x <= cx + n; x++) {
    for (const i of g.cells.get(`${y}:${x}`) ?? []) {
      const s = ix.s[i], m = metresBetween(at, [s[1], s[2]]);
      if (m <= r) out.push({ i, m });
    }
  }
  return out.sort((a, b) => a.m - b.m);
}

export interface RailNear { name: string; lines: string[]; mode: RailMode; m: number; walk: number; id?: string }
export interface BusNear { name: string; stops: number[]; lines: string[]; m: number; walk: number }
export interface Near { rail: RailNear[]; bus: BusNear[] }

// The changes a short walk from a place: the stations (one entry per name, nearest), and the bus stops grouped by
// name with the lines they add (not those of `skip`, the lines of where one stands, nor `skipStops` themselves).
export function nearby(ix: TripIndex | null, rail: RailPoint[], at: LatLon,
  opts: { skip?: Iterable<string>; skipStops?: Iterable<number>; railM?: number; busM?: number } = {}): Near {
  const skip = new Set(opts.skip ?? []), skipStops = new Set(opts.skipStops ?? []);
  const railOut = new Map<string, RailNear>();
  for (const s of rail) {
    const m = metresBetween(at, [s.lat, s.lon]);
    if (m > (opts.railM ?? RAIL_M)) continue;
    const key = `${fold(s.name)}|${s.mode}`, old = railOut.get(key);
    if (old) { for (const l of s.lines) if (!old.lines.includes(l)) old.lines.push(l); if (m < old.m) Object.assign(old, { m, walk: walkMin(m), id: s.id ?? old.id }); }
    else railOut.set(key, { name: s.name, lines: [...s.lines], mode: s.mode, m, walk: walkMin(m), ...(s.id && { id: s.id }) });
  }
  const bus = new Map<string, BusNear>();
  if (ix) for (const { i, m } of stopsNear(ix, at, opts.busM ?? BUS_M)) {
    if (skipStops.has(i)) continue;
    const adds = linesOfStop(ix, i).filter(l => !skip.has(l));
    if (!adds.length) continue;
    const key = fold(ix.s[i][0]), old = bus.get(key);
    if (old) { old.stops.push(i); for (const l of adds) if (!old.lines.includes(l)) old.lines.push(l); }
    else bus.set(key, { name: ix.s[i][0], stops: [i], lines: adds, m, walk: walkMin(m) });
  }
  const order: Record<RailMode, number> = { metro: 0, tram: 1, suburban: 2 };
  return {
    rail: [...railOut.values()].sort((a, b) => order[a.mode] - order[b.mode] || a.m - b.m),
    bus: [...bus.values()].map(b => ({ ...b, lines: b.lines.sort(byLine) })).sort((a, b) => a.m - b.m),
  };
}

// «Πού θες να πας από εδώ;»: the lines from these stops that reach a stop whose name holds the words typed (after the
// stop they are taken from), each with where to take it and where it gets off; the shortest ride first.
export interface GoMatch { line: string; from: number; to: string; hops: number; m: number }
export function goesTo(ix: TripIndex, from: { i: number; m: number }[], query: string, max = 12): GoMatch[] {
  const q = fold(query).trim();
  if (q.length < 3) return [];
  const hit = new Map<number, boolean>();
  const named = (i: number) => hit.get(i) ?? (hit.set(i, fold(ix.s[i][0]).includes(q)), hit.get(i)!);
  const best = new Map<string, GoMatch>();
  const at = new Map(from.map(f => [f.i, f.m]));
  for (const [line, vs] of Object.entries(ix.l)) for (const seq of Object.values(vs)) {
    for (let k = 0; k < seq.length; k++) {
      const m = at.get(seq[k]);
      if (m == null) continue;
      const j = seq.findIndex((s, n) => n > k && named(s));
      if (j < 0) continue;
      const g = { line, from: seq[k], to: ix.s[seq[j]][0], hops: j - k, m };
      const old = best.get(line);
      if (!old || g.m + g.hops * 60 < old.m + old.hops * 60) best.set(line, g);
    }
  }
  return [...best.values()].sort((a, b) => a.hops - b.hops || a.m - b.m).slice(0, max);
}

// Lines in the order of the stop card (stops.ts): numbers by value.
const byLine = (a: string, b: string) => a.localeCompare(b, "el", { numeric: true });

// The stations as RailPoints, from metro.json and suburban.json (whichever has loaded).
export function railPoints(metro: { stations: { name: string; lat: number; lon: number; lines: string[] }[] } | null,
  suburban: { stations: { id: string; name: string; lat: number; lon: number }[] } | null): RailPoint[] {
  const out: RailPoint[] = [];
  for (const s of metro?.stations ?? []) {
    const metroLines = s.lines.filter(l => l.startsWith("M")), tram = s.lines.filter(l => l.startsWith("T"));
    if (metroLines.length) out.push({ name: s.name, lat: s.lat, lon: s.lon, lines: metroLines, mode: "metro" });
    if (tram.length) out.push({ name: s.name, lat: s.lat, lon: s.lon, lines: tram, mode: "tram" });
  }
  for (const s of suburban?.stations ?? []) out.push({ name: s.name, lat: s.lat, lon: s.lon, lines: ["P"], mode: "suburban", id: s.id });
  return out;
}

// A rail line's badge: «2» on the line's colour, round for the metro, square for the tram, «Π» for the suburban.
export const SUBURBAN_COLOR = "#8a5cc7";
export function railBadge(id: string, colors: Record<string, string>): { label: string; color: string; round: boolean } {
  if (id === "P") return { label: "Π", color: SUBURBAN_COLOR, round: false };
  return { label: id.replace(/^[MT]/, ""), color: colors[id] ?? (id.startsWith("T") ? "#f39200" : "#3b5bdb"), round: id.startsWith("M") };
}
