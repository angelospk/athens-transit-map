import { describe, expect, it } from "vitest";
import { distanceM, ease } from "../src/lib/glide";

describe("glide math", () => {
  it("eases out from 0 to 1", () => {
    expect(ease(0)).toBe(0);
    expect(ease(0.5)).toBe(0.75);
    expect(ease(1)).toBe(1);
  });
  it("measures metres", () => {
    // Syntagma -> Piraeus is about 8.5 km
    expect(distanceM([23.7348, 37.9755], [23.6466, 37.9420])).toBeGreaterThan(8000);
    expect(distanceM([23.7348, 37.9755], [23.6466, 37.9420])).toBeLessThan(9000);
  });
});
