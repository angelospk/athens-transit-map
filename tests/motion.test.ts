import { describe, expect, it } from "vitest";
import { distanceM, type LngLat } from "../src/lib/glide";
import {
  AHEAD_MAX, BRAKE, bridge, careful, CATCH_MAX, CRAWL, FADE_S, LEAN, LEAN_S, LEAP_M, STEP_PACE, chase, cumulativeLL, drive, DWELL_S, GLIDE_MAX_S, GLIDE_S, glideS, HORIZON_S,
  linePlan, MIN_CRUISE, Mover, PACE, pathPlan, PENDING_STAND_S, pointAtLL, project, STEP_M, STOP_HOLD_S, subLine, TRAIL_S, WAIT_MAX, WAIT_STAND_S, walk, type Plan,
} from "../src/lib/motion";

// 0.01° lon at 37.97° ≈ 877 m. Geometry here is [lon, lat].
const M = 877.4;
const east: LngLat[] = [[23.70, 37.97], [23.71, 37.97], [23.72, 37.97]];
const plan = (target: (t: number) => number, geom = east): Plan => ({ geom, cum: cumulativeLL(geom), target });
// Steps on to `t` half a second at a time (a frame loop; a longer gap between steps snaps), the last step at t.
const stepTo = (mv: Mover, t: number) => { for (let x = (mv as unknown as { last: number }).last; x + 0.5 < t; x += 0.5) mv.step(x + 0.5); return mv.step(t); };
const atM = (m: number): LngLat => [23.70 + (m / M) * 0.01, 37.97];
// East M metres, then north (0.01° lat ≈ 1112 m): a bend at s = M.
const N = 1111.9;
const bent: LngLat[] = [[23.70, 37.97], [23.71, 37.97], [23.71, 37.98]];
const onBent = (m: number): LngLat => (m <= M ? atM(m) : [23.71, 37.97 + ((m - M) / N) * 0.01]);

describe("chase", () => {
  it("wants the target's speed on target, more when behind, only what it can brake off when close", () => {
    expect(chase(100, 100, 8)).toBe(8);
    const late = chase(0, 100, 8) as number;
    expect(late).toBeGreaterThan(8);                         // faster than v
    expect(late).toBeLessThanOrEqual(8 + CATCH_MAX + 1e-9);  // capped catch-up
    expect(CATCH_MAX).toBeLessThanOrEqual(6);                // no burst after new data
    const close = chase(99, 100, 0) as number;
    expect(close).toBeGreaterThan(0);
    expect(close).toBeLessThanOrEqual(Math.sqrt(2 * BRAKE * 1) + 1e-9);   // it can still stop on the target
  });
  it("eases off when ahead, never under a crawl, never a correction back", () => {
    const ahead = chase(110, 100, 8) as number;
    expect(ahead).toBeLessThan(8);
    expect(ahead).toBeGreaterThanOrEqual(CRAWL);
    expect(chase(400, 100, 8)).toBe(CRAWL);
    expect(chase(120, 100, 0)).toBe(CRAWL);                  // standing target: it still rolls, slowly
  });
  it("asks for a correction only when far behind the target", () => {
    expect(chase(0, 700, 8)).toBe("fix");
    expect(chase(0, 500, 8)).not.toBe("fix");
  });
});

describe("careful", () => {
  it("leans the guess back as the fix ages, up to LEAN after LEAN_S; nothing before the fix", () => {
    const f = careful(t => 8 * (t - 100), 100);
    expect(f(100)).toBe(0);
    expect(f(90)).toBe(-80);
    expect(f(120)).toBeCloseTo(8 * 20 * (1 - LEAN * (20 / LEAN_S)), 6);
    expect(f(100 + LEAN_S)).toBeCloseTo(8 * LEAN_S * (1 - LEAN), 6);
    expect(f(100 + 3 * LEAN_S)).toBeCloseTo(8 * 3 * LEAN_S * (1 - LEAN), 6);
    for (let t = 100; t < 300; t += 0.5) expect(f(t + 0.5)).toBeGreaterThanOrEqual(f(t));   // still never backwards
  });
});

