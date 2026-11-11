// Natural motion for every moving dot (docs/superpowers/specs/2026-10-06-natural-motion-locate-design.md).
// The shown position chases a target along a polyline: faster when late, slower when early, and
// never backwards on the street (2026-11-09, the demo «Το λεωφορείο χωρίς όπισθεν»): a target that
// falls behind the dot is waited for at a crawl, or standing at a stop for a while, until it passes
// under the dot again. Its speed changes at a bus's own pace, never in a jump when data arrives.
// A target very far ahead gets a "correction": a glide along the route to it, leaving a trail that
// fades. One far behind, or not coming, is reached by a fade: out where the dot is, in where it
// should be. Geometry here is [lon, lat]; times are server seconds.

import { distanceM, type LngLat } from "./glide";
import { bearingDeg } from "./heading";
import { headingAlong } from "./turn";

export const TAU_S = 10;       // a gap closes with this time constant...
export const CATCH_MAX = 6;    // ...at most this much faster than the target (m/s): no burst after new data
export const FAR_M = 600;      // farther ahead: correction, not a race
export const GLIDE_S = 1.2;    // correction glide length: the shortest, either way
export const GLIDE_MAX_S = 8;  // the longest
const GLIDE_M_PER_S = 40;      // GLIDE_S plus a second per this many metres: a correction slides, it does not blink
//                                (replay of a recorded feed, 2026-11-06: 200 m back in 1.2 s read as a jump) ...
export const LEAP_M = 600;     // ... but farther than this it is a new place, not a correction: the dot leaps there
//                                at once (a sweep across the city for seconds is worse than one blink)
export const OWN_M = 500;      // the measured speed counts over this far from the fix, fading into the step speeds
export const TRAIL_S = 0.8;    // its trail fades out over this, after the glide
const OFF_S = 1.2;             // sideways offsets fade out over at least this...
const OFF_V = 5;               // ...and at most this fast (m/s at the steepest point)
const SNAP_S = 3;              // longer between steps (hidden tab, off screen): just snap
const NEAR_M = 30;             // a shown point this close to new geometry continues on it
const JOIN_M = 40;             // otherwise, at most this far it glides there
const BEHIND_DEG = 110;        // a fix this far off the travel bearing is behind
const NOISE_M = 25;            // shorter backward moves are GPS noise

// Never backwards. The guess leans back as the fix ages (fewer dots ahead of their bus: a dot ahead
// is the one that has to wait); a dot ahead rolls on at a crawl, or stands at a stop (boarding),
// until its guess passes under it; too far ahead, or waiting too long, it fades over to the guess.
export const LEAN = 0.3;        // the guess's advance shrinks by this much...
export const LEAN_S = 40;       // ...over this long after the fix
export const CRAWL = 2;         // m/s: the least a dot ahead of its guess rolls at (never standing in the street)
export const BRAKE = 1.6;       // m/s², the dot's own braking; ACC below is its pulling away
export const AHEAD_MAX = 260;   // farther ahead of its guess: a fade to it
export const WAIT_MAX = 60;     // or after waiting this long...
export const WAIT_STAND_S = 25; // ...or this long ahead of a guess that stands (it is not coming; a stop's dwell is shorter)
export const PENDING_STAND_S = 8;   // a place behind with no way on and standing: not coming either, sooner
export const FADE_S = 0.6;      // out and in
export const STOP_HOLD_S = 20;  // ahead of its guess, it may stand at a stop this long, once per stop
const STOP_LOOK = 30;           // a stop this far ahead is the one to stand at
const AHEAD_MIN = 12;           // closer than this it is on its guess
const HOLD_MIN = 40;            // the dot eases off over this much ahead at least

