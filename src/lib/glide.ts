// Vehicles glide to a new position instead of jumping (upstream: 1.5 s ease-out).

export type LngLat = [number, number];

export const GLIDE_MS = 1500;
export const JUMP_M = 1000;   // longer moves (new trip, GPS glitch) are not animated

export const ease = (k: number) => k * (2 - k);

export const interpolate = (a: LngLat, b: LngLat, k: number): LngLat => {
  const e = ease(Math.min(1, Math.max(0, k)));
  return [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e];
};

export function distanceM(a: LngLat, b: LngLat): number {
  const rad = Math.PI / 180, R = 6_371_000;
  const dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const shouldJump = (a: LngLat, b: LngLat) => (a[0] === b[0] && a[1] === b[1]) || distanceM(a, b) > JUMP_M;

const reducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// Drives one marker. apply() is called with each intermediate position.
export class Glider {
  private frame = 0;
  busy = false;
  constructor(public pos: LngLat, private apply: (p: LngLat) => void) {
    apply(pos);
  }

  to(target: LngLat) {
    this.cancel();
    const from = this.pos;
    if (shouldJump(from, target) || reducedMotion() || document.hidden) {
      this.pos = target;
      this.apply(target);
      return;
    }
    const t0 = performance.now();
    this.busy = true;
    const step = (t: number) => {
      const k = (t - t0) / GLIDE_MS;
      this.pos = k >= 1 ? target : interpolate(from, target, k);
      this.apply(this.pos);
      if (k < 1) this.frame = requestAnimationFrame(step);
      else this.busy = false;
    };
    this.frame = requestAnimationFrame(step);
  }

  cancel() {
    cancelAnimationFrame(this.frame);
    this.busy = false;
  }
}

// Animates one number (a distance along a route) so a marker can follow the route's bends.
export class ScalarGlider {
  private frame = 0;
  busy = false;
  correcting = false;   // an eased (non-linear) animation is running
  constructor(public value: number, private apply: (v: number) => void) {}

  to(target: number, ms: number, linear = false) {
    this.cancel();
    const from = this.value;
    if (from === target || reducedMotion() || document.hidden) {
      this.value = target;
      this.apply(target);
      return;
    }
    const t0 = performance.now();
    this.busy = true;
    this.correcting = !linear;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      this.value = from + (target - from) * (linear ? k : ease(k));
      this.apply(this.value);
      if (k < 1) this.frame = requestAnimationFrame(step);
      else this.busy = this.correcting = false;
    };
    this.frame = requestAnimationFrame(step);
  }

  cancel() {
    cancelAnimationFrame(this.frame);
    this.busy = this.correcting = false;
  }
}
