// The last step before a vehicle's model is drawn (scene3d.place): where it is drawn follows where it should be as a
// bus drives, never hopping and never sliding. Each frame's place is worked out afresh (projected from its line's
// shape onto the painted route, or onto the road running its way, in its lane), and at a vertex, a fork or a lane's
// edge that moves it by a metre or two in one frame. Riding behind it (the chase) the camera moved with it and that
// was not seen; with the camera still, it was.
// Along its way it follows a critically damped spring told the speed the place moves at (so it does not lag behind
// at a steady speed). Sideways (a lane change, a place a metre off) it moves only as a bus can: at most SLOPE metres
// for each metre it drives on, so crawling it changes lanes slowly and standing it does not (but for a slow CREEP).
// Its heading is a bus's (2026-11-09): the front axle, FRONT_M ahead of the drawn point, is steered toward its way,
// no sharper than a bus can turn (TURN_PER_M degrees a metre driven: never on the spot); the rear axle is dragged
// after it, WHEELBASE back, never sideways (a tractrix); the bus points from its rear axle to its front one. So it
// starts to turn as its front reaches the corner, its rear cuts in, and it straightens after; a lane change steers
// out and back; standing, it does not turn at all. Only the heading comes of this: where it is drawn is the place,
// smoothed as above.

const W = 5;            // the spring along its way, 1/s: a hop is closed over about half a second
const TV = 0.25;        // the speed it is told: how the place moved over about this many seconds
const V_MAX = 25;       // m/s: a frame's step faster than this is a hop, not speed
const SNAP_M = 25;      // further than this from where it is drawn: a new place (a fix, a fade over), not smoothed
const STALE_S = 0.5;    // not drawn for this long: it starts again where it is
const SLOPE = 0.2;      // sideways, metres for each metre on (about 11°)
const SIDE_TAU = 0.6;   // s: how quickly it closes a gap sideways, within SLOPE
const CREEP = 0.12;     // m/s sideways standing (a place moved while it stands: it gets there, unseen)
export const REAR_M = 3.4;   // the rear axle behind the model's middle (buildBus: 2.6 m, drawn 1.3 times larger)
export const FRONT_M = 4.3;  // the front axle ahead of it (buildBus: 3.3 m)
const WHEELBASE = REAR_M + FRONT_M;
const TURN_PER_M = 11;       // degrees its front wheels turn it for each metre it drives (the route's corners are tight: slower, and it
//                              lagged through every turn)
const BODY_PER_M = 12;       // and the body at most this
const ASTRAY_DEG = 150; // a heading this far from its way's: it has been put somewhere new facing the other way

type State = { x: number; y: number; v: number; ex: number; ey: number; rx: number; ry: number; at: number; h: number | null;
  ax: number; ay: number; hd: number | null; fh: number | null };   // ax, ay: the rear axle; hd: the heading drawn; fh: the front wheels' way

const unit = (h: number): [number, number] => [Math.sin((h * Math.PI) / 180), Math.cos((h * Math.PI) / 180)];
const bearing = (dx: number, dy: number) => ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
const off = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

export class PoseSmoother {
  private s = new Map<string, State>();

  private start(key: string, x: number, y: number, heading: number | null, t: number) {
    const [fx, fy] = heading == null ? [0, 0] : unit(heading);
    this.s.set(key, { x, y, v: 0, ex: 0, ey: 0, rx: x, ry: y, at: t, h: heading, ax: x - fx * REAR_M, ay: y - fy * REAR_M, hd: heading, fh: heading });
  }