// Driving with stops (docs/research/realistic-motion.md, chosen in lab/motion): the bus cruises,
// brakes into every stop, waits there and pulls away again. Its mean speed, stops included, is
// PACE times the measured one (a little slow: a late catch-up looks better than a reverse).
export const PACE = 0.85;
export const DWELL_S = 15;      // wait at each stop
export const HORIZON_S = 180;   // after this long without a new fix, stand
export const NO_SPEED = 1.5;    // m/s for a vehicle on its route without a measured speed
const ACC = 1;                  // m/s², braking and pulling away
const STOP_GAP_M = 400;         // stop spacing when fewer than two gaps are known
const MAX_CRUISE = 15;          // m/s
export const MIN_CRUISE = 3;    // m/s; slower traffic waits longer at stops instead (lab: same score)
export const STEP_M = 200;      // metres per path_speeds step (contract rev 6)

interface Phase { t: number; s: number; v: number; a: number }

// Metres from the fix dt seconds after it, at measured mean speed v (m/s). stops: metres ahead,
// ascending; the vehicle stands for good at `end`.
export function drive(v: number, stops: number[], end: number, horizon = HORIZON_S, minCruise = MIN_CRUISE): (dt: number) => number {
  const mean = PACE * v;
  if (!(mean > 0) || !(end > 0)) return () => 0;
  const ahead: number[] = [];
  for (const x of stops) if (x >= 1 && x < end && x - (ahead[ahead.length - 1] ?? 0) >= 1) ahead.push(x);   // listed twice: once
  const legs = [...ahead, end];
  // Cruise so that, over a typical gap, cruising plus one wait gives the mean speed. No stops
  // known: no waits either, so cruise at the mean.
  const gaps = ahead.slice(0, 4).map((x, i) => x - (i ? ahead[i - 1] : 0));
  const L = gaps.length >= 2 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : STOP_GAP_M;
  const run = L / mean - DWELL_S;
  let vc = !ahead.length ? Math.min(mean, MAX_CRUISE) : run > L / MAX_CRUISE ? L / run : MAX_CRUISE;
  let dwell = DWELL_S;
  if (ahead.length && vc < minCruise) { vc = minCruise; dwell = Math.max(DWELL_S, L / mean - L / vc); }
  const ph: Phase[] = [];
  let t = 0, s = 0, u = vc;
  const go = (dur: number, a: number) => { if (dur > 0) { ph.push({ t, s, v: u, a }); s += u * dur + (a * dur * dur) / 2; u += a * dur; t += dur; } };
  for (const x of legs) {
    if (t >= horizon) break;
    const d = x - s;
    if (d < 1) continue;   // the end right at the last stop
    if ((u * u) / (2 * ACC) >= d) go((2 * d) / u, -(u * u) / (2 * d));   // too close: brake harder
    else {
      const top = Math.min(vc, Math.sqrt(ACC * d + (u * u) / 2));
      const up = (top * top - u * u) / (2 * ACC), down = (top * top) / (2 * ACC);
      go((top - u) / ACC, ACC);
      go((d - up - down) / top, 0);
      go(top / ACC, -ACC);
    }
    s = x; u = 0;
    ph.push({ t, s, v: 0, a: 0 });
    t += dwell;
  }
  if (!ph.length) return () => 0;   // less than a metre to go
  return dt => {
    const k = Math.min(Math.max(dt, 0), horizon);
    let p = ph[0];
    for (const q of ph) if (q.t <= k) p = q; else break;
    const r = k - p.t;
    return Math.min(end, Math.max(p.s, p.s + p.v * r + (p.a * r * r) / 2));
  };
}

