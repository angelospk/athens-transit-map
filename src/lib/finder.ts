// Finder search: lines by label or name, stops by name, plus the recent-picks list. Pure, no Svelte.

import { fold, greeklish, greeklishKeys, hasLatin } from "./search";
import type { MuniCard } from "./muniLine";
import type { MunicipalRoute, MunicipalStop } from "./municipal";
import { normalizeLineId } from "./selection";
import type { V2Line } from "./v2";

export type Chip = "bus" | "metro" | "tram" | "suburban";
// A row of the /v2/stops index.
export type StopEntry = [id: string, name: string, lat: number, lon: number, modes: string[], lines: string[]];
export interface Recent { kind: "line" | "stop"; id: string; label: string; name?: string }

const noZeros = (s: string) => s.replace(/^0+(?=.)/, "");

// Trolleys share the bus chip; modes without a chip (ferry...) are null.
export function chipOf(mode: string): Chip | null {
  if (mode === "bus" || mode === "trolley") return "bus";
  if (mode === "metro" || mode === "tram" || mode === "suburban") return mode;
  return null;
}

// Stable sort by rank; entries ranked -1 are dropped.
function rankSort<T>(items: T[], rank: (x: T) => number): T[] {
  return items.map(x => [rank(x), x] as const).filter(([r]) => r >= 0).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
}

export function findLines(lines: V2Line[], query: string, chips: Chip[]): V2Line[] {
  const q = fold(query.trim());
  if (!q) return [];
  const qid = fold(normalizeLineId(query));
  const qz = noZeros(qid);
  const gq = hasLatin(q) ? greeklishKeys(q) : [];   // Greeklish: «syntagma» finds ΣΥΝΤΑΓΜΑ
  const rank = (l: V2Line) => {
    if (l.label) {
      const id = fold(normalizeLineId(l.label));
      const iz = noZeros(id);
      if (id === qid || iz === qz) return 0;
      if (id.startsWith(qid) || iz.startsWith(qz)) return 1;
    }
    if (fold(l.name).includes(q) || (l.name_en && fold(l.name_en).includes(q)) || gq.some(k => greeklish(l.name).includes(k))) return 2;
    return -1;
  };
  const shown = chips.length ? lines.filter(l => { const c = chipOf(l.mode); return c !== null && chips.includes(c); }) : lines;
  return rankSort(shown, rank);
}

// True when a word of `name` starts with `q` (a word begins after any non-letter, non-digit).
function wordStarts(name: string, q: string): boolean {
  for (let i = name.indexOf(q); i >= 0; i = name.indexOf(q, i + 1)) {
    if (i === 0 || !/[\p{L}\p{N}]/u.test(name[i - 1])) return true;
  }
  return false;
}

export function findStops(stops: StopEntry[], query: string, chips: Chip[]): StopEntry[] {
  const raw = fold(query.trim());
  if (raw.length < 2) return [];
  const latin = hasLatin(raw);   // Greeklish: «syntagma» finds ΣΥΝΤΑΓΜΑ, also while typed
  const qs = latin ? greeklishKeys(raw) : [raw];
  // A station (metro, tram, suburban) before the bus poles of the same rank: there are few of them, and dozens of poles.
  const rank = (s: StopEntry) => {
    const name = latin ? greeklish(s[1]) : fold(s[1]);
    const at = (q: string) => (name.startsWith(q) ? 0 : wordStarts(name, q) ? 2 : name.includes(q) ? 4 : -1);
    const rs = qs.map(at).filter(x => x >= 0);
    const r = rs.length ? Math.min(...rs) : -1;
    return r < 0 ? r : r + (s[4].every(m => chipOf(m) === "bus") ? 1 : 0);
  };
  const shown = chips.length ? stops.filter(s => s[4].some(m => { const c = chipOf(m); return c !== null && chips.includes(c); })) : stops;
  return rankSort(shown, rank);
}

// Municipal lines and stops (the «Δημοτικά» layer). People say «Χολαργός», the data says «Δήμος
// Παπάγου-Χολαργού»: a query word of 5+ letters matches by its stem (the last 2 letters cut), so the
// nominative finds the genitive.
const stems = (query: string) => fold(query.trim()).split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(w => (w.length >= 5 ? w.slice(0, -2) : w));
const hasAll = (text: string, ws: string[]) => { const t = fold(text); return ws.every(w => t.includes(w)); };

export function findMuniLines(cards: MuniCard[], query: string): MuniCard[] {
  const ws = stems(query);
  if (!ws.length) return [];
  const qid = normalizeLineId(query);
  const rank = (c: MuniCard) => {
    const ref = c.ref ? normalizeLineId(c.ref) : "";
    if (ref && ref === qid) return 0;
    if (ref && ref.startsWith(qid)) return 1;
    if (hasAll(c.municipality, ws)) return 2;
    if (hasAll(c.name, ws)) return 3;
    return -1;
  };
  return rankSort(cards, rank);
}

export interface MuniStopHit { id: string; name: string; municipality: string }

// Named stops only (an unnamed one cannot be told apart in a list), with the municipality of a route
// through them.
export function findMuniStops(stops: Record<string, MunicipalStop>, routes: MunicipalRoute[], query: string): MuniStopHit[] {
  const q = fold(query.trim());
  if (q.length < 2) return [];
  const where = new Map<string, string>();
  for (const r of routes) for (const id of r.stops) if (!where.has(id)) where.set(id, r.municipality);
  const hits: MuniStopHit[] = [];
  for (const [id, s] of Object.entries(stops)) if (s.name) hits.push({ id, name: s.name, municipality: where.get(id) ?? "" });
  const rank = (h: MuniStopHit) => { const n = fold(h.name); return n.startsWith(q) ? 0 : wordStarts(n, q) ? 1 : n.includes(q) ? 2 : -1; };
  return rankSort(hits, rank);
}

// The municipalities on the layer, each once, without «Δήμος», sorted.
export function muniPlaces(routes: MunicipalRoute[]): string[] {
  return [...new Set(routes.map(r => r.municipality.replace(/^Δήμος\s+/, "")))].sort((a, b) => a.localeCompare(b, "el"));
}

// Newest first, no duplicates (same kind + id), at most `max` entries.
export function pushRecent(list: Recent[], item: Recent, max = 5): Recent[] {
  return [item, ...list.filter(r => r.kind !== item.kind || r.id !== item.id)].slice(0, max);
}

// A mode chip pressed or released. All four modes pressed is the same as none: back to «Όλα».
export function toggleChip(chips: Chip[], c: Chip): Chip[] {
  const next = chips.includes(c) ? chips.filter(x => x !== c) : [...chips, c];
  return next.length === 4 ? [] : next;
}

// [lon, lat] of every stop a line serves: what the map frames when the line is picked.
export function lineStopPoints(stops: StopEntry[], line: string): [number, number][] {
  return stops.filter(s => s[5].includes(line)).map(s => [s[3], s[2]]);
}
