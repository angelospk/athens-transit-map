import { describe, expect, it } from "vitest";
import { distanceM, type LngLat } from "../src/lib/glide";
import {
  bridge, CATCH_MAX, chase, cumulativeLL, drive, DWELL_S, GLIDE_MAX_S, GLIDE_S, glideS, holdM, HORIZON_S, linePlan, MIN_CRUISE, Mover, PACE,
  pathPlan, pointAtLL, project, STEP_M, subLine, TRAIL_S, walk, type Plan,
} from "../src/lib/motion";

// 0.01° lon at 37.97° ≈ 877 m. Geometry here is [lon, lat].
const M = 877.4;
const east: LngLat[] = [[23.70, 37.97], [23.71, 37.97], [23.72, 37.97]];
const plan = (target: (t: number) => number, geom = east): Plan => ({ geom, cum: cumulativeLL(geom), target });
const atM = (m: number): LngLat => [23.70 + (m / M) * 0.01, 37.97];
// East M metres, then north (0.01° lat ≈ 1112 m): a bend at s = M.
const N = 1111.9;
const bent: LngLat[] = [[23.70, 37.97], [23.71, 37.97], [23.71, 37.98]];
const onBent = (m: number): LngLat => (m <= M ? atM(m) : [23.71, 37.97 + ((m - M) / N) * 0.01]);

