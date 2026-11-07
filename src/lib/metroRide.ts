// Riding the metro, on the rider's own phone (nothing is sent): which station the train is at or heading to, from its
// timetable and the phone's motion, and whether the rider seems to be on a train at all.
//
// Underground there is no GPS; the phone's accelerometer still works. A train running shakes the phone a little all
// the time; standing at a platform it is still; a person walking shakes it a lot. A still spell after a run is a stop,
// matched to the station the timetable (plus the delay seen so far) puts nearest in time.
// The thresholds are a first guess: they want tuning on real rides (a phone in a pocket, in a hand, on a seat).

export interface RideStop { stop: string; name: string; at: number; lat: number; lon: number }   // a station ahead, its timetable time (s)

export const WIN_S = 3;          // the window the shaking is measured over
export const SHAKE = 0.12;       // m/s², the spread of the acceleration over the window: a train running, over this
export const WALK = 1.5;         // a person walking (or the phone handled), over this
export const HOLD_S = 8;         // a state counts once it has lasted this long
export const MOVE_MIN_S = 25;    // a run between stations lasts at least this long
export type Motion = "moving" | "still" | "walking";

/** Stops and starts of a train from the phone's acceleration, sampled (t in s, a the acceleration's size). */
export class MotionStops {
  private win: [number, number][] = [];
  private cur: Motion | null = null;
  private since = 0;
  private cand: Motion | null = null;
  private candAt = 0;
  private stopped = false;
  /** A run like a train's was seen (moving long enough, then a stop). */
  trainLike = false;
  /** Seconds of train-like motion seen so far. */
  movedS = 0;
  constructor(private emit: (kind: "stop" | "go", t: number) => void) {}

  push(t: number, a: number) {
    this.win.push([t, a]);
    while (this.win.length && t - this.win[0][0] > WIN_S) this.win.shift();
    if (this.win.length < 8 || t - this.win[0][0] < WIN_S * 0.8) return;
    const n = this.win.length, mean = this.win.reduce((s, x) => s + x[1], 0) / n;
    const sd = Math.sqrt(this.win.reduce((s, x) => s + (x[1] - mean) ** 2, 0) / n);
    const now: Motion = sd >= WALK ? "walking" : sd >= SHAKE ? "moving" : "still";
    if (now !== this.cand) { this.cand = now; this.candAt = t; }
    if (now === this.cur || t - this.candAt < HOLD_S) return;
    const prev = this.cur, ranS = this.candAt - this.since;
    this.cur = now;
    this.since = this.candAt;
    if (prev === "moving") this.movedS += ranS;
    if (now === "still" && prev === "moving" && ranS >= MOVE_MIN_S) {
      this.trainLike = true;
      this.stopped = true;
      this.emit("stop", this.candAt);
    } else if (now === "moving" && this.stopped) {
      this.stopped = false;
      this.emit("go", this.candAt);
    }
  }
}

/** Where the rider is: `i` the station the train goes to (or stands at, `at`), `offset` the delay seen (s). */
export interface Ride { stops: RideStop[]; i: number; at: boolean; offset: number; seen: number; matched: number }

export const rideStart = (stops: RideStop[], now: number): Ride =>
  ({ stops, i: 0, at: stops.length > 0 && Math.abs(stops[0].at - now) <= 20, offset: 0, seen: 0, matched: 0 });

/** A stop seen at t: of the next three stations the one nearest in time; none within 4 minutes: a stop between
 *  stations (a signal), not one of them. `matched` counts the stops within 3 minutes of the timetable. */
export function rideStop(r: Ride, t: number): Ride {
  let best = -1, d = Infinity;
  for (let j = r.i; j < Math.min(r.stops.length, r.i + 3); j++) {
    const e = Math.abs(r.stops[j].at + r.offset - t);
    if (e < d) { d = e; best = j; }
  }
  if (best < 0 || d > 240) return { ...r, seen: r.seen + 1 };
  return { ...r, i: best, at: true, offset: t - r.stops[best].at, seen: r.seen + 1, matched: r.matched + (d <= 180 ? 1 : 0) };
}

/** The train left the station it stood at: on to the next. */
export const rideGo = (r: Ride): Ride => (r.at ? { ...r, at: false, i: Math.min(r.i + 1, r.stops.length - 1) } : r);

/** By the clock (no motion, or stops missed): the station the timetable plus the delay seen puts the train at or
 *  going to now. */
export function rideByClock(r: Ride, now: number): Ride {
  let i = r.i;
  while (i < r.stops.length - 1 && r.stops[i].at + r.offset + 20 < now) i++;
  const at = Math.abs(r.stops[i].at + r.offset - now) <= 20;
  return i === r.i && at === r.at ? r : { ...r, i, at };
}

/** The ride is over: at the last station, or a minute past its time. */
export const rideOver = (r: Ride, now: number) =>
  !r.stops.length || (r.i === r.stops.length - 1 && (r.at || r.stops[r.i].at + r.offset + 60 < now));

/** Metres from the rider to the nearest station of the ride. */
export function nearestStationM(r: Ride, pos: [number, number]): number {
  const kx = 111320 * Math.cos((pos[0] * Math.PI) / 180), ky = 110540;
  return r.stops.reduce((m, s) => Math.min(m, Math.hypot((s.lon - pos[1]) * kx, (s.lat - pos[0]) * ky)), Infinity);
}
