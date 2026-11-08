import { describe, expect, it } from "vitest";
import { arrow, covers, dashes, decode, points, TURN, zebra, type RoadsFile } from "../src/lib/athensRoads";
import { RoadIndex, snapLine, type LngLat } from "../src/lib/roadSnap";

const lat0 = 37.97, lon0 = 23.73;
const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
const at = (x: number, y: number): LngLat => [lon0 + x / kx, lat0 + y / ky];
const mx = (p: LngLat) => [(p[0] - lon0) * kx, (p[1] - lat0) * ky];
const len = (l: LngLat[]) => l.slice(1).reduce((s, p, i) => s + Math.hypot(...(mx(p).map((v, k) => v - mx(l[i])[k]) as [number, number])), 0);

describe("points", () => {
  it("adds up the steps from the origin, in whole units", () => {
    const p = points([23.73, 37.99], 1e-7, [100, -200, 50, 50]);
    expect(p[0][0]).toBeCloseTo(23.73001, 9);
    expect(p[0][1]).toBeCloseTo(37.98998, 9);
    expect(p[1][0]).toBeCloseTo(23.730015, 9);
    expect(p[1][1]).toBeCloseTo(37.989985, 9);
  });
});

describe("dashes", () => {
  it("cuts a line into 3 m dashes, 6 m apart, the first half a gap in", () => {
    const d = dashes([at(0, 0), at(40, 0)]);
    expect(d.length).toBe(4);                        // at 3, 12, 21, 30 m; the one at 39 m would run off the end
    expect(mx(d[0][0])[0]).toBeCloseTo(3, 5);
    for (const s of d) expect(len(s)).toBeCloseTo(3, 5);
    expect(mx(d[1][0])[0]).toBeCloseTo(12, 5);
  });

  it("carries a dash round a bend", () => {
    const d = dashes([at(0, 0), at(4, 0), at(4, 20)]);
    expect(d[0].length).toBe(3);                     // from 3 m, through the corner at 4 m, to 2 m up
    expect(len(d[0])).toBeCloseTo(3, 5);
  });
});

describe("zebra", () => {
  it("lays 50 cm stripes along the road, across its carriageway", () => {
    const z = zebra(at(0, 0), 0, 5);                 // an east-west road, 10 m wide
    expect(z.length).toBe(9);
    for (const s of z) {
      const [a, b] = s.map(mx);
      expect(Math.abs(b[0] - a[0])).toBeCloseTo(3, 5);   // 3 m along the road
      expect(b[1] - a[1]).toBeCloseTo(0, 5);
      expect(Math.abs(a[1])).toBeLessThanOrEqual(4.6);   // off the kerb
    }
  });
});

describe("decode", () => {
  const f: RoadsFile = {
    origin: [23.73, 37.97], unit: 1e-7,
    r: [
      [0, 120, 30, 0, 45, [0, 0, 5000, 1000], [[0, [0, 10, 5000, 0]], [1, [0, 0, 5000, 0]]]],
      [1, 60, 0, 0, 0, [0, 1000, 0, 1000], []],
    ],
    a: [[0, 0, 100, 0, 0, 100, -100, -100]],
    x: [[2500, 0, 0, 60]],
  };
  const r = decode(f, true);

  it("makes the streets, their markings, squares and crossings into features", () => {
    const kinds = r.features.map(x => `${x.properties!.kind}${x.properties!.t ?? ""}`);
    expect(kinds).toEqual(["road", "path", "mark0", "mark1", "area", "mark3"]);   // markings once every road is known
    expect(r.features[0].properties).toMatchObject({ w: 12, p: 3 });
    expect(r.features[2].geometry.type).toBe("MultiLineString");   // the lane line, dashed
  });

  it("gives the carriageways, with their lanes, to the snapping", () => {
    expect(r.roads).toHaveLength(1);
    expect(r.roads[0]).toMatchObject({ half: 6, oneway: false, bus: 4.5 });
    expect(r.streets[0].pave).toBe(3);
    expect(covers(r, [23.7302, 37.97005], 0)).toBe(true);
    expect(covers(r, [23.80, 37.97], 0)).toBe(false);
  });
});