describe("geometry", () => {
  it("walks and projects along lon/lat polylines", () => {
    const cum = cumulativeLL(east);
    expect(distanceM(pointAtLL(east, cum, 300), atM(300))).toBeLessThan(0.5);
    expect(pointAtLL(east, cum, 1e6)).toEqual(east[2]);
    const p = project(east, cum, [23.705, 37.9701]);
    expect(p.s).toBeCloseTo(M / 2, -1);
    expect(p.off).toBeCloseTo(11, 0);
    expect(project(east, cum, [23.69, 37.97]).s).toBe(0);
  });
});

describe("subLine", () => {
  const cum = cumulativeLL(bent);
  it("walks forward and backward through the vertices in between", () => {
    const f = subLine(bent, cum, 200, M + 300);
    expect(f).toHaveLength(3);
    expect(distanceM(f[0], onBent(200))).toBeLessThan(0.5);
    expect(f[1]).toEqual(bent[1]);
    expect(distanceM(f[2], onBent(M + 300))).toBeLessThan(2);   // M is rounded
    const b = subLine(bent, cum, M + 300, 200);
    expect(b).toEqual([...f].reverse());
  });
  it("clamps to the ends, keeps exact vertices once, and is a single point for zero length", () => {
    const all = subLine(bent, cum, -50, 1e6);
    expect(all).toEqual(bent);
    expect(subLine(bent, cum, M, M + 100)).toHaveLength(2);
    expect(subLine(bent, cum, 300, 300)).toHaveLength(1);
    const dup: LngLat[] = [bent[0], bent[1], bent[1], bent[2]];
    expect(subLine(dup, cumulativeLL(dup), 0, M + 100)).toHaveLength(3);
  });
});