// Metres from the fix dt seconds after it, at the backend's typical speeds per STEP_M: step i covers
// metres [i*STEP_M, (i+1)*STEP_M) at steps[i]; a null step, and everything after the last step, at
// `fallback`. Stands for good at a speed <= 0, never past `end`. The backend's typical speeds per
// 200 m (history, day type, hour; chosen in lab/motion round 2026-10-21) replace the stop waits of
// drive().
// With `own`, the bus's own measured speed, the first OWN_M run at it, fading into the steps: a bus
// in a queue now is not at the road's usual speed, and a dot that races ahead of it is thrown back
// at the next fix. A standing bus (own under 1 m/s) stands for OWN_STAND_S, then goes.
export const OWN_STAND_S = 20;
export function walk(steps: (number | null)[], fallback: number, end: number, horizon = HORIZON_S, own?: number | null): (dt: number) => number {
  if (!(end > 0)) return () => 0;
  const ph: Phase[] = [];
  let t = 0, s = 0;
  const add = (v: number, d: number) => { ph.push({ t, s, v, a: 0 }); t += d / v; s += d; };
  if (own != null && own < 1) { ph.push({ t, s, v: 0, a: 0 }); t += OWN_STAND_S; own = null; }
  for (let i = 0; s < end; i++) {
    const v = (i < steps.length ? steps[i] : null) ?? fallback;
    if (!(v > 0)) break;
    const stepEnd = Math.min(s + STEP_M, end);
    if (own != null && s < OWN_M) {
      // In 50 m pieces: the share of its own speed falls with the distance from the fix.
      while (s < stepEnd && s < OWN_M) {
        const d = Math.min(50, stepEnd - s, OWN_M - s), w = 1 - (s + d / 2) / OWN_M;
        add(w * own + (1 - w) * v, d);
      }
      if (s < stepEnd) add(v, stepEnd - s);
    } else add(v, stepEnd - s);
  }
  if (!ph.length) return () => 0;   // standing from the start
  const limit = s;
  return dt => {
    const k = Math.min(Math.max(dt, 0), horizon);
    let p = ph[0];
    for (const q of ph) if (q.t <= k) p = q; else break;
    return Math.min(limit, p.s + p.v * (k - p.t));
  };
}

export interface Plan {
  geom: LngLat[];
  cum: number[];                       // metres from geom[0] to each point
  target: (tSec: number) => number;    // metres along geom where the dot should be
  stops?: number[];                    // metres along geom of the stops (a dot ahead of its guess may stand at one)
  base?: { geom: LngLat[]; ds: number };   // a handoff onto `geom`: s here is s + ds there
}

/** A careful guess: the target's own, on a clock that runs slow after the fix at `at` (by LEAN once LEAN_S has
 *  passed). It passes everything the guess passes, a little later, so fewer dots run ahead of their bus. */
export function careful(target: (tSec: number) => number, at: number): (tSec: number) => number {
  return t => { const dt = t - at; return dt <= 0 ? target(t) : target(at + dt * (1 - LEAN * Math.min(1, dt / LEAN_S))); };
}

// The speed the dot wants: at the target's when on it, faster when behind (but able to brake back to
// the target's by the time it gets there), easing off to a crawl when ahead (the target catches up).
// "fix" when only a correction glide can get there (far behind).
export function chase(s: number, target: number, v: number): number | "fix" {
  const gap = target - s;
  if (gap > FAR_M) return "fix";
  if (gap >= 0) return Math.min(v + Math.min(gap / TAU_S, CATCH_MAX), v + Math.sqrt(2 * BRAKE * gap));
  const ahead = -gap, hold = Math.max(HOLD_MIN, 12 * v);
  return Math.max(CRAWL, v * Math.max(0, 1 - ahead / hold));
}

export function cumulativeLL(geom: LngLat[]): number[] {
  const out = [0];
  for (let i = 1; i < geom.length; i++) out.push(out[i - 1] + distanceM(geom[i - 1], geom[i]));
  return out;
}

export function pointAtLL(geom: LngLat[], cum: number[], s: number): LngLat {
  // The first leg of some length whose end is at or past s: a binary search for the first end at or past s, then on
  // past legs of no length (every vehicle, every frame, a route of a thousand points).
  let lo = 1, hi = geom.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] >= s) hi = mid; else lo = mid + 1; }
  for (let i = lo; i < geom.length; i++) {
    const len = cum[i] - cum[i - 1];
    if (len > 0) {
      const k = Math.max(0, s - cum[i - 1]) / len, a = geom[i - 1], b = geom[i];
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    }
  }
  return geom[geom.length - 1];
}

