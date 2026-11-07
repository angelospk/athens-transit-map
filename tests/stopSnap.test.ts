import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { points, type RoadsFile } from "../src/lib/athensRoads";
import { kerbPoint, type Pt } from "../src/lib/stopSnap";

const m = (a: Pt, b: Pt) => Math.hypot((a[0] - b[0]) * 110_540, (a[1] - b[1]) * 111_320 * Math.cos((a[0] * Math.PI) / 180));

describe("stops on their street", () => {
  const f = JSON.parse(readFileSync("public/roads/596_948.json", "utf8")) as RoadsFile;
  const streets = [...f.r, ...(f.c ?? [])].map(w => ({ pts: points(f.origin, f.unit, w[5]), half: w[1] / 20 }));
  it("moves 3η Αγίας Τριάδος from beside a lane to Αγίας Τριάδος's kerb", () => {
    const stop: Pt = [37.95351, 23.85899];
    const at = kerbPoint(streets, stop)!;
    expect(at).not.toBeNull();
    expect(m(stop, at)).toBeGreaterThan(8);
    // On the pavement's edge of the 8.2 m street: about 5 m from its middle, not out in the lane beside it.
    const road = { pts: points(f.origin, f.unit, f.r[218][5]), half: 4.1 };
    expect(kerbPoint([road], at, 30)).toBeNull();
  });
  it("leaves a stop that is on its street", () => {
    const road = { pts: [[23.85, 37.95], [23.86, 37.95]] as [number, number][], half: 4 };
    expect(kerbPoint([road], [37.95002, 23.855])).toBeNull();     // 2 m from the middle
    expect(kerbPoint([road], [37.9502, 23.855])).not.toBeNull();  // 22 m off
    expect(kerbPoint([road], [37.951, 23.855])).toBeNull();       // 110 m: not its street
  });
});
