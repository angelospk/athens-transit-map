import { describe, expect, it } from "vitest";
import { cumulative, measure, projectOn, projectStops, type Sample } from "../lab/stops/audit";
import { offsetPoint } from "../src/lib/stopfix";

const O: [number, number] = [37.98, 23.73];
const north = (m: number) => offsetPoint(O, m, 0);
const east = (m: number) => offsetPoint(O, 0, m);
// A straight shape 1 km north.
const LINE = [O, north(1000)];

describe("projection on a shape", () => {
  it("measures metres along and off the shape", () => {
    const cum = cumulative(LINE);
    expect(cum[1]).toBeCloseTo(1000, 0);
    const [lat, lon] = offsetPoint(north(300), 0, 12);
    const p = projectOn(LINE, cum, [lat, lon]);
    expect(p.s).toBeCloseTo(300, 0);
    expect(p.d).toBeCloseTo(12, 0);
  });

  it("keeps a windowed projection inside the window, on a street the route takes twice", () => {
    // Out 500 m north, back south 1 m to the east: a point at 350 m north is on both passes.
    const shape = [O, north(500), offsetPoint(north(500), 0, 1), east(1)];
    const cum = cumulative(shape);
    const p = projectOn(shape, cum, north(350), 500, 800);
    expect(p.s).toBeGreaterThanOrEqual(500);
    expect(p.s).toBeCloseTo(651, 0);
  });

  it("puts stops in route order on a shape that passes the same street twice", () => {
    // Out north 500 m on one street, then back south 6 m to the east (a loop's two sides).
    const shape = [O, north(500), offsetPoint(north(500), 0, 6), east(6)];
    const cum = cumulative(shape);
    // Stop 1 at 200 m out, stop 2 on the way back at 300 m north (300+6+200 = 506 along... ), stop 3 out of order nearby.
    const s = projectStops(shape, cum, [north(200), offsetPoint(north(300), 0, 6)]);
    expect(s[0]).toBeCloseTo(200, 0);
    expect(s[1]).toBeCloseTo(500 + 6 + 200, 0);
  });

  it("puts the first stop of a circular line at the start and the same stop again at the end", () => {
    // A square loop 400 m a side from O, ending 4 m east of O; the terminal stop is 3 m east of O,
    // so it lies on the closing edge, 3 m from the first edge: the nearest point alone is the end.
    const shape = [O, north(400), offsetPoint(north(400), 0, 400), east(400), east(4)];
    const cum = cumulative(shape);
    const s = projectStops(shape, cum, [east(3), north(200), east(200), east(3)]);
    expect(s[0]).toBeCloseTo(0, 0);
    expect(s[1]).toBeCloseTo(200, 0);
    expect(s[2]).toBeCloseTo(1400, 0);
    expect(s[3]).toBeCloseTo(1596, 0);
  });
});

describe("measure", () => {
  // n halts around `at` metres along (relative to the GTFS stop), spread over days 0..n-1.
  const around = (at: number, n: number, spread = 4): Sample[] =>
    Array.from({ length: n }, (_, k) => {
      const a = at + ((k % 5) - 2) * (spread / 2);
      const [lat, lon] = north(500 + a);
      return { a, lat, lon, day: k };
    });

  it("finds a clear peak 25 m after the GTFS stop with high confidence", () => {
    const m = measure(around(25, 40), 60, 60);
    expect(m.along).toBeGreaterThan(22);
    expect(m.along).toBeLessThan(28);
    expect(m.halts).toBe(40);
    expect(m.confidence).toBe("high");
  });

  it("says low with few halts", () => {
    expect(measure(around(0, 3), 60, 60).confidence).toBe("low");
  });

  it("is not high when a second peak (a traffic light) is nearly as strong", () => {
    const m = measure([...around(0, 30), ...around(-45, 26)], 60, 60);
    expect(m.confidence).not.toBe("high");
  });

  it("is not high when the two halves of the days disagree", () => {
    const even = around(0, 40).filter(s => s.day % 2 === 0);
    const odd = around(30, 40).filter(s => s.day % 2 === 1);
    expect(measure([...even, ...odd], 60, 60).confidence).not.toBe("high");
  });

  it("ignores halts outside the window on each side", () => {
    const m = measure([...around(0, 20), ...around(-50, 40)], 30, 60);
    expect(Math.abs(m.along)).toBeLessThan(4);
  });

  it("returns no estimate without halts", () => {
    const m = measure([], 60, 60);
    expect(m.halts).toBe(0);
    expect(m.confidence).toBe("none");
  });
});