// The polyline from s1 to s2 (either order), in that order: the end points and the vertices between.
export function subLine(geom: LngLat[], cum: number[], s1: number, s2: number): LngLat[] {
  const end = cum[cum.length - 1];
  const lo = Math.max(0, Math.min(s1, s2, end)), hi = Math.min(end, Math.max(s1, s2, 0));
  const out = [pointAtLL(geom, cum, lo)];
  for (let i = 0; i < geom.length; i++) {
    const last = out[out.length - 1];
    if (cum[i] > lo && cum[i] < hi && (geom[i][0] !== last[0] || geom[i][1] !== last[1])) out.push(geom[i]);
  }
  const b = pointAtLL(geom, cum, hi), last = out[out.length - 1];
  if (hi > lo && (b[0] !== last[0] || b[1] !== last[1])) out.push(b);
  return s1 <= s2 ? out : out.reverse();
}

// Each polyline's legs' bearings, worked out once (a route is a thousand points, and its vehicles ask for their
// heading every frame, a bus ahead of a turn dozens of times: roadSnap.turnBlend).
const legsOf = new WeakMap<LngLat[], { bearing: number[]; at: number[] }>();
export function headingAtLL(geom: LngLat[], cum: number[], s: number): number | null {
  // The heading turns through each corner over a few metres (turn.ts), not in one jump at the vertex.
  let legs = legsOf.get(geom);
  if (!legs || legs.at[legs.at.length - 1] !== cum[geom.length - 1]) {
    const bearing: number[] = [], at: number[] = [];
    for (let i = 1; i < geom.length; i++) if (cum[i] > cum[i - 1]) { bearing.push(bearingDeg(geom[i - 1], geom[i])); at.push(cum[i - 1]); }
    at.push(cum[geom.length - 1]);
    legsOf.set(geom, (legs = { bearing, at }));
  }
  if (!legs.bearing.length) return null;
  return headingAlong(legs.bearing, legs.at, s);
}

const rad = Math.PI / 180;

// Nearest point of the polyline to p: s and metres off. With `hint`, of the legs nearly as close
// as the nearest (loops, out-and-back streets), the one whose s is closest to the hint.
export function project(geom: LngLat[], cum: number[], p: LngLat, hint?: number): { s: number; off: number } {
  // Called for every vehicle every frame: no arrays, two passes (the nearest; then, with a hint, of those within 20 m
  // of it, the one nearest the hint).
  if (geom.length < 2) return { s: 0, off: geom.length ? distanceM(p, geom[0]) : Infinity };
  const kx = Math.cos(p[1] * rad);
  const leg = (i: number, out: { s: number; off: number }) => {
    const a = geom[i - 1], b = geom[i];
    const ax = (a[0] - p[0]) * kx, ay = a[1] - p[1], dx = (b[0] - a[0]) * kx, dy = b[1] - a[1];
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
    out.s = cum[i - 1] + t * (cum[i] - cum[i - 1]); out.off = Math.hypot(ax + t * dx, ay + t * dy) * 111_320;
    return out;
  };
  const h = { s: 0, off: 0 }, best = { s: 0, off: Infinity };
  for (let i = 1; i < geom.length; i++) { leg(i, h); if (h.off < best.off) { best.s = h.s; best.off = h.off; } }
  if (hint == null) return best;
  const pick = { s: best.s, off: best.off }, lim = best.off + 20;
  for (let i = 1; i < geom.length; i++) {
    leg(i, h);
    if (h.off <= lim && Math.abs(h.s - hint) < Math.abs(pick.s - hint)) { pick.s = h.s; pick.off = h.off; }
  }
  return pick;
}

export interface Handoff { plan: Plan; s0: number; off?: LngLat; fix: boolean; back?: boolean }

export const glideS = (m: number, _back: boolean) => Math.min(GLIDE_MAX_S, GLIDE_S + Math.max(0, m) / GLIDE_M_PER_S);

