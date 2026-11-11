import { describe, expect, it } from "vitest";
import { headingAlong, mixBearing, turnBetween, Turner, Turners } from "../src/lib/turn";

describe("turn", () => {
  it("turns the short way round", () => {
    expect(turnBetween(350, 10)).toBe(20);
    expect(turnBetween(10, 350)).toBe(-20);
    expect(mixBearing(350, 10, 0.5)).toBe(0);
  });

  it("blends the heading through a corner, not at the vertex", () => {
    const bearing = [0, 90], cum = [0, 100, 200];
    expect(headingAlong(bearing, cum, 50)).toBe(0);
    expect(headingAlong(bearing, cum, 150)).toBe(90);
    expect(headingAlong(bearing, cum, 100)).toBeCloseTo(45, 5);   // half way at the corner
    const before = headingAlong(bearing, cum, 94)!, after = headingAlong(bearing, cum, 106)!;
    expect(before).toBeGreaterThan(0); expect(before).toBeLessThan(45);
    expect(after).toBeGreaterThan(45); expect(after).toBeLessThan(90);
    // continuous across the vertex
    expect(Math.abs(headingAlong(bearing, cum, 99.99)! - headingAlong(bearing, cum, 100.01)!)).toBeLessThan(0.1);
    expect(headingAlong([], [0], 0)).toBeNull();
  });

  it("turns toward the target over time, never faster than the cap", () => {
    const t = new Turner();
    expect(t.toward(0, 0)).toBe(0);
    const h = t.toward(180 - 1, 0.1)!;          // a near U-turn in 0.1 s
    expect(h).toBeGreaterThan(0);
    expect(h).toBeLessThanOrEqual(30 + 1e-9);   // 300°/s × 0.1 s
    let x = h;
    for (let i = 2; i <= 40; i++) x = t.toward(179, i * 0.05)!;
    expect(x).toBe(179);
    expect(t.toward(null, 3)).toBeNull();
    expect(t.toward(90, 3.1)).toBe(90);          // after none: taken as is
    expect(t.toward(270, 10)).toBe(270);         // after a long gap: taken as is
  });

  it("keeps one per vehicle and says while one is still turning", () => {
    const ts = new Turners();
    ts.toward("a", 0, 0); ts.toward("b", 0, 0);
    ts.busy = false;
    ts.toward("a", 90, 0.016);
    expect(ts.busy).toBe(true);
    ts.keep(["a"]);
    expect(ts.size).toBe(1);
  });
});

describe("headingAlong on a short leg", () => {
  it("has no jump where two corners' windows would overlap (a 6 m leg)", () => {
    const bearing = [0, 90, 180], cum = [0, 100, 106, 206];
    let prev = headingAlong(bearing, cum, 90)!;
    for (let s = 90.1; s <= 120; s += 0.1) {
      const h = headingAlong(bearing, cum, s)!;
      expect(Math.abs(((h - prev + 540) % 360) - 180)).toBeLessThan(10);
      prev = h;
    }
  });
});
