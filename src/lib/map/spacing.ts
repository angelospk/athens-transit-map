// Two 3D buses on one lane never sit inside each other (scene3d draws them where their GPS puts them, and two of them
// close behind one another often overlap). For each pair going the same way, side by side closer than a bus's width:
// - both under way: the one behind pulls out to the lane on its left (or, with no road there, on its right: canPass)
//   early enough to pass (as soon as it is closing in and would reach the one ahead within LOOKAHEAD_S), stays out
//   until it is clear by CLEAR_M, then glides back; with no lane either side, it keeps in line behind instead;
// - the one ahead standing (at a stop, at the lights): the one behind comes into line behind it, and so on down the
//   queue, however its GPS has it.
// These are targets; scene3d moves each vehicle to its own on a spring (no jumps), turned a little as it steers.

export interface Car { key: string; x: number; y: number; heading: number | null; v: number; moving: boolean }   // local metres; v: m/s
export interface Gap { lat: number; back: number }   // metres to the left of its way (right: negative), and back along it

// Moving or standing, with a margin between (GPS speeds jitter): moving from MOVE_ON, standing below MOVE_OFF.
export const MOVE_ON = 1.5, MOVE_OFF = 0.6;
const SAME_WAY = 35;       // degrees
const LOOKAHEAD_S = 3;     // pull out this long before it would reach the one ahead
const CLEAR_M = 4;         // and back in once this far past it

const dirOf = (h: number): [number, number] => [Math.sin((h * Math.PI) / 180), Math.cos((h * Math.PI) / 180)];
const turn = (a: number, b: number) => Math.abs(((a - b) % 360 + 540) % 360 - 180);

/** width: how far apart side by side two buses stop touching; lane: how far one pulls out to pass; canPass: whether
 *  there is road a lane to that side of a car (1 left, -1 right); without it, the left always. */
export function spacingTargets(cars: Car[], now: Map<string, Gap>, len: number, lane: number, width = 3.2,
  canPass?: (c: Car, side: 1 | -1) => boolean): Map<string, Gap> {
  const out = new Map<string, Gap>(cars.map(c => [c.key, { lat: 0, back: 0 }]));
  const need = len + 1.5;
  // The side a car passes on: the one it is out on already, else the left, else the right, else none (0). Once a frame.
  const sides = new Map<string, number>();
  const sideOf = (c: Car) => {
    let s = sides.get(c.key);
    if (s === undefined) {
      const was = now.get(c.key)?.lat ?? 0;
      s = Math.abs(was) > 0.5 ? Math.sign(was) : !canPass || canPass(c, 1) ? 1 : canPass(c, -1) ? -1 : 0;
      sides.set(c.key, s);
    }
    return s;
  };
  const queue = (behind: Car, ahead: Car, room: number, gap: number) => {
    if (gap >= room) return;
    const t = out.get(behind.key)!;
    t.back = Math.max(t.back, room - gap + out.get(ahead.key)!.back);
  };
  // Twice: a queue's third bus waits behind the second's new place.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j];
      if (a.heading == null || b.heading == null || turn(a.heading, b.heading) > SAME_WAY) continue;
      const [dx, dy] = [b.x - a.x, b.y - a.y];
      const reach = need + CLEAR_M + Math.max(a.v, b.v) * LOOKAHEAD_S;
      if (dx * dx + dy * dy > reach * reach) continue;
      const d = dirOf(a.heading), along = dx * d[0] + dy * d[1], side = -dx * d[1] + dy * d[0];
      if (Math.abs(side) >= width) continue;   // side by side apart already (another lane)
      const gap = Math.abs(along);
      const [ahead, behind] = along >= 0 ? [b, a] : [a, b];
      const outNow = (k: Car) => Math.abs(now.get(k.key)?.lat ?? 0) > 1;   // out to either side (scene3d picks it)
      const closing = Math.max(0, behind.v - ahead.v);
      if (outNow(ahead) && !outNow(behind) && gap < need + CLEAR_M) {
        out.get(ahead.key)!.lat = lane * Math.sign(now.get(ahead.key)!.lat);   // it passed: out until it is clear
      } else if (behind.moving && (ahead.moving || outNow(behind))) {
        // Both under way (or it is passing already): it pulls out early enough to pass, where there is a lane.
        const soon = need + closing * LOOKAHEAD_S;
        if (gap < soon || (outNow(behind) && gap < need + CLEAR_M)) {
          const side = sideOf(behind);
          if (side) out.get(behind.key)!.lat = lane * side;
          else queue(behind, ahead, need + closing, gap);   // nowhere to pass: in line behind
        }
      } else {
        // The one ahead stands (a stop, the lights): it comes into line behind it, slowing in time.
        queue(behind, ahead, need + (behind.moving ? closing : 0), gap);
      }
    }
  }
  return out;
}

// One step of a critically damped spring from x (moving at v) toward `to`, settling in about `period` seconds: the
// gaps move on it, so a bus pulls out and back in smoothly, without a jump at the start or an overshoot.
export function springStep(x: number, v: number, to: number, period: number, dt: number): [number, number] {
  const w = (2 * Math.PI) / period, acc = w * w * (to - x) - 2 * w * v, nv = v + acc * dt;
  return [x + nv * dt, nv];
}
export const LAT_PERIOD = 2.2, BACK_PERIOD = 1.2;
