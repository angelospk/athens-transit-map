import { describe, expect, it } from "vitest";
import fixture from "./fixtures/v2/plan.json";
import { parsePlan, planFC, planStops, planSummary, planUrl, type Itinerary, type PlanResponse } from "../src/lib/plan";

const plan = fixture as unknown as PlanResponse;

// Σύνταγμα → M2 → Ελληνικό, walk 95 m, bus 122 → Σαρωνίδα stop, walk to the end (CONTRACT §9 example).
const twoRides: PlanResponse = {
  ...plan,
  itineraries: [{
    depart_at: 1791185350, arrive_at: 1791188000, duration_s: 2650, transfers: 1, walk_m: 610, modes: ["metro", "bus"],
    legs: [
      { kind: "walk", from: { stop: null, lat: 37.97527, lon: 23.73552 }, to: { stop: "stasy:syn", lat: 37.97527, lon: 23.73552 },
        depart_at: 1791185350, arrive_at: 1791185350, distance_m: 0, shape: [[37.97527, 23.73552], [37.97527, 23.73552]] },
      { kind: "ride", line: "stasy:M2", mode: "metro", headsign: "Ελληνικό", run: "stasy:run:1:2026-10-05",
        from: { stop: "stasy:syn", lat: 37.97527, lon: 23.73552 }, to: { stop: "stasy:ell", lat: 37.8926, lon: 23.7471 },
        depart_at: 1791185400, arrive_at: 1791186400, hops: 10, source: "timetable",
        shape: [[37.97527, 23.73552], [37.9681, 23.729], [37.8926, 23.7471]] },
      { kind: "walk", from: { stop: "stasy:ell", lat: 37.8926, lon: 23.7471 }, to: { stop: "oasa:330032", lat: 37.8921, lon: 23.748 },
        depart_at: 1791186400, arrive_at: 1791186600, distance_m: 95, shape: [[37.8926, 23.7471], [37.8921, 23.748]] },
      { kind: "ride", line: "oasa:122", mode: "bus", headsign: "Σαρωνίδα", run: "oasa:run:x:2026-10-05",
        from: { stop: "oasa:330032", lat: 37.8921, lon: 23.748 }, to: { stop: "oasa:330140", lat: 37.8752, lon: 23.7531 },
        depart_at: 1791186700, arrive_at: 1791187600, hops: 9, source: "timetable",
        shape: [[37.8921, 23.748], [37.884, 23.7502], [37.8752, 23.7531]] },
      { kind: "walk", from: { stop: "oasa:330140", lat: 37.8752, lon: 23.7531 }, to: { stop: null, lat: 37.8739, lon: 23.754 },
        depart_at: 1791187600, arrive_at: 1791188000, distance_m: 515, shape: [[37.8752, 23.7531], [37.8739, 23.754]] },
    ],
  }] as Itinerary[],
  lines: {
    "stasy:M2": { id: "stasy:M2", mode: "metro", label: "M2", name: "Ανθούπολη - Ελληνικό", name_en: null, color: "#e30613", text_color: "#ffffff", source: "stasy" },
    // No label: the id after the source prefix stands in.
    "oasa:122": { id: "oasa:122", mode: "bus", label: null, name: "Σαρωνίδα", name_en: null, color: "#153ce0", text_color: "#ffffff", source: "oasa" },
  },
  stops: {
    "stasy:syn": { id: "stasy:syn", name: "Σύνταγμα", name_en: null, lat: 37.97527, lon: 23.73552, modes: ["metro"], lines: [], source: "stasy" },
    "stasy:ell": { id: "stasy:ell", name: "Ελληνικό", name_en: null, lat: 37.8926, lon: 23.7471, modes: ["metro"], lines: [], source: "stasy" },
    "oasa:330032": { id: "oasa:330032", name: "Ελληνικό (λεωφ.)", name_en: null, lat: 37.8921, lon: 23.748, modes: ["bus"], lines: [], source: "oasa" },
    "oasa:330140": { id: "oasa:330140", name: "Πλατεία", name_en: null, lat: 37.8752, lon: 23.7531, modes: ["bus"], lines: [], source: "oasa" },
  },
};

describe("planUrl", () => {
  it("rounds the points to 4 decimals and asks for 3 options", () => {
    expect(planUrl("https://x.dev", [37.975512, 23.734849], [38.07419, 23.81051]))
      .toBe("https://x.dev/v2/plan?from=37.9755,23.7348&to=38.0742,23.8105&n=3");
  });
  it("drops trailing zeros", () => {
    expect(planUrl("https://x.dev", [38.00001, 23.7], [37.9, 23.80004]))
      .toBe("https://x.dev/v2/plan?from=38,23.7&to=37.9,23.8&n=3");
  });
  it("rounds `after` down to the minute when given", () => {
    expect(planUrl("https://x.dev", [38, 23.7], [37.9, 23.8], 1791185399))
      .toBe("https://x.dev/v2/plan?from=38,23.7&to=37.9,23.8&n=3&after=1791185340");
  });
});

