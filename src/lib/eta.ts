// Estimated times of arrival of the stops ahead of a vehicle, from its last fix.
// Distances are metres along the shape, times are seconds since the epoch.

import { projectCandidates, stopOffsets } from "./predict";

export const FALLBACK_MPS = 3.5;   // m/s (12.6 km/h): a city bus over its whole run
const STEP_M = 200;                // the backend gives one typical speed per 200 m step
const MIN_MPS = 1;                 // m/s: slower than this is a standstill, not a speed
const MAX_MPS = 15;                // m/s (54 km/h)
const AHEAD_M = 30;                // GPS noise: a candidate this far past the next stop still is it

const sane = (mps: number) => Math.min(MAX_MPS, Math.max(MIN_MPS, mps));

// Seconds to drive `dist` metres: each step at its own speed, the metres between the steps and
// beyond the last one at the mean of the known steps (the fallback speed without any).
export function driveSeconds(dist: number, steps: (number | null)[] | null | undefined): number {
  if (!(dist > 0)) return 0;
  const known = (steps ?? []).filter((x): x is number => typeof x === "number");
  const base = known.length ? sane(known.reduce((a, b) => a + b, 0) / known.length) : FALLBACK_MPS;
  let left = dist, sec = 0;
  for (let k = 0; left > 0; k++) {
    const run = Math.min(left, STEP_M);
    const step = steps?.[k];
    sec += run / (typeof step === "number" ? sane(step) : base);
    left -= run;
  }
  return sec;
}

// The stop the vehicle is heading for and every stop after it on the variant, with its time.
export function upcomingStops(
  variant: { shape: [number, number][]; stops: string[] },
  stops: Record<string, { name: string; lat: number; lon: number }>,
  v: { lat: number; lon: number; position_at: number; next_stop_id: string | null; path_speeds?: (number | null)[] | null },
): { id: string; name: string; i: number; at: number }[] {
  if (v.next_stop_id === null) return [];
  // A stop the table does not know has no place on the shape; keep its variant index all the same. Every
  // stop is placed, the passed ones too: on a loop the stops before put the next one on its right pass.
  const known = variant.stops.map((id, i) => ({ id, i })).filter(s => stops[s.id]);
  const all = stopOffsets(variant.shape, known.map(s => [stops[s.id].lon, stops[s.id].lat]));
  const cands = projectCandidates(variant.shape, [v.lon, v.lat]);
  if (!cands.length) return [];
  // The next stop's visit (a loop can pass a stop twice): the one the vehicle is closest behind; a
  // visit it is only a little past (GPS noise) counts after every visit it is behind.
  let first = -1, gap = Infinity;
  variant.stops.forEach((id, k) => {
    if (id !== v.next_stop_id) return;
    const f = known.findIndex(s => s.i >= k);
    if (f < 0) return;
    const gaps = cands.map(c => all[f] - c.s).filter(g => g >= -AHEAD_M);
    const before = gaps.filter(g => g >= 0);
    const g = before.length ? Math.min(...before) : gaps.length ? 1e9 - Math.max(...gaps) : Infinity;
    if (first < 0 || g < gap) { first = f; gap = g; }
  });
  if (first < 0) return [];
  const ahead = known.slice(first), stopS = all.slice(first);
  // The leg that puts the vehicle where a bus heading for its next stop could be; never past that stop.
  const behind = cands.filter(c => c.s <= stopS[0] + AHEAD_M);
  const fit = behind.length
    ? behind.reduce((a, b) => (b.s > a.s ? b : a)).s
    : cands.reduce((a, b) => (b.s < a.s ? b : a)).s;
  const s = Math.min(fit, stopS[0]);
  return ahead.map((stop, j) => ({
    id: stop.id,
    name: stops[stop.id].name,
    i: stop.i,
    at: Math.max(v.position_at, v.position_at + Math.round(driveSeconds(stopS[j] - s, v.path_speeds))),
  }));
}
