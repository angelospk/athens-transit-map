import { describe, expect, it } from "vitest";
import {
  dirLabels, dirOf, freshness, headsignName, lineVehicleRows, nextStops, stopRows, vehicleDir,
  type V2Arrival, type V2Pattern, type V2Run, type V2Stop, type V2Vehicle,
} from "../src/lib/v2";

const pat = (id: string, direction: 0 | 1, headsign: string, n = 10): V2Pattern =>
  ({ id, direction, headsign, stops: Array.from({ length: n }, (_, i) => `s${i}`), shape: [] });
const stopOf = (id: string, name: string): V2Stop =>
  ({ id, name, name_en: null, lat: 0, lon: 0, modes: ["metro"], lines: [], source: "stasy" });
const arr = (line: string, headsign: string, at: number, extra: Partial<V2Arrival> = {}): V2Arrival => ({
  line, stop: "x", headsign, at, scheduled_at: at, delay_s: null, source: "timetable", run: `${line}:run:${at}`,
  vehicle: null, vehicle_label: null, platform: null, status: "scheduled", ...extra,
});

// M3 at Σύνταγμα: two headsigns towards the airport, one the other way.
const m3 = [pat("M3-0", 0, "ΔΗΜΟΤΙΚΟ ΘΕΑΤΡΟ", 23), pat("M3-2", 0, "ΔΗΜΟΤΙΚΟ ΘΕΑΤΡΟ", 28), pat("M3-3", 0, "ΕΛ. ΒΕΝΙΖΕΛΟΣ", 28),
  pat("M3-1", 1, "Δ. ΠΛΑΚΕΝΤΙΑΣ", 23)];
const m3stops = { a: stopOf("a", "Δημοτικό Θέατρο"), b: stopOf("b", "Ελ. Βενιζέλος") };

describe("headsignName", () => {
  it("gives an all-caps headsign the case of the stop it names", () => {
    expect(headsignName("ΔΗΜΟΤΙΚΟ ΘΕΑΤΡΟ", m3stops)).toBe("Δημοτικό Θέατρο");
    expect(headsignName("ΕΛΛΗΝΙΚΟ", [stopOf("e", "Ελληνικό")])).toBe("Ελληνικό");
  });
  it("leaves a headsign in mixed case, or one that names no stop", () => {
    expect(headsignName("Πικροδάφνη", m3stops)).toBe("Πικροδάφνη");
    expect(headsignName("Δ. ΠΛΑΚΕΝΤΙΑΣ", m3stops)).toBe("Δ. ΠΛΑΚΕΝΤΙΑΣ");
    expect(headsignName("ΣΥΝΤΑΓΜΑ")).toBe("ΣΥΝΤΑΓΜΑ");
  });
});

describe("directions", () => {
  it("finds a headsign's direction from the line's patterns, ignoring case and accents", () => {
    expect(dirOf(m3, "Ελ. Βενιζέλος")).toBe(0);
    expect(dirOf(m3, "Δ. ΠΛΑΚΕΝΤΙΑΣ")).toBe(1);
    expect(dirOf(m3, "Πουθενά")).toBeNull();
  });
  it("takes the Vehicle's own direction first, else its headsign's", () => {
    const v = { headsign: "Δ. ΠΛΑΚΕΝΤΙΑΣ" } as V2Vehicle;
    expect(vehicleDir(v, m3)).toBe(1);
    expect(vehicleDir({ ...v, direction: 0 }, m3)).toBe(0);
    expect(vehicleDir({ ...v, direction: null }, m3)).toBe(1);
  });
  it("labels each direction with its most common headsign", () => {
    expect(dirLabels(m3, m3stops)).toEqual(["Δημοτικό Θέατρο", "Δ. ΠΛΑΚΕΝΤΙΑΣ"]);
    expect(dirLabels([pat("p", 1, "Α")])).toEqual([null, "Α"]);
  });
});

