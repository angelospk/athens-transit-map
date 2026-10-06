// Natural motion for every moving dot (docs/superpowers/specs/2026-10-06-natural-motion-locate-design.md).
// The shown position chases a target along a polyline: faster when late, slower when early, never
// backwards. A target far behind (or very far ahead) gets a "correction" instead: a fast glide
// along the route to it, leaving a trail that fades.
// Geometry here is [lon, lat]; times are server seconds.

import { distanceM, type LngLat } from "./glide";
import { bearingDeg } from "./heading";

export const TAU_S = 2.5;      // a gap closes with this time constant...
export const CATCH_MAX = 10;   // ...at most this much faster than the target (m/s)
export const FAR_M = 600;      // farther ahead: correction, not a race
export const GLIDE_S = 1.2;    // correction glide length
export const TRAIL_S = 0.8;    // its trail fades out over this, after the glide
const OFF_S = 1.2;             // sideways offsets fade out over at least this...
const OFF_V = 5;               // ...and at most this fast (m/s at the steepest point)
const SNAP_S = 3;              // longer between steps (hidden tab, off screen): just snap
const NEAR_M = 30;             // a shown point this close to new geometry continues on it
const JOIN_M = 40;             // otherwise, at most this far it glides there
const BEHIND_DEG = 110;        // a fix this far off the travel bearing is behind
const NOISE_M = 25;            // shorter backward moves are GPS noise
const WAIT_S = 6;              // a dot ahead of a standing target waits this long, then is corrected
const WAIT_M = 8;              // (closer than this it just stays)

// Metres driven dt seconds after a fix at speed v, guessed short: the speed fades with a 60 s time
// constant (buses slow down and stop; a late correction forwards looks better than one backwards).
export const DECAY_S = 60;
export const MAX_AHEAD_S = 150;
export const aheadM = (v: number, dt: number) =>
  v * DECAY_S * (1 - Math.exp(-Math.min(Math.max(dt, 0), MAX_AHEAD_S) / DECAY_S));

export interface Plan {
  geom: LngLat[];
  cum: number[];                       // metres from geom[0] to each point
  target: (tSec: number) => number;    // metres along geom where the dot should be
}

export const holdM = (v: number) => Math.min(80, Math.max(25, 8 * v));

// One step of the chase: the new shown s, or "fix" when only a correction can get there.
export function chase(s: number, target: number, v: number, dt: number): number | "fix" {
  const gap = target - s;
  if (gap > FAR_M) return "fix";
  if (gap >= 0) return s + Math.min(gap, (v + Math.min(gap / TAU_S, CATCH_MAX)) * dt);
  const ahead = -gap, hold = holdM(v);
  if (ahead > hold) return "fix";
  return s + v * Math.max(0, 1 - ahead / hold) * dt;   // let the target catch up
}

export function cumulativeLL(geom: LngLat[]): number[] {
  const out = [0];
  for (let i = 1; i < geom.length; i++) out.push(out[i - 1] + distanceM(geom[i - 1], geom[i]));
  return out;
}

