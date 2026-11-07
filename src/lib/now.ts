// «Τώρα» (NowPanel): when to leave for a bus. Pure helpers: which stop to plan from, how long the walk is, and the
// first bus the user can still catch there, with how long until they must set off.

import { walkMin } from "./nearby";
import type { StopRow } from "./v2";

export interface NowStop { id: string; name: string; lat: number; lon: number; fav: boolean }

// Metres between two [lat, lon] points (equirectangular: exact enough within a city).
export function metresBetween(a: [number, number], b: [number, number]): number {
  const kx = 111_320 * Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180), ky = 110_540;
  return Math.hypot((a[1] - b[1]) * kx, (a[0] - b[0]) * ky);
}

// Streets are not straight lines: a walk is about a quarter longer than the crow flies.
export const DETOUR = 1.25;
// A favourite stop is planned from only when it is walkable; further than this the nearest stop is.
export const FAV_REACH_M = 1500;

// The walk to a stop, in whole minutes (at least 1), from where the user is; null without a location.
export function walkTo(me: [number, number] | null, s: { lat: number; lon: number }): number | null {
  return me ? walkMin(metresBetween(me, [s.lat, s.lon]) * DETOUR) : null;
}

// The stops to plan from, best first: the favourite stops within reach (nearest first), then the nearest stop.
// Without a location: the favourite stops in the order they were added.
export function planStops(favs: NowStop[], nearest: NowStop | null, me: [number, number] | null): NowStop[] {
  if (!me) return favs.length ? favs : nearest ? [nearest] : [];
  const near = favs
    .map(s => ({ s, m: metresBetween(me, [s.lat, s.lon]) }))
    .filter(x => x.m <= FAV_REACH_M)
    .sort((a, b) => a.m - b.m)
    .map(x => x.s);
  if (nearest && !near.some(s => s.id === nearest.id)) near.push(nearest);
  return near;
}

export interface LeaveNow {
  line: string; headsign: string; dir: 0 | 1 | null;
  at: number;            // the bus at the stop (Unix s)
  inMin: number;         // minutes until the bus is at the stop
  leaveIn: number;       // minutes until the user must set off; 0: now
  walk: number;          // minutes of walking (0 without a location)
  live: boolean; delay_s: number | null; vehicle: string | null;
  nextAt: number | null; // the one after it, on the same row
}

// The first bus the user can still catch at a stop: the soonest time, over all rows (favourite lines first when
// any of them has one), that is at least the walk away. null: none on the board can be caught.
export function leaveNow(rows: StopRow[], walk: number, nowS: number, favLines: string[] = []): LeaveNow | null {
  const pick = (list: StopRow[]) => {
    let best: LeaveNow | null = null;
    for (const r of list) {
      r.times.forEach((t, k) => {
        const inMin = Math.floor((t.at - nowS) / 60);
        if (inMin < walk) return;
        if (best && t.at >= best.at) return;
        best = { line: r.line, headsign: r.headsign, dir: r.dir, at: t.at, inMin, leaveIn: Math.max(0, inMin - walk), walk,
          live: t.live, delay_s: t.delay_s, vehicle: t.vehicle, nextAt: r.times[k + 1]?.at ?? null };
      });
    }
    return best;
  };
  const mine = rows.filter(r => favLines.includes(r.line));
  return (mine.length ? pick(mine) : null) ?? pick(rows);
}

// The three parts of the wait for the timeline bar, as shares of the whole: until leaving, walking, at the stop.
export function timeline(l: LeaveNow): { leave: number; walk: number; wait: number } {
  const total = Math.max(1, l.inMin);
  const walk = Math.min(l.walk, total);
  const leave = Math.min(l.leaveIn, total - walk);
  return { leave: leave / total, walk: walk / total, wait: Math.max(0, total - walk - leave) / total };
}
