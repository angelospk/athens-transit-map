import { describe, expect, it } from "vitest";
import { backToClear, BACK_MAX, follow, FOLLOW_BRAKE, separate, type Box, type Follow } from "../src/lib/map/spacing";

const LEN = 15.6, WIDE = 3.25, FPS = 60, dt = 1 / FPS;

// Two buses north, both drawn on their data's place, the one ahead stopping at a stop: the one behind is held back
// by its target, as scene3d.spaced runs it.
describe("follow", () => {
  it("is drawn on its place, at its speed, with nothing ahead", () => {
    const st: Follow = { back: 0, u: 0 };
    for (let i = 0; i < 60; i++) follow(st, 8 * dt, 0, dt);
    expect(st.back).toBe(0);
    expect(st.u).toBeCloseTo(8);
  });
  it("brakes into a target back as a bus does: never backwards, never harder than its brakes", () => {
    const st: Follow = { back: 0, u: 8 };
    let prevU = 8, minStep = Infinity;
    for (let i = 0; i < 10 * FPS; i++) {
      follow(st, 8 * dt, 12, dt);   // its data drives on at 8 m/s; it should be 12 m back
      minStep = Math.min(minStep, st.u * dt);
      expect(prevU - st.u).toBeLessThanOrEqual(FOLLOW_BRAKE * dt + 1e-9);
      prevU = st.u;
    }
    expect(minStep).toBeGreaterThanOrEqual(0);
    expect(st.back).toBeGreaterThan(11);
    expect(st.back).toBeLessThan(13);
    expect(st.u).toBeCloseTo(8, 0);   // held there, at its place's speed
  });
  it("stands behind one standing, and pulls away smoothly when let go, back onto its place", () => {
    const st: Follow = { back: 0, u: 0 };
    let back = 0;
    // its data's place creeps forward 6 m into the one ahead (target grows with it): it stands still drawn
    for (let i = 0; i < 3 * FPS; i++) { back += 2 * dt; follow(st, 2 * dt, back, dt); }
    expect(st.u).toBeLessThan(0.5);
    // the one ahead leaves: no target; it pulls away and is back on its place without a jump
    let maxJump = 0, last = -st.back;
    for (let i = 0; i < 20 * FPS; i++) { follow(st, 5 * dt, 0, dt); const at = (i + 1) * 5 * dt - st.back; maxJump = Math.max(maxJump, at - last); last = at; }
    expect(st.back).toBe(0);
    expect(maxJump).toBeLessThan(10 * dt);   // never faster than its place plus the catch-up
  });
  it("stands in a queue whose places creep on: keeps to its target instead of trailing it", () => {
    const st: Follow = { back: 0, u: 0 };
    let target = 0, worst = 0;
    for (let i = 0; i < 20 * FPS; i++) { target += 2 * dt; follow(st, 2 * dt, target, dt); if (i > 3 * FPS) worst = Math.max(worst, target - st.back); }
    expect(worst).toBeLessThan(0.5);   // under the queue's margin: the hard pass never has to push it back
  });
  it("is never drawn ahead of its place, nor farther back than BACK_MAX", () => {
    const st: Follow = { back: 3, u: 20 };
    follow(st, 0, 0, dt);
    expect(st.back).toBeGreaterThanOrEqual(0);
    const far: Follow = { back: 0, u: 0 };
    for (let i = 0; i < 60 * FPS; i++) follow(far, 10 * dt, 1000, dt);
    expect(far.back).toBeLessThanOrEqual(BACK_MAX + 0.5);
  });
});

describe("backToClear", () => {
  const n = (key: string, x: number, y: number, h = 0): Box => ({ key, x, y, h });
  it("is 0 for buses apart, in line or side by side", () => {
    expect(backToClear(n("a", 0, 20), n("b", 0, 0), LEN, WIDE)).toBe(0);
    expect(backToClear(n("a", 0, 0), n("b", 3.6, 0), LEN, WIDE)).toBe(0);
  });
  it("moves the one behind back just far enough, in line", () => {
    const s = backToClear(n("a", 0, 10), n("b", 0, 0), LEN, WIDE);
    expect(s).toBeCloseTo(LEN - 10 + 0.3, 5);
  });
  it("parts two at right angles (a junction)", () => {
    const a = n("a", 0, 0, 90), b = n("b", -2, -6, 0);   // b heading north into a's side
    const s = backToClear(a, b, LEN, WIDE);
    expect(s).toBeGreaterThan(0);
    expect(backToClear(a, { ...b, y: b.y - s - 1e-6 }, LEN, WIDE)).toBe(0);
  });
});

describe("separate", () => {
  it("leaves no two drawn buses touching, a queue from its head", () => {
    const boxes: Box[] = [{ key: "a", x: 0, y: 20, h: 0 }, { key: "b", x: 0.3, y: 12, h: 2 }, { key: "c", x: -0.2, y: 4, h: 358 }, { key: "d", x: 6, y: 9, h: 30 }];
    const s = separate(boxes, LEN, WIDE, 6);
    const drawn = boxes.map(b => { const k = s.get(b.key) ?? 0, r = (b.h * Math.PI) / 180; return { ...b, x: b.x - Math.sin(r) * k, y: b.y - Math.cos(r) * k }; });
    for (let i = 0; i < drawn.length; i++) for (let j = i + 1; j < drawn.length; j++) {
      expect(backToClear(drawn[i], drawn[j], LEN, WIDE - 0.05) + backToClear(drawn[j], drawn[i], LEN, WIDE - 0.05)).toBeLessThan(0.35);
    }
    expect(s.get("a") ?? 0).toBe(0);   // the head stays on its place
  });
  it("moves one appearing this frame, not the one already there (a bus never seen jumping back)", () => {
    const s = separate([{ key: "old", x: 0, y: 0, h: 0 }, { key: "new", x: 0, y: -8, h: 0, fresh: true }], LEN, WIDE);
    expect(s.get("old") ?? 0).toBe(0);
    expect(s.get("new")!).toBeGreaterThan(7);
    // even when it appears ahead of the other: it goes in behind it
    const t = separate([{ key: "old", x: 0, y: 0, h: 0 }, { key: "new", x: 0, y: 6, h: 0, fresh: true }], LEN, WIDE);
    expect(t.get("old") ?? 0).toBe(0);
    expect(t.get("new")!).toBeGreaterThan(LEN + 6 - 1);
  });
  it("leaves two going opposite ways to edge apart sideways", () => {
    expect(separate([{ key: "a", x: 0, y: 0, h: 0 }, { key: "b", x: 0.5, y: 4, h: 180 }], LEN, WIDE).size).toBe(0);
  });
});
