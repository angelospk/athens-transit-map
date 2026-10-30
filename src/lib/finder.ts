// Finder search: lines by label or name, stops by name, plus the recent-picks list. Pure, no Svelte.

import { fold } from "./search";
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
  const rank = (l: V2Line) => {
    if (l.label) {
      const id = fold(normalizeLineId(l.label));
      const iz = noZeros(id);
      if (id === qid || iz === qz) return 0;
      if (id.startsWith(qid) || iz.startsWith(qz)) return 1;
    }
    if (fold(l.name).includes(q) || (l.name_en && fold(l.name_en).includes(q))) return 2;
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
  const q = fold(query.trim());
  if (q.length < 2) return [];
  // A station (metro, tram, suburban) before the bus poles of the same rank: there are few of them, and dozens of poles.
  const rank = (s: StopEntry) => {
    const name = fold(s[1]);
    const r = name.startsWith(q) ? 0 : wordStarts(name, q) ? 2 : name.includes(q) ? 4 : -1;
    return r < 0 ? r : r + (s[4].every(m => chipOf(m) === "bus") ? 1 : 0);
  };
  const shown = chips.length ? stops.filter(s => s[4].some(m => { const c = chipOf(m); return c !== null && chips.includes(c); })) : stops;
  return rankSort(shown, rank);
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