describe("parsePlan", () => {
  it("accepts a plan body", () => {
    expect(parsePlan(fixture)?.itineraries).toHaveLength(2);
  });
  it("rejects bodies without an itineraries array or lines/stops maps", () => {
    expect(parsePlan(null)).toBeNull();
    expect(parsePlan({ error: "busy" })).toBeNull();
    expect(parsePlan({ ...plan, itineraries: "x" })).toBeNull();
    expect(parsePlan({ ...plan, lines: undefined })).toBeNull();
    expect(parsePlan({ ...plan, stops: null })).toBeNull();
  });
});

describe("planSummary", () => {
  it("gives Athens clock times, whole minutes and the rides", () => {
    const s = planSummary(plan.itineraries[0], plan, 1791185350 - 5 * 60 - 30);
    expect(s).toEqual({
      depart: "10:29", arrive: "10:47", mins: 18, leaveIn: 5, transfers: 0, walk_m: 203,
      rides: [{ line: "oasa:L", label: "L", color: "#153ce0", text: "#ffffff", mode: "bus", headsign: "EAST", from: "STOP 0", to: "STOP 3" }],
    });
  });
  it("never says to leave in less than 0 minutes", () => {
    expect(planSummary(plan.itineraries[0], plan, 1791185350 + 120).leaveIn).toBe(0);
  });
  it("labels a line without a label by its id after the source prefix", () => {
    const s = planSummary(twoRides.itineraries[0], twoRides, 1791185000);
    expect(s.rides.map(r => r.label)).toEqual(["M2", "122"]);
    expect(s.rides[1]).toMatchObject({ from: "Ελληνικό (λεωφ.)", to: "Πλατεία", headsign: "Σαρωνίδα", mode: "bus" });
    expect(s.transfers).toBe(1);
  });
  it("treats an empty label or colour as missing", () => {
    const blank = { ...twoRides, lines: { "stasy:M2": { ...twoRides.lines["stasy:M2"], label: "", color: "", text_color: "" } } };
    expect(planSummary(twoRides.itineraries[0], blank, 0).rides[0]).toMatchObject({ label: "M2", color: "#3b5bdb", text: "#ffffff" });
    expect(planFC(twoRides.itineraries[0], blank).features[0].properties!.color).toBe("#3b5bdb");
  });
  it("falls back to the stop id and a default colour when the maps lack them", () => {
    const bare = { ...twoRides, lines: {}, stops: {} };
    const r = planSummary(twoRides.itineraries[0], bare, 1791185000).rides[0];
    expect(r).toMatchObject({ label: "M2", color: "#3b5bdb", text: "#ffffff", from: "stasy:syn", to: "stasy:ell" });
  });
});

describe("planFC", () => {
  it("draws rides in the line colour and walks as walks, in [lon, lat]", () => {
    const fc = planFC(twoRides.itineraries[0], twoRides);
    expect(fc.type).toBe("FeatureCollection");
    // The 0 m walk at the start is left out.
    expect(fc.features.map(f => [f.properties!.kind, f.properties!.color])).toEqual([
      ["ride", "#e30613"], ["walk", null], ["ride", "#153ce0"], ["walk", null],
    ]);
    expect(fc.features[0].geometry).toEqual({ type: "LineString", coordinates: [[23.73552, 37.97527], [23.729, 37.9681], [23.7471, 37.8926]] });
  });
});

describe("planStops", () => {
  it("names where to get on, change and get off, without repeating a stop", () => {
    expect(planStops(twoRides.itineraries[0], twoRides)).toEqual([
      { at: [37.97527, 23.73552], name: "Σύνταγμα" },
      { at: [37.8926, 23.7471], name: "Ελληνικό" },
      { at: [37.8921, 23.748], name: "Ελληνικό (λεωφ.)" },
      { at: [37.8752, 23.7531], name: "Πλατεία" },
    ]);
    // One ride: on and off.
    expect(planStops(plan.itineraries[0], plan).map(s => s.name)).toEqual(["STOP 0", "STOP 3"]);
  });
  it("keeps one pin when a change is at the same stop", () => {
    const it0 = twoRides.itineraries[0];
    const same: Itinerary = { ...it0, legs: it0.legs.map((l, k) => k === 3 ? { ...l, from: it0.legs[1].to } : k === 2 ? { ...l, to: it0.legs[1].to, distance_m: 0 } : l) };
    expect(planStops(same, twoRides).map(s => s.name)).toEqual(["Σύνταγμα", "Ελληνικό", "Πλατεία"]);
  });
});
