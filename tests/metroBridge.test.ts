import { describe, expect, it, vi } from "vitest";
vi.mock("../src/lib/metro", () => ({ loadMetro: async () => ({ source: "", lines: [], stations: [
  { name: "ΣΥΝΤΑΓΜΑ", lat: 37.9755, lon: 23.7355, lines: ["M2", "M3"] },
  { name: "ΔΟΥΚ. ΠΛΑΚΕΝΤΙΑΣ", lat: 38.0242, lon: 23.8338, lines: ["M3"] },
  { name: "ΧΑΛΑΝΔΡΙ", lat: 38.0215, lon: 23.8213, lines: ["M3"] },
  { name: "ΠΕΙΡΑΙΑΣ", lat: 37.948, lon: 23.643, lines: ["M1"] }] }) }));
import { bridgeStations, join, withMetro } from "../src/lib/metroBridge";
import type { Itinerary, PlanResponse } from "../src/lib/plan";

const leg = (kind: "walk" | "ride", t: number, d: number, line?: string, mode?: string) =>
  ({ kind, from: { stop: null, lat: 0, lon: 0 }, to: { stop: null, lat: 0, lon: 0 }, depart_at: t, arrive_at: t + d, shape: [], line, mode });
const trip = (legs: ReturnType<typeof leg>[], transfers = 0): Itinerary =>
  ({ depart_at: legs[0].depart_at, arrive_at: legs.at(-1)!.arrive_at, duration_s: legs.at(-1)!.arrive_at - legs[0].depart_at, transfers, walk_m: 0, modes: [], legs });
const plan = (its: Itinerary[]): PlanResponse => ({ service_day: "", from: { lat: 0, lon: 0 }, to: { lat: 0, lon: 0 }, after: 0, last: false,
  itineraries: its, walk_only: null, lines: {}, stops: {}, sources: [] });
const home: [number, number] = [37.995, 23.845], syn: [number, number] = [37.9755, 23.7348];

describe("a metro option the server left out", () => {
  it("gets off near the end, on near the start", async () => {
    const { stations } = { stations: (await import("../src/lib/metro")).loadMetro };
    const p = bridgeStations((await stations()).stations, home, syn)!;
    expect(p.off.name).toBe("ΣΥΝΤΑΓΜΑ");
    expect(p.on.map(s => s.name)).toContain("ΔΟΥΚ. ΠΛΑΚΕΝΤΙΑΣ");
  });
  it("joins two parts, the change counted", () => {
    const j = join(trip([leg("ride", 0, 600, "oasa:308", "bus")]), trip([leg("ride", 720, 900, "stasy:M3", "metro")]));
    expect([j.transfers, j.depart_at, j.arrive_at, j.legs.length]).toEqual([1, 0, 1620, 2]);
  });
  it("adds it when it arrives close to the best, not when the plan already rides the metro", async () => {
    const bus = plan([trip([leg("ride", 0, 3000, "oasa:Χ95", "bus")])]);
    const ask = vi.fn(async (_f: [number, number], _t: [number, number], after?: number) =>
      after == null ? plan([trip([leg("ride", 0, 700, "oasa:308", "bus")])]) : plan([trip([leg("ride", after, 1500, "stasy:M3", "metro")])]));
    const out = await withMetro(bus, home, syn, undefined, 0, ask);
    expect(out.itineraries).toHaveLength(2);
    expect(out.itineraries.some(x => x.legs.some(l => l.line === "stasy:M3"))).toBe(true);
    const again = await withMetro(out, home, syn, undefined, 0, ask);
    expect(again).toBe(out);
  });
});
