import { describe, expect, it } from "vitest";
import { BACK_PERIOD, LAT_PERIOD, spacingTargets, springStep, type Car, type Gap } from "../src/lib/map/spacing";

const LEN = 15.6, LANE = 3.6, WIDE = 3.25;
// Heading north (0°): y grows ahead.
const car = (key: string, y: number, v: number, x = 0, heading: number | null = 0, fix?: [number, number]): Car => ({ key, x, y, heading, v, moving: v > 1, fix });
// Its GPS fix level with the other's (the data has it passing).
const passing = (c: Car, other: Car): Car => ((other.fix ??= [other.x, other.y]), { ...c, fix: [other.x, other.y] });
const t = (cars: Car[], now = new Map<string, Gap>()) => spacingTargets(cars, now, LEN, LANE, WIDE);

describe("spacingTargets", () => {
  it("leaves buses apart alone", () => {
    expect([...t([car("a", 0, 8), car("b", 60, 8)]).values()]).toEqual([{ lat: 0, back: 0 }, { lat: 0, back: 0 }]);
  });
  it("pulls out early, before it reaches a slower one ahead, where their fixes have it passing", () => {
    // 25 m apart (not touching yet), closing at 6 m/s: it would be there in under 3 s; its fix level with the other's.
    const b = car("b", 25, 3);
    expect(t([passing(car("a", 0, 9), b), b]).get("a")).toEqual({ lat: LANE, back: 0 });
    // Same gap, the same speed: no reason to pass.
    expect(t([car("a", 0, 6), car("b", 25, 6)]).get("a")!.lat).toBe(0);
  });
  it("does not pass where the fixes have it behind: it keeps in line, however it is drawn closing in", () => {
    const r = t([car("a", 0, 9, 0, 0, [0, 0]), car("b", 10, 3, 0, 0, [0, 10])]);
    expect(r.get("a")!.lat).toBe(0);
    expect(r.get("a")!.back).toBeGreaterThan(0);
    // and none known: the same
    expect(t([car("a", 0, 9), car("b", 10, 3)]).get("a")!.lat).toBe(0);
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
  it("keeps one drawn behind behind, even when its place has run on past the other's (a guess past one at a stop)", () => {
    // a's place is 4 m past b's, but a is drawn 12 m back (held behind b): a stays behind, by its place's lead too.
    const now = new Map<string, Gap>([["a", { lat: 0, back: 12 }]]);
    const r = t([car("a", 4, 0), car("b", 0, 0)], now);
    expect(r.get("b")!.back).toBe(0);
    expect(r.get("a")!.back).toBeCloseTo(LEN + 1.5 + 4);
  });
  it("goes round one standing at a stop once its own data has long gone past it", () => {
    const now = new Map<string, Gap>([["a", { lat: 0, back: 35 }]]);
    const r = t([car("a", 30, 6), car("b", 0, 0)], now);   // a's place 30 m past b's; drawn 5 m behind it
    expect(r.get("a")!.lat).toBe(LANE);
    // not held so long: it waits in line
    expect(t([car("a", 0, 6), car("b", 10, 0)]).get("a")!.lat).toBe(0);
  });
  it("counts a bus a little to the side as in the way (they would touch)", () => {
    expect(t([car("a", 0, 0), car("b", 4, 0, 2.6)]).get("a")!.back).toBeGreaterThan(0);
  });
  it("passes on the right when there is no road on the left, and keeps in line when there is none either side", () => {
    const b25 = car("b", 25, 3), b10 = car("b", 10, 3);
    const right = spacingTargets([passing(car("a", 0, 9), b25), b25], new Map(), LEN, LANE, WIDE, (_c, side) => side === -1);
    expect(right.get("a")).toEqual({ lat: -LANE, back: 0 });
    const none = spacingTargets([passing(car("a", 0, 9), b10), b10], new Map(), LEN, LANE, WIDE, () => false);
    expect(none.get("a")!.lat).toBe(0);
    expect(none.get("a")!.back).toBeGreaterThan(0);
    // out on the right already: it stays out on the right until clear
    const now = new Map<string, Gap>([["a", { lat: -LANE, back: 0 }]]);
    expect(spacingTargets([car("a", 18, 9), car("b", 0, 3)], now, LEN, LANE, WIDE, () => true).get("a")!.lat).toBe(-LANE);
  });
  it("leaves buses side by side apart, or going the other way", () => {
    const side = t([car("a", 0, 0), car("b", 4, 0, 3.5)]);
    const back = t([car("a", 0, 0), car("b", 4, 0, 3.5, 180)]);
    for (const r of [side, back]) expect([...r.values()].every(g => g.lat === 0 && g.back === 0)).toBe(true);
  });
  it("edges two going opposite ways apart sideways when they are drawn inside each other, never back", () => {
    // b half a metre east of a, coming the other way: a (north) edges west, its left; b (south) edges east, its left.
    const r = t([car("a", 0, 6), car("b", 4, 6, 0.5, 180)]);
    for (const k of ["a", "b"]) { expect(r.get(k)!.lat).toBeGreaterThan(0); expect(r.get(k)!.back).toBe(0); }
    const ax = -r.get("a")!.lat, bx = 0.5 + r.get("b")!.lat;   // drawn x (scene3d: x − d[1]·lat)
    expect(bx - ax).toBeGreaterThanOrEqual(WIDE);
    // dead level: each to its right
    const lv = t([car("a", 0, 6), car("b", 4, 6, 0, 180)]);
    for (const k of ["a", "b"]) expect(lv.get(k)!.lat).toBeLessThan(0);
  });
});

// The two together over time, as scene3d runs them at 30 frames a second: a fast bus catching a slow one never
// touches it (it is out of the lane before they meet), and stands in line behind it when both stop.
function run(speeds: (t: number) => [number, number], start: [number, number], secs: number, fixes = false) {
  const g = new Map<string, Gap & { latV: number; backV: number }>([["a", { lat: 0, back: 0, latV: 0, backV: 0 }], ["b", { lat: 0, back: 0, latV: 0, backV: 0 }]]);
  let [ya, yb] = start, worst = Infinity, maxStep = 0;
  for (let t = 0; t < secs; t += 1 / 30) {
    const [va, vb] = speeds(t);
    ya += va / 30; yb += vb / 30;
    const want = spacingTargets([car("a", ya, va, 0, 0, fixes ? [0, yb] : undefined), car("b", yb, vb, 0, 0, fixes ? [0, yb] : undefined)], g, LEN, LANE, WIDE);
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
    const r = run(() => [9, 3], [0, 40], 20, true);   // the fixes have it passing
    expect(r.worst).toBeGreaterThanOrEqual(WIDE - 0.3);
    expect(r.maxStep).toBeLessThan(0.15);   // metres a frame sideways: a glide, not a jump
  });
  it("lines up behind one standing at a stop", () => {
    const r = run(t => [Math.max(0, 8 - 2 * t), 0], [0, 30], 15);   // braking to a stop behind it
    expect(r.worst).toBe(Infinity);   // never within a length of it
  });
});

