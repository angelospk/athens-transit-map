import { describe, expect, it } from "vitest";
import { joinWays, osmPaths, simplify, type OsmElement } from "../scripts/osm";

const way = (id: number, ...pts: [number, number][]): OsmElement =>
  ({ type: "way", id, geometry: pts.map(([lon, lat]) => ({ lon, lat })) });
const rel = (ref: string, ...members: [number, string][]): OsmElement =>
  ({ type: "relation", id: members[0][0] * 100, tags: { ref }, members: members.map(([ref, role]) => ({ type: "way", ref, role })) });

describe("joinWays", () => {
  it("joins ways that share an end, reversing where needed", () => {
    expect(joinWays([[[0, 0], [1, 0]], [[2, 0], [1, 0]], [[2, 0], [3, 0]]])).toEqual([[[0, 0], [1, 0], [2, 0], [3, 0]]]);
  });

  it("joins at the start of a chain too", () => {
    expect(joinWays([[[1, 0], [2, 0]], [[0, 0], [1, 0]]])).toEqual([[[0, 0], [1, 0], [2, 0]]]);
  });

  it("keeps a branch as its own path", () => {
    const out = joinWays([[[0, 0], [1, 0]], [[1, 0], [2, 0]], [[1, 0], [1, 1]]]);
    expect(out).toHaveLength(2);
    expect(out.flat()).toHaveLength(5);
  });
});

describe("osmPaths", () => {
  it("takes the track ways of a line's relations, once each, and skips platforms", () => {
    const els = [
      rel("Μ1", [1, ""], [2, ""], [9, "platform"]),
      rel("Μ1", [2, ""], [1, ""]),   // the other direction, same track
      way(1, [23.6, 37.9], [23.61, 37.91]),
      way(2, [23.61, 37.91], [23.62, 37.90]),
      way(9, [23.0, 37.0], [23.01, 37.01]),
    ];
    expect(osmPaths(els)).toEqual(new Map([["M1", [[[23.6, 37.9], [23.61, 37.91], [23.62, 37.90]]]]]));
  });

  it("counts one-way track roles as track", () => {
    const els = [rel("Μ3", [1, "forward"], [2, "stop"]), way(1, [23.7, 37.9], [23.71, 37.91]), way(2, [23.8, 37.9], [23.81, 37.91])];
    expect(osmPaths(els).get("M3")).toEqual([[[23.7, 37.9], [23.71, 37.91]]]);
  });

  it("maps the Greek refs to the GTFS line ids", () => {
    const els = [rel("Τ6", [1, ""]), way(1, [23.7, 37.9], [23.71, 37.91])];
    expect([...osmPaths(els).keys()]).toEqual(["T6"]);
  });

  it("rounds to 6 decimals", () => {
    const els = [rel("Μ2", [1, ""]), way(1, [23.71234567, 37.91234567], [23.7, 37.9])];
    expect(osmPaths(els).get("M2")![0][0]).toEqual([23.712346, 37.912346]);
  });
});

describe("simplify", () => {
  it("drops points closer than the tolerance to the line through their neighbours, keeps the ends", () => {
    // 0.00001° of latitude ≈ 1.1 m: the middle point is ~1 m off the straight line.
    expect(simplify([[23.7, 37.9], [23.701, 37.90001], [23.702, 37.9]], 3)).toEqual([[23.7, 37.9], [23.702, 37.9]]);
  });

  it("keeps a turnback (a point past the end, on the same line)", () => {
    const back: [number, number][] = [[23.7, 37.9], [23.702, 37.9], [23.701, 37.9]];
    expect(simplify(back, 3)).toEqual(back);
  });

  it("keeps a real bend", () => {
    const bend: [number, number][] = [[23.7, 37.9], [23.701, 37.901], [23.702, 37.9]];
    expect(simplify(bend, 3)).toEqual(bend);
  });
});
