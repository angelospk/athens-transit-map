import { describe, expect, it } from "vitest";
import { linesNear, ownLines } from "../src/lib/offline";
import type { TripIndex } from "../src/lib/trip";

// Three stops: two near each other, one 5 km off; three lines.
const ix: TripIndex = {
  v: "t",
  s: [["Α", 37.98, 23.73], ["Β", 37.981, 23.731], ["Γ", 38.02, 23.75]],
  l: { "040": { a: [0, 2] }, "550": { a: [1] }, "Χ95": { a: [2] } },
};

describe("offline lines", () => {
  it("finds the lines with a stop near a point", () => {
    expect(linesNear(ix, [37.98, 23.73], 200).sort()).toEqual(["040", "550"]);
    expect(linesNear(ix, [38.1, 23.9], 500)).toEqual([]);
  });
  it("gathers the rider's own: favourite bus lines, and lines near favourite stops and places, each once", () => {
    expect(ownLines(ix, ["oasa:Χ95", "stasy:M3", "oasa:999"], [], [])).toEqual(["Χ95"]);
    expect(ownLines(ix, ["oasa:040"], [[37.98, 23.73]], [[38.02, 23.75]]).sort()).toEqual(["040", "550", "Χ95"]);
  });
});
