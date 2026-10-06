import { describe, expect, it } from "vitest";
import { distanceM } from "../src/lib/glide";
import {
  headingAt, pointAt, predictS, projectCandidates, stopOffsets, updateTrack, type Route, type Sample, type Track,
} from "../src/lib/predict";
import { drive, NO_SPEED } from "../src/lib/motion";

// Shapes are [lat, lon]. 0.01° lon at 37.97° ≈ 877 m.
const M = 877.4;
const east: [number, number][] = [[37.97, 23.70], [37.97, 23.71], [37.97, 23.72]];
const outBack: [number, number][] = [[37.97, 23.70], [37.97, 23.71], [37.97001, 23.71], [37.97001, 23.70]];
const at = (lonFrac: number): [number, number] => [23.70 + lonFrac * 0.01, 37.97];   // [lon, lat] on east

const route = (shape: [number, number][], stopIds: string[] = [], stops: [number, number][] = []): Route => {
  const stopS = stopOffsets(shape, stops);
  return { shape, stopIds, stopS, endS: pointAtEnd(shape) };
};
const pointAtEnd = (shape: [number, number][]) => {
  let d = 0;
  for (let i = 1; i < shape.length; i++) d += distanceM([shape[i - 1][1], shape[i - 1][0]], [shape[i][1], shape[i][0]]);
  return d;
};
const sample = (pos: [number, number], t: number, extra: Partial<Sample> = {}): Sample =>
  ({ pos, at: t, key: "v1/t1", ...extra });

describe("geometry", () => {
  it("projects onto the shape, with every leg that passes close by", () => {
    expect(projectCandidates(east, at(0.5))[0].s).toBeCloseTo(0.5 * M, -1);
    expect(projectCandidates(east, [23.705, 37.975])).toEqual([]);
    const c = projectCandidates(outBack, [23.705, 37.970005]).map(x => Math.round(x.s));
    expect(c).toHaveLength(2);
  });
  it("walks along the shape and stops at its ends", () => {
    expect(distanceM(pointAt(east, M), [23.71, 37.97])).toBeLessThan(2);
    expect(pointAt(east, -50)).toEqual([23.70, 37.97]);
    expect(pointAt(east, 5 * M)).toEqual([23.72, 37.97]);
  });
  it("gives the travel bearing at a point", () => {
    expect(headingAt(east, 100)).toBeCloseTo(90, 0);
    expect(headingAt(outBack, 1.5 * M)).toBeCloseTo(270, 0);
  });
  it("projects repeated stops in order along the shape", () => {
    const s = stopOffsets(outBack, [[23.705, 37.97], [23.705, 37.97001]]);
    expect(s[0]).toBeLessThan(500);
    expect(s[1]).toBeGreaterThan(1200);
  });
});

