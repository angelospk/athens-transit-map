import { describe, expect, it } from "vitest";
import { asExpression, widenBy } from "../src/lib/map/scene3d";

describe("asExpression", () => {
  it("converts the base map's legacy filters, and passes expressions through", () => {
    expect(asExpression(["all", ["==", "$type", "LineString"], ["in", "class", "motorway", "trunk"]]))
      .toEqual(["all", ["==", ["geometry-type"], "LineString"], ["match", ["get", "class"], ["motorway", "trunk"], true, false]]);
    expect(asExpression(["!in", "brunnel", "tunnel"])).toEqual(["match", ["get", "brunnel"], ["tunnel"], false, true]);
    expect(asExpression(["!has", "name"])).toEqual(["!", ["has", "name"]]);
    const e = ["==", ["get", "class"], "primary"];
    expect(asExpression(e)).toBe(e);
    expect(asExpression(["weird", "x"])).toBeNull();
  });
});

describe("widenBy (the base map's road widths, widened in 3D under the street zoom)", () => {
  const by = (z: number) => (z <= 12 ? 1 : z >= 16 ? 2.4 : 1 + ((z - 12) * 1.4) / 4);
  it("keeps one zoom interpolate, with the style's stops and the factor's, every width scaled", () => {
    const w = widenBy(["interpolate", ["exponential", 1.55], ["zoom"], 13, 1.8, 20, 20], by) as unknown[];
    expect(w.slice(0, 3)).toEqual(["interpolate", ["exponential", 1.55], ["zoom"]]);
    const stops = w.slice(3) as number[], zs = stops.filter((_, i) => i % 2 === 0);
    expect(zs).toEqual([12, 13, 14, 16, 20]);
    expect(stops[zs.indexOf(13) * 2 + 1]).toBeCloseTo(1.8 * by(13), 6);
    expect(stops[zs.indexOf(20) * 2 + 1]).toBeCloseTo(20 * 2.4, 6);
    expect(stops[zs.indexOf(12) * 2 + 1]).toBeCloseTo(1.8, 6);   // below the first stop: its width, factor 1
    // at 16 the exponential curve between 13 and 20, scaled
    const t = (Math.pow(1.55, 3) - 1) / (Math.pow(1.55, 7) - 1);
    expect(stops[zs.indexOf(16) * 2 + 1]).toBeCloseTo((1.8 + (20 - 1.8) * t) * 2.4, 6);
  });
  it("reads a number and a legacy stops function too, and refuses what it cannot read", () => {
    expect((widenBy(2, by) as number[]).slice(3)).toEqual([0, 2, 12, 2, 14, 2 * by(14), 16, 4.8, 24, 4.8]);
    const w = widenBy({ base: 1.2, stops: [[10, 1], [18, 4]] }, by) as unknown[];
    expect(w.slice(0, 3)).toEqual(["interpolate", ["exponential", 1.2], ["zoom"]]);
    expect(widenBy({ stops: [[10, "a"]] }, by)).toBeNull();
    expect(widenBy(["match", ["get", "class"], "a", 1, 2], by)).toBeNull();
    expect(widenBy(undefined, by)).toBeNull();
  });
});
