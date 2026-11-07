// Bad records inside a well-formed answer (a null vehicle, a train without its stops, an itinerary without
// legs, a day without its hours): dropped or refused before they reach the map, the planner or the stats.
import { afterEach, describe, expect, it, vi } from "vitest";
import { isLineLive } from "../src/lib/poller";
import { parsePlan } from "../src/lib/plan";
import { latestDay, validDay } from "../src/lib/stats";
import { loadTripIndex } from "../src/lib/trip";
import { validTrains } from "../src/lib/trains";

afterEach(() => vi.unstubAllGlobals());

const v = { id: "1", lat: 37.9, lon: 23.7, bearing: null, position_at: 1, route_code: "r" };

describe("live vehicles", () => {
  // The city layer drops such rows itself (cleanCity); a line answer has no such step.
  it("refuses a line answer with a vehicle that is not a record with a position", () => {
    for (const bad of [null, {}, { ...v, lat: "x" }]) {
      expect(isLineLive({ line: "040", updated_at: 1, next_update_at: 2, vehicles: [v, bad] })).toBe(false);
    }
    expect(isLineLive({ line: "040", updated_at: 1, next_update_at: 2, vehicles: [v] })).toBe(true);
  });
});

describe("trains", () => {
  const stop = { lat: 37.9, lon: 23.7, at: 1 };
  it("keeps only metro trains with both stops placed, and Proastiakos trains with a position", () => {
    const metro = { trip: "t", line: "M1", route_color: "#0a0", headsign: "h", from: stop, to: stop };
    expect(validTrains("metro", [metro, {}, null, { ...metro, to: { lat: 1 } }])).toEqual([metro]);
    const sub = { train: "1", lat: 38, lon: 23.6, position_at: 1 };
    expect(validTrains("suburban", [sub, {}, null, { ...sub, lon: null }])).toEqual([sub]);
  });
});

describe("trip planner", () => {
  it("drops itineraries without legs or times", () => {
    const leg = { kind: "walk", from: { lat: 37.9, lon: 23.7 }, to: { lat: 37.91, lon: 23.71 } };
    const good = { depart_at: 10, arrive_at: 20, duration_s: 10, transfers: 0, walk_m: 0, legs: [leg] };
    const r = parsePlan({ itineraries: [good, { ...good, legs: null }, { ...good, legs: [] }, null, { ...good, depart_at: "x" }], lines: {}, stops: {} });
    expect(r?.itineraries).toEqual([good]);
  });
  it("refuses a stop index that is not one (a {} would crash the stop layer and stay cached)", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    await expect(loadTripIndex()).rejects.toThrow();
  });
});

describe("stats", () => {
  it("refuses a latest day whose hours are not hour records", async () => {
    const day = { version: 1, date: "2026-11-05", tz: "Europe/Athens", first_fix: 1, last_fix: 2, fixes: 3, by_line: [],
      hours: Array.from({ length: 24 }, (_, h) => ({ h, fixes: 1, vehicles: 1, dist_m: 1, time_s: 1 })) };
    // The well-formed day passes; the same with null hours does not.
    expect(validDay(day, day.date)).toBe(true);
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ ...day, hours: Array(24).fill(null) }), { status: 200 }));
    await expect(latestDay(0)).rejects.toThrow();
  });
});