describe("Mover", () => {
  it("follows a moving target smoothly, step after step", () => {
    const mv = new Mover(atM(0));
    mv.setPlan(plan(t => 8 * t), 0, 0);
    let prev = 0;
    for (let t = 0.1; t <= 10; t += 0.1) {
      mv.step(t);
      expect(mv.s).toBeGreaterThanOrEqual(prev);   // never backwards
      expect(mv.s - prev).toBeLessThan(2);         // no jumps
      prev = mv.s;
    }
    expect(mv.s).toBeCloseTo(80, 0);
  });
  it("catches up with a target that jumped ahead, faster but bounded", () => {
    const mv = new Mover(atM(0));
    mv.setPlan(plan(() => 200), 0, 0);
    mv.step(1);
    expect(mv.s).toBeGreaterThan(0);
    expect(mv.s).toBeLessThanOrEqual(1 + 1e-9);   // pulls away at ACC: no burst of speed
    for (let t = 1.1; t < 90; t += 0.1) { mv.step(t); expect(mv.u).toBeLessThanOrEqual(CATCH_MAX + 1e-9); }
    expect(mv.s).toBeCloseTo(200, 0);
  });
  it("never goes back: ahead of a target that fell behind, it rolls on at a crawl until it is caught up", () => {
    const mv = new Mover(atM(200));
    mv.setPlan(plan(t => 200 + 8 * t), 200, 0);
    stepTo(mv, 2);
    expect(mv.s).toBeCloseTo(216, 0);
    mv.retarget(plan(t => 100 + 8 * t), 2);   // a fix behind: the guess is now 100 m back, still at 8 m/s
    let prev = mv.s, prevU = mv.u, slowest = Infinity, caught: number | null = null;
    for (let t = 2.1; t <= 45; t += 0.1) {
      const r = mv.step(t);
      expect(r.alpha).toBe(1);                              // no fade: it waits on the road
      expect(mv.s).toBeGreaterThanOrEqual(prev - 1e-9);     // never backwards
      expect(Math.abs(mv.u - prevU)).toBeLessThan(0.2);     // speed changes at the dot's own pace (BRAKE per 0.1 s)
      prev = mv.s; prevU = mv.u;
      if (t > 6) slowest = Math.min(slowest, mv.u);
      if (caught == null && Math.abs(mv.s - (100 + 8 * t)) < 10) caught = t;
    }
    expect(slowest).toBeGreaterThanOrEqual(CRAWL - 1e-9);   // never stood
    expect(caught).not.toBeNull();
    expect(caught!).toBeLessThan(40);                       // the guess gains on it, easing in over the last metres
    expect(Math.abs(mv.s - (100 + 8 * 45))).toBeLessThan(6);   // riding along with it again
  });
  it("ahead of its guess, it brakes into a stop just ahead, stands there a while, then rolls on", () => {
    const mv = new Mover(atM(200));
    mv.setPlan({ ...plan(t => 200 + 8 * t), stops: [240] }, 200, 0);
    stepTo(mv, 2);
    mv.retarget({ ...plan(t => 50 + 0.5 * t), stops: [240] }, 2);   // the bus is far behind and barely moving
    stepTo(mv, 20);
    expect(mv.s).toBeCloseTo(240, 0);                       // standing at the stop
    expect(mv.u).toBe(0);
    stepTo(mv, 2 + STOP_HOLD_S + 12);
    expect(mv.s).toBeGreaterThan(242);                      // rolled on after its hold
    expect(mv.u).toBeGreaterThanOrEqual(CRAWL - 1e-9);
  });
  it("fades over to a guess it has waited on too long, or that is too far behind", () => {
    const mv = new Mover(atM(200));
    mv.setPlan(plan(t => 200 + 8 * t), 200, 0);
    stepTo(mv, 2);
    mv.retarget(plan(t => 50 + 2 * t), 2);                  // 160 m behind, coming at the crawl's own pace: never
    let faded: number | null = null, fromPos = mv.pos;
    for (let t = 2.1; t < 2 + WAIT_MAX + 2; t += 0.1) { const r = mv.step(t); if (r.alpha < 1) { faded ??= t; if (t < faded + FADE_S / 2 - 0.1) expect(distanceM(r.pos, fromPos)).toBeLessThan(1); } else if (faded == null) fromPos = r.pos; }
    expect(faded).not.toBeNull();
    expect(faded!).toBeGreaterThan(2 + WAIT_MAX - 1);
    expect(Math.abs(mv.s - (50 + 2 * (2 + WAIT_MAX + 1.9)))).toBeLessThan(2);   // landed on the guess, riding with it
    const far = new Mover(atM(400));
    far.setPlan(plan(() => 400), 400, 0);
    far.step(0.1);
    far.retarget(plan(() => 400 - AHEAD_MAX - 20), 0.2);
    far.step(0.3);
    expect(far.step(0.4).alpha).toBeLessThan(1);            // too far behind to wait for: a fade at once
    expect(far.step(0.3 + FADE_S + 0.01).alpha).toBe(1);
    expect(far.s).toBe(400 - AHEAD_MAX - 20);
  });
  it("races up to a target ahead, never backwards; leaps at once to one far ahead (a new place)", () => {
    const mv = new Mover(atM(0));
    mv.setPlan(plan(() => 0), 0, 0);
    mv.step(0.1);
    mv.retarget(plan(() => 350), 0.2);
    let prev = 0;
    for (let t = 0.3; t < 80; t += 0.5) {
      mv.step(t);
      expect(mv.s).toBeGreaterThanOrEqual(prev);
      prev = mv.s;
    }
    expect(mv.s).toBeGreaterThan(340);   // the chase closes in on the target (exponentially)
    const far = new Mover(atM(0));
    far.setPlan(plan(() => 0), 0, 0);
    far.step(0.1);
    far.retarget(plan(() => LEAP_M + 300), 0.2);
    const r = far.step(0.3);
    expect(r.fx).toBeNull();
    expect(far.s).toBe(LEAP_M + 300);
  });
  it("fades from the shown point to a place far behind on a fix handoff, never driving back", () => {
    const mv = new Mover(atM(400));
    mv.setPlan(plan(() => 400), 400, 0);
    mv.step(0.1);
    const h = linePlan(mv.pos, atM(100), 90);                // far behind the bearing
    expect(h.fix).toBe(true);
    expect(h.back).toBe(true);
    mv.apply(h, 1);
    mv.step(1.01);
    const a = mv.step(1.1);
    expect(distanceM(a.pos, atM(400))).toBeLessThan(2);
    expect(a.alpha).toBeLessThan(1);
    expect(distanceM(stepTo(mv, 1 + FADE_S + 0.01).pos, atM(100))).toBeLessThan(0.5);
    expect(mv.fixing).toBe(false);
  });
  it("drops the old sideways offset on a correction to new geometry: it starts at the shown point", () => {
    const mv = new Mover([23.71, 37.9702]);
    mv.setPlan(plan(() => M), M, 0, [0, 0.0002]);
    const a = mv.step(0.1).pos;
    mv.apply(linePlan(a, atM(M - 300), 90), 0.15);          // far behind the bearing: a correction
    expect(distanceM(mv.step(0.2).pos, a)).toBeLessThan(3);
  });
  it("keeps a fading sideways offset when a glide starts: no jump", () => {
    const mv = new Mover([23.71, 37.9702]);                 // 22 m north of the line at s = M
    mv.setPlan(plan(() => M), M, 0, [0, 0.0002]);
    const a = mv.step(0.1).pos;
    mv.retarget(plan(() => M - 300), 0.15);
    const b = mv.step(0.2).pos;
    expect(distanceM(a, b)).toBeLessThan(3);
  });
  it("snaps without an effect after a long pause (hidden tab)", () => {
    const mv = new Mover(atM(0));
    mv.setPlan(plan(t => 8 * t), 0, 0);
    const r = mv.step(60);
    expect(r.fx).toBeNull();
    expect(mv.s).toBeCloseTo(480, 5);
  });
  it("fades a large sideways offset slowly, starting gently", () => {
    const mv = new Mover([23.705, 37.97027]);   // 30 m north of the line
    mv.setPlan(plan(() => M / 2), M / 2, 0, [0, 0.00027]);
    let prev = mv.step(0).pos, max = 0;
    for (let t = 0.05; t < 12; t += 0.05) {
      const p = mv.step(t).pos;
      max = Math.max(max, distanceM(prev, p) / 0.05);
      prev = p;
    }
    expect(max).toBeLessThan(6);                                  // m/s sideways, never a flick
    expect(distanceM(prev, [23.705, 37.97])).toBeLessThan(0.5);   // and it gets there
  });
  it("fades a sideways offset out instead of jumping onto the line", () => {
    const mv = new Mover([23.705, 37.9701]);
    mv.setPlan(plan(() => M / 2), M / 2, 0, [0, 0.0001]);
    expect(distanceM(mv.step(0.01).pos, [23.705, 37.9701])).toBeLessThan(1);
    expect(distanceM(mv.step(4).pos, [23.705, 37.97])).toBeLessThan(0.5);   // 11 m at ≤ 5 m/s: 3.3 s
  });
});