describe("updateTrack", () => {
  const r = route(east);
  it("starts with no speed, then measures it", () => {
    const t1 = updateTrack(null, sample(at(0.2), 1000), r, 1005)!;
    expect(t1.speed).toBeNull();
    const t2 = updateTrack(t1, sample(at(0.5), 1030), r, 1035)!;
    expect(t2.speed).toBeCloseTo((0.3 * M) / 30, 1);
  });
  it("ignores repeated and older samples", () => {
    const t1 = updateTrack(updateTrack(null, sample(at(0.2), 1000), r, 1005), sample(at(0.5), 1030), r, 1035)!;
    expect(updateTrack(t1, sample(at(0.5), 1030), r, 1040)).toBe(t1);
    expect(updateTrack(t1, sample(at(0.1), 1010), r, 1040)).toBe(t1);
  });
  it("treats small moves as standing still", () => {
    const t1 = updateTrack(null, sample(at(0.5), 1000), r, 1001)!;
    expect(updateTrack(t1, sample(at(0.501), 1030), r, 1031)!.speed).toBe(0);
  });
  it("starts over on a new trip and on an implausible jump", () => {
    const t1 = updateTrack(null, sample(at(0.2), 1000), r, 1001)!;
    expect(updateTrack(t1, sample(at(0.5), 1030, { key: "v1/t2" }), r, 1031)!.speed).toBeNull();
    expect(updateTrack(t1, sample(at(1.9), 1010), r, 1011)!.speed).toBeNull();   // 1.5 km in 10 s
    expect(updateTrack(t1, sample(at(0.6), 1181), r, 1182)!.speed).toBeNull();   // over 3 min apart
  });
  it("gives a speed to fixes that arrive 50 s old, none to ones over 2 minutes old", () => {
    const t1 = updateTrack(null, sample(at(0.2), 1000), r, 1001)!;
    expect(updateTrack(t1, sample(at(0.5), 1030), r, 1080)!.speed).toBeGreaterThan(5);
    expect(updateTrack(t1, sample(at(0.5), 1030), r, 1151)!.speed).toBeNull();
  });
  it("holds a first sample on an out-and-back street, then follows the movement", () => {
    const ob = route(outBack);
    const t1 = updateTrack(null, sample([23.708, 37.970005], 1000), ob, 1001)!;
    expect(t1.speed).toBeNull();
    const back = updateTrack(t1, sample([23.704, 37.970005], 1030), ob, 1031)!;   // moved west: back leg
    expect(back.s).toBeGreaterThan(M);
    expect(back.speed).toBeGreaterThan(5);
  });
  it("knows the stops ahead of the vehicle", () => {
    const rs = route(east, ["A", "B"], [at(0.3), at(1.2)]);
    const t1 = updateTrack(null, sample(at(0.1), 1000), rs, 1001)!;
    expect(t1.stopS).toBe(rs.stopS);
  });
  it("returns null off the route", () => {
    expect(updateTrack(null, sample([23.705, 37.975], 1000), r, 1001)).toBeNull();
  });
  it("uses the backend's smoothed speed when given, from the first sample on", () => {
    const t1 = updateTrack(null, sample(at(0.2), 1000, { speed: 6 }), r, 1005)!;
    expect(t1.speed).toBe(6);
    const t2 = updateTrack(t1, sample(at(0.5), 1030, { speed: 7.5 }), r, 1035)!;   // measured would be ~8.8
    expect(t2.speed).toBe(7.5);
    expect(updateTrack(t2, sample(at(0.5), 1060, { speed: 0 }), r, 1061)!.speed).toBe(0);
    expect(updateTrack(null, sample(at(0.2), 1000, { speed: 99 }), r, 1001)!.speed).toBe(20);   // clamped
  });
  it("falls back to its own speed when the backend's is missing or invalid", () => {
    const t1 = updateTrack(null, sample(at(0.2), 1000, { speed: null }), r, 1005)!;
    expect(t1.speed).toBeNull();
    expect(updateTrack(t1, sample(at(0.5), 1030, { speed: -3 }), r, 1035)!.speed).toBeCloseTo((0.3 * M) / 30, 1);
    expect(updateTrack(t1, sample(at(0.5), 1030, { speed: NaN }), r, 1035)!.speed).toBeCloseTo((0.3 * M) / 30, 1);
  });
  it("gives no speed to old fixes or ambiguous first samples, even with a backend speed", () => {
    expect(updateTrack(null, sample(at(0.2), 1000, { speed: 6 }), r, 1121)!.speed).toBeNull();
    expect(updateTrack(null, sample([23.708, 37.970005], 1000, { speed: 6 }), route(outBack), 1001)!.speed).toBeNull();
  });
});

describe("predictS", () => {
  const stopS = [900, 1300];
  const track: Track = { s: 500, at: 1000, speed: 10, stopS, endS: 2 * M, key: "k" };
  it("drives the stops ahead of the vehicle, from the fix", () => {
    const f = drive(10, [400, 800], 2 * M - 500);
    expect(predictS(track, 1010)).toBeCloseTo(500 + f(10), 6);
    expect(predictS(track, 1000 + 600)).toBeLessThanOrEqual(2 * M);
  });
  it("ignores a stop the vehicle is at or has passed", () => {
    const f = drive(10, [400], 2 * M - 890);
    expect(predictS({ ...track, s: 890 }, 1010)).toBeCloseTo(890 + f(10), 6);
  });
  it("moves slowly without a speed, not at all when standing, held or before the fix", () => {
    expect(predictS({ ...track, speed: null }, 1010)).toBeCloseTo(500 + drive(NO_SPEED, [400, 800], 2 * M - 500)(10), 6);
    expect(predictS({ ...track, speed: 0 }, 1010)).toBe(500);
    expect(predictS({ ...track, speed: null, alts: [500, 1500] }, 1010)).toBe(500);
    expect(predictS(track, 990)).toBe(500);
  });
});

