// Predicted motion along the route between GPS updates (docs/superpowers/specs/2026-10-05-predicted-motion-design.md).
// Positions along a shape are `s`, metres from its start. Shapes are [lat, lon]; points [lon, lat].

import { distanceM, type LngLat } from "./glide";
import { bearingDeg } from "./heading";
import { drive, NO_SPEED } from "./motion";

const NEAR_ROUTE_M = 150;    // farther than this, the shape says nothing about the vehicle
const TIE_M = 20;            // other legs this close to the nearest are candidates too
const AMBIGUOUS_M = 50;      // candidates farther apart than this along the shape: ambiguous
const BACK_TOLERANCE_M = 30; // GPS noise backwards along the route
const STANDING_M = 20;       // smaller moves count as standing
const MAX_SPEED = 20;        // m/s (72 km/h)
// Real feeds: fixes arrive 20-50 s old, and a line may refresh only every 30-120 s.
const MAX_GAP_S = 180;       // samples farther apart in time give no speed
const MAX_LATE_S = 120;      // samples this old on arrival give no speed

export interface Route { shape: [number, number][]; stopIds: string[]; stopS: number[]; endS: number }
// key: variant + trip. speed: the backend's smoothed speed (contract rev 3), if any.
export interface Sample { pos: LngLat; at: number; key: string; speed?: number | null }
export interface Track {
  s: number; at: number; key: string;
  speed: number | null;   // m/s; null: unknown (moves at NO_SPEED unless held)
  stopS: number[];        // the route's stops (it waits at the ones ahead)
  endS: number;
  alts?: number[];        // held first sample: every candidate s
}

const pt = (p: [number, number]): LngLat => [p[1], p[0]];
const rad = Math.PI / 180;

// Nearest point of segment ab to p, on a local flat projection: [fraction along ab, metres off].
function nearestOnSegment(p: LngLat, a: LngLat, b: LngLat): [number, number] {
  const kx = Math.cos(p[1] * rad);
  const ax = (a[0] - p[0]) * kx, ay = a[1] - p[1], dx = (b[0] - a[0]) * kx, dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
  return [t, Math.hypot(ax + t * dx, ay + t * dy) * 111_320];
}

// Every leg of the shape that passes within TIE_M of the nearest one (and within NEAR_ROUTE_M), by s.
export function projectCandidates(shape: [number, number][], p: LngLat): { s: number; offM: number }[] {
  const hits: { s: number; offM: number }[] = [];
  let walked = 0;
  for (let i = 1; i < shape.length; i++) {
    const a = pt(shape[i - 1]), b = pt(shape[i]), len = distanceM(a, b);
    const [t, off] = nearestOnSegment(p, a, b);
    hits.push({ s: walked + t * len, offM: off });
    walked += len;
  }
  const min = Math.min(...hits.map(h => h.offM));
  if (!(min <= NEAR_ROUTE_M)) return [];
  // One candidate per leg: merge neighbours (consecutive segments meeting at a vertex).
  const near = hits.filter(h => h.offM <= min + TIE_M).sort((x, y) => x.s - y.s);
  const out: { s: number; offM: number }[] = [];
  for (const h of near) {
    const last = out[out.length - 1];
    if (last && h.s - last.s < AMBIGUOUS_M) { if (h.offM < last.offM) out[out.length - 1] = h; }
    else out.push(h);
  }
  return out;
}

export function pointAt(shape: [number, number][], s: number): LngLat {
  if (s <= 0 || shape.length < 2) return pt(shape[0]);
  let walked = 0;
  for (let i = 1; i < shape.length; i++) {
    const a = pt(shape[i - 1]), b = pt(shape[i]), len = distanceM(a, b);
    if (walked + len >= s && len > 0) {
      const k = (s - walked) / len;
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    }
    walked += len;
  }
  return pt(shape[shape.length - 1]);
}

