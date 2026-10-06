import { describe, expect, it } from "vitest";
import { distanceM, type LngLat } from "../src/lib/glide";
import { aheadM, chase, cumulativeLL, GLIDE_S, holdM, linePlan, Mover, pathPlan, pointAtLL, project, subLine, TRAIL_S, type Plan } from "../src/lib/motion";

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
    expect(late).toBeGreaterThan(4 + 4);                     // faster than v
    expect(late).toBeLessThanOrEqual(0.5 * (8 + 10) + 1e-9); // capped catch-up
    expect(chase(99, 100, 0, 5)).toBe(100);                  // no overshoot
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
    expect(mv.s).toBeLessThanOrEqual(10 + 1e-9);
    for (let t = 1.1; t < 30; t += 0.1) mv.step(t);
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
    for (let t = 0.3; t < 0.3 + GLIDE_S + 0.1; t += 0.05) {
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

describe("plans from new data", () => {
  it("continues along a new path from the projected shown point", () => {
    const r = pathPlan(atM(300), east, 8, 1000, 1000)!;
    expect(r.fix).toBe(false);
    expect(r.s0).toBeCloseTo(300, 0);
    expect(r.plan.target(1010)).toBeCloseTo(aheadM(8, 10), 5);   // the path starts at the fix
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