describe("lanes", () => {
  // A two-way street along y = 0, a bus driving 4 m right of its centre.
  const idx = new RoadIndex([{ coords: [at(-100, 0), at(400, 0)], half: 7, bus: 4 }], lon0, lat0);

  it("puts a route in the middle of its own lane, on the right of its way", () => {
    const east = snapLine([at(0, 2), at(300, 2)], idx).map(p => idx.m(p)[1]);
    const west = snapLine([at(300, 2), at(0, 2)], idx).map(p => idx.m(p)[1]);
    for (const y of east) expect(y).toBeCloseTo(-4, 6);
    for (const y of west) expect(y).toBeCloseTo(4, 6);
  });
});

describe("markings at junctions", () => {
  it("stop where another road's carriageway crosses them", () => {
    // An east-west street with a lane line 1 m north of its centre, and a 10 m wide street crossing it at x = 0.
    const f: RoadsFile = { origin: [23.73, 37.99], unit: 1e-7, a: [], x: [], r: [] };
    const enc = (ll: [number, number][]) => {
      let x = Math.round(f.origin[0] / f.unit), y = Math.round(f.origin[1] / f.unit);
      return ll.flatMap(([lo, la]) => { const X = Math.round(lo / f.unit), Y = Math.round(la / f.unit), d = [X - x, Y - y]; x = X; y = Y; return d; });
    };
    const kx = 111320 * Math.cos((37.99 * Math.PI) / 180);
    const p = (x: number, y: number): [number, number] => [23.73 + x / kx, 37.99 + y / 110540];
    f.r.push([0, 70, 0, 0, 0, enc([p(-50, 0), p(0, 0), p(50, 0)]), [[1, enc([p(-50, 1), p(50, 1)])]]] as never);
    f.r.push([0, 100, 0, 0, 0, enc([p(0, -50), p(0, 0), p(0, 50)]), []] as never);
    const lines = decode(f, true).features.filter(x => x.properties!.kind === "mark").map(x => (x.geometry as GeoJSON.LineString).coordinates);
    expect(lines.length).toBe(2);   // the line, cut in two by the crossing street
    for (const l of lines) for (const [lo] of l) expect(Math.abs((lo - 23.73) * kx)).toBeGreaterThan(5);
  });
});

describe("a bridge over a street", () => {
  it("is drawn flat, and the street's lines stop under it", () => {
    const f: RoadsFile = { origin: [23.73, 37.99], unit: 1e-7, a: [], x: [], r: [] };
    const enc = (ll: [number, number][]) => {
      let x = Math.round(f.origin[0] / f.unit), y = Math.round(f.origin[1] / f.unit);
      return ll.flatMap(([lo, la]) => { const X = Math.round(lo / f.unit), Y = Math.round(la / f.unit), d = [X - x, Y - y]; x = X; y = Y; return d; });
    };
    const kx = 111320 * Math.cos((37.99 * Math.PI) / 180);
    const p = (x: number, y: number): [number, number] => [23.73 + x / kx, 37.99 + y / 110540];
    f.r.push([0, 70, 0, 0, 0, enc([p(-50, 0), p(50, 0)]), [[1, enc([p(-50, 1), p(50, 1)])]]] as never);
    f.r.push([0, 100, 0, 0, 0, enc([p(0, -50), p(0, 50)]), [], 1, 0] as never);   // over it, no shared point
    const out = decode(f, true);
    expect(out.roads.every(r => !("lv" in r))).toBe(true);
    const lines = out.features.filter(x => x.properties!.kind === "mark").map(x => (x.geometry as GeoJSON.LineString).coordinates);
    expect(lines.length).toBe(2);
    for (const l of lines) for (const [lo] of l) expect(Math.abs((lo - 23.73) * kx)).toBeGreaterThan(5);
  });
});

describe("turn arrows", () => {
  it("point the way they say, heading north", () => {
    const at: [number, number] = [23.73, 38];
    const xs = (code: number) => arrow(at, 90, code).flat(2).map(q => q[0] - at[0]);
    expect(Math.min(...xs(TURN.left))).toBeLessThan(-1e-5);    // a left turn reaches west
    expect(Math.max(...xs(TURN.left))).toBeLessThan(1e-5);
    expect(Math.max(...xs(TURN.right))).toBeGreaterThan(1e-5); // a right turn reaches east
    expect(arrow(at, 90, 0)).toEqual([]);
  });
});

