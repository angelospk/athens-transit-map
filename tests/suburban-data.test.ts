import { describe, expect, it } from "vitest";
import data from "../public/suburban.json";

// public/suburban.json: every station is on its corridors (in their station lists, and near their track). «Άγιος
// Γεώργιος» (Οινόη – Χαλκίδα, by Σχηματάρι) once sat on Lycabettus, the chapel of that name: a train «to Χαλκίδα»
// from the middle of Athens.
type Corridor = { stations: string[]; path: [number, number][] | [number, number][][] };
const corridors = data.corridors as unknown as Record<string, Corridor>;
const km = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * 111, (a[1] - b[1]) * 88);

describe("suburban.json", () => {
  it("lists every station on a corridor, near that corridor's track", () => {
    for (const s of data.stations) {
      expect(Object.values(corridors).some(c => c.stations.includes(s.id)), s.name).toBe(true);
      const near = Math.min(...[...new Set(s.corridors)].flatMap(k => {
        const p = corridors[k].path, paths = (Array.isArray(p[0][0]) ? p : [p]) as [number, number][][];
        return paths.flat().map(q => km(q, [s.lat, s.lon]));
      }));
      expect(near, s.name).toBeLessThan(2);
    }
  });
});