describe("two standing at one stop", () => {
  it("queues the one behind a full bus length back, whatever their speeds, when both face the same way", () => {
    const cars = [
      { key: "a", x: 0, y: 0, heading: 90, v: 0, moving: false },
      { key: "b", x: 0.5, y: 0.2, heading: 92, v: 0, moving: false },
    ];
    const out = spacingTargets(cars, new Map(), 12, 3.4);
    const backs = [out.get("a")!.back, out.get("b")!.back];
    expect(Math.max(...backs)).toBeGreaterThanOrEqual(12);
    expect(Math.min(...backs)).toBe(0);
  });
});

describe("across each other", () => {
  it("holds the one that has the other in front of it back, so they are never inside one another", () => {
    const cars = [
      { key: "a", x: 0, y: 0, heading: 90, v: 2, moving: true },     // going east
      { key: "b", x: 4, y: 1, heading: 0, v: 0, moving: false },     // across it, going north, 4 m ahead of a
    ];
    const out = spacingTargets(cars, new Map(), 12, 3.4);
    expect(out.get("a")!.back).toBeGreaterThan(3);   // a has b in front: a holds back
    expect(out.get("b")!.back).toBe(0);
  });
});

describe("on a bend", () => {
  it("does not pull out to pass while either is turning: it falls in line behind instead", () => {
    const cars = [
      { key: "a", x: 0, y: 0, heading: 0, v: 9, moving: true, turning: true, fix: [0, 16] as [number, number] },
      { key: "b", x: 0, y: 16, heading: 0, v: 4, moving: true, fix: [0, 16] as [number, number] },
    ];
    const out = spacingTargets(cars, new Map(), 12, 3.4);
    expect(out.get("a")!.lat).toBe(0);
    expect(out.get("a")!.back).toBeGreaterThan(0);
    const straight = spacingTargets(cars.map(c => ({ ...c, turning: false })), new Map(), 12, 3.4);
    expect(straight.get("a")!.lat).not.toBe(0);
  });
});