describe("drive", () => {
  const stops = Array.from({ length: 20 }, (_, i) => 300 * (i + 1));   // a stop every 300 m
  it("keeps PACE times the measured mean speed, stops included", () => {
    const f = drive(5, stops, 1e6, 600);
    expect(f(300) / 300).toBeGreaterThan(0.9 * PACE * 5);
    expect(f(300) / 300).toBeLessThan(1.1 * PACE * 5);
  });
  it("without known stops, cruises at the mean speed (no waits to make up for)", () => {
    const f = drive(10, [], 1e6);
    expect(f(100) / 100).toBeCloseTo(PACE * 10, 6);
  });
  it("counts a stop listed twice once", () => {
    const twice = stops.flatMap(x => [x, x]);
    expect(drive(5, twice, 1e6)(200)).toBeCloseTo(drive(5, stops, 1e6)(200), 6);
  });
  it("brakes into each stop and waits there DWELL_S", () => {
    const f = drive(5, stops, 1e6);
    let t = 0;
    while (f(t) < 300 - 1e-6) t += 0.1;
    expect(f(t - 1) - f(t - 2)).toBeLessThan(2);        // slow just before the stop
    expect(f(t + DWELL_S - 0.5)).toBeCloseTo(300, 6);   // standing
    expect(f(t + DWELL_S + 3)).toBeGreaterThan(300);    // and off again
  });
  it("in slow traffic drives at MIN_CRUISE and waits longer at stops, same mean", () => {
    const f = drive(1.5, stops, 1e6, 1200);
    expect(f(1200) / 1200).toBeGreaterThan(0.9 * PACE * 1.5);
    expect(f(1200) / 1200).toBeLessThan(1.1 * PACE * 1.5);
    let t = 0;
    while (f(t) < 300 - 1e-6) t += 0.1;
    expect(f(t - 5) - f(t - 6)).toBeGreaterThan(MIN_CRUISE - 0.5);   // cruising, not crawling
    expect(f(t + 60)).toBeCloseTo(300, 6);                           // a long wait
  });
  it("never goes backwards, past the end or past the horizon", () => {
    const f = drive(8, stops, 1000);
    let prev = 0;
    for (let t = 0; t <= 400; t += 0.5) {
      expect(f(t)).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = f(t);
    }
    expect(prev).toBeLessThanOrEqual(1000);
    const g = drive(5, [], 1e6);
    expect(g(HORIZON_S + 60)).toBe(g(HORIZON_S));
  });
  it("brakes harder when the first stop is too close to brake gently", () => {
    const f = drive(15, [10, 400], 1e6);
    let t = 0;
    while (f(t) < 10 - 1e-6) t += 0.05;
    expect(t).toBeLessThan(5);
    expect(f(t + DWELL_S - 0.5)).toBeCloseTo(10, 6);
  });
  it("stands without a speed, before the fix and at the end", () => {
    expect(drive(0, stops, 1e6)(60)).toBe(0);
    expect(drive(5, stops, 1e6)(-5)).toBe(0);
    expect(drive(5, stops, 0)(60)).toBe(0);
    expect(drive(5, [], 0.5)(60)).toBe(0);              // shorter than a metre: no phases
    expect(drive(5, [0.2, 0.4], 0.6)(60)).toBe(0);
    expect(drive(5, stops, 1e6, 0)(60)).toBe(0);         // no horizon: no motion
    expect(drive(5, stops, 1e6, -10)(60)).toBe(0);
  });
});