// The shown point joined to the polyline at s = at: [shown, point(at), ...rest]; target shifted.
function joinAt(shown: LngLat, p: Plan, at: number): Handoff {
  const start = pointAtLL(p.geom, p.cum, at), d = distanceM(shown, start);
  const rest = p.geom.filter((_, i) => p.cum[i] > at);
  const geom = [shown, start, ...rest];
  const stops = p.stops?.filter(x => x >= at).map(x => x - at + d);
  return { plan: { geom, cum: cumulativeLL(geom), target: t => d + Math.max(0, p.target(t) - at), base: { geom: p.geom, ds: at - d }, ...(stops && { stops }) },
    s0: 0, fix: false };
}

// Hand a shown dot over to new geometry without a jump (see the design note).
export function planOnto(shown: LngLat, p: Plan, nowSec: number): Handoff {
  const now = p.target(nowSec), pr = project(p.geom, p.cum, shown, now);
  if (pr.off <= NEAR_M) {
    const q = pointAtLL(p.geom, p.cum, pr.s);
    return { plan: p, s0: pr.s, off: [shown[0] - q[0], shown[1] - q[1]], fix: false };
  }
  // Behind the start, roughly in the travel direction: drive up to it.
  if (pr.s < 1 && p.geom.length > 1) {
    const d = distanceM(shown, p.geom[0]), h = headingAtLL(p.geom, p.cum, 0);
    if (d <= FAR_M && h != null && angle(bearingDeg(shown, p.geom[0]), h) < 60) return joinAt(shown, p, 0);
  }
  const j = joinAt(shown, p, now);
  return distanceM(shown, pointAtLL(p.geom, p.cum, now)) <= JOIN_M ? j : { ...j, fix: true };
}

const smooth = (k: number) => k * k * (3 - 2 * k);
const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const angle = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

// A backend `path` ([lon, lat] here) driven at `speed` from position_at `at`, waiting at `stops`
// (metres along it, contract rev 4). With `steps` (path_speeds, rev 6) it walks those typical speeds
// instead: no stop waits. Without stops it brakes into the path's end only.
export function pathPlan(shown: LngLat, path: LngLat[], speed: number, at: number, nowSec: number, stops: number[] = [], steps?: (number | null)[] | null, own?: number | null): Handoff {
  const cum = cumulativeLL(path), end = cum[cum.length - 1];
  const f = steps && steps.length ? walk(steps, speed, end, HORIZON_S, own) : drive(speed, stops, end);
  return planOnto(shown, { geom: path, cum, target: careful(t => f(t - at), at), stops }, nowSec);
}

// No geometry: glide straight to a fixed point. With a bearing, a point well behind is a correction.
export function linePlan(shown: LngLat, to: LngLat, bearing: number | null): Handoff {
  const d = distanceM(shown, to);
  const behind = bearing != null && d > NOISE_M && angle(bearingDeg(shown, to), bearing) > BEHIND_DEG;
  const geom = [shown, to];
  return { plan: { geom, cum: [0, d], target: () => d }, s0: 0, fix: behind || d > FAR_M, back: behind };
}

// A handoff that starts with a straight leg from the shown point (no path, another route, a path
// that does not pass the dot) goes along the route the dot is on instead, when the leg's end lies
// on it: back to it as a correction, or on round the bend. Else the handoff as it is.
export function bridge(mv: Mover, h: Handoff): Handoff {
  const old = mv.plan, g = h.plan.geom;
  if (!old || h.s0 !== 0 || g.length < 2) return h;
  const dist0 = distanceM(g[0], g[1]);
  if (dist0 <= NEAR_M) return h;
  const q = project(old.geom, old.cum, g[1], mv.s);
  if (q.off > NEAR_M || Math.abs(q.s - mv.s) <= NEAR_M) return h;
  const way = subLine(old.geom, old.cum, mv.s, q.s);
  way[0] = mv.pos;   // the shown point, with any fading offset
  if (distanceM(way[way.length - 1], g[1]) >= 1) way.push(g[1]);
  const geom = [...way, ...g.slice(2)], cum = cumulativeLL(geom), L = cum[way.length - 1];
  const back = q.s < mv.s, t = h.plan.target, base = h.plan.base, stops = h.plan.stops?.map(x => x + L - dist0).filter(x => x >= 0);
  return { plan: { geom, cum, target: s => Math.max(0, L + t(s) - dist0), ...(base && { base: { geom: base.geom, ds: base.ds + dist0 - L } }), ...(stops && { stops }) },
    s0: 0, fix: back || h.fix, back };
}

