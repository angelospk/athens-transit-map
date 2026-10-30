import { describe, expect, it } from "vitest";
import { passTime, score, type Fix, type Pred } from "../lab/eta/eta";

// Points along a north-south street through the stop at (38, 23.7): 1° lat ≈ 111 195 m.
const stop = { lat: 38, lon: 23.7 };
const at = (m: number) => ({ lat: 38 + m / 111195, lon: 23.7 });
const fix = (t: number, m: number, off = 0): Fix => ({ t, lat: at(m).lat, lon: 23.7 + off / 87_600 });

describe("passTime", () => {
  it("a fix within 40 m of the stop is the pass", () => {
    expect(passTime([fix(0, -500), fix(60, -20), fix(120, 300)], stop)).toBe(60);
  });
  it("interpolates between the fix before and the fix after by distance", () => {
    expect(passTime([fix(0, -300), fix(100, 100)], stop)).toBeCloseTo(75, 0);
  });
  it("null while the vehicle has not reached the stop", () => {
    expect(passTime([fix(0, -900), fix(60, -600), fix(120, -300)], stop)).toBeNull();
  });
  it("null on a parallel street 200 m away", () => {
    expect(passTime([fix(0, -300, 200), fix(100, 100, 200)], stop)).toBeNull();
  });
  it("only passes at or after `after` count (loops pass a stop twice)", () => {
    const fixes = [fix(0, -10), fix(100, 500), fix(200, 900), fix(300, 500), fix(400, 10)];
    expect(passTime(fixes, stop)).toBe(0);
    expect(passTime(fixes, stop, 50)).toBe(400);
  });
  it("ignores unsorted input order", () => {
    expect(passTime([fix(100, 100), fix(0, -300)], stop)).toBeCloseTo(75, 0);
  });
});

describe("score", () => {
  const p = (q: number, at: number, vehicle = "v1", stop = "s1"): Pred => ({ q, stop, vehicle, at });

  it("error = predicted − actual, bucketed by the real time to arrival", () => {
    const passes = { "s1|v1": [1000] };
    // asked at 700 (5 min before): predicted 1060 → +60 s; asked at 100 (15 min before): predicted 900 → −100 s
    const r = score([p(700, 1060), p(100, 900)], passes, 5000);
    const b5 = r.buckets.find(b => b.label === "5-10′")!;
    const b10 = r.buckets.find(b => b.label === "10-20′")!;
    expect(b5.n).toBe(1);
    expect(b5.median_abs_s).toBe(60);
    expect(b5.within_60).toBe(1);
    expect(b10.n).toBe(1);
    expect(b10.median_abs_s).toBe(100);
    expect(b10.within_60).toBe(0);
    expect(b10.within_120).toBe(1);
    expect(r.matched).toBe(2);
  });

  it("buckets are 0-5′, 5-10′, 10-20′, 20′+ and medians are over |error|", () => {
    const passes = { "s1|v1": [600] };
    const r = score([p(500, 530), p(510, 600), p(520, 400)], passes, 5000); // errors −70, 0, −200 → |.| 70, 0, 200
    expect(r.buckets.map(b => b.label)).toEqual(["0-5′", "5-10′", "10-20′", "20′+"]);
    expect(r.buckets[0].n).toBe(3);
    expect(r.buckets[0].median_abs_s).toBe(70);
    expect(r.buckets[0].mean_s).toBeCloseTo(-90, 5); // signed: negative = we said earlier than it came
  });

  it("uses the first pass after the question (minus 60 s grace), not an earlier one", () => {
    const passes = { "s1|v1": [100, 3000] };
    const r = score([p(2000, 3100)], passes, 9000);
    expect(r.buckets.find(b => b.n === 1)!.median_abs_s).toBe(100);
  });

  it("a prediction whose vehicle never passes within 20 min of `at` is a phantom", () => {
    const r = score([p(0, 600, "ghost")], {}, 5000);
    expect(r.phantom).toBe(1);
    expect(r.matched).toBe(0);
  });

  it("a prediction too close to the end of the data is left out, not a phantom", () => {
    const r = score([p(4500, 4800, "ghost")], {}, 5000);
    expect(r.phantom).toBe(0);
    expect(r.unresolved).toBe(1);
  });

  it("counts one row per question even when the same bus is asked about every minute", () => {
    const passes = { "s1|v1": [1000] };
    const r = score([p(400, 1000), p(460, 1000), p(520, 1000)], passes, 5000);
    expect(r.matched).toBe(3);
  });
});