describe("plans from new data", () => {
  it("continues along a new path from the projected shown point", () => {
    const r = pathPlan(atM(300), east, 8, 1000, 1000)!;
    expect(r.fix).toBe(false);
    expect(r.s0).toBeCloseTo(300, 0);
    expect(r.plan.target(1010)).toBeCloseTo(careful(drive(8, [], cumulativeLL(east)[2]), 0)(10), 5);   // the path starts at the fix, the guess leans
  });
  it("drives into the stops of the path and stops at its end", () => {
    const r = pathPlan(atM(0), east, 15, 1000, 1000, [400])!;
    const end = cumulativeLL(east)[2];
    expect(r.plan.target(1000 + 900)).toBeCloseTo(end, 6);
    const f = careful(drive(15, [400], end), 0);
    expect(r.plan.target(1040)).toBeCloseTo(f(40), 5);
    expect(r.plan.stops).toEqual([400]);
  });
  it("prepends the shown point when it is behind the new path's start", () => {
    const r = pathPlan([23.695, 37.97], east, 8, 1000, 1000)!;
    expect(r.fix).toBe(false);
    expect(r.s0).toBe(0);
    expect(r.plan.target(1000)).toBeCloseTo(0.005 / 0.01 * M, -1);
  });
  it("falls back to a straight glide when close, else a correction", () => {
    expect(pathPlan([23.705, 37.9702], east, 8, 1000, 1000)!.fix).toBe(false);   // 22 m off: projected
    const near = linePlan([23.7, 37.9703], [23.7, 37.97], null);
    expect(near.fix).toBe(false);
    expect(near.plan.target(0)).toBeCloseTo(33, 0);
  });
  it("treats a fix well behind the bearing as a correction", () => {
    expect(linePlan(atM(100), atM(0), 90).fix).toBe(true);    // heading east, fix 100 m west
    expect(linePlan(atM(0), atM(100), 90).fix).toBe(false);   // ahead: glide
    expect(linePlan(atM(10), atM(0), 90).fix).toBe(false);    // GPS noise: glide
  });
});