// One moving dot. step() is called each frame with the server time.
export class Mover {
  plan: Plan | null = null;
  s = 0;
  pos: LngLat;
  u = 0;   // the dot's own speed, m/s: it changes at ACC and BRAKE, never in a jump
  private off: LngLat | null = null;
  private offAt = 0;
  private offDur = OFF_S;
  // from: s on the plan where this glide leg starts; tail: where the trail starts (the first leg's from); dur: its length
  private glide: { t0: number; from: number; tail: number; dur: number } | null = null;
  private trail: { geom: LngLat[]; end: number } | null = null; // after a glide, fading until `end`
  // A fade over to the guess: out where the dot was (`from`) in the first half, in at the guess after.
  private fade: { t0: number; from: LngLat; landed: boolean } | null = null;
  // A new place behind the dot, waited for: taken up when it passes under the dot on the way it is on.
  private pending: { plan: Plan; since: number; standSince: number | null } | null = null;
  private last = -Infinity;
  private snapPending = false;
  private aheadSince: number | null = null;
  private standSince: number | null = null;   // ahead of a guess that stands, since
  private stood: { at: number; s: number } | null = null;   // standing at a stop ahead of the guess, since
  reduced = false;   // prefers-reduced-motion: no animation, always at the target
  cap: number | null = null;   // do not move forward past this s (the vehicle ahead on the line)

  constructor(pos: LngLat) { this.pos = pos; }

  // The next step jumps to the target without an effect (e.g. the tab was hidden).
  snap() { this.snapPending = true; }

  // A new target on the same geometry: keep the shown s, a fading offset and a running wait. A
  // running glide goes on from where the dot is, to the new target, with the same trail.
  retarget(plan: Plan, nowSec: number) {
    this.plan = plan;
    this.pending = null;
    if (this.glide) this.glide = { ...this.glide, t0: nowSec, from: this.s };
  }

  // A correction glide, its trail, a fade or a wait for a place behind is on.
  get fixing() { return this.glide != null || this.trail != null || this.fade != null || this.pending != null; }

  // New geometry. A correction ahead (re)starts the glide at s0, where the dot is (handoffs put the
  // shown point at s0); a place behind (`back`) is waited for on the way the dot is on; otherwise
  // a running glide ends here and its trail fades.
  setPlan(plan: Plan, s0: number, nowSec: number, off?: LngLat, fix = false, back = false) {
    const old = this.plan;
    if (fix && back && old) {
      if (this.fade) { this.plan = plan; this.pending = null; return; }   // fading already: it lands at the new place
      this.pending = { plan, since: nowSec, standSince: null };
      return;
    }
    if (this.glide && old) this.endGlide(old, nowSec);
    this.plan = plan;
    this.pending = null;
    this.aheadSince = this.standSince = null;
    this.stood = null;
    if (!old) this.u = Math.max(0, plan.target(nowSec + 1) - plan.target(nowSec));   // first seen: already under way
    if (fix) { this.s = s0; this.off = null; this.startFix(nowSec); }   // s0 is the shown point, offset included
    else {
      this.s = s0;
      this.setOff(off, nowSec);
    }
    if (this.last === -Infinity) this.last = nowSec;
  }

  apply(h: Handoff, nowSec: number) { this.setPlan(h.plan, h.s0, nowSec, h.off, h.fix, h.back); }

  private setOff(off: LngLat | undefined, nowSec: number) {
    this.off = off && (off[0] || off[1]) ? off : null;
    this.offAt = nowSec;
    // smoothstep's steepest slope is 1.5 / duration
    if (this.off) this.offDur = Math.max(OFF_S, (1.5 * distanceM(this.pos, [this.pos[0] - this.off[0], this.pos[1] - this.off[1]])) / OFF_V);
  }

