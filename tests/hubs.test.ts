import { describe, expect, it } from "vitest";
import { goesTo, linesOfStop, nearby, railBadge, railPoints, stopsNear, walkMin } from "../src/lib/hubs";
import type { TripIndex } from "../src/lib/trip";

// Four stops on a street running east (about 90 m apart at Athens' latitude: 0.001° of longitude), and one far off.
const ix: TripIndex = {
  v: "t",
  s: [["ΑΛΦΑ", 37.98, 23.730, "1"], ["ΒΗΤΑ", 37.98, 23.731, "2"], ["ΓΑΜΜΑ", 37.98, 23.732, "3"], ["ΔΕΛΤΑ", 37.98, 23.733, "4"], ["ΜΑΚΡΙΑ", 38.1, 23.9, "5"]],
  l: { "040": { a: [0, 1, 2, 3] }, "224": { a: [1, 4] }, "550": { a: [2, 1, 0] } },
};
const rail = railPoints({ stations: [{ name: "ΣΥΝΤΑΓΜΑ", lat: 37.9802, lon: 23.7312, lines: ["M2", "M3", "T6"] }] }, null);

describe("hubs", () => {
  it("indexes each stop's lines and finds stops nearest first", () => {
    expect(linesOfStop(ix, 1).sort()).toEqual(["040", "224", "550"]);
    const near = stopsNear(ix, [37.98, 23.731], 100).map(s => s.i);
    expect(near[0]).toBe(1);
    expect(near.slice(1).sort()).toEqual([0, 2]);   // the two neighbours, 88 m each way
  });
  it("lists the stations and the bus stops with the lines they add, metro before tram", () => {
    const n = nearby(ix, rail, [37.98, 23.730], { skip: ["040"], skipStops: [0] });
    expect(n.rail.map(r => [r.name, r.mode, r.lines])).toEqual([["ΣΥΝΤΑΓΜΑ", "metro", ["M2", "M3"]], ["ΣΥΝΤΑΓΜΑ", "tram", ["T6"]]]);
    expect(n.bus.map(b => [b.name, b.lines])).toEqual([["ΒΗΤΑ", ["224", "550"]], ["ΓΑΜΜΑ", ["550"]]]);
    expect(n.bus[0].walk).toBe(walkMin(n.bus[0].m));
  });
  it("finds the lines that go to a place typed, from the stops given, only onwards", () => {
    const g = goesTo(ix, [{ i: 1, m: 0 }], "δελτα");
    expect(g).toEqual([{ line: "040", from: 1, to: "ΔΕΛΤΑ", hops: 2, m: 0 }]);
    expect(goesTo(ix, [{ i: 1, m: 0 }], "αλφα").map(x => x.line)).toEqual(["550"]);   // 040 passed it already
    expect(goesTo(ix, [{ i: 1, m: 0 }], "αλ")).toEqual([]);                           // three letters at least
  });
  it("draws a metro line round, a tram square and the suburban as Π", () => {
    expect(railBadge("M2", { M2: "#e30613" })).toEqual({ label: "2", color: "#e30613", round: true });
    expect(railBadge("T6", {})).toMatchObject({ label: "6", round: false });
    expect(railBadge("P", {}).label).toBe("Π");
  });
});
