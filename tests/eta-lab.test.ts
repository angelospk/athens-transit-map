import { describe, expect, it } from "vitest";
import { passTime, score, summary, type Fix, type Pred } from "../lab/eta/eta";

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
  it("a bus that waits at the stop (a terminus) passes when it leaves, not when it arrives", () => {
    const fixes = [fix(0, -300), fix(60, -10), fix(180, 5), fix(300, 10), fix(420, 12), fix(560, 15), fix(620, 400)];
    expect(passTime(fixes, stop)).toBe(560);
  });
  it("a short stop inside 40 m is still the arrival", () => {
    expect(passTime([fix(0, -300), fix(60, -10), fix(100, 20), fix(160, 400)], stop)).toBe(60);
  });
  it("a wait that runs to the end of the data has no pass yet", () => {
    expect(passTime([fix(0, -300), fix(60, -10), fix(180, 5), fix(300, 10)], stop)).toBeNull();
  });
  it("a wait with a gap in the fixes ends only at a fix outside the stop", () => {
    const fixes = [fix(0, -10), fix(60, 5), fix(120, 10), fix(400, 12)];
    expect(passTime(fixes, stop)).toBeNull();
    expect(passTime([...fixes, fix(460, 400)], stop)).toBe(400);
  });
  it("a wait that began before `after` still counts from its start", () => {
    const fixes = [fix(0, -10), fix(60, 5), fix(120, 10), fix(180, 12), fix(240, 400)];
    expect(passTime(fixes, stop, 100)).toBe(180);
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
    const r = score([p(2000, 3100), p(2900, 3100)], passes, 9000);
    expect(r.matched).toBe(2);
    expect(r.buckets.find(b => b.label === "10-20′")!.median_abs_s).toBe(100);
  });

  it("a bus is listed until it passes: a pass long after it left the list belongs to a later trip", () => {
    // listed 1000-1100 (it passed unseen, then dropped off the list); the next pass is its next lap
    const passes = { "s1|v1": [4500] };
    const r = score([p(1000, 1200), p(1060, 1200), p(1100, 1150)], passes, 9000);
    expect(r.matched).toBe(0);
    expect(r.phantom).toBe(3);
  });

  it("a gap of more than 15 min in the listing starts a new trip", () => {
    const passes = { "s1|v1": [1150, 3000] };
    const r = score([p(1000, 1150), p(1100, 1150), p(2700, 3000), p(2900, 3000)], passes, 9000);
    expect(r.matched).toBe(4);
    expect(r.all.median_abs_s).toBe(0);
  });

  it("a prediction whose vehicle never passes within 20 min of `at` is a phantom", () => {
    const r = score([p(0, 600, "ghost")], {}, 5000);
    expect(r.phantom).toBe(1);
    expect(r.matched).toBe(0);
  });

  it("a run that may still continue after the data ends is unresolved", () => {
    // listed at 1000; data ends at 1700: a listing at 1800 would have extended the run
    const r = score([p(1000, 1300, "ghost")], {}, 1700);
    expect(r.unresolved).toBe(1);
    expect(r.phantom).toBe(0);
  });

  it("a prediction too close to the end of the data is left out, not a phantom", () => {
    const r = score([p(4500, 4800, "ghost")], {}, 5000);
    expect(r.phantom).toBe(0);
    expect(r.unresolved).toBe(1);
  });

  it("counts one row per question even when the same bus is asked about every minute", () => {
    const passes = { "s1|v1": [700] };
    const r = score([p(400, 700), p(460, 700), p(520, 700)], passes, 5000);
    expect(r.matched).toBe(3);
  });
});

describe("score with keep", () => {
  const p = (q: number, at: number, vehicle = "v1", stop = "s1"): Pred => ({ q, stop, vehicle, at });
  it("rows left out still extend the run of the rows that count (a run across midnight)", () => {
    const passes = { "s1|v1": [2000] };
    // counted: the listing at 1000; not counted: the later listings of the same run up to the pass
    const preds = [p(1000, 1900), p(1500, 1950), p(1900, 2000)];
    const r = score(preds, passes, 9000, x => x.q < 1200);
    expect(r.matched).toBe(1);
    expect(r.phantom).toBe(0);
    expect(r.all.median_abs_s).toBe(100);
  });
});

describe("summary (the published weekly accuracy)", () => {
  const p = (q: number, at: number, vehicle = "v1", stop = "s1"): Pred => ({ q, stop, vehicle, at });
  it("keeps the three buckets under 20′, rounds, and counts phantoms as a share", () => {
    const passes = { "s1|v1": [1000] };
    const r = score([p(700, 1060), p(940, 1000), p(100, 900), p(0, 300, "ghost")], passes, 9000);
    const s = summary(r, { from: "2026-10-31", to: "2026-11-06", stops: 5 });
    expect(s).toEqual({
      v: 1, from: "2026-10-31", to: "2026-11-06", stops: 5, preds: 4,
      buckets: [
        { label: "0-5′", n: 1, median_s: 0, within_120: 1 },
        { label: "5-10′", n: 1, median_s: 60, within_120: 1 },
        { label: "10-20′", n: 1, median_s: 100, within_120: 1 },
      ],
      phantom_share: 0.25,
    });
  });
});
