import { describe, expect, it } from "vitest";
import { directionGroups, isHidden } from "../src/lib/directions";
import s040 from "../src/fixtures/lines-040.json";
import type { LineStatic } from "../src/lib/types";

describe("directionGroups", () => {
  it("groups the variants of 040 by last stop", () => {
    const g = directionGroups(s040 as unknown as LineStatic);
    expect(g.map(x => x.to).sort()).toEqual(["ΠΕΙΡΑΙΑΣ", "ΣΥΝΤΑΓΜΑ"]);
    expect(g.find(x => x.to === "ΣΥΝΤΑΓΜΑ")!.variants.sort()).toEqual(["5512", "5535"]);
  });
  it("gives one group for a line with one direction", () => {
    const one = { id: "x", stops: { a: { name: "A", lat: 0, lon: 0 } },
      variants: { v1: { headsign: "", direction: 0, shape: [], stops: ["b", "a"] }, v2: { headsign: "", direction: 0, shape: [], stops: ["c", "a"] } } };
    expect(directionGroups(one as unknown as LineStatic)).toHaveLength(1);
  });
});

describe("isHidden", () => {
  const focus = new Set(["5512", "5535"]);
  const known = new Set(["5512", "5513", "5535"]);
  it("hides vehicles of other known directions only", () => {
    expect(isHidden("5513", focus, known)).toBe(true);
    expect(isHidden("5512", focus, known)).toBe(false);
    expect(isHidden(null, focus, known)).toBe(false);
    expect(isHidden("9999", focus, known)).toBe(false);   // variant not in static data: unknown
    expect(isHidden("5513", undefined, known)).toBe(false);
  });
});

describe("directionGroups labels", () => {
  it("adds the headsign when two directions end at stops with the same name", () => {
    const st = { id: "x", stops: { a: { name: "ΑΦΕΤΗΡΙΑ", lat: 0, lon: 0 }, b: { name: "ΑΦΕΤΗΡΙΑ", lat: 0, lon: 0 } },
      variants: { v1: { headsign: "ΔΕΞΙΟΣΤΡΟΦΗ", direction: 0, shape: [], stops: ["b", "a"] },
                  v2: { headsign: "ΑΡΙΣΤΕΡΟΣΤΡΟΦΗ", direction: 0, shape: [], stops: ["a", "b"] },
                  v3: { headsign: "", direction: 0, shape: [], stops: [] } } };
    expect(directionGroups(st as unknown as LineStatic).map(g => g.to)).toEqual(["ΑΦΕΤΗΡΙΑ (ΔΕΞΙΟΣΤΡΟΦΗ)", "ΑΦΕΤΗΡΙΑ (ΑΡΙΣΤΕΡΟΣΤΡΟΦΗ)"]);
  });
});