describe("stopRows", () => {
  const now = 1000;
  it("puts both M3 headsigns of one direction in one row, under the next train's headsign", () => {
    const rows = stopRows([
      arr("stasy:M3", "ΕΛ. ΒΕΝΙΖΕΛΟΣ", 1300),
      arr("stasy:M3", "ΔΗΜΟΤΙΚΟ ΘΕΑΤΡΟ", 1100),
      arr("stasy:M3", "Δ. ΠΛΑΚΕΝΤΙΑΣ", 1200),
      arr("stasy:M3", "ΔΗΜΟΤΙΚΟ ΘΕΑΤΡΟ", 1500),
      arr("stasy:M3", "ΕΛ. ΒΕΝΙΖΕΛΟΣ", 1700),
    ], now, { "stasy:M3": m3 }, m3stops);
    expect(rows.map(r => [r.line, r.dir, r.headsign, r.times.map(t => t.at)])).toEqual([
      ["stasy:M3", 0, "Δημοτικό Θέατρο", [1100, 1300, 1500]],
      ["stasy:M3", 1, "Δ. ΠΛΑΚΕΝΤΙΑΣ", [1200]],
    ]);
  });
  it("keys by headsign when the line's patterns are unknown, and drops times long gone", () => {
    const rows = stopRows([arr("oasa:040", "ΣΥΝΤΑΓΜΑ", 900), arr("oasa:040", "ΣΥΝΤΑΓΜΑ", 1060), arr("oasa:040", "ΠΕΙΡΑΙΑΣ", 1030)], now);
    expect(rows.map(r => [r.dir, r.headsign, r.times.length])).toEqual([[null, "ΠΕΙΡΑΙΑΣ", 1], [null, "ΣΥΝΤΑΓΜΑ", 1]]);
  });
  it("names the first known vehicle of a row", () => {
    const rows = stopRows([arr("oasa:040", "Α", 1100), arr("oasa:040", "Α", 1200, { vehicle: "oasa:7", source: "live" })], now);
    expect(rows[0].vehicle).toBe("oasa:7");
    expect(rows[0].times[1].live).toBe(true);
  });
});

describe("vehicle card", () => {
  it("lists the stops still ahead of a run, at most 8", () => {
    const run: V2Run = { id: "r", line: "l", headsign: "h", pattern: "p", vehicle: "v", vehicle_label: null, status: "running",
      stops: Array.from({ length: 12 }, (_, i) => ({ stop: `s${i}`, scheduled_at: 100 * i, at: 100 * i, delay_s: null,
        source: i < 6 ? "live" : "timetable", platform: null, passed: i < 2 })) };
    const n = nextStops(run);
    expect(n).toHaveLength(8);
    expect(n[0]).toMatchObject({ stop: "s2", at: 200, live: true });
    expect(n[7]).toMatchObject({ stop: "s9", live: false });
  });
  it("tags freshness: GPS age short, red over 90″; an estimate says «πρόγραμμα»", () => {
    const v = (kind: "gps" | "estimate", at: number) => ({ position: { kind, lat: 0, lon: 0, bearing: null, at } }) as V2Vehicle;
    expect(freshness(v("gps", 962), 1000)).toEqual({ text: "38″", warn: false });
    expect(freshness(v("gps", 760), 1000)).toEqual({ text: "4′", warn: true });
    expect(freshness(v("estimate", 100), 1000)).toEqual({ text: "πρόγραμμα", warn: false });
  });
});

describe("line card", () => {
  const veh = (id: string, headsign: string, next: string | null, extra: Partial<V2Vehicle> = {}): V2Vehicle => ({
    id, line: "stasy:M3", run: null, mode: "metro", headsign, label: null, delay_s: null, next_stop: next, motion: null,
    source: "stasy", position: { kind: "estimate", lat: 0, lon: 0, bearing: null, at: 0 }, ...extra,
  });
  const stops = { s3: stopOf("s3", "Τρίτη"), s7: stopOf("s7", "Έβδομη"), s20: stopOf("s20", "Εικοστή") };
  it("lists a direction's vehicles from the start of the line to its end, each with its next stop", () => {
    const rows = lineVehicleRows([
      veh("a", "ΕΛ. ΒΕΝΙΖΕΛΟΣ", "s20", { label: "#12", delay_s: 120 }),
      veh("b", "Δ. ΠΛΑΚΕΝΤΙΑΣ", "s3"),
      veh("c", "ΔΗΜΟΤΙΚΟ ΘΕΑΤΡΟ", "s7"),
      veh("d", "ΔΗΜΟΤΙΚΟ ΘΕΑΤΡΟ", null),
    ], m3, stops, 0);
    expect(rows.map(r => [r.id, r.next, r.label, r.delay_s])).toEqual([
      ["c", "Έβδομη", null, null], ["a", "Εικοστή", "#12", 120], ["d", null, null, null],
    ]);
  });
  it("shows a vehicle of no known direction under both", () => {
    const v = veh("x", "Πουθενά", "s3");
    expect(lineVehicleRows([v], m3, stops, 0).map(r => r.id)).toEqual(["x"]);
    expect(lineVehicleRows([v], m3, stops, 1).map(r => r.id)).toEqual(["x"]);
    expect(lineVehicleRows([{ ...v, direction: 1 }], m3, stops, 0)).toEqual([]);
  });
});
