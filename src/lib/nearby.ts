// «Κοντά σου»: the stops around a point, grouped by name, with the lines that stop there.

import { distanceM } from "./glide";
import { fold } from "./search";
import type { TripIndex } from "./trip";

// One group of nearby stops: stops of one name close together, the metres to the nearest of them, and
// the lines of all of them.
export interface NearGroup { name: string; ids: string[]; idx: number[]; m: number; lines: string[] }

const byLine = (a: string, b: string) => a.localeCompare(b, "el", { numeric: true });

// Metres between two [lat, lon] points (distanceM takes [lon, lat]).
const between = (a: [number, number], b: [number, number]) => distanceM([a[1], a[0]], [b[1], b[0]]);

// The lines with a variant that stops at one of the given stops, once each, in Greek numeric order.
function linesOf(ix: TripIndex, idx: number[]): string[] {
  const set = new Set(idx), out: string[] = [];
  for (const [line, vs] of Object.entries(ix.l))
    if (Object.values(vs).some(seq => seq.some(k => set.has(k)))) out.push(line);
  return out.sort(byLine);
}

// The stops within radiusM of `at` ([lat, lon]), nearest first: a stop joins a group when its name
// (folded) and its distance to the group's first stop (mergeM) allow it, else it starts one. Stops
// without a GTFS id are left out (their card cannot open). The lines are found after the cut to max.
export function nearbyGroups(ix: TripIndex, at: [number, number], o: { radiusM?: number; max?: number; mergeM?: number } = {}): NearGroup[] {
  const radiusM = o.radiusM ?? 1000, max = o.max ?? 5, mergeM = o.mergeM ?? 150;
  const near: { k: number; id: string; d: number }[] = [];
  ix.s.forEach((x, k) => {
    const id = x[3];
    if (!id) return;
    const d = between(at, [x[1], x[2]]);
    if (d <= radiusM) near.push({ k, id, d });
  });
  near.sort((a, b) => a.d - b.d || a.k - b.k);

  // The group's first stop, not its last one: a chain of stops cannot stretch a group across a district.
  const found: { key: string; seed: [number, number]; g: NearGroup }[] = [];
  for (const { k, id, d } of near) {
    const [name, lat, lon] = ix.s[k];
    const key = fold(name);
    let hit = found.find(x => x.key === key && between(x.seed, [lat, lon]) <= mergeM);
    if (!hit) found.push((hit = { key, seed: [lat, lon], g: { name, ids: [], idx: [], m: Math.round(d), lines: [] } }));
    hit.g.ids.push(id);
    hit.g.idx.push(k);
  }
  const out = found.slice(0, max).map(x => x.g);
  for (const g of out) g.lines = linesOf(ix, g.idx);
  return out;
}

// The lines of the first n groups, once each: what the map shows when «Κοντά σου» opens.
export function focusLines(groups: NearGroup[], n = 3): string[] {
  return [...new Set(groups.slice(0, n).flatMap(g => g.lines))];
}

export type Perm = "granted" | "denied" | "prompt" | "unknown";

// What the page does on open: a link wins, an allowed location loads at once, a refused one shows
// nothing, and a location not decided yet is asked for once, then shown as a button. last: the answer this browser
// gave the last time, for a browser without the Permissions API (Safari before iOS 16).
export function onOpen(o: { linked: boolean; perm: Perm; asked: boolean; last?: Perm }): "load" | "ask" | "button" | "none" {
  const perm = o.perm === "unknown" ? o.last ?? "unknown" : o.perm;
  if (o.linked || perm === "denied") return "none";
  if (perm === "granted") return "load";
  return o.asked ? "button" : "ask";
}

// A distance for people: whole tens of metres under 1 km, then km with one decimal and a Greek comma.
export function distText(m: number): string {
  const n = Math.round(m / 10) * 10;
  if (n < 1000) return `${n} μ`;
  return `${(n / 1000).toFixed(1).replace(".", ",").replace(",0", "")} χλμ`;
}
