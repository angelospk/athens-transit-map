import { describe, expect, it } from "vitest";
import { along, distSaid, guideFromTrip, metres, parseFoot, ridePassed, stepArrow, stepText, walkNow, type GuideRide } from "../src/lib/guide";
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