describe("Mover lifecycle", () => {
  it("ahead of a standing target it rolls on slowly, then fades over to it after a bounded wait", () => {
    const mv = new Mover(atM(120));
    mv.setPlan(plan(() => 100), 120, 0);
    let prev = 120;
    for (let t = 0.1; t < WAIT_STAND_S - 1; t += 0.1) { const r = mv.step(t); expect(r.alpha).toBe(1); expect(mv.s).toBeGreaterThanOrEqual(prev); prev = mv.s; }
    expect(mv.s).toBeGreaterThan(120 + CRAWL * (WAIT_STAND_S - 1) - 5);   // rolled on at the crawl, never stood
    let faded = false;
    for (let t = WAIT_STAND_S - 1; t < WAIT_STAND_S + 3; t += 0.1) { const r = mv.step(t); faded ||= r.alpha < 1; }
    expect(faded).toBe(true);
    expect(mv.s).toBe(100);
  });
  it("waits on its way for a place behind on another geometry, and takes it up when it passes under", () => {
    const mv = new Mover(atM(400));
    mv.setPlan(plan(t => 400 + 8 * t), 400, 0);
    mv.step(0.1);
    // A fix 100 m behind with its own path along the same road, driving on at 8 m/s: planOnto puts the dot
    // on that path ahead of the guess, and it waits at a crawl (same as on one geometry).
    const path: LngLat[] = [atM(300), atM(600), atM(1000)];
    const h = pathPlan(mv.pos, path, 8, 0.1, 0.1);
    expect(h.fix).toBe(false);
    mv.apply(h, 0.1);
    let prev = mv.pos[0];
    for (let t = 0.2; t < 40; t += 0.1) { const r = mv.step(t); expect(r.alpha).toBe(1); expect(r.pos[0]).toBeGreaterThanOrEqual(prev - 1e-12); prev = r.pos[0]; }
    expect(mv.u).toBeGreaterThan(CRAWL + 1);                 // caught up and riding along again
  });
  it("gives a place behind with no way on, and standing, a short wait, then fades to it", () => {
    const mv = new Mover(atM(400));
    mv.setPlan(plan(() => 400), 400, 0);
    mv.step(0.1);
    const h = bridge(mv, linePlan(mv.pos, atM(300), 90));    // no path: a straight leg back along the road
    expect(h.back).toBe(true);
    mv.apply(h, 1);
    let faded: number | null = null;
    for (let t = 1.1; t < 1 + PENDING_STAND_S + 2; t += 0.1) { const r = mv.step(t); if (r.alpha < 1) faded ??= t; if (faded == null) expect(mv.pos[0]).toBeGreaterThanOrEqual(atM(400)[0]); }
    expect(faded).not.toBeNull();
    expect(faded!).toBeGreaterThan(1 + PENDING_STAND_S - 0.2);
    expect(distanceM(mv.pos, atM(300))).toBeLessThan(0.5);
  });
  it("restarts a running glide ahead from where the dot is when a new correction arrives", () => {
    const mv = new Mover(atM(0));
    mv.setPlan(plan(() => 0), 0, 0);
    mv.step(0.1);
    mv.apply({ plan: plan(() => 300), s0: 0, fix: true }, 1);   // a handoff far off the geometry: a glide ahead
    mv.step(1);
    const G = glideS(300, false);
    const mid = stepTo(mv, 1 + G / 2).pos;
    mv.apply({ plan: plan(() => 350), s0: 0, fix: true }, 1 + G / 2);   // newer fix, still far ahead
    expect(distanceM(mv.step(1 + G / 2 + 0.01).pos, atM(0))).toBeLessThan(2);   // s0 = 0 is the shown point in the handoff's own geometry
    expect(stepTo(mv, 1 + G).fx).not.toBeNull();             // a new schedule, not the old one
    stepTo(mv, 1 + G / 2 + GLIDE_MAX_S + 0.01);
    expect(mv.s).toBe(350);
    void mid;
  });
  it("goes on from where the dot is when the target moves on the same geometry mid-glide", () => {
    const mv = new Mover(atM(0));
    mv.setPlan(plan(() => 0), 0, 0);
    mv.step(0.1);
    mv.apply({ plan: plan(() => 300), s0: 0, fix: true }, 1);
    mv.step(1);
    const G = glideS(300, false);
    const mid = stepTo(mv, 1 + G / 2).pos;
    mv.retarget(plan(() => 200), 1 + G / 2);
    expect(distanceM(mv.step(1 + G / 2).pos, mid)).toBeLessThan(1);
    stepTo(mv, 1 + G * 1.5 + 0.01);
    expect(mv.s).toBe(200);
  });
  it("ends a glide without a jump when new data needs no correction, and fades its trail", () => {
    const mv = new Mover(atM(0));
    mv.setPlan(plan(() => 0), 0, 0);
    mv.step(0.1);
    mv.apply({ plan: plan(() => 300), s0: 0, fix: true }, 1);
    mv.step(1);                                              // the glide starts here
    const G = glideS(300, false);
    const mid = stepTo(mv, 1 + G / 2).pos;
    const h = linePlan(mid, atM(255), null);                 // close by: no correction
    expect(h.fix).toBe(false);
    mv.apply(h, 1 + G / 2);
    const r = mv.step(1 + G / 2 + 0.02);
    expect(r.fx).toBeNull();
    expect(distanceM(r.pos, mid)).toBeLessThan(2);
    expect(r.trail!.geom.length).toBeGreaterThanOrEqual(2);
    expect(mv.step(1 + G / 2 + TRAIL_S + 0.05).trail).toBeNull();
  });
  it("snaps on request (tab shown again) and with reduced motion", () => {
    const mv = new Mover(atM(0));
    mv.setPlan(plan(() => 300), 0, 0);
    mv.step(0.5);
    mv.snap();
    const sn = mv.step(0.6);
    expect(sn.fx).toBeNull();
    expect(sn.trail).toBeNull();
    expect(mv.s).toBe(300);
    const r = new Mover(atM(500));
    r.reduced = true;
    r.setPlan(plan(() => 500), 500, 0);
    r.step(0.1);
    r.setPlan(plan(() => 100), 500, 1);
    const st = r.step(1.1);
    expect(st.fx).toBeNull();
    expect(st.trail).toBeNull();
    expect(distanceM(st.pos, atM(100))).toBeLessThan(0.5);
  });

  it("tells where the target is, for culling off-screen dots", () => {
    const mv = new Mover(atM(0));
    expect(mv.targetPos(0)).toBeNull();
    mv.setPlan(plan(t => 8 * t), 0, 0);
    expect(distanceM(mv.targetPos(10)!, atM(80))).toBeLessThan(0.5);
  });

  it("keeps a fading offset when the target moves on the same geometry", () => {
    const mv = new Mover([23.705, 37.97015]);
    mv.setPlan(plan(() => M / 2), M / 2, 0, [0, 0.00015]);
    const a = mv.step(1).pos;
    mv.retarget(plan(() => M / 2 + 5), 1.05);
    const b = mv.step(1.05).pos;
    expect(distanceM(a, b)).toBeLessThan(1);
  });
  it("still snaps after a hidden tab when data arrives before the first frame", () => {
    const mv = new Mover(atM(0));
    mv.setPlan(plan(() => 0), 0, 0);
    mv.step(0.1);
    mv.snap();
    mv.setPlan(plan(() => 300), 0, 1);
    expect(mv.step(1.05).fx).toBeNull();
    expect(mv.s).toBe(300);
  });
});

