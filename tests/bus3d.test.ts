import { describe, expect, it } from "vitest";
import { along, busRoute, lateness, minsTo, nextStopByPath, nextStopByShape } from "../src/lib/bus3d";
import type { LineStatic } from "../src/lib/types";

// A line east along a street: five stops 200 m apart, the shape through them.
const lat = 37.98, lon0 = 23.73, dLon = 200 / (111_320 * Math.cos((lat * Math.PI) / 180));
const ids = ["a", "b", "c", "d", "e"];
const stops = Object.fromEntries(ids.map((id, k) => [id, { name: `ΣΤΑΣΗ ${id.toUpperCase()}`, lat, lon: lon0 + k * dLon }]));
const st = {
  id: "999",
  variants: { v1: { headsign: "ΑΚΑΔΗΜΙΑ", direction: 0, shape: ids.map((_, k) => [lat, lon0 + k * dLon] as [number, number]), stops: ids } },
  stops,
} as unknown as LineStatic;

describe("bus3d", () => {
  it("walks a line to a distance", () => {
    const p = along([[lat, lon0], [lat, lon0 + dLon]], 100)!;
    expect(p[1]).toBeCloseTo(lon0 + dLon / 2, 6);
    expect(along([[lat, lon0], [lat, lon0 + dLon]], 999)).toEqual([lat, lon0 + dLon]);
  });
  it("finds a city bus's next stop from the road ahead of it", () => {
    // 50 m past A, the road ahead to the end; its first stop 150 m on: B.
    const path = [[lat, lon0 + dLon / 4], [lat, lon0 + 4 * dLon]] as [number, number][];
    expect(nextStopByPath({ path, path_stops: [150, 350] }, ids, stops)).toBe("b");
    expect(nextStopByPath({ path: null, path_stops: null }, ids, stops)).toBeNull();
  });
  it("finds it from where it is on the shape when the road ahead is not sent", () => {
    expect(nextStopByShape({ lat, lon: lon0 + 1.5 * dLon, bearing: 90 }, st.variants.v1, stops)).toBe("c");
    expect(nextStopByShape({ lat: 38.2, lon: 23.9, bearing: null }, st.variants.v1, stops)).toBeNull();   // nowhere near
  });
  it("gives the route from here: the stop passed, every stop ahead with its time", () => {
    const now = 1_000_000;
    const v = { line: "999", id: "1", lat, lon: lon0 + 1.5 * dLon, bearing: 90, position_at: now, variant: "v1", delay_s: 420, speed: 5, path: null };
    const r = busRoute("999", "1", v, st)!;
    expect(r.passed).toBe("Σταση B");
    expect(r.ahead.map(a => a.id)).toEqual(["c", "d", "e"]);
    expect(r.ahead[0].at).toBeGreaterThan(now);
    expect(r.ahead[2].at).toBeGreaterThan(r.ahead[1].at);
    expect(r.head).toMatch(/^Ακαδημ/);
    expect(r.from).toBe("Σταση A");
    expect(r.cls).toBe("late2");
    expect(busRoute("999", "1", v, undefined)).toBeNull();
  });
  it("says how late, and the minutes, as the labels do", () => {
    expect(lateness(null).tone).toBe("none");
    expect(lateness(60)).toMatchObject({ text: "στην ώρα", tone: "ok" });
    expect(lateness(-300)).toMatchObject({ short: "5′ νωρίς", tone: "ok" });
    expect(lateness(360)).toMatchObject({ text: "+6′ καθυστέρηση", short: "+6′", tone: "late" });
    expect(lateness(900).tone).toBe("bad");
    expect(minsTo(100, 80)).toBe("τώρα");
    expect(minsTo(200, 80)).toBe("2′");
  });
});
