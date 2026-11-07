import { describe, expect, it } from "vitest";
import { accuracyCounts, fmtErr, parseAccuracy } from "../src/lib/eta-accuracy";

const good = {
  v: 1, from: "2026-10-31", to: "2026-11-06", stops: 5, preds: 480000,
  buckets: [
    { label: "0-5′", n: 76095, median_s: 37, within_120: 0.87 },
    { label: "5-10′", n: 59879, median_s: 65, within_120: 0.74 },
    { label: "10-20′", n: 110725, median_s: 103, within_120: 0.56 },
  ],
  phantom_share: 0.12,
};

describe("parseAccuracy", () => {
  it("accepts the published file", () => {
    expect(parseAccuracy(good)).toEqual(good);
  });
  it("rejects another version, a bad date, or a bucket without numbers", () => {
    expect(parseAccuracy({ ...good, v: 2 })).toBeNull();
    expect(parseAccuracy({ ...good, to: "6/11" })).toBeNull();
    expect(parseAccuracy({ ...good, buckets: [{ label: "0-5′", n: 1 }] })).toBeNull();
    expect(parseAccuracy({ ...good, buckets: [] })).toBeNull();
    expect(parseAccuracy(null)).toBeNull();
    expect(parseAccuracy("x")).toBeNull();
  });
  it("drops buckets with too few predictions to mean anything", () => {
    const r = parseAccuracy({ ...good, buckets: [good.buckets[0], { ...good.buckets[1], n: 50 }] })!;
    expect(r.buckets.map(b => b.label)).toEqual(["0-5′"]);
  });
});

describe("fmtErr", () => {
  it("seconds under 90 s, else minutes with a Greek decimal comma", () => {
    expect(fmtErr(37)).toBe("37″");
    expect(fmtErr(89.4)).toBe("89″");
    expect(fmtErr(89.6)).toBe("1,5′");
    expect(fmtErr(103)).toBe("1,7′");
    expect(fmtErr(120)).toBe("2,0′");
  });
});

describe("accuracyCounts", () => {
  it("the measured predictions are the bucket sum; the unseen share is shown apart", () => {
    expect(accuracyCounts(parseAccuracy(good)!)).toEqual({ measured: 76095 + 59879 + 110725, unseen_pct: 12 });
  });
});
