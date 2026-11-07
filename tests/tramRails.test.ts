import { describe, expect, it } from "vitest";
import { smoothPath, snapTram } from "../src/lib/map/tramRails";

// An L: 200 m east, then 200 m north (lat, lon).
const L: [number, number][] = [[37.95, 23.70], [37.95, 23.70228], [37.9518, 23.70228]];

describe("smoothPath", () => {
  it("rounds the corner, keeps the ends", () => {
    const s = smoothPath(L);
    expect(s[0]).toEqual(L[0]);
    expect(s[s.length - 1]).toEqual(L[2]);
    expect(s.length).toBeGreaterThan(6);
    expect(s.some(p => p[0] === L[1][0] && p[1] === L[1][1])).toBe(false);   // the sharp corner is gone
  });
});

describe("snapTram", () => {
  const paths = [smoothPath(L).map(([lat, lon]) => [lon, lat] as [number, number])];
  it("puts a tram on the rails with their way", () => {
    const r = snapTram(paths, [23.701, 37.95005], null)!;
    expect(Math.abs(r.pos[1] - 37.95)).toBeLessThan(1e-6);
    expect(Math.round(r.heading)).toBe(90);
  });
  it("turns the way the tram goes", () => {
    expect(Math.round(snapTram(paths, [23.701, 37.95005], 265)!.heading)).toBe(270);
  });
  it("leaves one far off", () => {
    expect(snapTram(paths, [23.701, 37.9506], null)).toBeNull();
  });
});
