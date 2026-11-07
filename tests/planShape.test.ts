import { describe, expect, it, vi } from "vitest";
import { bestSlice, chunks, matchPiece, matchRoads, resample, sensibleWalk, sliceShape, stationsAlong, stopsBetween, type Pt } from "../src/lib/planShape";

// A shape going east along a street, a point every ~88 m.
const street: Pt[] = [0, 1, 2, 3, 4, 5].map(k => [37.98, 23.73 + k * 0.001]);

describe("planShape", () => {
  it("takes the part of a shape between the two stops, with the stops at its ends", () => {
    const r = sliceShape(street, [37.9801, 23.7311], [37.9799, 23.7339]);
    expect(r?.pts[0]).toEqual([37.9801, 23.7311]);
    expect(r?.pts.at(-1)).toEqual([37.9799, 23.7339]);
    expect(r?.pts.slice(1, -1)).toEqual([street[2], street[3]]);
  });
  it("refuses a shape the stops are not on, or that runs the other way", () => {
    expect(sliceShape(street, [37.99, 23.731], [37.98, 23.734])).toBeNull();
    expect(sliceShape(street, [37.98, 23.734], [37.98, 23.731])).toBeNull();
  });
  it("picks the variant that fits best", () => {
    const back = [...street].reverse();
    expect(bestSlice([back, street], [37.98, 23.7311], [37.98, 23.7339])?.length).toBe(4);
  });

  it("puts points every so many metres along a line, its ends kept", () => {
    const ps = resample([street[0], street[5]], 80, 100);
    expect(ps[0]).toEqual(street[0]);
    expect(ps.at(-1)).toEqual(street[5]);
    expect(ps.length).toBeGreaterThan(5);
    expect(resample([street[0], street[5]], 10, 4)).toHaveLength(4);   // at most max: spaced wider
  });
  it("cuts a line into pieces that each start where the last ended", () => {
    expect(chunks([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [3, 4, 5], [5, 6, 7]]);
    expect(chunks([1, 2], 10)).toEqual([[1, 2]]);
    // overlapping by three, so two pieces share a point inside both (the second of one, the last but one of the other)
    expect(chunks([1, 2, 3, 4, 5, 6, 7, 8, 9], 5, 3)).toEqual([[1, 2, 3, 4, 5], [3, 4, 5, 6, 7], [5, 6, 7, 8, 9]]);
  });
  it("matches a line piece by piece, a piece it cannot match keeping its own points", async () => {
    const long: Pt[] = [[37.98, 23.73], [37.98, 23.76]];
    let n = 0;
    const road = await matchRoads(long, undefined, async ps => { const line = ps.map(([a, b]) => [a + 0.0001, b] as Pt); return n++ === 1 ? null : { line, at: line }; });
    expect(n).toBeGreaterThan(2);
    expect(road?.length).toBeGreaterThan(10);
    // in order along the line, no step back at the joins
    expect(road!.every((p, i) => i === 0 || p[1] >= road![i - 1][1])).toBe(true);
    expect(await matchRoads(long, undefined, async () => null)).toBeNull();
  });
  it("finds the stops a bus passes between two of its stops, on the variant that has both in order", () => {
    const stops = { a: { name: "Α", lat: 1, lon: 1 }, b: { name: "Β", lat: 2, lon: 2 }, c: { name: "Γ", lat: 3, lon: 3 }, d: { name: "Δ", lat: 4, lon: 4 } };
    expect(stopsBetween([{ stops: ["d", "c", "b", "a"] }, { stops: ["a", "b", "c", "d"] }], stops, "a", "d")?.map(m => m.name)).toEqual(["Β", "Γ"]);
    expect(stopsBetween([{ stops: ["a", "b"] }], stops, "b", "a")).toBeNull();
  });
  it("finds a line's stations along a ride's track, in order, without its two ends", () => {
    const track: Pt[] = Array.from({ length: 41 }, (_, k) => [37.98, 23.73 + k * 0.001]);
    const st = (name: string, lon: number, lines = ["M3"]) => ({ name, lat: 37.9801, lon, lines });
    const got = stationsAlong(track, [st("Γ", 23.76), st("Α", 23.73), st("Β", 23.745), st("Άλλη", 23.75, ["M1"]), st("Μακριά", 23.80)], "M3");
    expect(got.map(m => m.name)).toEqual(["Β", "Γ"]);
  });
  it("keeps a walk's way unless it goes round about", () => {
    const a: Pt = [37.98, 23.73], b: Pt = [37.98, 23.732];
    expect(sensibleWalk([a, [37.981, 23.731], b], a, b)).not.toBeNull();
    expect(sensibleWalk([a, [37.99, 23.73], [37.99, 23.74], b], a, b)).toBeNull();
    expect(sensibleWalk(null, a, b)).toBeNull();
  });
  it("asks again when the router is busy, and gives up after a few tries", async () => {
    const ok = { code: "Ok", matchings: [{ geometry: { coordinates: [[23.73, 37.98], [23.731, 37.98]] } }] };
    const answers = [new Response("", { status: 429 }), new Response(JSON.stringify({ code: "TooBig" })), new Response(JSON.stringify(ok))];
    vi.stubGlobal("fetch", vi.fn(async () => answers.shift()!));
    const ps: Pt[] = [[37.98, 23.73], [37.98, 23.731]];
    expect((await matchPiece(ps, undefined, async () => {}))?.line).toEqual([[37.98, 23.73], [37.98, 23.731]]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 429 })));
    expect(await matchPiece(ps, undefined, async () => {})).toBeNull();
    vi.unstubAllGlobals();
  });
});
