import { describe, expect, it } from "vitest";
import { isSpeedData, speedNote, SPEED_STOPS } from "../src/lib/speed";

const meta = { from: 1791266400, to: 1791882000, samples: 1449490, segments: 4254, min_samples: 20 };   // 6/10 09:00 – 13/10 12:00 Athens
const fc = (m: unknown) => ({ type: "FeatureCollection", features: [], meta: m });

describe("SPEED_STOPS", () => {
  it("goes up in km/h", () => {
    const v = SPEED_STOPS.map(s => s[0]);
    expect(v).toEqual([...v].sort((a, b) => a - b));
  });
});

describe("isSpeedData", () => {
  it("accepts a feature collection with its meta", () => {
    expect(isSpeedData(fc(meta))).toBe(true);
  });
  it("rejects data without meta or with broken meta", () => {
    expect(isSpeedData(fc(undefined))).toBe(false);
    expect(isSpeedData(fc({ ...meta, samples: "many" }))).toBe(false);
    expect(isSpeedData({ type: "Feature", meta })).toBe(false);
    expect(isSpeedData(null)).toBe(false);
  });
});

describe("speedNote", () => {
  it("gives the period in Athens days, the samples and the minimum per segment", () => {
    const n = speedNote(meta);
    expect(n.period).toBe("6/10–13/10");
    expect(n.samples).toBe("1.449.490");
    expect(n.min).toBe(20);
  });
  it("gives one day once", () => {
    expect(speedNote({ ...meta, to: meta.from + 3600 }).period).toBe("6/10");
  });
});
