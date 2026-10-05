import { describe, expect, it } from "vitest";
import { bearingDeg, vehicleHeading } from "../src/lib/heading";

// Shapes are [lat, lon]; positions [lon, lat].
const east: [number, number][] = [[37.97, 23.70], [37.97, 23.71], [37.97, 23.72]];
const v = (lon: number, lat: number, bearing: number | null = null) => ({ lon, lat, bearing });

describe("bearingDeg", () => {
  it("measures clockwise from north", () => {
    expect(bearingDeg([23.7, 37.9], [23.7, 38.0])).toBeCloseTo(0, 0);
    expect(bearingDeg([23.7, 37.9], [23.8, 37.9])).toBeCloseTo(90, 0);
    expect(bearingDeg([23.7, 37.9], [23.7, 37.8])).toBeCloseTo(180, 0);
    expect(bearingDeg([23.7, 37.9], [23.6, 37.9])).toBeCloseTo(270, 0);
  });
});

describe("vehicleHeading", () => {
  it("uses the vehicle bearing when there is one", () => {
    expect(vehicleHeading(v(23.705, 37.97, 200), east, null)).toBe(200);
  });
  it("uses the route shape direction near the route", () => {
    expect(vehicleHeading(v(23.705, 37.9702), east, null)).toBeCloseTo(90, 0);
  });
  it("ignores a shape more than 150 m away and falls back to the last movement", () => {
    expect(vehicleHeading(v(23.705, 37.975), east, null)).toBeNull();
    expect(vehicleHeading(v(23.705, 37.975), east, [23.705, 37.973])).toBeCloseTo(0, 0);
  });
  it("ignores movements under 15 m", () => {
    expect(vehicleHeading(v(23.705, 37.975), null, [23.705, 37.97495])).toBeNull();
  });
  it("on a route that comes back along the same street, follows the last movement", () => {
    const loop: [number, number][] = [[37.97, 23.70], [37.97, 23.72], [37.97001, 23.72], [37.97001, 23.70]];
    expect(vehicleHeading(v(23.71, 37.970005), loop, [23.712, 37.970005])).toBeCloseTo(270, 0);
    expect(vehicleHeading(v(23.71, 37.970005), loop, [23.708, 37.970005])).toBeCloseTo(90, 0);
  });
  it("shows no heading where a route overlaps itself in both directions and there is no movement", () => {
    const loop: [number, number][] = [[37.97, 23.70], [37.97, 23.72], [37.97001, 23.72], [37.97001, 23.70]];
    expect(vehicleHeading(v(23.71, 37.970005), loop, null)).toBeNull();
  });
  it("keeps a bearing of 0 (north)", () => {
    expect(vehicleHeading(v(23.705, 37.97, 0), east, null)).toBe(0);
  });
  it("treats a non-finite bearing as missing", () => {
    expect(vehicleHeading(v(23.705, 37.97, Number.NaN), east, null)).toBeCloseTo(90, 0);
  });
});
