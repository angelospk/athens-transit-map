import { describe, expect, it } from "vitest";
import { depthAt, liveryOf } from "../src/lib/map/metroDepth";

describe("metro depth", () => {
  it("runs M2 under the street all the way", () => {
    expect(depthAt("M2", 23.735, 37.9755)).toBe(50);   // Syntagma
  });
  it("brings M3 up to the surface ~600 m past Doukissis Plakentias, toward the airport", () => {
    expect(depthAt("M3", 23.75, 37.98)).toBe(70);
    expect(depthAt("M3", 23.821223, 38.021516)).toBe(70);          // Chalandri: level along its platform
    expect(depthAt("M3", 23.83359, 38.02396)).toBe(25);            // Doukissis Plakentias: level along its platform
    expect(depthAt("M3", 23.8336 + 0.0007, 38.0239)).toBe(25);
    const ramp = depthAt("M3", 23.838515, 38.023748);              // ~350 m on: climbing
    expect(ramp).toBeGreaterThan(0);
    expect(ramp).toBeLessThan(25);
    expect(depthAt("M3", 23.8413, 38.02294)).toBe(0);              // ~610 m on: on the ground
    expect(depthAt("M3", 23.86929, 38.005457)).toBe(0);            // Pallini
    expect(depthAt("M3", 23.9, 37.95)).toBe(0);                    // out towards the airport
  });
  it("keeps M1 on the surface but under the centre", () => {
    expect(depthAt("M1", 23.728, 37.984)).toBe(30);     // Omonia
    expect(depthAt("M1", 23.725616, 37.976085)).toBe(30);   // Monastiraki: deep all along its platform
    expect(depthAt("M1", 23.730278, 37.9937)).toBe(30);     // Victoria's north end
    expect(depthAt("M1", 23.722665, 37.999417)).toBe(0);    // Attiki: at the surface
    expect(depthAt("M1", 23.720702, 37.976717)).toBe(0);    // Thiseio
    expect(depthAt("M1", 23.646, 37.948)).toBe(0);      // Piraeus
    expect(depthAt("T6", 23.73, 37.97)).toBe(0);        // a tram: never
  });
  it("keeps the lines at their own levels where they meet: M3 lowest, M1 highest", () => {
    const at: [number, number] = [23.728, 37.984];   // Omonia (M1 and M2)
    expect(depthAt("M2", ...at) - depthAt("M1", ...at)).toBeGreaterThanOrEqual(14);
    expect(depthAt("M3", 23.735, 37.9755) - depthAt("M2", 23.735, 37.9755)).toBeGreaterThanOrEqual(14);   // Syntagma
  });
  it("knows the train by its line and where it goes", () => {
    expect(liveryOf("M1")).toBe("m1");
    expect(liveryOf("M3", "Αεροδρόμιο")).toBe("airport");
    expect(liveryOf("M3", "ΑΕΡΟΔΡΟΜΙΟ")).toBe("airport");
    expect(liveryOf("M3", "Δημοτικό Θέατρο")).toBe("m23");
    expect(liveryOf("M3", "Δημοτικό Θέατρο", 23.80)).toBe("m23");
    expect(liveryOf("M3", "Δημοτικό Θέατρο", 23.87)).toBe("airport");   // on the airport branch, on its way back
    expect(liveryOf("M2", "Ελληνικό")).toBe("m23");
  });
});

import { trackBehind } from "../src/lib/map/metroDepth";
describe("a metro train on its own track", () => {
  // A straight line east, 400 m.
  const k = 111320 * Math.cos((37.98 * Math.PI) / 180);
  const path: [number, number][] = [0, 100, 200, 300, 400].map(m => [23.7 + m / k, 37.98]);
  it("lays the train back along the rails, on the right of its way", () => {
    const east = trackBehind(path, [23.7 + 250 / k, 37.98], 90, 130)!;
    const front = east[east.length - 1], back = east[0];
    expect((front[0] - 23.7) * k).toBeCloseTo(250, 0);
    expect((back[0] - 23.7) * k).toBeCloseTo(120, 0);
    expect((front[1] - 37.98) * 110540).toBeCloseTo(-2.2, 1);     // running east: its right is south
    const west = trackBehind(path, [23.7 + 250 / k, 37.98], 270, 130)!;
    expect((west[0][0] - 23.7) * k).toBeCloseTo(380, 0);           // behind it is east
    expect((west[0][1] - 37.98) * 110540).toBeCloseTo(2.2, 1);     // running west: its right is north
  });
  it("is null off the line", () => {
    expect(trackBehind(path, [23.7, 38.1], 90)).toBeNull();
  });
});

import { straighten } from "../src/lib/map/metroDepth";
describe("a station, straight", () => {
  it("runs the path on a straight line through a station and leaves it alone farther off", () => {
    const k = 111320 * Math.cos((37.98 * Math.PI) / 180);
    // A bend: east 300 m with a 6 m bulge north at 150 m, a station there.
    const path: [number, number][] = [0, 75, 150, 225, 300].map(m => [23.7 + m / k, 37.98 + (m === 150 ? 6 / 110540 : 0)]);
    const out = straighten(path, [[23.7 + 150 / k, 37.98]], 120, 30);
    const north = (p: [number, number]) => (p[1] - 37.98) * 110540;
    const mid = out.reduce((a, p) => (Math.abs((p[0] - 23.7) * k - 150) < Math.abs((a[0] - 23.7) * k - 150) ? p : a));
    const edge = out.find(p => Math.abs((p[0] - 23.7) * k - 100) < 2)!;
    const far = out.find(p => Math.abs((p[0] - 23.7) * k - 10) < 2)!;
    expect(north(mid)).toBeLessThan(north(path[2]));             // pulled onto the chord
    expect(Math.abs(north(edge) - (north(mid) + 0))).toBeLessThan(1.6);   // straight along the platform
    expect(north(far)).toBeCloseTo(0, 3);                             // untouched far off
  });
});
