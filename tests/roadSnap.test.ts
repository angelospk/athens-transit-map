import { describe, expect, it } from "vitest";
import { RoadIndex, snapLine, Track, type LngLat } from "../src/lib/roadSnap";

// Two streets in Athens' latitude: an east-west one along y = 0 and a north-south one along x = 200 m.
const lat0 = 37.97, lon0 = 23.73;
const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
const at = (x: number, y: number): LngLat => [lon0 + x / kx, lat0 + y / ky];
const idx = new RoadIndex([
  { coords: [at(-100, 0), at(400, 0)], half: 7 },
  { coords: [at(200, -300), at(200, 300)], half: 4 },
], lon0, lat0);
const m = (p: LngLat) => idx.m(p);

describe("RoadIndex", () => {
  it("finds the nearest centreline and how far it is", () => {
    const h = idx.nearest(at(50, 12), 25)!;
    expect(h.road).toBe(0);
    expect(h.d).toBeCloseTo(12, 6);
    expect(h.ny).toBeCloseTo(1, 6);   // the normal points to the point's side
    expect(idx.nearest(at(50, 40), 25)).toBeNull();
  });

  it("tells the carriageway from the pavement", () => {
    expect(idx.onRoad(at(50, 5))).not.toBeNull();     // 5 m from the centre of a 14 m road
    expect(idx.onRoad(at(50, 9))).toBeNull();         // on the pavement
  });

  it("moves a point on the road out to the pavement, on its own side", () => {
    const [x, y] = m(idx.offRoad(at(50, -3))!);
    expect(x).toBeCloseTo(50, 6);
    expect(y).toBeCloseTo(-(7 + 1.8), 6);
    expect(idx.offRoad(at(50, 30))).toEqual(at(50, 30));   // off any road: unchanged
  });
});

describe("snapLine", () => {
  it("puts a sparse, cut-corner route on its two streets", () => {
    // A route drawn from 10 m north of the first street, cutting the corner, to the second street.
    const line: LngLat[] = [at(0, 10), at(150, 10), at(190, 60), at(205, 200)];
    const s = snapLine(line, idx);
    expect(s.length).toBeGreaterThan(line.length);
    // On one of the two streets, give or take the few metres the corner is rounded by.
    for (const p of s) {
      const [x, y] = m(p);
      expect(Math.min(Math.abs(y), Math.abs(x - 200))).toBeLessThan(3);
    }
  });

  it("stays on its road at a crossing when the other is barely closer", () => {
    // Along the first street, passing the crossing 3 m north of it: the north-south road is not taken.
    const s = snapLine([at(150, 3), at(250, 3)], idx);
    expect(s.every(p => Math.abs(m(p)[1]) < 1e-6)).toBe(true);
  });

  it("leaves points with no road near as they are", () => {
    const far: LngLat[] = [at(0, 100), at(50, 100)];
    expect(snapLine(far, idx)[0]).toEqual(far[0]);
  });

  it("keeps to its own carriageway of a dual avenue", () => {
    // Two one-way carriageways 14 m apart (eastbound at y = 0, westbound at y = 14), a route driving east between them.
    const dual = new RoadIndex([
      { coords: [at(-100, 0), at(400, 0)], half: 4, oneway: true },
      { coords: [at(400, 14), at(-100, 14)], half: 4, oneway: true },
    ], lon0, lat0);
    const s = snapLine([at(0, 8), at(300, 9)], dual);
    expect(s.every(p => Math.abs(dual.m(p)[1]) < 1e-6)).toBe(true);
  });

  it("does not cut across a long stretch off the roads", () => {
    // Leaves the first street at x = 100, loops 300 m north (no roads there) and comes back down the second street:
    // the loop is kept, not replaced by the corner of the two streets.
    const loop: LngLat[] = [at(0, 0), at(100, 0), at(100, 300), at(200, 300), at(200, 100), at(200, 50)];
    const s = snapLine(loop, idx);
    expect(Math.max(...s.map(p => m(p)[1]))).toBeGreaterThan(250);
  });

  it("keeps to the main road at a fork, off a slip road the sparse shape passes closer to", () => {
    // A one-way road east to a fork at (0, 0); there the main road bends right, and a one-way slip leaves the same
    // point more sharply (the Hilton junction on Vas. Sofias). The source line cuts the bend, near the slip at first.
    const bend: [number, number][] = [[0, 0], [30, -4], [60, -14], [90, -32], [120, -60], [140, -100]];
    const fork = new RoadIndex([
      { coords: [at(-200, 0), at(0, 0)], half: 5, oneway: true },
      { coords: bend.map(([x, y]) => at(x, y)), half: 5, oneway: true },
      { coords: [at(0, 0), at(20, -14), at(30, -40)], half: 3, oneway: true },
    ], lon0, lat0);
    const main: [number, number][] = [[-200, 0], ...bend];
    const offMain = ([x, y]: [number, number]) => Math.min(...main.slice(1).map(([bx, by], i) => {
      const [ax, ay] = main[i], dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(x - ax - dx * t, y - ay - dy * t);
    }));
    const s = snapLine([at(-200, 0), at(-10, 0), at(70, -22), at(140, -100)], fork);
    expect(Math.max(...s.map(p => offMain(fork.m(p))))).toBeLessThan(4);
  });

  it("never turns back through a corner behind it", () => {
    // East along the first street, then north up the second: every step goes east or north, never back.
    const s = snapLine([at(-200, 0), at(150, 0), at(200, 100)], idx);
    for (let i = 1; i < s.length; i++) {
      const [ax, ay] = m(s[i - 1]), [bx, by] = m(s[i]);
      expect(bx - ax > -0.5 || by - ay > 0).toBe(true);
    }
  });
});

describe("Track", () => {
  it("puts a vehicle on the stretch of its route that runs its way", () => {
    // Out east along y = -2 and back west along y = 2 (the two lanes of one street).
    const t = new Track([at(0, -2), at(200, -2), at(200, 2), at(0, 2)], idx);
    const east = t.at(at(100, 1), 25, [1, 0])!, west = t.at(at(100, -1), 25, [-1, 0])!;
    expect(east.s).toBeCloseTo(100, 6);
    expect(m(t.pose(east.s).pos)[1]).toBeCloseTo(-2, 6);
    expect(t.pose(east.s).heading).toBeCloseTo(90, 6);
    expect(west.s).toBeCloseTo(304, 6);
    expect(m(t.pose(west.s).pos)[1]).toBeCloseTo(2, 6);
    expect(t.at(at(100, 60), 25, [1, 0])).toBeNull();
    // Only near a place given: the far end of the same stretch is not taken.
    expect(t.at(at(100, 1), 25, [1, 0], [0, 50])).toBeNull();
  });

  it("turns a vehicle gradually through a corner, never in a step", () => {
    // East 100 m, then a quarter turn north round a 12 m radius (a corner as the routes are drawn), then north.
    const arc: LngLat[] = [];
    for (let k = 0; k <= 12; k++) { const a = (k / 12) * (Math.PI / 2); arc.push(at(100 + 12 * Math.sin(a), 12 - 12 * Math.cos(a))); }
    const t = new Track([at(0, 0), ...arc, at(112, 112)], idx);
    const hs: number[] = [];
    for (let s = 80; s <= 140; s += 0.5) hs.push(t.pose(s).heading);
    expect(hs[0]).toBeCloseTo(90, 6);                     // east before the corner
    expect(hs[hs.length - 1]).toBeCloseTo(0, 6);          // north after it
    for (let i = 1; i < hs.length; i++) expect(Math.abs(hs[i] - hs[i - 1])).toBeLessThan(3);   // no steps
  });
});
