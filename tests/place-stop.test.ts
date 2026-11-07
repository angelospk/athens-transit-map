import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { centre, distM, placeStop, places, searchPlaces, type TripIndex } from "../src/lib/trip";

const ix = JSON.parse(readFileSync(new URL("../public/trips.json", import.meta.url), "utf8")) as TripIndex;
const all = places(ix);

describe("placeStop", () => {
  // A stop place of the search is every stop of one name within 800 m: its centre can be far from all of them.
  it("opens a stop of the place, however far its centre is from the stops", () => {
    let seen = 0;
    for (const q of ["Συνταγμα", "Πανεπιστημιο", "Ομονοια", "Ακαδημια", "Πειραιας"]) {
      const p = searchPlaces(all, q, 6).find(x => x.kind === "stop" && x.pts.length > 1);
      if (!p) continue;
      seen++;
      const k = placeStop(ix, p);
      expect(k, q).toBeGreaterThanOrEqual(0);
      const s = ix.s[k];
      expect(s[3], q).toBeTruthy();
      expect(p.pts.some(x => x[0] === s[1] && x[1] === s[2]), q).toBe(true);
    }
    expect(seen).toBeGreaterThanOrEqual(2);
  });

  it("takes the stop nearest the centre", () => {
    const p = searchPlaces(all, "Συνταγμα", 6).find(x => x.kind === "stop" && x.pts.length > 1)!;
    const c = centre(p.pts), k = placeStop(ix, p);
    for (const [, lat, lon, code] of ix.s) {
      if (code && p.pts.some(x => x[0] === lat && x[1] === lon)) expect(distM([lat, lon], c)).toBeGreaterThanOrEqual(distM([ix.s[k][1], ix.s[k][2]], c));
    }
  });

  it("is -1 for a place with no stop of the index", () => {
    expect(placeStop(ix, { label: "Κάπου", pts: [[30, 20]], lines: [], kind: "stop" })).toBe(-1);
  });
});
