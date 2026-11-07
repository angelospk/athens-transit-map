import { describe, expect, it } from "vitest";
import { crowdFix, metres } from "../src/lib/crowd";

const at = (lat: number, lon: number, accuracy = 10) => ({ latitude: lat, longitude: lon, accuracy, speed: 8, heading: 90 });

describe("crowdFix", () => {
  it("sends a fine fix near the bus, rounded to about a metre", () => {
    const f = crowdFix("r", "224", "12013", at(37.9765432, 23.7489123), 1_700_000_000_500, [37.9766, 23.7490]);
    expect(f).toEqual({ ride: "r", line: "224", vehicle: "12013", lat: 37.97654, lon: 23.74891, accuracy: 10, speed: 8, heading: 90, at: 1_700_000_001 });
  });

  it("drops a coarse fix, and one too far from the bus", () => {
    expect(crowdFix("r", "224", "1", at(37.97, 23.74, 120), 0, null)).toBeNull();
    expect(crowdFix("r", "224", "1", at(37.97, 23.74), 0, [37.98, 23.74])).toBeNull();   // ~1.1 km away
    expect(crowdFix("r", "224", "1", at(37.97, 23.74), 0, null)).toBeNull();             // bus position unknown: nothing to check
  });

  it("measures distance on the sphere", () => {
    expect(Math.round(metres([37.97, 23.74], [37.98, 23.74]))).toBe(1112);
  });
});
