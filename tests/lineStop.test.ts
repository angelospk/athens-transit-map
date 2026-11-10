import { describe, expect, it } from "vitest";
import { hhmm, lineStopFor, stopPlace, walkDirectionsUrl } from "../src/lib/lineStop";
import type { TripIndex } from "../src/lib/trip";

// Line 040, two directions: v1 runs stops 0 → 1 → 2, v2 runs 2 → 3. Stop 4 is on no variant of 040.
const ix: TripIndex = {
  v: "t",
  s: [
    ["ΠΕΙΡΑΙΑΣ", 37.9420, 23.6460, "100"],
    ["ΚΑΛΛΙΘΕΑ", 37.9550, 23.7000, "101"],
    ["ΣΥΝΤΑΓΜΑ", 37.9755, 23.7348, "102"],
    ["ΣΥΝΤΑΓΜΑ", 37.9757, 23.7352, "103"],
    ["ΑΛΛΟΥ", 37.9756, 23.7349, "104"],
  ],
  l: { "040": { v1: [0, 1, 2], v2: [2, 3] }, "550": { w: [4, 1] } },
};

describe("lineStopFor", () => {
  it("takes the stop the card was opened from when the chosen direction serves it", () => {
    expect(lineStopFor(ix, "040", ["v1"], { stopCode: "101", pos: [37.9755, 23.7348] })).toEqual({ k: 1, m: null });
  });

  it("falls back to the nearest stop of the chosen direction when the opening stop is not on it", () => {
    // 104 is not on 040; the user stands at Σύνταγμα: stop 2 is on v1.
    expect(lineStopFor(ix, "040", ["v1"], { stopCode: "104", pos: [37.9755, 23.7348] })).toEqual({ k: 2, m: 0 });
  });

  it("only looks at the variants of the chosen direction", () => {
    // Standing at stop 3: v1 does not serve it, so its nearest stop of v1 is stop 2, a few tens of metres away.
    const r = lineStopFor(ix, "040", ["v1"], { pos: [37.9757, 23.7352] });
    expect(r?.k).toBe(2);
    expect(r!.m).toBeGreaterThan(0);
    expect(r!.m).toBeLessThan(60);
  });

  it("gives nothing when the nearest stop of the direction is farther than the limit", () => {
    expect(lineStopFor(ix, "040", ["v2"], { pos: [37.9420, 23.6460] })).toBeNull();
  });

  it("gives nothing with no opening stop and no location, or for a line the index does not know", () => {
    expect(lineStopFor(ix, "040", ["v1"], {})).toBeNull();
    expect(lineStopFor(ix, "999", ["x"], { pos: [37.9755, 23.7348] })).toBeNull();
  });

  it("rounds the walk distance to whole metres", () => {
    const r = lineStopFor(ix, "040", ["v2"], { pos: [37.9756, 23.7350] });
    expect(Number.isInteger(r!.m)).toBe(true);
  });
});

describe("stopPlace", () => {
  it("is a trip planner place at the stop, with the stop's lines", () => {
    expect(stopPlace(ix, 1, "Καλλιθέα")).toEqual({ label: "Καλλιθέα", pts: [[37.955, 23.7]], lines: ["040", "550"], kind: "stop" });
  });
});

describe("walkDirectionsUrl", () => {
  it("asks Google Maps for walking directions to the point", () => {
    expect(walkDirectionsUrl(37.9755, 23.7348)).toBe("https://www.google.com/maps/dir/?api=1&destination=37.9755%2C23.7348&travelmode=walking");
  });
});

describe("hhmm", () => {
  it("is the Athens clock time, hours and minutes", () => {
    expect(hhmm(Date.UTC(2026, 10, 10, 21, 8, 40))).toBe("23:08");
    expect(hhmm(Date.UTC(2026, 6, 1, 6, 5))).toBe("09:05");   // summer time, +3
  });
});