  // A running fading offset goes on fading: the dot does not jump when the glide starts.
  private startFix(nowSec: number) {
    const p = this.plan!, m = Math.abs(p.target(nowSec) - this.s);
    if (m > LEAP_M) { this.s = p.target(nowSec); this.glide = this.trail = null; return; }
    this.glide = { t0: nowSec, from: this.s, tail: this.s, dur: glideS(m, false) };
    this.trail = null;
  }

  // The glide so far becomes a fading trail.
  private endGlide(p: Plan, nowSec: number) {
    this.trail = { geom: subLine(p.geom, p.cum, this.glide!.tail, this.s), end: nowSec + TRAIL_S };
    this.glide = null;
  }

  private startFade(nowSec: number) {
    this.fade = { t0: nowSec, from: this.pos, landed: false };
    this.glide = this.trail = this.off = null;
    this.aheadSince = this.standSince = null;
    this.stood = null;
  }

  // The place waited for: taken up when it has come under the dot (on its way, not behind it any
  // more); given up for a fade when it is too long coming, too far, or the dot's way has run out.
  private resolvePending(nowSec: number) {
    const pd = this.pending!, p = this.plan!;
    const tp = pd.plan.target(nowSec), tpos = pointAtLL(pd.plan.geom, pd.plan.cum, tp);
    const q = project(p.geom, p.cum, tpos, this.s);
    if (q.off <= NEAR_M && q.s >= this.s - 2) {
      this.plan = pd.plan; this.pending = null; this.aheadSince = this.standSince = null; this.stood = null;
      this.s = tp;
      this.setOff([this.pos[0] - tpos[0], this.pos[1] - tpos[1]], nowSec);
      return;
    }
    // Standing, or at the end of its way: it is not coming.
    const still = pd.plan.target(nowSec + 1) - tp < 0.1 || tp >= pd.plan.cum[pd.plan.cum.length - 1] - 1;
    pd.standSince = still ? pd.standSince ?? nowSec : null;
    const end = p.cum[p.cum.length - 1];
    if (nowSec - pd.since > WAIT_MAX || (pd.standSince != null && nowSec - pd.standSince > PENDING_STAND_S)
      || distanceM(this.pos, tpos) > AHEAD_MAX || this.s >= end - 1) {
      this.plan = pd.plan; this.pending = null;
      this.startFade(nowSec);
    }
  }

  // The stop just ahead (it brakes into it and stands there once).
  private stopAhead(p: Plan): number | null {
    let best: number | null = null;
    for (const x of p.stops ?? []) if (x >= this.s - 1 && x <= this.s + STOP_LOOK && (best == null || x < best)) best = x;
    return best;
  }

