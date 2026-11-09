import { describe, expect, it } from "vitest";
import { PoseSmoother } from "../src/lib/map/smoothPose";

const FPS = 60;
// Runs `place(t)` (where it should be) through the smoother at 60 frames a second for `secs`.
function run(place: (t: number) => [number, number], secs: number, heading = 0) {
  const sm = new PoseSmoother(), out: { t: number; x: number; y: number; raw: [number, number]; h: number | null }[] = [];
  for (let i = 0; i <= secs * FPS; i++) {
    const t = i / FPS, raw = place(t), r = sm.step("a", raw[0], raw[1], heading, t);
    out.push({ t, x: r.x, y: r.y, raw, h: r.heading });
  }
  return out;
}

describe("PoseSmoother", () => {
  it("does not lag behind at a steady speed", () => {
    const o = run(t => [0, 10 * t], 6);
    const last = o[o.length - 1];
    expect(Math.abs(last.y - last.raw[1])).toBeLessThan(0.2);
    expect(Math.abs(last.x)).toBeLessThan(1e-6);
  });

  it("spreads a hop sideways over a glide, and leans into it only a little", () => {
    // 10 m/s north; at 2 s the place moves 1.7 m to the right in one frame (a lane, a road nudge).
    const o = run(t => [t < 2 ? 0 : 1.7, 10 * t], 6);
    let maxStep = 0;
    for (let i = 1; i < o.length; i++) maxStep = Math.max(maxStep, Math.abs(o[i].x - o[i - 1].x));
    expect(maxStep).toBeLessThan(0.12);   // a metre and a bit, over many frames, not in one
    expect(Math.abs(o[o.length - 1].x - 1.7)).toBeLessThan(0.05);   // and it gets there
    const hs = o.map(r => r.h!).map(h => (h > 180 ? h - 360 : h));
    expect(Math.max(...hs.map(Math.abs))).toBeLessThanOrEqual(12);
  });

  it("changes lanes as a smooth turn out and back, without wagging", () => {
    // 8 m/s north, 12 m over to the left in the 50 m before a turn, eased (as roadSnap.turnBlend has it).
    const ease = (k: number) => k * k * (3 - 2 * k);
    const o = run(t => { const y = 8 * t, k = Math.max(0, Math.min(1, (y - 40) / 50)); return [-12 * ease(k), y]; }, 14);
    const hs = o.map(r => (r.h! > 180 ? r.h! - 360 : r.h!));
    let sign = 0, flips = 0;
    for (let i = 1; i < hs.length; i++) { const d = Math.sign(Math.round((hs[i] - hs[i - 1]) * 1000)); if (d && sign && d !== sign) flips++; if (d) sign = d; }
    expect(flips).toBeLessThanOrEqual(2);   // turns out, turns back: no wag
    expect(Math.min(...hs)).toBeLessThan(-5);   // and visibly steers into it
  });

  it("keeps a jittering place steady", () => {
    // The place jumps ±0.6 m back and forth along the way every few frames (a projection at vertices).
    const o = run(t => [0, 8 * t + (Math.floor(t * 12) % 2 ? 0.6 : -0.6)], 5);
    const steps = o.slice(60).map((r, i, a) => (i ? (r.y - a[i - 1].y) * FPS : 8)).slice(1);
    expect(Math.min(...steps)).toBeGreaterThan(5);
    expect(Math.max(...steps)).toBeLessThan(11);
  });

  it("crawling, changes lanes slowly and steers into it: never slides sideways", () => {
    // 2 m/s north; the place moves 3.5 m to the left at once (a lane for a turn).
    const o = run(t => [t < 1 ? 0 : -3.5, 2 * t], 12);
    for (let i = 1; i < o.length; i++) {
      const dx = o[i].x - o[i - 1].x, dy = o[i].y - o[i - 1].y;
      if (Math.abs(dx) > 1e-6) expect(Math.abs(dx) / Math.max(dy, 1e-9)).toBeLessThanOrEqual(0.2 + 0.12 / 60 / Math.max(dy, 1e-9) + 1e-9);
    }
    const hs = o.map(r => (r.h! > 180 ? r.h! - 360 : r.h!));
    expect(Math.min(...hs)).toBeLessThan(-6);   // steered left
    expect(Math.abs(o[o.length - 1].x + 3.5)).toBeLessThan(0.1);
  });

  it("goes round a corner close to it", () => {
    // East at 8 m/s, then at (40, 0) north.
    const o = run(t => (t < 5 ? [8 * t, 0] : [40, 8 * (t - 5)]), 10, 90);
    let worst = 0;
    for (const r of o) worst = Math.max(worst, Math.min(Math.hypot(r.x - Math.min(40, Math.max(0, r.x)), r.y), Math.hypot(r.x - 40, r.y - Math.max(0, r.y))));
    expect(worst).toBeLessThan(2.5);
  });

  it("jumps with a new place far off, and starts again after a pause", () => {
    const sm = new PoseSmoother();
    sm.step("a", 0, 0, 0, 0);
    expect(sm.step("a", 100, 0, 0, 1 / 60).x).toBe(100);
    sm.step("a", 100, 0, 0, 2 / 60);
    expect(sm.step("a", 105, 0, 0, 2).x).toBe(105);
  });

  it("turns through a corner as a bus: gradually, its rear cutting in, and straight again after", () => {
    // East at 8 m/s, then at (40, 0) north, the way's heading turning at the corner in one frame.
    const sm = new PoseSmoother(), hs: number[] = [];
    for (let i = 0; i <= 10 * FPS; i++) {
      const t = i / FPS, east = t < 5, raw: [number, number] = east ? [8 * t, 0] : [40, 8 * (t - 5)];
      hs.push(sm.step("a", raw[0], raw[1], east ? 90 : 0, t).heading!);
    }
    let maxStep = 0;
    for (let i = 1; i < hs.length; i++) maxStep = Math.max(maxStep, Math.abs(((hs[i] - hs[i - 1] + 540) % 360) - 180));
    expect(maxStep).toBeLessThan(6);            // degrees a frame: a swing, not a snap
    expect(hs[4 * FPS]).toBeCloseTo(90, 0);     // on the straight, along it
    expect(Math.abs(((hs[hs.length - 1] + 540) % 360) - 180)).toBeLessThan(2);   // north again, 40 m on
  });

  it("standing, does not turn when its way's heading changes", () => {
    const sm = new PoseSmoother();
    sm.step("a", 0, 0, 0, 0);
    let h = 0;
    for (let i = 1; i <= 2 * FPS; i++) h = sm.step("a", 0, 0, 30, i / FPS).heading!;   // its way now 30° off, it stands
    expect(h).toBeCloseTo(0, 5);
  });

  it("faces its way at once when put on a stretch that runs the other way (a new place, a U-turn)", () => {
    const sm = new PoseSmoother();
    for (let i = 0; i <= FPS; i++) sm.step("a", 0, 8 * (i / FPS), 0, i / FPS);
    const r = sm.step("a", 0, 8 + 8 / FPS, 180, 1 + 1 / FPS);
    expect(r.heading).toBe(180);
  });
});
