// The 3D buses as traffic: never one inside another, from any angle, and never a drawn bus rolling backwards.
// Each bus is drawn where its motion (OASA's data) has it, less two offsets: `back` along its way (it holds back
// behind another) and `lat` to its left (it pulls out to pass). The offsets are the only thing this changes; the
// data's place stays the truth, and with nothing in the way both are 0 and the bus is drawn exactly there.
//
// For each pair close enough to matter (a sweep along x: pairs far apart are never looked at):
// - the same way: the one behind passes only where their GPS says it does (its last fix level with the other's, or
//   ahead: PASS_M), not because it is drawn closing in. Then it pulls out to the lane on its left (or, with no road
//   there, on its right: canPass), stays out until clear by CLEAR_M, then glides back. Else it keeps in line;
// - the one ahead standing (a stop, the lights): the one behind comes into line behind it, down the queue;
// - across each other (a junction): the one that has the other in front of it holds back;
// - the other way, side by side too close (a narrow street, a coarse shape): both edge to their right.
// Then, per bus, follow(): its drawn speed eases to the speed that keeps it its target back, braking and pulling
// away as a bus does, never below 0. Last, separate(): any two drawn rectangles that still touch (a bus appearing,
// a sharp corner) are pulled apart at once, the one behind moved back along its own way.

export interface Car { key: string; x: number; y: number; heading: number | null; v: number; moving: boolean; turning?: boolean; fix?: [number, number] }   // local metres; v: m/s; turning: its heading is changing (a bend, a junction); fix: where its last GPS fix is (local metres)
export interface Gap { lat: number; back: number }   // metres to the left of its way (right: negative), and back along it

// Moving or standing, with a margin between (GPS speeds jitter): moving from MOVE_ON, standing below MOVE_OFF.
export const MOVE_ON = 1.5, MOVE_OFF = 0.6;
const SAME_WAY = 70;       // degrees: two going roughly the same way (one of them turning, or placed askew) are kept apart too
const LOOKAHEAD_S = 9;     // pull out this long before it would reach the one ahead (early: a driver changes lane well before)
const PULL_M = 20;         // and at least this far back from it
const CLEAR_M = 9;         // and back in once this far past it (not cutting in just in front of the other)
const PASS_M = 2;          // its fix no more than this behind the other's: the data has it passing
const PASS_LAG_M = 30;     // or held this far behind its own place: its data has long gone past, it passes where it can
const KEEP_M = 4;          // the gap kept in a queue, bumper to bumper, standing...
const HEADWAY_S = 1.2;     // ...and this much more per m/s it drives at (a driver keeps a second or so behind)
const CROSS_M = 5;         // across each other: the one giving way stops this far clear of the other...
const CROSS_S = 1;         // ...and this much farther per m/s it drives at (it slows well before, not at the other's side)
const EDGE_M = 1.8;        // the most two going opposite ways edge to their right
const SIDE_GAP = 0.8;      // two side by side keep at least this between them (next lanes: they edge apart)

const dirOf = (h: number): [number, number] => [Math.sin((h * Math.PI) / 180), Math.cos((h * Math.PI) / 180)];
const turn = (a: number, b: number) => Math.abs(((a - b) % 360 + 540) % 360 - 180);

/** width: how far apart side by side two buses stop touching; lane: how far one pulls out to pass; canPass: whether
 *  there is road a lane to that side of a car (1 left, -1 right); without it, the left always. */
