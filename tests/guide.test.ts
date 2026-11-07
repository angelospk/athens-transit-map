import { describe, expect, it } from "vitest";
import { along, distSaid, guideFromPlan, guideFromTrip, isMetro, metres, parseFoot, railSeq, ridePassed, stepArrow, stepText, walkNow, type GuideRide } from "../src/lib/guide";
import type { Itinerary, PlanResponse } from "../src/lib/plan";
import type { V2Run, V2Stop } from "../src/lib/v2";
import type { TripIndex } from "../src/lib/trip";

// Four stops 200 m apart on a line north (about 0.0018° of latitude each).
const ix: TripIndex = {
  v: "t",
  s: [["ΑΛΦΑ", 37.97, 23.73, "1"], ["ΒΗΤΑ", 37.9718, 23.73, "2"], ["ΓΑΜΜΑ", 37.9736, 23.73, "3"], ["ΔΕΛΤΑ(ΠΡΟΣΩΡΙΝΗ)", 37.9754, 23.73, "4"]],
  l: { "040": { v1: [0, 1, 2, 3] } },
};

describe("guideFromTrip", () => {
  it("walks to the stop, rides, walks to the end", () => {
    const g = guideFromTrip(ix, "040", { id: "v1", i: 1, j: 3, from: 1, to: 3, walk: 0, stops: 2, ride: 0, min: 5 }, [37.9718, 23.728], [37.9754, 23.7325], "Σπίτι");
    expect(g.legs.map(l => l.kind)).toEqual(["walk", "ride", "walk"]);
    const r = g.legs[1] as GuideRide;
    expect(r.board.name).toBe("Βητα");
    expect(r.alight.id).toBe("4");
    expect(r.seq.map(s => s.id)).toEqual(["2", "3", "4"]);
    expect(r.before.map(s => s.id)).toEqual(["1"]);
    expect(r.headsign).toBe("Δελτα");   // the note in brackets left out
  });
  it("leaves out a walk of under 20 m", () => {
    const g = guideFromTrip(ix, "040", { id: "v1", i: 0, j: 2, from: 0, to: 2, walk: 0, stops: 2, ride: 0, min: 5 }, [37.97, 23.73], [37.9736, 23.73], "Εκεί");
    expect(g.legs.map(l => l.kind)).toEqual(["ride"]);
  });
});

describe("ridePassed", () => {
  const g = guideFromTrip(ix, "040", { id: "v1", i: 0, j: 3, from: 0, to: 3, walk: 0, stops: 3, ride: 0, min: 5 }, [37.97, 23.73], [37.9754, 23.73], "Εκεί");
  const r = g.legs.find(l => l.kind === "ride") as GuideRide;
  it("counts the stops behind the user", () => {
    expect(ridePassed(r, [37.9701, 23.73])).toBe(0);
    expect(ridePassed(r, [37.9727, 23.73])).toBe(1);
    expect(ridePassed(r, [37.9735, 23.73])).toBe(2);   // 15 m before a stop counts it
  });
});

describe("walking route", () => {
  const body = {
    routes: [{
      distance: 300, duration: 230,
      geometry: { coordinates: [[23.73, 37.97], [23.73, 37.9718], [23.7323, 37.9718]] },
      legs: [{ steps: [
        { maneuver: { location: [23.73, 37.97], type: "depart" }, name: "Ερμού", distance: 200 },
        { maneuver: { location: [23.73, 37.9718], type: "turn", modifier: "right" }, name: "Μητροπόλεως", distance: 100 },
        { maneuver: { location: [23.7323, 37.9718], type: "arrive" }, name: "", distance: 0 },
      ] }],
    }],
  };
  const route = parseFoot(body)!;
  it("reads the OSRM answer", () => {
    expect(route.steps.map(s => s.s)).toEqual([0, 200, 300]);
    expect(route.line[0]).toEqual([37.97, 23.73]);
  });
  it("says the steps in Greek", () => {
    expect(stepText(route.steps[0], "στάση Σύνταγμα")).toBe("Ξεκίνα στην Ερμού");
    expect(stepText(route.steps[1], "στάση Σύνταγμα")).toBe("Στρίψε δεξιά στην Μητροπόλεως");
    expect(stepText(route.steps[2], "στάση Σύνταγμα")).toBe("Φτάνεις στη στάση Σύνταγμα");
    expect(stepArrow(route.steps[1])).toBe("right");
  });
  it("finds the next step and the metres to it", () => {
    const w = walkNow(route, [37.9709, 23.73]);
    expect(w.next?.type).toBe("turn");
    expect(w.toNext).toBeGreaterThan(90);
    expect(w.toNext).toBeLessThan(110);
    expect(w.then?.type).toBe("arrive");
    expect(w.off).toBeLessThan(2);
  });
});