describe("a junction", () => {
  it("is paved as one, with a kerb round each corner, and no lane line runs into it", () => {
    const f: RoadsFile = { origin: [23.73, 37.99], unit: 1e-7, a: [], x: [], r: [] };
    const enc = (ll: [number, number][]) => {
      let x = Math.round(f.origin[0] / f.unit), y = Math.round(f.origin[1] / f.unit);
      return ll.flatMap(([lo, la]) => { const X = Math.round(lo / f.unit), Y = Math.round(la / f.unit), d = [X - x, Y - y]; x = X; y = Y; return d; });
    };
    const kx = 111320 * Math.cos((37.99 * Math.PI) / 180);
    const p = (x: number, y: number): [number, number] => [23.73 + x / kx, 37.99 + y / 110540];
    // A cross: two 10 m streets meeting at (0, 0), each with a centre line.
    f.r.push([0, 100, 30, 0, 0, enc([p(-60, 0), p(0, 0), p(60, 0)]), [[1, enc([p(-60, 0.1), p(60, 0.1)])]]] as never);
    f.r.push([0, 100, 30, 0, 0, enc([p(0, -60), p(0, 0), p(0, 60)]), [[1, enc([p(0.1, -60), p(0.1, 60)])]]] as never);
    const out = decode(f, true).features;
    expect(out.filter(x => x.properties!.kind === "patch")).toHaveLength(1);
    expect(out.filter(x => x.properties!.kind === "patchKerb")).toHaveLength(4);   // four corners
    for (const l of out.filter(x => x.properties!.kind === "mark").map(x => (x.geometry as GeoJSON.LineString).coordinates))
      for (const [lo, la] of l) expect(Math.max(Math.abs((lo - 23.73) * kx), Math.abs((la - 37.99) * 110540))).toBeGreaterThan(5);
  });
});

describe("a road changing width", () => {
  const f: RoadsFile = { origin: [23.73, 37.99], unit: 1e-7, a: [], x: [], r: [] };
  const enc = (ll: [number, number][]) => {
    let x = Math.round(f.origin[0] / f.unit), y = Math.round(f.origin[1] / f.unit);
    return ll.flatMap(([lo, la]) => { const X = Math.round(lo / f.unit), Y = Math.round(la / f.unit), d = [X - x, Y - y]; x = X; y = Y; return d; });
  };
  const kx = 111320 * Math.cos((37.99 * Math.PI) / 180);
  const p = (x: number, y: number): [number, number] => [23.73 + x / kx, 37.99 + y / 110540];
  const wide = [0, 100, 30, 1, 0, enc([p(-60, 0), p(0, 0)]), []] as never, narrow = [0, 60, 30, 1, 0, enc([p(0, 0), p(60, 0)]), []] as never;
  const kinds = (g: RoadsFile) => decode(g, true).features.map(x => x.properties!.kind);

  it("widens gradually, with its kerbs and its pavement, not in a step", () => {
    const out = decode({ ...f, r: [wide, narrow] }, true).features;
    const patch = out.find(x => x.properties!.kind === "patch")!;
    const ring = (patch.geometry as GeoJSON.Polygon).coordinates[0].map(([lo, la]) => [(lo - 23.73) * kx, (la - 37.99) * 110540]);
    expect(Math.max(...ring.map(q => q[0]))).toBeCloseTo(24, 0);           // 6 m per metre of difference: 4 m -> 24 m
    expect(Math.max(...ring.map(q => Math.abs(q[1])))).toBeCloseTo(5, 1);  // from the wide road's half (5 m) at the joint
    expect(out.filter(x => x.properties!.kind === "patchKerb")).toHaveLength(2);
    expect(out.filter(x => x.properties!.kind === "walkPatch")).toHaveLength(1);
  });

  it("is seen across a tile's edge, and drawn by the tile the joint is in", () => {
    // The wide part in this tile, the narrow one in the next: before, neither saw the other.
    expect(kinds({ ...f, r: [wide], c: [narrow], b: [23.7, 37.98, 23.74, 38.02] })).toContain("walkPatch");
    expect(kinds({ ...f, r: [wide], c: [narrow], b: [23.7, 37.98, 23.74, 38.02] }).filter(k => k === "road")).toHaveLength(1);   // the next tile's road not drawn here
    expect(kinds({ ...f, r: [wide], c: [narrow], b: [23.74, 37.98, 23.78, 38.02] })).not.toContain("walkPatch");   // the joint is not in this tile
  });
});

