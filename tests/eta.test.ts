import { describe, expect, it } from "vitest";
import { FALLBACK_MPS, driveSeconds, upcomingStops } from "../src/lib/eta";

// Shapes are [lat, lon]. 0.01° lon at 37.97° ≈ 877 m: the shape runs east, 2.6 km.
const M = 877.4;
const shape: [number, number][] = [[37.97, 23.70], [37.97, 23.71], [37.97, 23.72], [37.97, 23.73]];
const lon = (frac: number) => 23.70 + frac * 0.01;   // frac of 0.01° from the start
const stops = {
  A: { name: "Α", lat: 37.97, lon: lon(0) },
  B: { name: "Β", lat: 37.9701, lon: lon(1) },   // a stop stands beside the street
  C: { name: "Γ", lat: 37.97, lon: lon(2) },
  D: { name: "Δ", lat: 37.97, lon: lon(3) },
};
const variant = { shape, stops: ["A", "B", "C", "D"] };
const bus = (frac: number, next: string | null, extra: Record<string, unknown> = {}) =>
  ({ lat: 37.97, lon: lon(frac), position_at: 1000, next_stop_id: next, ...extra });

describe("driveSeconds", () => {
  it("walks the 200 m steps at their speeds, then the rest at the base speed", () => {
    // 200 m at 10 m/s, 200 m at 5 m/s, then 100 m at the base (mean of the known steps, 7.5 m/s)
    expect(driveSeconds(500, [10, 5])).toBeCloseTo(20 + 40 + 100 / 7.5, 5);
  });
  it("takes a null step at the base speed", () => {
    expect(driveSeconds(400, [4, null])).toBeCloseTo(50 + 50, 5);
  });
  it("uses the fallback speed without any step", () => {
    expect(driveSeconds(700, null)).toBeCloseTo(700 / FALLBACK_MPS, 5);
    expect(driveSeconds(700, [])).toBeCloseTo(700 / FALLBACK_MPS, 5);
    expect(driveSeconds(700, [null, null])).toBeCloseTo(700 / FALLBACK_MPS, 5);
  });
  it("is 0 for no distance and never negative", () => {
    expect(driveSeconds(0, [5])).toBe(0);
    expect(driveSeconds(-30, [5])).toBe(0);
  });
  it("keeps speeds in a sane range (1 to 15 m/s)", () => {
    expect(driveSeconds(200, [0.1])).toBeCloseTo(200, 5);
    expect(driveSeconds(200, [40])).toBeCloseTo(200 / 15, 5);
  });
});

describe("upcomingStops", () => {
  it("lists the next stop and every stop after it, with estimated times from the fix", () => {
    const r = upcomingStops(variant, stops, bus(0.5, "B"));
    expect(r.map(s => s.id)).toEqual(["B", "C", "D"]);
    expect(r.map(s => s.name)).toEqual(["Β", "Γ", "Δ"]);
    expect(r[0].at).toBeCloseTo(1000 + (0.5 * M) / FALLBACK_MPS, -1);
    expect(r[1].at).toBeCloseTo(1000 + (1.5 * M) / FALLBACK_MPS, -1);
    expect(r[2].at).toBeCloseTo(1000 + (2.5 * M) / FALLBACK_MPS, -1);
    for (const s of r) expect(Number.isInteger(s.at)).toBe(true);
  });
  it("gives each stop its index in the variant (for an alert at that stop)", () => {
    expect(upcomingStops(variant, stops, bus(1.2, "C")).map(s => s.i)).toEqual([2, 3]);
  });
  it("uses the typical step speeds ahead (path_speeds)", () => {
    const r = upcomingStops(variant, stops, bus(0.5, "B", { path_speeds: [10, 10, 10] }));
    // 0.5·M ≈ 439 m: 400 m at 10 m/s, the rest at the mean, 10 m/s
    expect(r[0].at).toBeCloseTo(1000 + (0.5 * M) / 10, -1);
  });
  it("puts a bus that is past its next stop's point on that stop (no negative time)", () => {
    const r = upcomingStops(variant, stops, bus(1.05, "B"));
    expect(r[0].at).toBe(1000);
  });
  it("gives nothing without a next stop, or one not on the variant", () => {
    expect(upcomingStops(variant, stops, bus(0.5, null))).toEqual([]);
    expect(upcomingStops(variant, stops, bus(0.5, "Z"))).toEqual([]);
  });
  it("skips stops missing from the stop table", () => {
    const { C: _, ...some } = stops;
    expect(upcomingStops(variant, some, bus(0.5, "B")).map(s => s.id)).toEqual(["B", "D"]);
  });
  it("gives nothing for a bus far from its shape", () => {
    expect(upcomingStops(variant, stops, { lat: 38.1, lon: lon(0.5), position_at: 1000, next_stop_id: "B" })).toEqual([]);
  });
});

describe("upcomingStops on a loop", () => {
  // Out east 2 legs and back on the same street: stop X is passed on the way out and on the way back.
  const loop: [number, number][] = [[37.97, 23.70], [37.97, 23.72], [37.97001, 23.72], [37.97001, 23.70]];
  const lstops = {
    S: { name: "Σ", lat: 37.97, lon: 23.70 },
    E: { name: "Ε", lat: 37.97, lon: 23.72 },
    X: { name: "Χ", lat: 37.970005, lon: 23.71 },   // between the two ways: as close to both
  };
  it("places the next stop after the stops before it, not on the way out", () => {
    const r = upcomingStops({ shape: loop, stops: ["S", "E", "X"] }, lstops, { lat: 37.97001, lon: 23.715, position_at: 0, next_stop_id: "X" });
    expect(r.map(s => s.id)).toEqual(["X"]);
    expect(r[0].at).toBeCloseTo((0.5 * M) / FALLBACK_MPS, -1);
  });
});