describe("helpers", () => {
  it("measures and says distances", () => {
    expect(Math.round(metres([37.97, 23.73], [37.9718, 23.73]))).toBe(200);
    expect(distSaid(123)).toBe("120 μ.");
    expect(distSaid(42)).toBe("40 μ.");
    expect(distSaid(1260)).toBe("1,3 χλμ.");
  });
  it("places a point along a line", () => {
    const a = along([[37.97, 23.73], [37.9718, 23.73]], [37.9709, 23.7301]);
    expect(Math.abs(a.s - 100)).toBeLessThan(2);
    expect(a.off).toBeLessThan(10);
  });
});

describe("a timed plan with a metro change", () => {
  const T = 1_794_000_000;
  const pt = (lat: number, lon: number, stop?: string) => ({ lat, lon, ...(stop ? { stop } : {}) });
  const it_ = {
    depart_at: T, arrive_at: T + 1500, duration_s: 1500, transfers: 1, walk_m: 0, modes: ["metro"],
    legs: [
      { kind: "ride" as const, from: pt(37.9409, 23.7413, "stasy:AD"), to: pt(37.9755, 23.7353, "stasy:SY2"), depart_at: T, arrive_at: T + 600, shape: [], line: "stasy:M2", mode: "metro", headsign: "ΑΝΘΟΥΠΟΛΗ", run: "r2" },
      { kind: "ride" as const, from: pt(37.9755, 23.7353, "stasy:SY3"), to: pt(38.0047, 23.7946, "stasy:XO"), depart_at: T + 840, arrive_at: T + 1500, shape: [], line: "stasy:M3", mode: "metro", headsign: "ΔΟΥΚΙΣΣΗΣ ΠΛΑΚΕΝΤΙΑΣ", run: "r3" },
    ],
  };
  const r = { from: pt(37.9409, 23.7413), to: pt(38.0047, 23.7946), itineraries: [it_], lines: { "stasy:M2": { label: "M2", mode: "metro" }, "stasy:M3": { label: "M3", mode: "metro" } },
    stops: { "stasy:SY2": { name: "ΣΥΝΤΑΓΜΑ" }, "stasy:SY3": { name: "ΣΥΝΤΑΓΜΑ" }, "stasy:AD": { name: "ΑΓ. ΔΗΜΗΤΡΙΟΣ" }, "stasy:XO": { name: "ΧΟΛΑΡΓΟΣ" } } } as unknown as PlanResponse;
  const g = guideFromPlan(it_ as unknown as Itinerary, r, null, "Χολαργός");
  it("keeps each ride's times and run, and the change before the second", () => {
    const rides = g.legs.filter((l): l is GuideRide => l.kind === "ride");
    expect(rides.map(x => [x.dep, x.arr, x.run])).toEqual([[T, T + 600, "r2"], [T + 840, T + 1500, "r3"]]);
    expect(g.changes?.[0]).toBeNull();
    expect(g.changes?.[1]).toMatchObject({ kind: "change", stop: "ΣΥΝΤΑΓΜΑ", label: "M3", prev: { label: "M2" } });
    expect(isMetro(rides[0].line)).toBe(true);
  });
  it("takes a train's stations and times from its run, board to alight", () => {
    const run = { id: "r2", line: "stasy:M2", headsign: "", pattern: null, vehicle: null, vehicle_label: null, status: "", stops: [
      { stop: "stasy:X", at: T - 120 }, { stop: "stasy:AD", at: T }, { stop: "stasy:MID", at: T + 300 }, { stop: "stasy:SY2", at: T + 600 }, { stop: "stasy:Z", at: T + 700 },
    ] } as unknown as V2Run;
    const stops = { "stasy:AD": { name: "ΑΓ. ΔΗΜΗΤΡΙΟΣ", lat: 1, lon: 2 }, "stasy:MID": { name: "ΔΑΦΝΗ", lat: 3, lon: 4 }, "stasy:SY2": { name: "ΣΥΝΤΑΓΜΑ", lat: 5, lon: 6 } } as unknown as Record<string, V2Stop>;
    const seq = railSeq(run, stops, "AD", "SY2");
    expect(seq?.map(s => [s.id, s.name, s.t])).toEqual([["AD", "Αγ. Δημητριος", T], ["MID", "Δαφνη", T + 300], ["SY2", "Συνταγμα", T + 600]]);
    expect(railSeq(run, stops, "SY2", "AD")).toBeNull();
  });
});
