// The user's ways (home, work) on the home screen (mockup 40, B): which way to show by itself (the hour and where the
// user is), and which lines from a stop go that way (a stop of theirs on the line after this one, close to the place).

import type { TripIndex } from "./trip";

type Pt = [number, number];
export type Way = "home" | "work";

const R = 6371000, rad = Math.PI / 180;
const metres = (a: Pt, b: Pt) => {
  const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
export const NEAR_M = 400;

/** The way to show, and why: near one place, the other; else work before 14:00, home after (when both are set). */
export function pickWay(places: { home?: { at: Pt }; work?: { at: Pt } }, me: Pt | null, hour: number): { way: Way; why: string } | null {
  const near = (k: Way) => !!me && !!places[k] && metres(me, places[k]!.at) < NEAR_M;
  const part = hour < 12 ? "πρωί" : hour < 17 ? "μεσημέρι" : hour < 21 ? "απόγευμα" : "βράδυ";
  if (near("home") && places.work) return { way: "work", why: `Το διάλεξα επειδή είναι ${part} και είσαι στο σπίτι.` };
  if (near("work") && places.home) return { way: "home", why: `Το διάλεξα επειδή είναι ${part} και είσαι στη δουλειά.` };
  const first: Way = hour < 14 ? "work" : "home", other: Way = first === "work" ? "home" : "work";
  const way = places[first] && !near(first) ? first : places[other] && !near(other) ? other : null;
  if (!way) return null;
  return { way, why: places.home && places.work ? `Το διάλεξα επειδή είναι ${part}.` : "" };
}

const memo = new Map<string, Set<string>>();
/** The lines (their ids in the index) that from this stop (its OASA id) go on to a stop within `m` of the place. */
export function linesToward(ix: TripIndex, stopId: string, to: Pt, m = 700): Set<string> {
  const key = `${ix.v}|${stopId}|${to[0].toFixed(4)},${to[1].toFixed(4)}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const at = new Set<number>();
  ix.s.forEach((s, k) => { if (s[3] === stopId) at.add(k); });
  const out = new Set<string>();
  for (const [line, variants] of Object.entries(ix.l)) {
    for (const seq of Object.values(variants)) {
      const i = seq.findIndex(k => at.has(k));
      if (i < 0) continue;
      if (seq.slice(i + 1).some(k => metres([ix.s[k][1], ix.s[k][2]], to) < m)) { out.add(line); break; }
    }
  }
  memo.set(key, out);
  return out;
}