  /** Where to draw `key`, given where it should be (x, y metres east and north of any fixed point) and its way
   *  (degrees clockwise from north, or null) at `t` seconds. */
  step(key: string, x: number, y: number, heading: number | null, t: number): { x: number; y: number; heading: number | null } {
    const o = this.s.get(key);
    const dt = o ? t - o.at : 0;
    if (!o || dt > STALE_S || dt < 0 || Math.hypot(x - o.x, y - o.y) > SNAP_M) {
      this.start(key, x, y, heading, t);
      return { x, y, heading };
    }
    if (dt === 0) return { x: o.x, y: o.y, heading: heading == null ? null : o.hd ?? heading };
    const h = heading ?? o.h;
    // The speed of the place itself, a hop left out.
    let rvx = (x - o.rx) / dt, rvy = (y - o.ry) / dt;
    const rv = Math.hypot(rvx, rvy);
    if (rv > V_MAX) { rvx *= V_MAX / rv; rvy *= V_MAX / rv; }
    const k = 1 - Math.exp(-dt / TV);
    o.ex += (rvx - o.ex) * k; o.ey += (rvy - o.ey) * k;
    o.rx = x; o.ry = y; o.at = t; o.h = h;
    if (h == null) {   // no way to go by: straight to it, eased
      const a = 1 - Math.exp(-dt / SIDE_TAU);
      o.x += (x - o.x) * a; o.y += (y - o.y) * a;
      return { x: o.x, y: o.y, heading };
    }
    // Along and across its way (the steering: the way it is told to go; the heading drawn follows from the axle).
    const face = o.hd ?? h;
    const [fx, fy] = unit(h), qx = fy, qy = -fx;   // ahead; to its right
    const ex = x - o.x, ey = y - o.y, eF = ex * fx + ey * fy, eR = ex * qx + ey * qy;
    // Along: the spring, told the place's speed along its way.
    const want = o.ex * fx + o.ey * fy, hh = Math.min(dt, 0.1);
    o.v += (W * W * eF + 2 * W * (want - o.v)) * hh;
    // Never backwards along its way (a place that hops back a metre at a vertex is waited for, not reversed to).
    if (o.v < 0) o.v = 0;
    const on = o.v * dt;
    // Sideways: towards the place, but no more than a bus can for the metres it drove.
    const room = SLOPE * Math.abs(on) + CREEP * dt;
    const side = Math.max(-room, Math.min(room, eR * (1 - Math.exp(-dt / SIDE_TAU))));
    o.x += fx * on + qx * side; o.y += fy * on + qy * side;
    // The front wheels turned toward its way, as far as the metres it drove allow.
    const moved = Math.abs(on) + Math.abs(side);
    if (o.fh == null) o.fh = face;
    let reset = off(o.fh, h) > ASTRAY_DEG;   // nearly opposite to its way (put on a stretch that runs back): faces it at once
    if (!reset) {
      const d = ((h - o.fh + 540) % 360) - 180, most = TURN_PER_M * moved;
      o.fh = (o.fh + Math.max(-most, Math.min(most, d)) + 360) % 360;
    }
    // The front axle there; the rear axle dragged after it, a wheelbase behind; the bus from one to the other.
    const [gx, gy] = unit(reset ? h : o.fh), fx2 = o.x + gx * FRONT_M, fy2 = o.y + gy * FRONT_M;
    const dx = fx2 - o.ax, dy = fy2 - o.ay, d = Math.hypot(dx, dy);
    if (!reset && d > 1e-6) { o.ax = fx2 - (dx / d) * WHEELBASE; o.ay = fy2 - (dy / d) * WHEELBASE; }
    let hd = bearing(fx2 - o.ax, fy2 - o.ay);
    // A place that turns a corner sharper than a bus can (a shape's vertex): the body turns no faster than its
    // wheels would let it, the rear axle put back behind it.
    const prev = o.hd ?? hd, dh = ((hd - prev + 540) % 360) - 180, most = BODY_PER_M * moved;
    if (Math.abs(dh) > most) {
      hd = (prev + Math.sign(dh) * most + 360) % 360;
      const [bx, by] = unit(hd);
      o.ax = fx2 - bx * WHEELBASE; o.ay = fy2 - by * WHEELBASE;
    }
    if (reset || off(hd, h) > ASTRAY_DEG) {
      const [bx, by] = unit(h);
      hd = o.fh = h;
      o.ax = o.x - bx * REAR_M; o.ay = o.y - by * REAR_M;
    }
    o.hd = hd;
    return { x: o.x, y: o.y, heading: hd };
  }

  drop(key: string) { this.s.delete(key); }
  get size() { return this.s.size; }
  keep(keys: Iterable<string>) { const k = new Set(keys); for (const key of this.s.keys()) if (!k.has(key)) this.s.delete(key); }
}
