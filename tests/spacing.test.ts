import { describe, expect, it } from "vitest";
import { BACK_PERIOD, LAT_PERIOD, spacingTargets, springStep, type Car, type Gap } from "../src/lib/map/spacing";

const LEN = 15.6, LANE = 3.6, WIDE = 3.25;
// Heading north (0°): y grows ahead.
const car = (key: string, y: number, v: number, x = 0, heading: number | null = 0): Car => ({ key, x, y, heading, v, moving: v > 1 });
const t = (cars: Car[], now = new Map<string, Gap>()) => spacingTargets(cars, now, LEN, LANE, WIDE);

describe("spacingTargets", () => {
  it("leaves buses apart alone", () => {
    expect([...t([car("a", 0, 8), car("b", 60, 8)]).values()]).toEqual([{ lat: 0, back: 0 }, { lat: 0, back: 0 }]);
  });
  it("pulls out early, before it reaches a slower one ahead", () => {
    // 25 m apart (not touching yet), closing at 6 m/s: it would be there in under 3 s.
    expect(t([car("a", 0, 9), car("b", 25, 3)]).get("a")).toEqual({ lat: LANE, back: 0 });
    // Same gap, the same speed: no reason to pass.
    expect(t([car("a", 0, 6), car("b", 25, 6)]).get("a")!.lat).toBe(0);
  });
  it("keeps the passing one out once it is ahead, until it is clear", () => {
    const now = new Map<string, Gap>([["a", { lat: LANE, back: 0 }]]);
    const r = t([car("a", 18, 9), car("b", 0, 3)], now);   // 18 m ahead: past, not yet clear
    expect(r.get("a")!.lat).toBe(LANE);
    expect(r.get("b")!.lat).toBe(0);
    expect(t([car("a", 30, 9), car("b", 0, 3)], now).get("a")!.lat).toBe(0);   // clear: back in
  });
  it("puts standing buses in line, one behind the other", () => {
    const r = t([car("a", 10, 0), car("b", 5, 0), car("c", 0, 0)]);
    expect(r.get("a")!.back).toBe(0);
    expect(r.get("b")!.back).toBeCloseTo(LEN + 1.5 - 5);
    expect(r.get("c")!.back).toBeGreaterThan(r.get("b")!.back);
  });
  it("counts a bus a little to the side as in the way (they would touch)", () => {
    expect(t([car("a", 0, 0), car("b", 4, 0, 2.6)]).get("a")!.back).toBeGreaterThan(0);
  });
  it("passes on the right when there is no road on the left, and keeps in line when there is none either side", () => {
    const right = spacingTargets([car("a", 0, 9), car("b", 25, 3)], new Map(), LEN, LANE, WIDE, (_c, side) => side === -1);
    expect(right.get("a")).toEqual({ lat: -LANE, back: 0 });
    const none = spacingTargets([car("a", 0, 9), car("b", 10, 3)], new Map(), LEN, LANE, WIDE, () => false);
    expect(none.get("a")!.lat).toBe(0);
    expect(none.get("a")!.back).toBeGreaterThan(0);
    // out on the right already: it stays out on the right until clear
    const now = new Map<string, Gap>([["a", { lat: -LANE, back: 0 }]]);
    expect(spacingTargets([car("a", 18, 9), car("b", 0, 3)], now, LEN, LANE, WIDE, () => true).get("a")!.lat).toBe(-LANE);
  });
  it("leaves buses side by side apart, or going the other way", () => {
    const side = t([car("a", 0, 0), car("b", 4, 0, 3.5)]);
    const back = t([car("a", 0, 0), car("b", 4, 0, 0, 180)]);
    for (const r of [side, back]) expect([...r.values()].every(g => g.lat === 0 && g.back === 0)).toBe(true);
  });
});

// The two together over time, as scene3d runs them at 30 frames a second: a fast bus catching a slow one never
// touches it (it is out of the lane before they meet), and stands in line behind it when both stop.
function run(speeds: (t: number) => [number, number], start: [number, number], secs: number) {
  const g = new Map<string, Gap & { latV: number; backV: number }>([["a", { lat: 0, back: 0, latV: 0, backV: 0 }], ["b", { lat: 0, back: 0, latV: 0, backV: 0 }]]);
  let [ya, yb] = start, worst = Infinity, maxStep = 0;
  for (let t = 0; t < secs; t += 1 / 30) {
    const [va, vb] = speeds(t);
    ya += va / 30; yb += vb / 30;
    const want = spacingTargets([car("a", ya, va), car("b", yb, vb)], g, LEN, LANE, WIDE);
    for (const k of ["a", "b"]) {
      const s = g.get(k)!, w = want.get(k)!, lat0 = s.lat;
      [s.lat, s.latV] = springStep(s.lat, s.latV, w.lat, LAT_PERIOD, 1 / 30);
      [s.back, s.backV] = springStep(s.back, s.backV, w.back, BACK_PERIOD, 1 / 30);
      maxStep = Math.max(maxStep, Math.abs(s.lat - lat0));
    }
    const along = Math.abs((yb - g.get("b")!.back) - (ya - g.get("a")!.back)), side = Math.abs(g.get("a")!.lat - g.get("b")!.lat);
    if (along < LEN) worst = Math.min(worst, side);   // side by side within a length: how far apart sideways
  }
  return { worst, maxStep };
}
describe("spacing over time", () => {
  it("passes without touching, and smoothly", () => {
    const r = run(() => [9, 3], [0, 40], 20);
    expect(r.worst).toBeGreaterThanOrEqual(WIDE - 0.3);
    expect(r.maxStep).toBeLessThan(0.15);   // metres a frame sideways: a glide, not a jump
  });
  it("lines up behind one standing at a stop", () => {
    const r = run(t => [Math.max(0, 8 - 2 * t), 0], [0, 30], 15);   // braking to a stop behind it
    expect(r.worst).toBe(Infinity);   // never within a length of it
  });
});
