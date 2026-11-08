import { describe, expect, it } from "vitest";
import { addedEntrances, entranceKey, withFixes, type StationFixes } from "../src/lib/metro";

describe("station entrances in the fixes", () => {
  const fixes: StationFixes = {
    "ent:ΣΥΝΤΑΓΜΑ|Πλατεία Συντάγματος": [37.975231, 23.735325],   // one of the map's, moved
    "ent:ΣΥΝΤΑΓΜΑ|Είσοδος 4": [37.9749, 23.7351],                  // added
    "ent:ΣΥΝΤΑΓΜΑ|Παλιά": null,                                    // removed
    "ent:ΟΜΟΝΟΙΑ|Είσοδος 1": [37.984, 23.728],                     // another station's
  };
  it("lists the ones the map's tiles do not have, for that station only, without the removed", () => {
    const known = new Set([entranceKey("ΣΥΝΤΑΓΜΑ", "Πλατεία Συντάγματος")]);
    expect(addedEntrances(fixes, "ΣΥΝΤΑΓΜΑ", known)).toEqual([
      { name: "Είσοδος 4", at: [37.9749, 23.7351], key: "ent:ΣΥΝΤΑΓΜΑ|Είσοδος 4", added: true },
    ]);
  });
  it("leaves the stations as they are when only entrances are fixed (or removed)", () => {
    const data = { source: "", lines: [], stations: [{ name: "ΣΥΝΤΑΓΜΑ", lat: 1, lon: 2, lines: ["M2"] }] };
    expect(withFixes(data, fixes).stations[0]).toEqual(data.stations[0]);
  });
});
