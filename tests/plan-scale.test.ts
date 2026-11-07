import { describe, expect, it } from "vitest";
import { changeWay, METRO_GATE_MIN, planSteps, scaledLegs, tightestChange, type Itinerary, type PlanLeg, type PlanResponse } from "../src/lib/plan";

const pt = { stop: null, lat: 0, lon: 0 };
const walk = (a: number, b: number): PlanLeg => ({ kind: "walk", from: pt, to: pt, depart_at: a, arrive_at: b, shape: [] });
const ride = (line: string, a: number, b: number, hops = 3): PlanLeg => ({ kind: "ride", from: pt, to: pt, depart_at: a, arrive_at: b, shape: [], line, hops });
const itin = (legs: PlanLeg[], walk_m = 300): Itinerary => ({
  depart_at: legs[0].depart_at, arrive_at: legs[legs.length - 1].arrive_at, duration_s: legs[legs.length - 1].arrive_at - legs[0].depart_at,
  transfers: Math.max(0, legs.filter(l => l.kind === "ride").length - 1), walk_m, modes: [], legs,
});
const r = { lines: { "oasa:224": { id: "oasa:224", label: "224", color: "#2f6fdc", text_color: "#fff" } } } as unknown as PlanResponse;

describe("scaledLegs", () => {
  it("lists walks and rides with their minutes, dropping walks under a minute", () => {
    const legs = scaledLegs(itin([walk(0, 180), ride("oasa:224", 240, 780), walk(780, 800)]), r);
    expect(legs).toEqual([
      { walk: true, min: 3, label: "3′", color: "", text: "", hops: null, mode: "" },
      { walk: false, min: 9, label: "224", color: "#2f6fdc", text: "#fff", hops: 3, mode: "bus" },
    ]);
  });
});

describe("tightestChange", () => {
  const direct = itin([walk(0, 180), ride("oasa:224", 240, 1200)], 400);
  const change = itin([walk(0, 60), ride("oasa:224", 60, 600), walk(600, 660), ride("oasa:M3", 700, 1000)], 200);
  it("finds the minutes to spare at a change, after the walk", () => {
    expect(tightestChange(direct)).toBeNull();
    expect(tightestChange(change)).toBeCloseTo(40 / 60);
  });
});

describe("planSteps", () => {
  const at = (stop: string, lat = 37.98, lon = 23.73) => ({ stop, lat, lon });
  const rr = { lines: { "oasa:040": { label: "040", color: "#153ce0", text_color: "#fff" }, "stasy:M2": { label: "M2", color: "#e30613", text_color: "#fff" } },
    stops: { a: { name: "Πειραιάς" }, b: { name: "Φιξ" }, c: { name: "Φιξ μετρό" }, d: { name: "Ελληνικό" } } } as unknown as PlanResponse;
  const leg = (kind: "walk" | "ride", from: string, to: string, a: number, b: number, line?: string): PlanLeg =>
    ({ kind, from: at(from), to: at(to, 37.981), depart_at: a, arrive_at: b, shape: [], ...(line && { line, headsign: "ΕΛΛΗΝΙΚΟ", hops: 7 }) });
  const trip = itin([leg("ride", "a", "b", 0, 1620, "oasa:040"), { ...leg("walk", "b", "c", 1620, 1740), distance_m: 150 }, leg("ride", "c", "d", 1920, 2820, "stasy:M2")]);
  const later = itin([leg("ride", "a", "b", 300, 1900, "oasa:040"), leg("walk", "b", "c", 1900, 2020), leg("ride", "c", "d", 2280, 3180, "stasy:M2")]);
  it("tells the change as its own step: the walk, the minutes to spare, and the next one if missed", () => {
    const s = planSteps(trip, rr, [trip, later]);
    expect(s.map(x => x.kind)).toEqual(["ride", "change", "ride", "end"]);
    expect(s[1]).toMatchObject({ kind: "change", stop: "Φιξ", m: 150, min: 2, spare: 3, label: "M2", missed: { in_min: 6, arrive_at: 3180 } });
  });
  it("counts the metro station's minutes in a change to or from the metro", () => {
    const metro = { ...rr, lines: { ...rr.lines, "stasy:M2": { label: "M2", color: "#e30613", text_color: "#fff", mode: "metro" } } } as unknown as PlanResponse;
    const s = planSteps(trip, metro);
    expect(s[1]).toMatchObject({ kind: "change", m: 150, min: 2 + METRO_GATE_MIN, gate: METRO_GATE_MIN, spare: 3 - METRO_GATE_MIN });
    expect(tightestChange(trip, metro)).toBeCloseTo(3 - METRO_GATE_MIN);
    expect(tightestChange(trip, rr)).toBeCloseTo(3);
    expect(planSteps(trip, rr)[1]).toMatchObject({ gate: 0, min: 2 });
  });
  it("says how a change is made: metres and minutes, or the same stop", () => {
    expect(changeWay({ m: 148, min: 2, gate: 0 })).toBe("150 μ · 2′");
    expect(changeWay({ m: 1260, min: 15, gate: 0 })).toBe("1,3 χλμ · 15′");
    expect(changeWay({ m: 0, min: 0, gate: 0 })).toBe("Ίδια στάση");
    expect(changeWay({ m: 0, min: 3, gate: 3 })).toBe("Ίδιος σταθμός · 3′");
    expect(changeWay({ m: 20, min: 5, gate: 3 })).toBe("20 μ + σταθμός · 5′");
  });
  it("numbers each ride with its leg", () => {
    expect(planSteps(trip, rr).filter(x => x.kind === "ride").map(x => (x as { leg: number }).leg)).toEqual([0, 2]);
  });
});