export function pointAtLL(geom: LngLat[], cum: number[], s: number): LngLat {
  for (let i = 1; i < geom.length; i++) {
    const len = cum[i] - cum[i - 1];
    if (len > 0 && cum[i] >= s) {
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

export function headingAtLL(geom: LngLat[], cum: number[], s: number): number | null {
  for (let i = 1; i < geom.length; i++)
    if (cum[i] > cum[i - 1] && (cum[i] >= s || i === geom.length - 1)) return bearingDeg(geom[i - 1], geom[i]);
  return null;
}

const rad = Math.PI / 180;

// Nearest point of the polyline to p: s and metres off. With `hint`, of the legs nearly as close
// as the nearest (loops, out-and-back streets), the one whose s is closest to the hint.
export function project(geom: LngLat[], cum: number[], p: LngLat, hint?: number): { s: number; off: number } {
  const kx = Math.cos(p[1] * rad), hits: { s: number; off: number }[] = [];
  for (let i = 1; i < geom.length; i++) {
    const a = geom[i - 1], b = geom[i];
    const ax = (a[0] - p[0]) * kx, ay = a[1] - p[1], dx = (b[0] - a[0]) * kx, dy = b[1] - a[1];
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
    hits.push({ s: cum[i - 1] + t * (cum[i] - cum[i - 1]), off: Math.hypot(ax + t * dx, ay + t * dy) * 111_320 });
  }
  if (!hits.length) return { s: 0, off: geom.length ? distanceM(p, geom[0]) : Infinity };
  const min = Math.min(...hits.map(h => h.off));
  const near = hits.filter(h => h.off <= min + 20);
  return hint == null ? hits.find(h => h.off === min)! : near.reduce((b, h) => (Math.abs(h.s - hint) < Math.abs(b.s - hint) ? h : b));
}

export interface Handoff { plan: Plan; s0: number; off?: LngLat; fix: boolean }

// The shown point joined to the polyline at s = at: [shown, point(at), ...rest]; target shifted.
function joinAt(shown: LngLat, p: Plan, at: number): Handoff {
  const start = pointAtLL(p.geom, p.cum, at), d = distanceM(shown, start);
  const rest = p.geom.filter((_, i) => p.cum[i] > at);
  const geom = [shown, start, ...rest];
  return { plan: { geom, cum: cumulativeLL(geom), target: t => d + Math.max(0, p.target(t) - at) }, s0: 0, fix: false };
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

// A backend `path` ([lon, lat] here) driven at `speed` from position_at `at`.
export function pathPlan(shown: LngLat, path: LngLat[], speed: number, at: number, nowSec: number): Handoff {
  const cum = cumulativeLL(path), end = cum[cum.length - 1];
  return planOnto(shown, { geom: path, cum, target: t => Math.min(end, aheadM(speed, t - at)) }, nowSec);
}

// No geometry: glide straight to a fixed point. With a bearing, a point well behind is a correction.
export function linePlan(shown: LngLat, to: LngLat, bearing: number | null): Handoff {
  const d = distanceM(shown, to);
  const behind = bearing != null && d > NOISE_M && angle(bearingDeg(shown, to), bearing) > BEHIND_DEG;
  const geom = [shown, to];
  return { plan: { geom, cum: [0, d], target: () => d }, s0: 0, fix: behind || d > FAR_M };
}

// One moving dot. step() is called each frame with the server time.
export class Mover {
  plan: Plan | null = null;
  s = 0;
  pos: LngLat;
  private off: LngLat | null = null;
  private offAt = 0;
  private offDur = OFF_S;
  // from: s on the plan where this glide leg starts; tail: where the trail starts (the first leg's from)
  private glide: { t0: number; from: number; tail: number } | null = null;
  private trail: { geom: LngLat[]; end: number } | null = null; // after a glide, fading until `end`
  private last = -Infinity;
  private snapPending = false;
  private aheadSince: number | null = null;
  reduced = false;   // prefers-reduced-motion: no animation, always at the target

  constructor(pos: LngLat) { this.pos = pos; }

  // The next step jumps to the target without an effect (e.g. the tab was hidden).
  snap() { this.snapPending = true; }

  // A new target on the same geometry: keep the shown s, a fading offset and a running wait. A
  // running glide goes on from where the dot is, to the new target, with the same trail.
  retarget(plan: Plan, nowSec: number) {
    this.plan = plan;
    if (this.glide) this.glide = { t0: nowSec, from: this.s, tail: this.glide.tail };
  }

  // A correction glide or its trail is on screen.
  get fixing() { return this.glide != null || this.trail != null; }

  // New geometry. A correction (re)starts the glide at s0, where the dot is (handoffs put the shown
  // point at s0); otherwise a running glide ends here and its trail fades.
  setPlan(plan: Plan, s0: number, nowSec: number, off?: LngLat, fix = false) {
    const old = this.plan;
    if (this.glide && old) this.endGlide(old, nowSec);
    this.plan = plan;
    this.aheadSince = null;
    if (fix) { this.s = s0; this.off = null; this.startFix(nowSec); }   // s0 is the shown point, offset included
    else {
      this.s = s0;
      this.off = off && (off[0] || off[1]) ? off : null;
      this.offAt = nowSec;
      // smoothstep's steepest slope is 1.5 / duration
      if (this.off) this.offDur = Math.max(OFF_S, (1.5 * distanceM(this.pos, [this.pos[0] - this.off[0], this.pos[1] - this.off[1]])) / OFF_V);
    }
    if (this.last === -Infinity) this.last = nowSec;
  }

  apply(h: Handoff, nowSec: number) { this.setPlan(h.plan, h.s0, nowSec, h.off, h.fix); }

  // A running fading offset goes on fading: the dot does not jump when the glide starts.
  private startFix(nowSec: number) {
    this.glide = { t0: nowSec, from: this.s, tail: this.s };
    this.trail = null;
  }

  // The glide so far becomes a fading trail.
  private endGlide(p: Plan, nowSec: number) {
    this.trail = { geom: subLine(p.geom, p.cum, this.glide!.tail, this.s), end: nowSec + TRAIL_S };
    this.glide = null;
  }

  // fx: the correction glide's phase (0..1), or null. trail: the route it has covered, while shown.
  step(nowSec: number): { pos: LngLat; fx: number | null; trail: { geom: LngLat[]; alpha: number } | null } {
    const p = this.plan;
    const dt = nowSec - this.last;
    this.last = nowSec;
    if (!p) return { pos: this.pos, fx: null, trail: null };
    const target = p.target(nowSec);
    let fx: number | null = null;
    if (dt > SNAP_S || dt < 0 || this.reduced || this.snapPending) {
      this.snapPending = false;
      this.s = target;
      this.off = this.glide = this.trail = null;
    } else if (this.glide) {
      const k = (nowSec - this.glide.t0) / GLIDE_S;
      if (k >= 1) { this.s = target; this.endGlide(p, nowSec); }
      else { fx = Math.max(0, k); this.s = this.glide.from + (target - this.glide.from) * easeInOut(fx); }
    } else {
      const v = Math.max(0, p.target(nowSec + 1) - target);
      const r = chase(this.s, target, v, dt);
      // Ahead of a target that stands: wait a little, then correct (it is not coming).
      const waiting = r !== "fix" && v < 0.1 && this.s - target > WAIT_M;
      this.aheadSince = waiting ? this.aheadSince ?? nowSec : null;
      if (r === "fix" || (waiting && nowSec - this.aheadSince! > WAIT_S)) { this.startFix(nowSec); fx = 0; }
      else this.s = r;
    }
    let pos = pointAtLL(p.geom, p.cum, this.s);
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
    return { pos, fx, trail };
  }

  // Where the target is now (culling: a dot off screen whose target is on screen must be stepped).
  targetPos(nowSec: number): LngLat | null {
    return this.plan ? pointAtLL(this.plan.geom, this.plan.cum, this.plan.target(nowSec)) : null;
  }

  heading(): number | null {
    return this.plan && this.plan.geom.length > 1 ? headingAtLL(this.plan.geom, this.plan.cum, this.s) : null;
  }
}
