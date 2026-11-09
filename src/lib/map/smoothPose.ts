// The last step before a vehicle's model is drawn (scene3d.place): where it is drawn follows where it should be as a
// heavy vehicle would, never hopping. Each frame's place is worked out afresh (projected from its line's shape onto
// the painted route, or onto the road running its way, in its lane), and at a vertex, a fork or a lane's edge that
// moves it by a metre or two in one frame. Riding behind it (the chase) the camera moved with it and that was not
// seen; with the camera still, it was. Here it is followed by a critically damped spring that is told the speed the
// place is moving at (so it does not lag behind at a steady speed), and the model leans a little the way it moves
// (a lane change is a slight turn, not a slide sideways).

const W = 5;            // the spring's stiffness, 1/s: a hop is closed over about half a second
const TV = 0.25;        // the speed it is told: how the place moved over about this many seconds
const V_MAX = 25;       // m/s: a frame's step faster than this is a hop, not speed
const SNAP_M = 25;      // further than this from where it is drawn: a new place (a fix, a fade over), not smoothed
const STALE_S = 0.5;    // not drawn for this long: it starts again where it is
const LEAN_V = 2;       // m/s: slower than this it faces as its route does
const LEAN_MAX = 15;    // degrees it turns towards the way it moves, at most

type State = { x: number; y: number; vx: number; vy: number; ex: number; ey: number; rx: number; ry: number; at: number };

const wrap = (d: number) => ((d + 540) % 360) - 180;

export class PoseSmoother {
  private s = new Map<string, State>();

  /** Where to draw `key`, given where it should be (x, y metres east and north of any fixed point) at `t` seconds. */
  step(key: string, x: number, y: number, heading: number | null, t: number): { x: number; y: number; heading: number | null } {
    const o = this.s.get(key);
    const dt = o ? t - o.at : 0;
    if (!o || dt > STALE_S || dt < 0 || Math.hypot(x - o.x, y - o.y) > SNAP_M) {
      this.s.set(key, { x, y, vx: 0, vy: 0, ex: 0, ey: 0, rx: x, ry: y, at: t });
      return { x, y, heading };
    }
    if (dt === 0) return { x: o.x, y: o.y, heading };
    const h = Math.min(dt, 0.1);
    // The speed of the place itself, a hop left out.
    let rvx = (x - o.rx) / dt, rvy = (y - o.ry) / dt;
    const rv = Math.hypot(rvx, rvy);
    if (rv > V_MAX) { rvx *= V_MAX / rv; rvy *= V_MAX / rv; }
    const k = 1 - Math.exp(-dt / TV);
    o.ex += (rvx - o.ex) * k; o.ey += (rvy - o.ey) * k;
    // The spring: towards the place, at its speed.
    o.vx += (W * W * (x - o.x) + 2 * W * (o.ex - o.vx)) * h;
    o.vy += (W * W * (y - o.y) + 2 * W * (o.ey - o.vy)) * h;
    o.x += o.vx * dt; o.y += o.vy * dt;
    o.rx = x; o.ry = y; o.at = t;
    const v = Math.hypot(o.vx, o.vy);
    if (heading != null && v > LEAN_V) {
      const d = wrap((Math.atan2(o.vx, o.vy) * 180) / Math.PI - heading);
      if (Math.abs(d) < 60) heading = (heading + Math.max(-LEAN_MAX, Math.min(LEAN_MAX, d)) + 360) % 360;
    }
    return { x: o.x, y: o.y, heading };
  }

  drop(key: string) { this.s.delete(key); }
  get size() { return this.s.size; }
  keep(keys: Iterable<string>) { const k = new Set(keys); for (const key of this.s.keys()) if (!k.has(key)) this.s.delete(key); }
}