describe("corrections ahead", () => {
  it("takes longer for a longer jump, within bounds: a slide, not a blink", () => {
    expect(glideS(200, false)).toBeGreaterThan(GLIDE_S);
    expect(200 / glideS(200, false)).toBeLessThan(40);   // never faster than this, m/s
    expect(glideS(5000, false)).toBe(GLIDE_MAX_S);
    expect(glideS(0, false)).toBe(GLIDE_S);
  });
  it("keeps facing its way while it waits for a place behind", () => {
    const mv = new Mover(onBent(M + 200));
    mv.setPlan(plan(() => M + 200, bent), M + 200, 0);
    mv.step(0.1);
    const h = bridge(mv, linePlan(mv.pos, onBent(M - 100), 0));   // heading north; the fix is back past the bend
    mv.apply(h, 1);
    for (let t = 1.05; t < 4; t += 0.1) { mv.step(t); expect(mv.heading()).toBeCloseTo(0, 0); }   // north, the way it travels
  });
});

describe("bridge", () => {
  const along = (mvS: number) => {
    const mv = new Mover(onBent(mvS));
    mv.setPlan(plan(() => mvS, bent), mvS, 0);
    mv.step(0.1);
    return mv;
  };
  it("takes a straight correction back along the route the dot was on", () => {
    const mv = along(M + 400);
    const h = bridge(mv, linePlan(mv.pos, onBent(200), 0));
    expect(h.fix).toBe(true);
    expect(h.back).toBe(true);
    expect(h.plan.geom).toHaveLength(3);                           // old place, the bend, the fix
    expect(h.plan.geom[1]).toEqual(bent[1]);
    expect(distanceM(h.plan.geom[2], onBent(200))).toBeLessThan(2);
    expect(h.plan.target(1)).toBeCloseTo(M + 200, -1);
  });
  it("takes a straight move ahead round the bend instead of across", () => {
    const mv = along(200);
    const h = bridge(mv, linePlan(mv.pos, onBent(M + 400), null));
    expect(h.back).toBe(false);
    expect(h.plan.geom).toHaveLength(3);
    expect(h.plan.geom[1]).toEqual(bent[1]);
  });
  it("goes on along the new path after the route bit", () => {
    const mv = along(M + 400);
    const path: LngLat[] = [onBent(200), onBent(M), onBent(M + 50)];   // the backend path from the fix on
    const h = bridge(mv, pathPlan(mv.pos, path, 8, 1, 1));
    expect(h.back).toBe(true);
    const back = M + 200;
    expect(h.plan.target(1)).toBeCloseTo(back, -1);
    expect(h.plan.target(1 + 20)).toBeGreaterThan(back + 10);       // and drives on from there
  });
  it("starts at the shown point, fading offset included: no jump", () => {
    const mv = new Mover([23.705, 37.9702]);                       // 22 m north of the line, fading in
    mv.setPlan(plan(() => M / 2), M / 2, 0, [0, 0.0002]);
    const shown = mv.step(0.1).pos;
    mv.apply(bridge(mv, linePlan(shown, atM(100), 90)), 0.1);
    expect(distanceM(mv.step(0.11).pos, shown)).toBeLessThan(1);
  });
  it("leaves a handoff alone when the fix is off the old route, or nothing is straight", () => {
    const mv = along(M + 400);
    const off = linePlan(mv.pos, [23.705, 37.975], 0);
    expect(bridge(mv, off)).toBe(off);
    const near = linePlan(mv.pos, onBent(M + 410), 0);             // close by: nothing to bridge
    expect(bridge(mv, near)).toBe(near);
    const fresh = new Mover(onBent(M + 400));                     // no plan yet
    const h = linePlan(fresh.pos, onBent(200), 0);
    expect(bridge(fresh, h)).toBe(h);
  });
});

