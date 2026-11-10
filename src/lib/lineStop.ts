// The line card's own stop: where the rider gets on the line in the chosen direction. The stop the card was
// opened from, when that direction serves it; else the nearest stop of the direction to the user, within
// NEAR_M; else none. Also the small things the stop and line cards link to (the trip planner, the phone's map).
import { distM, type Place, type Pt, type TripIndex } from "./trip";
import type { StopArrival } from "./stops";

export const NEAR_M = 1500;

export function lineStopFor(ix: TripIndex, line: string, variants: string[], from: { stopCode?: string | null; pos?: Pt | null },
  maxM = NEAR_M): { k: number; m: number | null } | null {
  const vs = ix.l[line];
  if (!vs) return null;
  const ks = new Set(variants.flatMap(v => vs[v] ?? []));
  if (!ks.size) return null;
  if (from.stopCode) for (const k of ks) if (ix.s[k]?.[3] === from.stopCode) return { k, m: null };
  if (!from.pos) return null;
  let best: { k: number; m: number } | null = null;
  for (const k of ks) {
    const s = ix.s[k];
    if (!s) continue;
    const m = distM(from.pos, [s[1], s[2]]);
    if (!best || m < best.m || (m === best.m && k < best.k)) best = { k, m };
  }
  return best && best.m <= maxM ? { k: best.k, m: Math.round(best.m) } : null;
}

// A board's arrivals of one line in one direction (a row with no variant counts: the board may not know it). Taken
// before arrivalGroups, which merges rows by headsign: two directions can share one at a stop.
export const lineArrivals = (arrivals: StopArrival[], line: string, variants: string[]) =>
  arrivals.filter(a => a.line === line && (!a.variant || variants.includes(a.variant)));

// A stop as a trip planner place (TripPlanner takes it as an end), with every line through it.
export function stopPlace(ix: TripIndex, k: number, label: string): Place {
  const [, lat, lon] = ix.s[k];
  const lines = Object.entries(ix.l).filter(([, vs]) => Object.values(vs).some(seq => seq.includes(k))).map(([l]) => l).sort();
  return { label, pts: [[lat, lon]], lines, kind: "stop" };
}

// Walking directions in Google Maps: its app on a phone that has it, else the site.
export const walkDirectionsUrl = (lat: number, lon: number) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lon}`)}&travelmode=walking`;

// «23:08»: the Athens clock, for «ζωντανά · 23:08».
export const hhmm = (ms: number) =>
  new Date(ms).toLocaleTimeString("el-GR", { timeZone: "Europe/Athens", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
