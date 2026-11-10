import { describe, expect, it } from "vitest";
import { minutesText, passedStops, runTime } from "../src/lib/busRun";

describe("runTime", () => {
  it("reads the departure from the trip label", () => {
    expect(runTime({ id: "40123", trip_label: "00:35 ΠΕΙΡΑΙΑΣ → ΣΥΝΤΑΓΜΑ" })).toBe("00:35");
  });
  it("reads it from a citybus.gr vehicle code when there is no label", () => {
    expect(runTime({ id: "20261110_4_0100000_17_20", trip_label: null })).toBe("17:20");
    expect(runTime({ id: "20261110_0121_0_0100000_07_05", trip_label: null })).toBe("07:05");
  });
  it("the label wins over the code", () => {
    expect(runTime({ id: "20261110_4_0100000_17_20", trip_label: "17:25 Α → Β" })).toBe("17:25");
  });
  it("is null for a device id, a fleet number or a time that is none", () => {
    expect(runTime({ id: "1607413212998552622", trip_label: null })).toBeNull();
    expect(runTime({ id: "40123", trip_label: null })).toBeNull();
    expect(runTime({ id: "20261110_4_0100000_31_70", trip_label: null })).toBeNull();
    expect(runTime({ id: "20261110_4_0100000_17_20", trip_label: "χωρίς ώρα" })).toBe("17:20");
  });
});

describe("passedStops", () => {
  const stops = { A: { name: "Αλφα" }, B: { name: "Βήτα" }, D: { name: "Δέλτα" } };
  it("lists the stops before the next one, with their place on the variant", () => {
    expect(passedStops({ stops: ["A", "B", "C", "D"] }, stops, 3)).toEqual([
      { id: "A", name: "Αλφα", i: 0 }, { id: "B", name: "Βήτα", i: 1 },
    ]);
  });
  it("is empty at the first stop", () => {
    expect(passedStops({ stops: ["A", "B"] }, stops, 0)).toEqual([]);
  });
});

describe("minutesText", () => {
  const now = 1_000_000_000_000;
  it("is minutes from now, also past an hour", () => {
    expect(minutesText(now / 1000 + 8 * 60, now)).toBe("8′");
    expect(minutesText(now / 1000 + 75 * 60, now)).toBe("75′");
  });
  it("is «τώρα» under half a minute or in the past", () => {
    expect(minutesText(now / 1000 + 20, now)).toBe("τώρα");
    expect(minutesText(now / 1000 - 90, now)).toBe("τώρα");
  });
});