export function spacingTargets(cars: Car[], now: Map<string, Gap>, len: number, lane: number, width = 3.2,
  canPass?: (c: Car, side: 1 | -1) => boolean): Map<string, Gap> {
  const out = new Map<string, Gap>(cars.map(c => [c.key, { lat: 0, back: 0 }]));
  const need = len + KEEP_M;
  // The side a car passes on: the one it is out on already, else the left, else the right, else none (0). Once a frame.
  const sides = new Map<string, number>();
  // `rel`: where the one it passes is, to its left (> 0) or right (< 0): it goes round on the far side from it (its
  // place a little to the right of the other's, pulling out left drove it into the other).
  const sideOf = (c: Car, rel = 0) => {
    let s = sides.get(c.key);
    if (s === undefined) {
      const was = now.get(c.key)?.lat ?? 0;
      const first: 1 | -1 = rel > 0.3 ? -1 : 1, second: 1 | -1 = first === 1 ? -1 : 1;
      s = Math.abs(was) > 0.5 ? Math.sign(was) : !canPass || canPass(c, first) ? first : canPass(c, second) ? second : 0;
      sides.set(c.key, s);
    }
    return s;
  };
  const lagging = (c: Car) => (now.get(c.key)?.back ?? 0) > PASS_LAG_M;
  const queue = (behind: Car, ahead: Car, room: number, gap: number) => {
    if (gap >= room) return;
    const t = out.get(behind.key)!;
    t.back = Math.max(t.back, room - gap + out.get(ahead.key)!.back);
  };
  // Sorted along x (stable: the order given breaks ties), so each car meets only those within `reach` of it.
  const order = cars.map((c, i) => [c, i] as const).sort((p, q) => p[0].x - q[0].x || p[1] - q[1]).map(p => p[0]);
  let vMax = 0;
  for (const c of cars) vMax = Math.max(vMax, c.v);
  const far = need + CLEAR_M + vMax * LOOKAHEAD_S;
  // Twice: a queue's third bus waits behind the second's new place.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length && order[j].x - order[i].x <= far; j++) {
      const a = order[i], b = order[j];
      if (a.heading == null || b.heading == null) continue;
      const [dx, dy] = [b.x - a.x, b.y - a.y];
      if (Math.abs(dy) > far) continue;
      const tw = turn(a.heading, b.heading);
      if (tw > 180 - SAME_WAY) {
        // The other way: the other carriageway, as a rule. Drawn side by side closer than a bus's width (a narrow
        // street, a shape down its middle): each edges a little away from the other, on the side it is on already
        // (dead level: each to its right, as traffic keeps).
        if (pass) continue;
        const d = dirOf(a.heading), along = dx * d[0] + dy * d[1], side = -dx * d[1] + dy * d[0];
        if (Math.abs(along) < len && Math.abs(side) < width) {
          const k = Math.min(EDGE_M, (width - Math.abs(side)) / 2 + 0.2);
          // b to a's left (side > 0): a edges right (lat < 0); and b, which has a on its left then too, the same.
          const away = Math.abs(side) < 0.1 ? -1 : -Math.sign(side);
          for (const c of [a, b]) { const t = out.get(c.key)!; if (Math.abs(away * k) > Math.abs(t.lat)) t.lat = away * k; }
        }
        continue;
      }
      if (tw > SAME_WAY) {
        // Across each other (a junction, one turning, one placed askew): the one that has the other in front of it
        // gives way, stopping well clear of it (CROSS_M, more the faster it comes), and goes once the other has
        // passed. Measured from the other as it is drawn (held back too, or out to pass).
        // Which: the one whose way runs into the other (its front's road straight on meets the other's body).
        if (pass) continue;
        for (const [behind, ahead] of [[a, b], [b, a]] as const) {
          // Only for one coming across (a bus standing by a junction, at its stop, is not crossing anything: a straight
          // look ahead on a bending road "met" it, and the bus waited for a minute); and not once its data has long
          // gone on (held PASS_LAG_M back already): then it goes, the hard pass keeps them apart.
          if (lagging(behind)) continue;
          const margin = CROSS_M + CROSS_S * behind.v;
          if ((ahead.x - behind.x) ** 2 + (ahead.y - behind.y) ** 2 > (len + width + margin) ** 2) continue;
          const ga = now.get(ahead.key), ua = dirOf(ahead.heading!), lat = ga?.lat ?? 0, bk = ga?.back ?? 0;
          const ox = ahead.x - ua[1] * lat - ua[0] * bk, oy = ahead.y + ua[0] * lat - ua[1] * bk;
          const hit = ahead.moving ? runInto(behind.x, behind.y, behind.heading!, ox, oy, ahead.heading!, len, width) : null;
          let need = hit != null && hit <= margin ? margin - hit : 0;
          // Already inside one another (its front past the other's side): the one with the other in front of it backs
          // off as far as it takes to be clear.
          const ub = dirOf(behind.heading!);
          if (!need && (ox - behind.x) * ub[0] + (oy - behind.y) * ub[1] > 0)
            need = backToClear({ key: ahead.key, x: ox, y: oy, h: ahead.heading! }, { key: behind.key, x: behind.x, y: behind.y, h: behind.heading! }, len, width);
          if (!need) continue;
          const t = out.get(behind.key)!;
          t.back = Math.max(t.back, need);
          break;   // one of the two gives way
        }
        continue;
      }
      const reach = need + CLEAR_M + Math.max(a.v, b.v) * LOOKAHEAD_S;
      if (dx * dx + dy * dy > reach * reach) continue;
      const d = dirOf(a.heading), along = dx * d[0] + dy * d[1], side = -dx * d[1] + dy * d[0], side0 = side;
      if (Math.abs(side) >= width + SIDE_GAP) continue;   // side by side apart already (another lane)
      if (Math.abs(side) >= width) {
        // In the next lane, but drawn closer than SIDE_GAP (the models are wider than life, the lanes are not):
        // each edges a little away from the other while they are level, as two drivers keep their distance.
        if (!pass && Math.abs(along) < len) {
          const k = Math.min(EDGE_M / 2, (width + SIDE_GAP - Math.abs(side)) / 2);
          const ta = out.get(a.key)!, tb = out.get(b.key)!, away = Math.sign(side);   // b to a's left: a goes right, b left
          if (Math.abs(ta.lat) < k) ta.lat = -away * k;
          if (Math.abs(tb.lat) < k) tb.lat = away * k;
        }
        continue;
      }
      // Which is ahead is where they are drawn (each held back by its own gap), not where their places are: a guess
      // that has run on past one standing at a stop stays behind it until the data has it passing. The gap is then
      // signed, from its place to the other's: below 0 when its place is past the other's.
      const drawn = along - (now.get(b.key)?.back ?? 0) + (now.get(a.key)?.back ?? 0);
      const [ahead, behind] = drawn >= 0 ? [b, a] : [a, b];
      const gap = drawn >= 0 ? along : -along;
      const outNow = (k: Car) => Math.abs(now.get(k.key)?.lat ?? 0) > 1;   // out to either side (scene3d picks it)
      const rel = behind === a ? side0 : -side0;   // the other to its left (> 0) or right
      const closing = Math.max(0, behind.v - ahead.v);
      if (outNow(ahead) && !outNow(behind) && gap < need + CLEAR_M) {
        out.get(ahead.key)!.lat = lane * Math.sign(now.get(ahead.key)!.lat);   // it passed: out until it is clear
      } else if (behind.moving && (ahead.moving || outNow(behind))) {
        // Both under way (or it is passing already): it pulls out early enough to pass, where there is a lane.
        const soon = need + Math.max(PULL_M, closing * LOOKAHEAD_S);
        if (gap < soon || (outNow(behind) && gap < need + CLEAR_M)) {
          // Only where the data has it passing (its fix level with the other's or ahead); not on a bend or through a
          // junction (either of them turning): it stays in line behind till then. One already out carries on past.
          const passing = (!!behind.fix && !!ahead.fix
            && (behind.fix[0] - ahead.fix[0]) * d[0] + (behind.fix[1] - ahead.fix[1]) * d[1] >= -PASS_M) || lagging(behind);
          const side = ((behind.turning || ahead.turning || !passing) && !outNow(behind)) ? 0 : sideOf(behind, rel);
          if (side) {
            out.get(behind.key)!.lat = lane * side;
            // Not yet out beside it (how far apart sideways they are drawn now): it holds back till it is, so it
            // never drives into the other while pulling out.
            const apart = Math.abs(side0 + ((now.get(behind.key)?.lat ?? 0) - (now.get(ahead.key)?.lat ?? 0)) * (drawn >= 0 ? -1 : 1));
            if (apart < width) queue(behind, ahead, need, gap);
          } else queue(behind, ahead, need + closing + HEADWAY_S * behind.v, gap);   // nowhere to pass, or a bend: in line behind
        }
      } else if (behind.moving && lagging(behind) && !behind.turning && !ahead.turning && sideOf(behind, rel)) {
        // The one ahead stands (a stop), and this one's data has long gone past it: it goes round, as buses do.
        out.get(behind.key)!.lat = lane * sideOf(behind, rel);
        const apart = Math.abs(side0 + ((now.get(behind.key)?.lat ?? 0) - (now.get(ahead.key)?.lat ?? 0)) * (drawn >= 0 ? -1 : 1));
        if (apart < width) queue(behind, ahead, need, gap);
      } else {
        // The one ahead stands (a stop, the lights): it comes into line behind it, slowing in time.
        queue(behind, ahead, need + (behind.moving ? closing + HEADWAY_S * behind.v : 0), gap);
      }
    }
  }
  return out;
}

