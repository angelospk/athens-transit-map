import { describe, expect, it } from "vitest";
import { RoadIndex, turnBlend } from "../src/lib/roadSnap";

// A route north, turning at s = 100 m from its start: left (west, 270°) or right (east, 90°). `here`: where the bus is.
const route = (after: number) => (here: number) => (k: number) => { const s = here + k; return s < 0 || s > 300 ? null : s < 100 ? 0 : after; };

describe("turnBlend", () => {
  it("moves over before a left turn, fully in its last stretch, and back after it", () => {
    const L = route(270);
    expect(turnBlend(L(0)).left).toBe(0);           // 100 m before: not yet
    expect(turnBlend(L(30)).left).toBeGreaterThan(0);
    expect(turnBlend(L(30)).left).toBeLessThan(1);
    expect(turnBlend(L(70)).left).toBe(1);          // 30 m before
    expect(turnBlend(L(100)).left).toBe(1);         // at the corner
    expect(turnBlend(L(150)).left).toBe(0);         // on the next road
    expect(turnBlend(L(70)).right).toBe(0);
  });
  it("grows smoothly as it drives up to the turn, never in steps", () => {
    const L = route(270);
    let prev = turnBlend(L(0)).left, worst = 0;
    for (let here = 0.25; here <= 100; here += 0.25) { const k = turnBlend(L(here)).left; worst = Math.max(worst, Math.abs(k - prev)); prev = k; }
    expect(worst).toBeLessThan(0.02);   // 25 cm on: under 2% of the way over (20 cm across a 10 m wide road)
  });
  it("does the same to the right for a right turn, and nothing on a straight road", () => {
    expect(turnBlend(route(90)(70))).toEqual({ left: 0, right: 1 });
    expect(turnBlend(route(0)(70))).toEqual({ left: 0, right: 0 });
  });
});

describe("lanes", () => {
  // A one-way road north, 4 lanes (14 m), its buses in the right lane; a two-way one, 2 lanes each way; a narrow one.
  const idx = new RoadIndex([
    { coords: [[23.73, 37.97], [23.73, 37.975]], half: 7, oneway: true, bus: 5.25 },
    { coords: [[23.74, 37.97], [23.74, 37.975]], half: 7, bus: 5.25 },
    { coords: [[23.75, 37.97], [23.75, 37.975]], half: 3, oneway: true, bus: 1.5 },
  ], 23.74, 37.972);
  const dir: [number, number] = [0, 1];
  const off = (lon: number, left: number, inner = 0) => { const h = idx.nearest([lon, 37.972], 20, undefined, dir)!; return idx.lane(h, dir, left, inner).x - h.x; };
  it("drives in the right lane, or one further in, and in the leftmost for a left turn", () => {
    expect(off(23.73, 0)).toBeGreaterThan(4);
    expect(off(23.73, 0, 1)).toBeCloseTo(off(23.73, 0) - (off(23.73, 0) - off(23.73, 1)) / 3, 5);   // 4 lanes: the 2nd
    expect(off(23.73, 0, 0.5)).toBeCloseTo((off(23.73, 0) + off(23.73, 0, 1)) / 2, 5);            // changing lanes
    expect(off(23.73, 1)).toBeLessThan(-4);
    expect(off(23.73, 1, 1)).toBeCloseTo(off(23.73, 1), 5);
  });
  it("keeps to its own side of a two-way road, and to the one lane of a narrow road", () => {
    expect(off(23.74, 1)).toBeCloseTo(1.75, 1);
    expect(off(23.74, 0, 1)).toBeCloseTo(1.75, 1);
    expect(off(23.75, 1, 1)).toBeCloseTo(off(23.75, 0), 5);
  });
});