describe("chase", () => {
  it("moves at target speed when on target, faster when behind, never overshoots", () => {
    expect(chase(96, 100, 8, 0.5)).toBe(100);               // the target moved 4 m: reach it
    const late = chase(0, 100, 8, 0.5) as number;
    expect(late).toBeGreaterThan(0.5 * 8);                   // faster than v
    expect(late).toBeLessThanOrEqual(0.5 * (8 + CATCH_MAX) + 1e-9); // capped catch-up
    expect(CATCH_MAX).toBeLessThanOrEqual(6);                // no burst after new data
    expect(chase(99, 100, 0, 5)).toBeLessThanOrEqual(100);   // no overshoot
    expect(chase(99, 100, 0, 5)).toBeGreaterThan(99);
  });
  it("slows down instead of reversing when a little ahead", () => {
    const ahead = chase(110, 100, 8, 0.5) as number;
    expect(ahead).toBeGreaterThanOrEqual(110);
    expect(ahead - 110).toBeLessThan(4);
    expect(chase(120, 100, 0, 1)).toBe(120);                 // standing target: wait
  });
  it("asks for a correction when far behind the target or far ahead of it", () => {
    expect(chase(100 + holdM(8) + 1, 100, 8, 0.1)).toBe("fix");
    expect(chase(0, 700, 8, 0.1)).toBe("fix");
    expect(holdM(0)).toBe(25);
    expect(holdM(100)).toBe(80);
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
    expect(mv.s).toBeGreaterThan(5);
    expect(mv.s).toBeLessThanOrEqual(CATCH_MAX + 1e-9);
    for (let t = 1.1; t < 90; t += 0.1) mv.step(t);
    expect(mv.s).toBeCloseTo(200, 0);
  });
  it("glides back along the route to a target far behind, then leaves a fading trail", () => {
    const mv = new Mover(onBent(M + 500));
    mv.setPlan(plan(() => M + 500, bent), M + 500, 0);
    mv.step(0.1);
    mv.retarget(plan(() => 200, bent), 1);   // the target jumps back past the bend
    const a = mv.step(1.1);
    expect(a.fx).not.toBeNull();
    expect(distanceM(a.pos, onBent(M + 500))).toBeLessThan(1);           // starts where it was
    const q = mv.step(1.1 + GLIDE_S / 4);
    expect(mv.s).toBeCloseTo(M + 500 - (M + 300) * (1 / 16), 0);          // ease-in-out: slow start
    expect(distanceM(q.trail!.geom[0], onBent(M + 500))).toBeLessThan(2);
    mv.step(1.1 + GLIDE_S * 0.75);
    expect(mv.s).toBeLessThan(M);                                          // past the bend, on the route
    const end = mv.step(1.1 + GLIDE_S + 0.01);
    expect(end.fx).toBeNull();
    expect(mv.s).toBe(200);
    expect(end.trail!.geom).toHaveLength(3);                               // old place, bend, new place
    expect(end.trail!.alpha).toBeGreaterThan(0.9);
    expect(mv.fixing).toBe(true);                                          // still drawing the trail
    expect(mv.step(1.1 + GLIDE_S + TRAIL_S / 2).trail!.alpha).toBeCloseTo(0.5, 1);
    expect(mv.step(1.1 + GLIDE_S + TRAIL_S + 0.01).trail).toBeNull();
    expect(mv.fixing).toBe(false);
  });
  it("glides forward to a target far ahead, never backwards", () => {
    const mv = new Mover(atM(0));
    mv.setPlan(plan(() => 0), 0, 0);
    mv.step(0.1);
    mv.retarget(plan(() => 1500), 0.2);
    let prev = 0;
    for (let t = 0.3; t < 0.3 + GLIDE_MAX_S + 0.1; t += 0.05) {
      mv.step(t);
      expect(mv.s).toBeGreaterThanOrEqual(prev);
      prev = mv.s;
    }
    expect(mv.s).toBe(1500);
  });
  it("starts a correction glide from the shown point of a fix handoff", () => {
    const mv = new Mover(atM(1500));
    mv.setPlan(plan(() => 1500), 1500, 0);
    mv.step(0.1);
    const h = linePlan(mv.pos, atM(100), 90);                // far behind the bearing: a correction
    expect(h.fix).toBe(true);
    mv.apply(h, 1);
    expect(distanceM(mv.step(1.01).pos, atM(1500))).toBeLessThan(2);
    expect(distanceM(mv.step(1 + GLIDE_S + 0.01).pos, atM(100))).toBeLessThan(0.5);
  });
  it("drops the old sideways offset on a correction to new geometry: it starts at the shown point", () => {
    const mv = new Mover([23.71, 37.9702]);
    mv.setPlan(plan(() => M), M, 0, [0, 0.0002]);
    const a = mv.step(0.1).pos;
    mv.apply(linePlan(a, atM(100), 90), 0.15);              // far behind the bearing: a correction
    expect(distanceM(mv.step(0.2).pos, a)).toBeLessThan(3);
  });
  it("keeps a fading sideways offset when a glide starts: no jump", () => {
    const mv = new Mover([23.71, 37.9702]);                 // 22 m north of the line at s = M
    mv.setPlan(plan(() => M), M, 0, [0, 0.0002]);
    const a = mv.step(0.1).pos;
    mv.retarget(plan(() => 100), 0.15);
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
    expect(r.plan.target(1010)).toBeCloseTo(drive(8, [], cumulativeLL(east)[2])(10), 5);   // the path starts at the fix
  });
  it("drives into the stops of the path and stops at its end", () => {
    const r = pathPlan(atM(0), east, 15, 1000, 1000, [400])!;
    const end = cumulativeLL(east)[2];
    expect(r.plan.target(1000 + 600)).toBeCloseTo(end, 6);
    const f = drive(15, [400], end);
    expect(r.plan.target(1040)).toBeCloseTo(f(40), 5);
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
  it("corrects a dot left ahead of a standing target after a bounded wait", () => {
    const mv = new Mover(atM(120));
    mv.setPlan(plan(() => 100), 120, 0);
    let fx = false;
    for (let t = 0.1; t < 5; t += 0.1) fx ||= mv.step(t).fx != null;
    expect(fx).toBe(false);                     // waits first: the bus may still be there
    for (let t = 5; t < 8; t += 0.1) fx ||= mv.step(t).fx != null;
    expect(fx).toBe(true);
    for (let t = 8; t < 10; t += 0.1) mv.step(t);
    expect(mv.s).toBe(100);
  });
  it("restarts a running glide from where the dot is when a new correction arrives", () => {
    const mv = new Mover(atM(1500));
    mv.setPlan(plan(() => 1500), 1500, 0);
    mv.step(0.1);
    mv.retarget(plan(() => 100), 1);
    mv.step(1);                                              // the glide starts here
    const mid = mv.step(1 + GLIDE_S / 2).pos;
    mv.apply(linePlan(mid, atM(50), 90), 1 + GLIDE_S / 2);   // newer fix, still far behind
    expect(distanceM(mv.step(1 + GLIDE_S / 2 + 0.01).pos, mid)).toBeLessThan(2);
    expect(mv.step(1 + GLIDE_S).fx).not.toBeNull();          // a new schedule, not the old one
    mv.step(1 + GLIDE_S * 1.5 + 0.01);
    expect(distanceM(mv.pos, atM(50))).toBeLessThan(0.5);
  });
  it("goes on from where the dot is when the target moves on the same geometry mid-glide", () => {
    const mv = new Mover(atM(1500));
    mv.setPlan(plan(() => 1500), 1500, 0);
    mv.step(0.1);
    mv.retarget(plan(() => 100), 1);
    mv.step(1);
    const mid = mv.step(1 + GLIDE_S / 2).pos;
    mv.retarget(plan(() => 200), 1 + GLIDE_S / 2);
    expect(distanceM(mv.step(1 + GLIDE_S / 2).pos, mid)).toBeLessThan(1);
    mv.step(1 + GLIDE_S * 1.5 + 0.01);
    expect(mv.s).toBe(200);
  });
  it("ends a glide without a jump when new data needs no correction, and fades its trail", () => {
    const mv = new Mover(atM(1500));
    mv.setPlan(plan(() => 1500), 1500, 0);
    mv.step(0.1);
    mv.retarget(plan(() => 100), 1);
    mv.step(1);                                              // the glide starts here
    const mid = mv.step(1 + GLIDE_S / 2).pos;
    const h = linePlan(mid, atM(805), null);                 // close by: no correction
    expect(h.fix).toBe(false);
    mv.apply(h, 1 + GLIDE_S / 2);
    const r = mv.step(1 + GLIDE_S / 2 + 0.02);
    expect(r.fx).toBeNull();
    expect(distanceM(r.pos, mid)).toBeLessThan(2);
    expect(r.trail!.geom.length).toBeGreaterThanOrEqual(2);
    expect(mv.step(1 + GLIDE_S / 2 + TRAIL_S + 0.05).trail).toBeNull();
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

describe("corrections forward and back", () => {
  it("takes longer for a longer jump ahead, within bounds; a jump back is quick", () => {
    expect(glideS(700, false)).toBeGreaterThan(GLIDE_S);
    expect(glideS(5000, false)).toBe(GLIDE_MAX_S);
    expect(glideS(5000, true)).toBe(GLIDE_S);
    expect(glideS(0, false)).toBe(GLIDE_S);
  });
  it("marks a glide back, and its trail, as back; a glide ahead is not", () => {
    const mv = new Mover(atM(1500));
    mv.setPlan(plan(() => 1500), 1500, 0);
    mv.step(0.1);
    mv.retarget(plan(() => 100), 1);
    expect(mv.step(1.1).back).toBe(true);
    const end = mv.step(1.1 + GLIDE_S + 0.01);
    expect(end.trail).not.toBeNull();
    expect(end.back).toBe(true);
    const fw = new Mover(atM(0));
    fw.setPlan(plan(() => 0), 0, 0);
    fw.step(0.1);
    fw.retarget(plan(() => 1500), 0.2);
    const r = fw.step(0.3);
    expect(r.fx).not.toBeNull();
    expect(r.back).toBe(false);
  });
  it("keeps facing the way it travels while it glides back", () => {
    const mv = new Mover(onBent(M + 500));
    mv.setPlan(plan(() => M + 500, bent), M + 500, 0);
    mv.step(0.1);
    const h = bridge(mv, linePlan(mv.pos, onBent(200), 0));   // heading north; the fix is back past the bend
    mv.apply(h, 1);
    mv.step(1.05);
    mv.step(1 + GLIDE_S * 0.75);                                   // past the bend, going west on the route
    expect(mv.heading()).toBeCloseTo(0, 0);                        // still north, the way it travels
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
  it("moves at each 200 m step's speed, then at the fallback", () => {
    expect(STEP_M).toBe(200);
    const f = walk([4, 2], 1, 1000);
    expect(f(10)).toBeCloseTo(40, 6);
    expect(f(50)).toBeCloseTo(200, 6);
    expect(f(60)).toBeCloseTo(220, 6);
    expect(f(150)).toBeCloseTo(400, 6);
    expect(f(160)).toBeCloseTo(410, 6);               // past the steps: fallback
  });
  it("takes a null step at the fallback; a zero fallback stands there", () => {
    const f = walk([null, 5], 2, 1000);
    expect(f(100)).toBeCloseTo(200, 6);
    expect(f(110)).toBeCloseTo(250, 6);
    expect(walk([null], 0, 1000)(50)).toBe(0);
    expect(walk([3, null], 0, 1000)(500)).toBeCloseTo(200, 6);
  });
  it("stops at the end and after the horizon; nothing before the fix", () => {
    expect(walk([10], 10, 150)(100)).toBeCloseTo(150, 6);
    expect(walk([1], 1, 1e4)(HORIZON_S + 100)).toBeCloseTo(HORIZON_S, 6);
    expect(walk([4], 4, 1000)(-5)).toBe(0);
  });
  it("is what pathPlan drives when the vehicle has path_speeds (no stop waits)", () => {
    const end = cumulativeLL(east)[2];
    const r = pathPlan(atM(0), east, 15, 1000, 1000, [400], [6, 3]);
    expect(r.plan.target(1040)).toBeCloseTo(walk([6, 3], 15, end)(40), 5);
    expect(pathPlan(atM(0), east, 15, 1000, 1000, [400], null).plan.target(1040)).toBeCloseTo(drive(15, [400], end)(40), 5);
    expect(pathPlan(atM(0), east, 15, 1000, 1000, [400], []).plan.target(1040)).toBeCloseTo(drive(15, [400], end)(40), 5);
  });
});
