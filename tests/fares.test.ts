import { describe, expect, it } from "vitest";
import { tripFare, bestBuy, euro } from "../src/lib/fares";
import type { Itinerary, PlanLeg, PlanResponse } from "../src/lib/plan";

const pt = (stop: string | null) => ({ stop, lat: 0, lon: 0 });
const ride = (line: string, from: string, to: string, at: number, mode = "bus"): PlanLeg =>
  ({ kind: "ride", line, mode, from: pt(from), to: pt(to), depart_at: at, arrive_at: at + 600, shape: [] });
const walk = (at: number): PlanLeg => ({ kind: "walk", from: pt(null), to: pt(null), depart_at: at, arrive_at: at + 120, shape: [], distance_m: 150 });
const trip = (legs: PlanLeg[]): Itinerary => ({ depart_at: 0, arrive_at: 9999, duration_s: 9999, transfers: 0, walk_m: 0, modes: [], legs });
const r = {
  lines: { "oasa:X95": { label: "X95" }, "oasa:040": { label: "040" }, "rail:M3": { label: "Μ3" }, "oasa:X80": { label: "X80" } },
  stops: { a: { name: "Σύνταγμα" }, b: { name: "Αεροδρόμιο" }, c: { name: "Παλλήνη" }, d: { name: "Πειραιάς" } },
} as unknown as PlanResponse;

describe("tripFare", () => {
  it("one 90′ ticket for rides and changes in the city", () => {
    const f = tripFare(trip([walk(0), ride("oasa:040", "a", "d", 100), ride("rail:M3", "d", "a", 1000, "metro")]), r)!;
    expect(f.lines.map(l => [l.name, l.n])).toEqual([["Εισιτήριο 90′", 1]]);
    expect(f.total).toEqual([1.2, 0.5]);
  });
  it("the metro airport ticket, and the near stations' price", () => {
    expect(tripFare(trip([ride("rail:M3", "a", "b", 0, "metro")]), r)!.total).toEqual([9, 4.5]);
    expect(tripFare(trip([ride("rail:M3", "c", "b", 0, "metro")]), r)!.total).toEqual([5.5, 2.7]);
  });
  it("an Express ride is its own ticket", () => {
    const f = tripFare(trip([ride("oasa:040", "d", "a", 0), ride("oasa:X95", "a", "b", 900)]), r)!;
    expect(f.total).toEqual([6.7, 3.2]);
  });
  it("nothing for a walk; X80 flagged", () => {
    expect(tripFare(trip([walk(0)]), r)).toBeNull();
    expect(tripFare(trip([ride("oasa:X80", "a", "d", 0)]), r)!.x80).toBe(true);
  });
});

describe("bestBuy", () => {
  it("marks the cheapest way", () => {
    expect(bestBuy(2, 22, false).find(o => o.best)!.key).toBe("month");
    expect(bestBuy(1, 5, false).find(o => o.best)!.key).toBe("single");
  });
  it("formats euros the Greek way", () => { expect(euro(1.2)).toBe("1,20 €"); expect(euro(27)).toBe("27 €"); });
});
