import { describe, expect, it } from "vitest";
import { distanceM } from "../src/lib/glide";
import { RailGlide, railPlace, railSegment, trackStops } from "../src/lib/rails";

// An L-shaped track: east along lat 38, then north. [lat, lon], as the predict shapes.
const L: [number, number][] = [[38, 23.7], [38, 23.71], [38.01, 23.71]];
// A point north of the corner as far from it as [23.705, 38] is: the half-way point is the corner.
const N = 38 + distanceM([23.705, 38], [23.71, 38]) / (6_371_000 * Math.PI / 180);
const near = (a: number[], b: number[]) => expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(1e-5);

describe("railSegment / railPlace", () => {
  it("moves along the track, round the corner, not on the straight line", () => {
    const seg = railSegment([L], [23.705, 38], [23.71, N])!;
    expect(seg).not.toBeNull();
    const p = railPlace(seg, 0.5);
    near(p.pos, [23.71, 38]);              // the corner: half of the way along the track
    expect(railPlace(seg, 0.4).h).toBeCloseTo(90, 0);   // heading east before the corner
    near(railPlace(seg, 0).pos, [23.705, 38]);
    near(railPlace(seg, 1).pos, [23.71, N]);
    expect(railPlace(seg, 0.9).h).toBeCloseTo(0, 0);   // north after it
  });
  it("runs a track drawn the other way backwards", () => {
    const seg = railSegment([L], [23.71, N], [23.705, 38])!;
    near(railPlace(seg, 0.5).pos, [23.71, 38]);
    expect(railPlace(seg, 0.2).h).toBeCloseTo(180, 0);  // south first
  });
  it("picks the track of the line that passes both stops", () => {
    const other: [number, number][] = [[37.9, 23.6], [37.9, 23.61]];
    const seg = railSegment([other, L], [23.705, 38], [23.71, N])!;
    near(railPlace(seg, 0.5).pos, [23.71, 38]);
  });
  it("a stretch much shorter than the stops are apart is a wrong track: null", () => {
    // Both stops within 300 m of the track, but they project onto the same place: not this track.
    expect(railSegment([L], [23.705, 38], [23.705, 38.0025])).toBeNull();
  });
  it("no track near a stop: null (the caller draws the straight line)", () => {
    expect(railSegment([L], [23.705, 38], [23.8, 38.1])).toBeNull();
    expect(railSegment([], [23.705, 38], [23.71, N])).toBeNull();
  });
});

describe("RailGlide", () => {
  it("snaps a fix onto the track and glides to the next one along it", () => {
    const g = new RailGlide(10_000);
    g.update("1", L, [23.7051, 38.0001], 0);           // a little off the track
    near(g.at("1", 0)!.pos, [23.7051, 38]);
    g.update("1", L, [23.71, N], 1_000);
    near(g.at("1", 1_000)!.pos, [23.7051, 38]);        // starts where it was drawn
    near(g.at("1", 11_000)!.pos, [23.71, N]);     // there after the glide
    const mid = g.at("1", 6_000)!;
    expect(mid.pos[0]).toBeGreaterThan(23.7051);
    expect(mid.h).not.toBeNull();
  });
  it("runs on along the track at the fix's speed, the way its course points, at most 30 s", () => {
    const g = new RailGlide(0);
    const start: [number, number] = [23.703, 38];
    g.update("e", L, start, 0, { kmh: 36, course: 85, at: 0 });   // 10 m/s, east
    const east = g.at("e", 5_000)!;
    expect(distanceM(start, east.pos)).toBeCloseTo(50, 0);
    expect(east.pos[0]).toBeGreaterThan(start[0]);
    expect(east.h).toBeCloseTo(90, 0);
    expect(distanceM(start, g.at("e", 60_000)!.pos)).toBeCloseTo(300, 0);   // 30 s at most
    g.update("w", L, start, 0, { kmh: 36, course: 260, at: 0 });  // west
    expect(g.at("w", 5_000)!.pos[0]).toBeLessThan(start[0]);
    g.update("s", L, start, 0, { kmh: 0.5, course: 90, at: 0 });  // standing
    near(g.at("s", 5_000)!.pos, start);
  });
  it("counts from the fix's own time, and blends from where it was drawn", () => {
    const g = new RailGlide(2_000);
    g.update("e", L, [23.703, 38], 10_000, { kmh: 36, course: 90, at: 4_000 });   // a fix 6 s old: 60 m on
    near(g.at("e", 10_000)!.pos, [23.703, 38]);   // the blend starts at the snapped fix (nothing drawn before)
    expect(distanceM([23.703, 38], g.at("e", 12_000)!.pos)).toBeCloseTo(80, 0);
  });
  it("a slow train runs on no farther than the next station ahead (it stops there)", () => {
    const g = new RailGlide(0);
    const stops = trackStops(L, [[23.7, 38], [23.708, 38], [23.71, N]]);   // 0 m, ~700 m, the end
    g.update("e", L, [23.705, 38], 0, { kmh: 54, course: 90, at: 0 }, stops);   // 435 m in 29 s: past it
    near(g.at("e", 29_000)!.pos, [23.708, 38]);
    g.update("f", L, [23.705, 38], 0, { kmh: 100, course: 90, at: 0 }, stops);  // fast: may pass it (not every train stops)
    expect(g.at("f", 10_000)!.pos[0]).toBeGreaterThan(23.708);
    g.update("w", L, [23.709, 38], 0, { kmh: 36, course: 270, at: 0 }, stops);   // west: the ~700 m one is just ahead
    near(g.at("w", 29_000)!.pos, [23.708, 38]);
  });
  it("the same fix polled again, or an older one, changes nothing", () => {
    const g = new RailGlide(2_000);
    g.update("e", L, [23.703, 38], 0, { kmh: 36, course: 90, at: 0 });
    const before = g.at("e", 4_000)!.pos;
    g.update("e", L, [23.703, 38], 3_000, { kmh: 36, course: 90, at: 0 });
    expect(g.at("e", 4_000)!.pos).toEqual(before);
    g.update("e", L, [23.7025, 38], 3_000, { kmh: 36, course: 90, at: -2_000 });   // older (another cache)
    expect(g.at("e", 4_000)!.pos).toEqual(before);
  });
  it("a slow train just before a station stops at it", () => {
    const g = new RailGlide(0);
    const stops = trackStops(L, [[23.708, 38]]);
    g.update("a", L, [23.7078, 38], 0, { kmh: 36, course: 90, at: 0 }, stops);   // ~17 m before it
    near(g.at("a", 20_000)!.pos, [23.708, 38]);
  });
  it("a fix off every track is drawn where it is, with no glide", () => {
    const g = new RailGlide(10_000);
    g.update("2", L, [23.9, 38.2], 0);
    expect(g.at("2", 0)).toEqual({ pos: [23.9, 38.2], h: null });
  });
  it("forgets trains not updated", () => {
    const g = new RailGlide(10_000);
    g.update("1", L, [23.705, 38], 0);
    g.keep(new Set());
    expect(g.at("1", 0)).toBeNull();
  });
});
