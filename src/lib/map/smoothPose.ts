// The last step before a vehicle's model is drawn (scene3d.place): where it is drawn follows where it should be as a
// bus drives, never hopping and never sliding. Each frame's place is worked out afresh (projected from its line's
// shape onto the painted route, or onto the road running its way, in its lane), and at a vertex, a fork or a lane's
// edge that moves it by a metre or two in one frame. Riding behind it (the chase) the camera moved with it and that
// was not seen; with the camera still, it was.
// Along its way it follows a critically damped spring told the speed the place moves at (so it does not lag behind
// at a steady speed). Sideways (a lane change, a place a metre off) it moves only as a bus can: at most SLOPE metres
// for each metre it drives on, so crawling it changes lanes slowly and standing it does not (but for a slow CREEP),
// and it is turned the way it moves, so it steers across, never slides.

const W = 5;            // the spring along its way, 1/s: a hop is closed over about half a second
const TV = 0.25;        // the speed it is told: how the place moved over about this many seconds
const V_MAX = 25;       // m/s: a frame's step faster than this is a hop, not speed
const SNAP_M = 25;      // further than this from where it is drawn: a new place (a fix, a fade over), not smoothed
const STALE_S = 0.5;    // not drawn for this long: it starts again where it is
const SLOPE = 0.2;      // sideways, metres for each metre on (about 11°)
const SIDE_TAU = 0.6;   // s: how quickly it closes a gap sideways, within SLOPE
const CREEP = 0.12;     // m/s sideways standing (a place moved while it stands: it gets there, unseen)
const LEAN_MAX = 12;    // degrees it is turned from its way, at most
const LEAN_TAU = 0.3;   // s: the turn eases in and out

type State = { x: number; y: number; v: number; ex: number; ey: number; rx: number; ry: number; at: number; lean: number; h: number | null };

const unit = (h: number): [number, number] => [Math.sin((h * Math.PI) / 180), Math.cos((h * Math.PI) / 180)];

export class PoseSmoother {
  private s = new Map<string, State>();

  /** Where to draw `key`, given where it should be (x, y metres east and north of any fixed point) and its way
   *  (degrees clockwise from north, or null) at `t` seconds. */
  step(key: string, x: number, y: number, heading: number | null, t: number): { x: number; y: number; heading: number | null } {
    const o = this.s.get(key);
    const dt = o ? t - o.at : 0;
    if (!o || dt > STALE_S || dt < 0 || Math.hypot(x - o.x, y - o.y) > SNAP_M) {
      this.s.set(key, { x, y, v: 0, ex: 0, ey: 0, rx: x, ry: y, at: t, lean: 0, h: heading });
      return { x, y, heading };
    }
    const turned = (hd: number | null) => (hd == null ? null : (hd + o.lean + 360) % 360);
    if (dt === 0) return { x: o.x, y: o.y, heading: turned(heading) };
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
    const [fx, fy] = unit(h), qx = fy, qy = -fx;   // ahead; to its right
    const ex = x - o.x, ey = y - o.y, eF = ex * fx + ey * fy, eR = ex * qx + ey * qy;
    // Along: the spring, told the place's speed along its way.
    const want = o.ex * fx + o.ey * fy, hh = Math.min(dt, 0.1);
    o.v += (W * W * eF + 2 * W * (want - o.v)) * hh;
    const on = o.v * dt;
    // Sideways: towards the place, but no more than a bus can for the metres it drove.
    const room = SLOPE * Math.abs(on) + CREEP * dt;
    const side = Math.max(-room, Math.min(room, eR * (1 - Math.exp(-dt / SIDE_TAU))));
    o.x += fx * on + qx * side; o.y += fy * on + qy * side;
    // Turned the way it moves.
    const lean = Math.abs(on) > 1e-3 ? Math.max(-LEAN_MAX, Math.min(LEAN_MAX, (Math.atan2(side, Math.abs(on)) * 180) / Math.PI)) : 0;
    o.lean += (lean - o.lean) * (1 - Math.exp(-dt / LEAN_TAU));
    return { x: o.x, y: o.y, heading: turned(heading) };
  }

  drop(key: string) { this.s.delete(key); }
  get size() { return this.s.size; }
  keep(keys: Iterable<string>) { const k = new Set(keys); for (const key of this.s.keys()) if (!k.has(key)) this.s.delete(key); }
}