// One step of a critically damped spring from x (moving at v) toward `to`, settling in about `period` seconds: the
// sideways gap moves on it, so a bus pulls out and back in smoothly, without a jump at the start or an overshoot.
export function springStep(x: number, v: number, to: number, period: number, dt: number): [number, number] {
  const w = (2 * Math.PI) / period, acc = w * w * (to - x) - 2 * w * v, nv = v + acc * dt;
  return [x + nv * dt, nv];
}
export const LAT_PERIOD = 3.6, BACK_PERIOD = 2.0;   // a lane change in about three and a half seconds, into line in two: no lurch

/** How far a bus (centre x, y, heading h) drives on before its front meets the body of another (centre ox, oy,
 *  heading oh; both len by w): its front's road straight on, as wide as it, against the other's outline. Below 0
 *  when they already touch; null when its road straight on never meets the other. */
export function runInto(x: number, y: number, h: number, ox: number, oy: number, oh: number, len: number, w: number): number | null {
  const u = dirOf(h), uo = dirOf(oh), no: [number, number] = [uo[1], -uo[0]];
  // In the other's frame: its front's centre and way; the other's outline grown by half this one's width.
  const fx = x + u[0] * len / 2 - ox, fy = y + u[1] * len / 2 - oy;
  const p = [fx * uo[0] + fy * uo[1], fx * no[0] + fy * no[1]], d = [u[0] * uo[0] + u[1] * uo[1], u[0] * no[0] + u[1] * no[1]];
  // Its front is a crossbar w wide across its way: the other's outline grows by its reach on each axis.
  const nb: [number, number] = [u[1], -u[0]];
  const half = [len / 2 + (w / 2) * Math.abs(nb[0] * uo[0] + nb[1] * uo[1]), w / 2 + (w / 2) * Math.abs(nb[0] * no[0] + nb[1] * no[1])];
  let t0 = -Infinity, t1 = Infinity;
  for (let k = 0; k < 2; k++) {
    if (Math.abs(d[k]) < 1e-9) { if (Math.abs(p[k]) > half[k]) return null; continue; }
    let a = (-half[k] - p[k]) / d[k], b = (half[k] - p[k]) / d[k];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
  }
  if (t0 > t1 || t1 < 0) return null;
  return t0;
}

