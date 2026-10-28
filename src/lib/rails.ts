// Trains on their tracks. A timetable train (metro, tram) runs between two stops: its place is
// that share of the track between them, not of the straight line. A GPS train (Proastiakos) is
// snapped onto its corridor and runs on along it at its speed until the next fix.
// Tracks are [lat, lon] shapes (as predict.ts); points are [lon, lat]; `s` is metres along a track.

import { distanceM, type LngLat } from "./glide";
import { headingAt, pointAt, shapeLength } from "./predict";

const NEAR_TRACK_M = 300;   // a stop or fix farther than this is not on the track (OSM and GTFS disagree a little)
const JUMP_M = 3000;        // a longer move between fixes is not glided

export type Track = [number, number][];
export interface Segment { track: Track; s0: number; s1: number }
export interface Place { pos: LngLat; h: number | null }

// Nearest point of a track to p: s and metres off (flat projection, fine at city scale).
function project(track: Track, p: LngLat): { s: number; off: number } {
  const kx = Math.cos((p[1] * Math.PI) / 180);
  let best = { s: 0, off: Infinity }, walked = 0;
  for (let i = 1; i < track.length; i++) {
    const a: LngLat = [track[i - 1][1], track[i - 1][0]], b: LngLat = [track[i][1], track[i][0]];
    const len = distanceM(a, b);
    const dx = (b[0] - a[0]) * kx, dy = b[1] - a[1], px = (p[0] - a[0]) * kx, py = p[1] - a[1];
    const sq = dx * dx + dy * dy;
    const t = sq ? Math.max(0, Math.min(1, (px * dx + py * dy) / sq)) : 0;
    const off = Math.hypot(px - t * dx, py - t * dy) * 111_320;
    if (off < best.off) best = { s: walked + t * len, off };
    walked += len;
  }
  return best;
}

// The stretch of track between two stops: of the tracks that pass near both, the shortest stretch.
// A stretch much shorter than the stops are apart is another track's (both stops project onto one
// place of it, as a terminus loop does): not taken.
export function railSegment(tracks: Track[], a: LngLat, b: LngLat): Segment | null {
  let best: Segment | null = null;
  const apart = distanceM(a, b);
  for (const track of tracks) {
    if (track.length < 2) continue;
    const pa = project(track, a), pb = project(track, b);
    if (pa.off > NEAR_TRACK_M || pb.off > NEAR_TRACK_M || Math.abs(pb.s - pa.s) < 0.8 * apart) continue;
    if (!best || Math.abs(pb.s - pa.s) < Math.abs(best.s1 - best.s0)) best = { track, s0: pa.s, s1: pb.s };
  }
  return best;
}

// The point at share k (0-1) of a stretch, heading the way the train runs (a track may be drawn
// the other way).
export function railPlace(seg: Segment, k: number): Place {
  const s = seg.s0 + (seg.s1 - seg.s0) * k;
  if (seg.s1 === seg.s0) return { pos: pointAt(seg.track, s), h: null };
  const h = headingAt(seg.track, s);
  return { pos: pointAt(seg.track, s), h: h == null ? null : seg.s1 > seg.s0 ? h : (h + 180) % 360 };
}

// A fix's motion: speed, course (degrees from north, null when unknown) and its time (ms).
export interface Motion { kmh: number; course: number | null; at: number }
interface Glide { track: Track | null; s: number; dir: number; v: number; at: number; from: number; t0: number; raw: LngLat; lim: number | null }

const RUN_ON_MS = 30_000;   // a fix is run on at most this long (the next one comes in 10-30 s)
const MOVING_KMH = 2;       // slower is standing
const SLOW_KMH = 60;        // slower, the train stops at the next station; faster, it may pass it (not every train stops)

// Where stations stand along a track (s, in order); those off the track left out.
export function trackStops(track: Track, pts: LngLat[]): number[] {
  return pts.map(p => project(track, p)).filter(p => p.off <= NEAR_TRACK_M).map(p => p.s).sort((a, b) => a - b);
}

// GPS trains: each fix snapped onto the track and run on along it at the fix's speed, the way its
// course points (the fixes come every 10-30 s); a slow one no farther than the next station
// (`stops`, from trackStops: it stops there); after a new fix the train blends over `blend` ms from where
// it was drawn.
export class RailGlide {
  private g = new Map<string, Glide>();
  constructor(private blend: number) {}

  update(id: string, track: Track | null, fix: LngLat, now: number, m?: Motion, stops: number[] = []) {
    const p = track && track.length > 1 ? project(track, fix) : null;
    if (!p || p.off > NEAR_TRACK_M) return void this.g.set(id, { track: null, s: 0, dir: 0, v: 0, at: now, from: 0, t0: now, raw: fix, lim: null });
    let dir = 0;
    if (m && m.kmh >= MOVING_KMH && m.course != null) {
      const h = headingAt(track!, p.s);
      if (h != null) dir = Math.abs(((m.course - h + 540) % 360) - 180) < 90 ? 1 : -1;
    }
    const old = this.g.get(id);
    if (m && old?.track === track && m.at <= old.at) return;   // the same fix polled again, or an older one
    const drawn = old?.track === track ? this.s(old, now) : p.s;
    const lim = !dir || m!.kmh >= SLOW_KMH ? undefined : dir > 0 ? stops.find(x => x > p.s) : [...stops].reverse().find(x => x < p.s);
    this.g.set(id, { track, s: p.s, dir, v: dir ? m!.kmh / 3.6 : 0, at: m?.at ?? now, t0: now, raw: fix, lim: lim ?? null,
      from: Math.abs(p.s - drawn) > JUMP_M ? p.s : drawn });
  }

  at(id: string, now: number): Place | null {
    const e = this.g.get(id);
    if (!e) return null;
    if (!e.track) return { pos: e.raw, h: null };
    const s = this.s(e, now), pos = pointAt(e.track, s);
    if (!e.dir && s === e.s) return { pos, h: null };
    const h = headingAt(e.track, s), back = e.dir < 0 || (!e.dir && s > e.s);
    return { pos, h: h == null ? null : back ? (h + 180) % 360 : h };
  }

  // Drop the trains no longer in the feed.
  keep(ids: Set<string>) {
    for (const id of this.g.keys()) if (!ids.has(id)) this.g.delete(id);
  }

  // Where the fix has run on to by now, blended from where the train was drawn at the update.
  private s(e: Glide, now: number) {
    let ran = e.s + e.dir * e.v * (Math.min(RUN_ON_MS, Math.max(0, now - e.at)) / 1000);
    if (e.lim != null) ran = e.dir > 0 ? Math.min(ran, e.lim) : Math.max(ran, e.lim);
    const k = this.blend > 0 ? Math.min(1, Math.max(0, (now - e.t0) / this.blend)) : 1;
    return Math.max(0, Math.min(trackLength(e.track!), e.from + (ran - e.from) * k));
  }
}

const lengths = new WeakMap<Track, number>();
function trackLength(t: Track) {
  let n = lengths.get(t);
  if (n == null) lengths.set(t, (n = shapeLength(t)));
  return n;
}