  // fx: the correction glide's phase (0..1), or null. trail: the route it has covered, while shown.
  // alpha: how much of the dot to draw (under 1 only during a fade).
  step(nowSec: number): { pos: LngLat; fx: number | null; trail: { geom: LngLat[]; alpha: number } | null; alpha: number } {
    const dt = nowSec - this.last;
    this.last = nowSec;
    if (this.pending && this.plan && dt <= SNAP_S && dt >= 0) this.resolvePending(nowSec);
    const p = this.plan;
    if (!p) return { pos: this.pos, fx: null, trail: null, alpha: 1 };
    const target = p.target(nowSec), s0 = this.s;
    const v = Math.max(0, p.target(nowSec + 1) - target);
    // Held behind the vehicle ahead (spacing): never forward past the cap, never backwards for it.
    const held = (x: number) => (this.cap != null && x > s0 && x > this.cap ? Math.max(s0, this.cap) : x);
    let fx: number | null = null, alpha = 1;
    if (dt > SNAP_S || dt < 0 || this.reduced || this.snapPending) {
      this.snapPending = false;
      if (this.pending) { this.plan = this.pending.plan; this.pending = null; }
      this.s = this.plan!.target(nowSec);
      this.u = Math.max(0, this.plan!.target(nowSec + 1) - this.s);
      this.off = this.glide = this.trail = this.fade = null;
      this.aheadSince = this.standSince = null; this.stood = null;
    } else if (this.fade) {
      const k = (nowSec - this.fade.t0) / FADE_S;
      if (k >= 0.5 && !this.fade.landed) { this.fade.landed = true; this.off = null; this.u = v; }
      if (this.fade.landed) this.s = target;
      if (k >= 1) this.fade = null; else alpha = Math.pow(Math.abs(1 - 2 * Math.max(0, k)), 1.5);
    } else if (this.glide) {
      const k = (nowSec - this.glide.t0) / this.glide.dur;
      if (k >= 1) { this.s = held(target); this.u = v; this.endGlide(p, nowSec); }
      else { fx = Math.max(0, k); this.s = this.glide.from + (target - this.glide.from) * easeInOut(fx); }
    } else {
      const gap = target - this.s, r = chase(this.s, target, v);
      if (r === "fix") { this.startFix(nowSec); fx = this.glide ? 0 : null; }
      else {
        let want = r;
        if (this.pending) want = CRAWL;   // waiting for a place behind: it rolls on slowly
        else if (gap < -AHEAD_MIN) {
          this.aheadSince ??= nowSec;
          this.standSince = v < 0.1 ? this.standSince ?? nowSec : null;
          // A stop just ahead: it brakes into it and stands there a while (boarding), then rolls on.
          const stop = this.stopAhead(p);
          if (stop != null) {
            const d = stop - this.s;
            if (d < 1) { this.stood ??= { at: nowSec, s: stop }; if (nowSec - this.stood.at < STOP_HOLD_S) want = 0; }
            else want = Math.min(want, Math.sqrt(2 * BRAKE * d));
          }
          if (-gap > AHEAD_MAX || nowSec - this.aheadSince > WAIT_MAX || (this.standSince != null && nowSec - this.standSince > WAIT_STAND_S)) { this.startFade(nowSec); want = this.u; }
        } else if (gap >= 0) { this.aheadSince = this.standSince = null; if (this.stood && this.s - this.stood.s > 1) this.stood = null; }
        this.u = Math.max(0, this.u + Math.max(-BRAKE * dt, Math.min(ACC * dt, want - this.u)));
        let s = this.s + this.u * dt;
        if (gap >= 0 && s > target) s = target;   // caught up: on its guess, not past it
        this.s = s;
      }
    }
    const before = this.s;
    this.s = held(this.s);
    if (this.s < before && dt > 0) this.u = Math.min(this.u, Math.max(0, (this.s - s0) / dt));
    let pos = this.fade && !this.fade.landed ? this.fade.from : pointAtLL(p.geom, p.cum, this.s);
    if (this.off) {
      const k = (nowSec - this.offAt) / this.offDur;
      if (k >= 1) this.off = null;
      else { const w = 1 - smooth(Math.max(0, k)); pos = [pos[0] + this.off[0] * w, pos[1] + this.off[1] * w]; }
    }
    let trail: { geom: LngLat[]; alpha: number } | null = null;
    if (this.glide) trail = { geom: subLine(p.geom, p.cum, this.glide.tail, this.s), alpha: 1 };
    else if (this.trail) {
      const left = this.trail.end - nowSec;
      if (left <= 0) this.trail = null;
      else trail = { geom: this.trail.geom, alpha: Math.min(1, left / TRAIL_S) };
    }
    this.pos = pos;
    return { pos, fx, trail, alpha };
  }

  // Where the target is now (culling: a dot off screen whose target is on screen must be stepped).
  targetPos(nowSec: number): LngLat | null {
    return this.plan ? pointAtLL(this.plan.geom, this.plan.cum, this.plan.target(nowSec)) : null;
  }

  heading(): number | null {
    return this.plan && this.plan.geom.length > 1 ? headingAtLL(this.plan.geom, this.plan.cum, this.s) : null;
  }
}