// ---- Holding back as a bus drives: its drawn speed, not its place, is what changes.
export const FOLLOW_ACC = 1.2;    // m/s², pulling away again
export const FOLLOW_BRAKE = 2.5;  // m/s², braking for the one ahead
const FOLLOW_TAU = 1.6;           // s: a gap to its target closed over about this
const FOLLOW_CATCH = 4;           // m/s: at most this faster than its data's place, catching up after
export const BACK_MAX = 60;       // metres: the most a bus is held behind its data's place (it catches up past this)

export interface Follow { back: number; u: number; was?: number }   // u: its drawn speed along its way, m/s (never below 0); was: last frame's target

/** One frame of a bus holding back: `ahead` is how far its data's place moved along its way this frame (metres),
 *  `target` how far back it should be drawn. The drawn bus moves u·dt (never backwards), easing to the speed that
 *  brings its back to the target; with no target and none left, it is on its place, at its speed. */
export function follow(st: Follow, ahead: number, target: number, dt: number): void {
  if (!(dt > 0)) return;
  target = Math.min(target, BACK_MAX);
  const v = ahead / dt;
  const rate = st.was == null ? 0 : Math.max(-FOLLOW_CATCH, (target - st.was) / dt);   // how fast its target grows
  st.was = target;
  if (target <= 0 && st.back <= 0.01) { st.back = 0; st.u = Math.max(0, v); return; }
  // Over: it is farther back than it needs (catch up); under: it should slow. And as fast as its target grows (its
  // place creeping on into a queue that stands: it stands too), so it keeps to it rather than trailing it.
  const e = st.back - target;
  const want = Math.max(0, Math.min(v + FOLLOW_CATCH, v - rate + Math.min(FOLLOW_CATCH, e / FOLLOW_TAU)));
  st.u = Math.max(0, st.u + Math.max(-FOLLOW_BRAKE * dt, Math.min(FOLLOW_ACC * dt, want - st.u)));
  st.back += ahead - st.u * dt;
  if (st.back < 0) { st.back = 0; st.u = Math.max(0, v); }   // never drawn ahead of its place
}