describe("the points of one junction", () => {
  it("are paved as one where two divided roads cross, but a city block is not", () => {
    const f: RoadsFile = { origin: [23.73, 37.99], unit: 1e-7, a: [], x: [], r: [] };
    const enc = (ll: [number, number][]) => {
      let x = Math.round(f.origin[0] / f.unit), y = Math.round(f.origin[1] / f.unit);
      return ll.flatMap(([lo, la]) => { const X = Math.round(lo / f.unit), Y = Math.round(la / f.unit), d = [X - x, Y - y]; x = X; y = Y; return d; });
    };
    const kx = 111320 * Math.cos((37.99 * Math.PI) / 180);
    const p = (x: number, y: number): [number, number] => [23.73 + x / kx, 37.99 + y / 110540];
    const grid = (gap: number, wDm: number, oneway: number) => {
      const g: RoadsFile = { ...f, r: [] };
      for (const c of [-gap / 2, gap / 2]) {
        g.r.push([0, wDm, 30, oneway, 0, enc([p(-80, c), p(-gap / 2, c), p(gap / 2, c), p(80, c)]), []] as never);
        g.r.push([0, wDm, 30, oneway, 0, enc([p(c, -80), p(c, -gap / 2), p(c, gap / 2), p(c, 80)]), []] as never);
      }
      return decode(g, true).features.filter(x => x.properties!.kind === "patch").length;
    };
    expect(grid(22, 100, 1)).toBe(1);   // two divided roads, 10 m halves 22 m apart: one junction, one patch
    expect(grid(40, 60, 0)).toBe(4);    // streets 6 m wide round a 40 m block: four junctions
  });
});

describe("junctions worked out with polygons (scripts/junctions.py)", () => {
  const f: RoadsFile = { origin: [23.73, 37.99], unit: 1e-7, a: [], x: [], r: [] };
  const enc = (ll: [number, number][]) => {
    let x = Math.round(f.origin[0] / f.unit), y = Math.round(f.origin[1] / f.unit);
    return ll.flatMap(([lo, la]) => { const X = Math.round(lo / f.unit), Y = Math.round(la / f.unit), d = [X - x, Y - y]; x = X; y = Y; return d; });
  };
  const kx = 111320 * Math.cos((37.99 * Math.PI) / 180);
  const p = (x: number, y: number): [number, number] => [23.73 + x / kx, 37.99 + y / 110540];
  const sq = (h: number) => enc([p(-h, -h), p(h, -h), p(h, h), p(-h, h), p(-h, -h)]);
  const street = [0, 100, 30, 0, 0, enc([p(-60, 0), p(60, 0)]), [[0, enc([p(-60, 1), p(60, 1)])]]] as never;

  it("draws the surfaces this tile owns, their kerbs and islands, a roundabout's lane line, and cuts lane lines on them", () => {
    const out = decode({ ...f, r: [street], j: [[1, sq(10)], [0, sq(5)]], k: [enc([p(-10, 10), p(10, 10)])], i: [[sq(2)]], o: [[...enc([p(0, 0)]), 2000, 400]] }, true).features;
    expect(out.filter(x => x.properties!.kind === "patch")).toHaveLength(1);    // the other is the next tile's
    expect(out.filter(x => x.properties!.kind === "patchKerb")).toHaveLength(1);
    expect(out.filter(x => x.properties!.kind === "island")).toHaveLength(1);
    expect(out.some(x => x.properties!.kind === "mark" && x.geometry.type === "MultiLineString" && (x.geometry.coordinates as number[][][]).length > 10)).toBe(true);   // the dashed ring
    const lane = out.filter(x => x.properties!.kind === "mark" && x.properties!.t === 0 && x.geometry.type === "MultiLineString" && (x.geometry.coordinates as number[][][]).length < 10);
    for (const l of lane) for (const d of (l.geometry as GeoJSON.MultiLineString).coordinates) for (const [lo] of d) expect(Math.abs((lo - 23.73) * kx)).toBeGreaterThan(9);
  });
});