describe("walk (contract rev 6 path_speeds)", () => {
  it("moves at each 200 m step's speed (times STEP_PACE), then at the fallback", () => {
    expect(STEP_M).toBe(200);
    const f = walk([4, 2], 1, 1000);
    expect(f(10 / STEP_PACE)).toBeCloseTo(40, 6);
    expect(f(50 / STEP_PACE)).toBeCloseTo(200, 6);
    expect(f(60 / STEP_PACE)).toBeCloseTo(220, 6);
    expect(f(150 / STEP_PACE)).toBeCloseTo(400, 6);
    expect(f(160 / STEP_PACE)).toBeCloseTo(410, 6);               // past the steps: fallback
  });
  it("takes a null step at the fallback; a zero fallback stands there", () => {
    const f = walk([null, 5], 2, 1000);
    expect(f(100 / STEP_PACE)).toBeCloseTo(200, 6);
    expect(f(110 / STEP_PACE)).toBeCloseTo(250, 6);
    expect(walk([null], 0, 1000)(50 / STEP_PACE)).toBe(0);
    expect(walk([3, null], 0, 1000)(500 / STEP_PACE)).toBeCloseTo(200, 6);
  });
  it("stops at the end and after the horizon; nothing before the fix", () => {
    expect(walk([10], 10, 150)(100 / STEP_PACE)).toBeCloseTo(150, 6);
    expect(walk([1], 1, 1e4)(HORIZON_S + 100)).toBeCloseTo(HORIZON_S * STEP_PACE, 6);
    expect(walk([4], 4, 1000)(-5)).toBe(0);
  });
  it("is what pathPlan drives when the vehicle has path_speeds (no stop waits)", () => {
    const end = cumulativeLL(east)[2];
    const r = pathPlan(atM(0), east, 15, 1000, 1000, [400], [6, 3]);
    expect(r.plan.target(1040)).toBeCloseTo(careful(walk([6, 3], 15, end), 0)(40), 5);
    expect(pathPlan(atM(0), east, 15, 1000, 1000, [400], null).plan.target(1040)).toBeCloseTo(careful(drive(15, [400], end), 0)(40), 5);
    expect(pathPlan(atM(0), east, 15, 1000, 1000, [400], []).plan.target(1040)).toBeCloseTo(careful(drive(15, [400], end), 0)(40), 5);
  });
});