// ---- Two drawn rectangles that touch, pulled apart: the one behind moved back along its own way, by as little as
// separates them (a separating-axis test of the two rectangles, both turned as drawn).
export interface Box { key: string; x: number; y: number; h: number; fresh?: boolean }   // drawn centre, heading in degrees; fresh: it appears this frame

const MARGIN = 1;   // two drawn buses never closer than this, whatever happens
const STEP_MAX = 2.5;   // metres a frame the hard pass moves a bus that was already there

/** How far b must move back along its own heading for the two rectangles (length len, width w) to be apart by
 *  `margin`; 0 when they are. */
export function backToClear(a: Box, b: Box, len: number, w: number, margin = MARGIN): number {
  const ua = dirOf(a.h), ub = dirOf(b.h);
  const axes: [number, number][] = [ua, [ua[1], -ua[0]], ub, [ub[1], -ub[0]]];
  const dx = b.x - a.x, dy = b.y - a.y;
  let best = Infinity;
  for (const k of axes) {
    const r = (len / 2) * (Math.abs(ua[0] * k[0] + ua[1] * k[1]) + Math.abs(ub[0] * k[0] + ub[1] * k[1]))
      + (w / 2) * (Math.abs(ua[1] * k[0] - ua[0] * k[1]) + Math.abs(ub[1] * k[0] - ub[0] * k[1])) + margin;
    const dk = dx * k[0] + dy * k[1];
    if (Math.abs(dk) >= r) return 0;   // a separating axis: apart
    const wk = ub[0] * k[0] + ub[1] * k[1];   // how much b's move back changes the gap on this axis (per metre: -wk)
    if (Math.abs(wk) < 1e-3) continue;
    best = Math.min(best, wk > 0 ? (dk + r) / wk : (r - dk) / -wk);
  }
  return best === Infinity ? 0 : Math.max(0, best);
}

/** Which of two touching boxes gives way: one appearing this frame (moved, it is not seen moving), else the one with
 *  the other more in front of it. */
function behindOf(a: Box, b: Box): [Box, Box] {
  if (a.fresh !== b.fresh) return a.fresh ? [a, b] : [b, a];
  const da = dirOf(a.h), db = dirOf(b.h), dx = b.x - a.x, dy = b.y - a.y;
  const aSees = dx * da[0] + dy * da[1], bSees = -dx * db[0] - dy * db[1];
  return aSees >= bSees ? [a, b] : [b, a];   // [behind, ahead]
}

/** Extra back for each drawn box so that none touches another (pairs going opposite ways are left to edge apart
 *  sideways: spacingTargets). A few passes: a queue settles from its head. */
export function separate(boxes: Box[], len: number, w: number, passes = 3): Map<string, number> {
  const out = new Map<string, number>();
  const at = boxes.map(b => ({ ...b }));
  const order = at.slice().sort((p, q) => p.x - q.x);
  const reach = Math.hypot(len, w) + MARGIN;
  for (let pass = 0; pass < passes; pass++) {
    let moved = false;
    for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length && order[j].x - order[i].x <= reach; j++) {
      const a = order[i], b = order[j];
      if (Math.abs(b.y - a.y) > reach) continue;
      const [behind, ahead] = behindOf(a, b);
      const da = dirOf(ahead.h), db = dirOf(behind.h);
      // Neither has the other in front of it (they part, side by side or back to back): moving one back would drive it
      // through the other; they are left to part.
      // (Going the same way, side by side, the one drawn behind is still moved back.)
      if (!behind.fresh && da[0] * db[0] + da[1] * db[1] < 0.34
        && (ahead.x - behind.x) * db[0] + (ahead.y - behind.y) * db[1] <= 0 && (behind.x - ahead.x) * da[0] + (behind.y - ahead.y) * da[1] <= 0) continue;
      // Going opposite ways: moving one back would only drive it backwards; they edge apart sideways instead.
      if (da[0] * db[0] + da[1] * db[1] < -0.5) continue;
      let s = backToClear(ahead, behind, len, w);
      if (!(s > 0)) continue;
      if (!behind.fresh) s = Math.min(s, STEP_MAX - (out.get(behind.key) ?? 0));   // a bus already there is never thrown far back in one frame
      if (!(s > 0)) continue;
      behind.x -= db[0] * s; behind.y -= db[1] * s;
      out.set(behind.key, (out.get(behind.key) ?? 0) + s);
      moved = true;
    }
    if (!moved) break;
  }
  return out;
}
