import { describe, expect, it } from "vitest";
import { distanceM, interpolate, shouldJump } from "../src/lib/glide";

describe("glide math", () => {
  it("eases out between two points", () => {
    expect(interpolate([0, 0], [10, 20], 0)).toEqual([0, 0]);
    expect(interpolate([0, 0], [10, 20], 0.5)).toEqual([7.5, 15]);
    expect(interpolate([0, 0], [10, 20], 1)).toEqual([10, 20]);
    expect(interpolate([0, 0], [10, 20], 2)).toEqual([10, 20]);
  });
  it("measures metres", () => {
    // Syntagma -> Piraeus is about 8.5 km
    expect(distanceM([23.7348, 37.9755], [23.6466, 37.9420])).toBeGreaterThan(8000);
    expect(distanceM([23.7348, 37.9755], [23.6466, 37.9420])).toBeLessThan(9000);
  });
  it("jumps on no move or a long move", () => {
    expect(shouldJump([23.7, 37.9], [23.7, 37.9])).toBe(true);
    expect(shouldJump([23.7348, 37.9755], [23.6466, 37.9420])).toBe(true);
    expect(shouldJump([23.7348, 37.9755], [23.7358, 37.9760])).toBe(false);
  });
  it("teleports moves over 1 km and glides shorter ones", () => {
    // 0.0135° of latitude is about 1.5 km; 0.0081° about 900 m
    expect(shouldJump([23.73, 37.97], [23.73, 37.9835])).toBe(true);
    expect(shouldJump([23.73, 37.97], [23.73, 37.9781])).toBe(false);
  });
});
