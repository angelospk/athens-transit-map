import { describe, expect, it } from "vitest";
import { coverAt, type Cover } from "../src/lib/map/clouds";

describe("clouds", () => {
  // A 6 × 6 grid, clear in the west half, overcast in the east.
  const cover: Cover = Array.from({ length: 36 }, (_, k) => ({ at: [k % 6, Math.floor(k / 6)] as [number, number], cover: k % 6 >= 3 ? 1 : 0 }));
  it("reads the cover where it is, between the grid's points", () => {
    expect(coverAt(cover, 0, 0.5)).toBe(0);
    expect(coverAt(cover, 1, 0.5)).toBe(1);
    const mid = coverAt(cover, 0.5, 0.5);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
  });
});

import { cloudPuffs } from "../src/lib/map/clouds";
describe("clouds in the sky", () => {
  const sky = (c: number): Cover => Array.from({ length: 36 }, (_, k) => ({ at: [k % 6, Math.floor(k / 6)] as [number, number], cover: c }));
  it("puts clouds up high, as many as the cover says", () => {
    expect(cloudPuffs(sky(0))).toHaveLength(0);
    const full = cloudPuffs(sky(1)), some = cloudPuffs(sky(0.3));
    expect(full.length).toBeGreaterThan(some.length);
    expect(Math.min(...full.map(p => p.z))).toBeGreaterThan(1000);
  });
});
