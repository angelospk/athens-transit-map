import { describe, expect, it } from "vitest";
import { spread, type DiagramItem } from "../src/lib/linediagram";

const stop = (id: string): DiagramItem => ({ kind: "stop", id, name: id.toUpperCase(), at: null, live: false, here: false });
const veh = (id: string): DiagramItem => ({ kind: "vehicle", id, label: null, delay_s: null, vehicle: {} as never });

describe("spread", () => {
  it("places each vehicle between its stops, from the first stop (0) to the last (1)", () => {
    const s = spread([stop("a"), veh("v1"), stop("b"), stop("c"), stop("d"), veh("v2"), stop("e")]);
    expect(s.dots.map(d => d.x)).toEqual([0.125, 0.875]);
    expect(s.dots.every(d => !d.bunched)).toBe(true);
    expect(s.bunch).toBeNull();
  });
  it("marks vehicles within one stop of each other as bunched, named by the stop they come to next", () => {
    const s = spread([stop("a"), veh("v1"), stop("b"), veh("v2"), stop("c"), stop("d"), stop("e"), veh("v3"), stop("f")]);
    expect(s.dots.map(d => d.bunched)).toEqual([true, true, false]);
    expect(s.bunch).toEqual({ n: 2, before: "C" });
  });
  it("needs two stops at least", () => {
    expect(spread([stop("a"), veh("v1")]).dots).toEqual([]);
  });
});