export function headingAt(shape: [number, number][], s: number): number | null {
  let walked = 0;
  for (let i = 1; i < shape.length; i++) {
    const a = pt(shape[i - 1]), b = pt(shape[i]), len = distanceM(a, b);
    walked += len;
    if (len > 0 && (walked >= s || i === shape.length - 1)) return bearingDeg(a, b);
  }
  return null;
}

export function shapeLength(shape: [number, number][]): number {
  let d = 0;
  for (let i = 1; i < shape.length; i++) d += distanceM(pt(shape[i - 1]), pt(shape[i]));
  return d;
}

// s of each stop, in order: among the legs at or after the previous stop, the closest one
// (a stop stands on the side of the street its direction uses), then the earliest.
export function stopOffsets(shape: [number, number][], stops: LngLat[]): number[] {
  let prev = 0;
  return stops.map(p => {
    const c = projectCandidates(shape, p).filter(x => x.s >= prev - BACK_TOLERANCE_M);
    const s = c.reduce<{ s: number; offM: number } | null>((b, x) => (!b || x.offM < b.offM - 0.5 ? x : b), null)?.s ?? prev;
    prev = Math.max(prev, s);
    return s;
  });
}

const plausible = (from: number, to: number, dt: number) =>
  to >= from - BACK_TOLERANCE_M && to - from <= MAX_SPEED * dt + 100;

// Fold a new GPS sample into a vehicle's track. Returns `prev` itself when the sample is not newer.
// The backend's speed wins over the two-sample one: it comes from a longer history.
export function updateTrack(prev: Track | null, sample: Sample, route: Route, nowSec: number): Track | null {
  if (prev && prev.key === sample.key && sample.at <= prev.at) return prev;
  const cands = projectCandidates(route.shape, sample.pos).map(c => c.s);
  if (!cands.length) return null;
  const late = nowSec - sample.at > MAX_LATE_S;
  const given = typeof sample.speed === "number" && sample.speed >= 0 && !late ? Math.min(sample.speed, MAX_SPEED) : null;
  const fresh = (s: number, alts?: number[]): Track => ({
    s, at: sample.at, key: sample.key, speed: alts ? null : given, stopS: route.stopS, endS: route.endS, alts,
  });
  if (!prev || prev.key !== sample.key) {
    const ambiguous = cands[cands.length - 1] - cands[0] > AMBIGUOUS_M;
    return fresh(cands[0], ambiguous ? cands : undefined);
  }
  const dt = sample.at - prev.at;
  // The pair (previous candidate, new candidate) with the least plausible progress.
  let best: [number, number] | null = null;
  for (const from of prev.alts ?? [prev.s]) for (const to of cands) {
    if (plausible(from, to, dt) && (!best || Math.abs(to - from) < Math.abs(best[1] - best[0]))) best = [from, to];
  }
  if (!best) return fresh(cands[0], cands.length > 1 ? cands : undefined);
  const [from, s] = best;
  const moved = s - from;
  let speed: number | null = moved < STANDING_M ? 0 : Math.min(moved / dt, MAX_SPEED);
  if (dt > MAX_GAP_S || late) speed = null;
  speed = given ?? speed;
  return { s, at: sample.at, key: sample.key, speed, stopS: route.stopS, endS: route.endS };
}

const STOP_PASSED_M = 15;   // a stop this close ahead is the one the vehicle stands at
const drives = new WeakMap<Track, (dt: number) => number>();

// Where the vehicle is at nowSec: driving with stops from its fix. A held first sample (which leg
// of a loop?) stands.
export function predictS(t: Track, nowSec: number): number {
  if (t.alts) return t.s;
  let f = drives.get(t);
  if (!f) {
    const stops = t.stopS.filter(x => x > t.s + STOP_PASSED_M).map(x => x - t.s);
    drives.set(t, f = drive(t.speed ?? NO_SPEED, stops, t.endS - t.s));
  }
  return t.s + f(nowSec - t.at);
}
