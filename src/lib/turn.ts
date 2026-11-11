// Smooth headings for every vehicle drawn: along its path (the heading turns through a corner over a few metres, not
// in one jump at the vertex) and over time (what is drawn turns toward the heading it should have, so a new fix or a
// new leg never snaps the pictogram, the pointer or the 3D model round). Pure: no map, no DOM.

/** Metres each side of a corner over which the heading turns from one leg's bearing to the next's. */
export const BLEND_M = 12;

/** The signed shortest turn from `a` to `b` (degrees, −180..180). */
export function turnBetween(a: number, b: number): number {
  return ((b - a + 540) % 360) - 180;
}

/** `k` of the way from bearing `a` to `b`, the short way round. */
export function mixBearing(a: number, b: number, k: number): number {
  return (a + turnBetween(a, b) * k + 360) % 360;
}

/** The heading `s` metres along a path whose legs have the bearings `bearing[i]` (leg i runs from `cum[i]` to
 *  `cum[i + 1]`): the leg's own, blended into the next (or the last) leg's within BLEND_M of the corner. */
export function headingAlong(bearing: number[], cum: number[], s: number, blend = BLEND_M): number | null {
  const n = bearing.length;
  if (!n) return null;
  // The leg s is on: the first whose end is at or past s (a binary search: called for every vehicle every frame).
  let lo = 0, hi = n - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid + 1] < s) lo = mid + 1; else hi = mid; }
  const i = lo;
  let h = bearing[i];
  const toEnd = cum[i + 1] - s, fromStart = s - cum[i];
  // Each corner's window is at most half of either leg beside it: two windows never overlap on a short leg.
  const leg = (j: number) => cum[j + 1] - cum[j];
  const bEnd = i < n - 1 ? Math.min(blend, leg(i) / 2, leg(i + 1) / 2) : 0;
  const bStart = i > 0 ? Math.min(blend, leg(i - 1) / 2, leg(i) / 2) : 0;
  if (bEnd > 0 && toEnd < bEnd) h = mixBearing(h, bearing[i + 1], 0.5 * (1 - toEnd / bEnd));
  else if (bStart > 0 && fromStart < bStart) h = mixBearing(bearing[i - 1], h, 0.5 + 0.5 * (fromStart / bStart));
  return h;
}

/** What is drawn turns toward the heading it should have: most of the way in `tau` seconds, and never faster than
 *  `maxRate` degrees a second (a vehicle, not a compass needle). A first heading, or one after none, is taken as is. */
export class Turner {
  h: number | null = null;
  private t = 0;
  toward(target: number | null, now: number, tau = 0.25, maxRate = 300): number | null {
    if (target == null) { this.h = null; return null; }
    // A first heading, or one after a long gap (off screen, the tab hidden): taken as is, not turned to from a stale one.
    if (this.h == null || now - this.t > 2) { this.h = target; this.t = now; return target; }
    if (!(now > this.t)) return this.h;
    const dt = Math.min(1, now - this.t);
    this.t = now;
    const d = turnBetween(this.h, target), k = 1 - Math.exp(-dt / tau);
    const step = Math.sign(d) * Math.min(Math.abs(d) * k, maxRate * dt);
    this.h = (this.h + step + 360) % 360;
    if (Math.abs(turnBetween(this.h, target)) < 0.3) this.h = target;
    return this.h;
  }
}

/** One Turner per vehicle, dropped with it. */
export class Turners {
  private m = new Map<string, Turner>();
  /** Set when a heading given out this round is still on its way to its target (the loop keeps a fast pace). */
  busy = false;
  toward(key: string, target: number | null, now: number): number | null {
    let t = this.m.get(key);
    if (!t) { t = new Turner(); this.m.set(key, t); }
    const h = t.toward(target, now);
    if (h != null && target != null && Math.abs(turnBetween(h, target)) > 0.3) this.busy = true;
    return h;
  }
  keep(keys: Iterable<string>) {
    const k = new Set(keys);
    for (const key of this.m.keys()) if (!k.has(key)) this.m.delete(key);
  }
  drop(key: string) { this.m.delete(key); }
  get size() { return this.m.size; }
}
