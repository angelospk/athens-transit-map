import { describe, expect, it } from "vitest";
import { metres, metresPerPixel, tileOf, tilesIn, yaw } from "../src/lib/map3d";

describe("map3d", () => {
  it("finds the z14 tile of Syntagma", () => {
    // Checked with the log-tan form of the mercator y, and against the file scripts/trees.py wrote for it.
    expect(tileOf([23.735, 37.9755])).toEqual([9272, 6321]);   // = public/trees/14/9272/6321.json
  });

  it("lists every tile of a view, west to east and north to south", () => {
    const t = tilesIn(23.72, 37.96, 23.76, 37.99);
    expect(t[0]).toBe(`${tileOf([23.72, 37.99])[0]}/${tileOf([23.72, 37.99])[1]}`);
    expect(t).toContain(tileOf([23.74, 37.975]).join("/"));
    expect(new Set(t).size).toBe(t.length);
  });

  it("a view inside one tile is one tile", () => {
    expect(tilesIn(23.7335, 37.9715, 23.7340, 37.9720)).toHaveLength(1);
  });

  it("turns a compass heading into the model's yaw", () => {
    expect(yaw(90)).toBeCloseTo(0);              // east: along +x
    expect(yaw(0)).toBeCloseTo(Math.PI / 2);     // north: +y
    expect(yaw(180)).toBeCloseTo(-Math.PI / 2);  // south
  });

  it("knows MapLibre's scale: about 0.06 m per pixel at z20 in Athens", () => {
    expect(metresPerPixel(37.97, 20)).toBeCloseTo(0.0587, 3);
    expect(metresPerPixel(37.97, 19)).toBeCloseTo(2 * metresPerPixel(37.97, 20), 9);
  });

  it("keeps a width the same in metres at every zoom (it doubles with each zoom level)", () => {
    const e = metres(18, 37.97) as [string, unknown, unknown, ...number[]];
    const stops = e.slice(3) as number[];
    for (let i = 0; i + 3 < stops.length; i += 2) expect(stops[i + 3] / stops[i + 1]).toBeCloseTo(2, 9);
    const z18 = stops[stops.indexOf(18) + 1];
    expect(z18 * metresPerPixel(37.97, 18)).toBeCloseTo(18, 9);
    expect(stops.at(-2)).toBe(24);   // it keeps growing past z20
  });

  it("never draws thinner than its minimum", () => {
    const stops = (metres(3.3, 37.97, 4) as unknown[]).slice(3) as number[];
    expect(stops[1]).toBe(4);                        // z12: 3.3 m is under a pixel
    expect(stops[stops.indexOf(20) + 1]).toBeGreaterThan(50);
  });

  it("multiplies a per-feature width expression into pixels at each zoom", () => {
    const widths = ["match", ["get", "class"], ["primary"], 18, 7.5];
    const e = metres(widths, 37.97) as unknown[];
    const z20 = e[e.indexOf(20) + 1] as [string, number, unknown];
    expect(z20[0]).toBe("*");
    expect(z20[1]).toBeCloseTo(1 / metresPerPixel(37.97, 20), 6);
    expect(z20[2]).toEqual(widths);
  });
});
