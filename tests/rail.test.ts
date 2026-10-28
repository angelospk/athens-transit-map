import { describe, expect, it } from "vitest";
import { boardRows, nextBoards, stasyUrl, stationNames, type StasyBoard } from "../src/lib/rail";
import type { MetroStation } from "../src/lib/metro";

const stations: MetroStation[] = [
  { name: "ΣΥΝΤΑΓΜΑ", lon: 23.7350, lat: 37.9755, lines: ["M2", "M3", "T6"] },
  { name: "Σύνταγμα (Κέντρο)", lon: 23.7345, lat: 37.9750, lines: ["T6", "M2", "M3"] },
  { name: "ΟΜΟΝΟΙΑ", lon: 23.7280, lat: 37.9840, lines: ["M1", "M2"] },
];

const dep = (line: string, headsign: string, t: string, in_s: number) => ({ line, route_color: line === "M2" ? "#e30613" : "#0072bc", headsign, t, in_s });

describe("stationNames", () => {
  it("asks the station and every other one within the transfer distance", () => {
    expect(stationNames(stations, "ΣΥΝΤΑΓΜΑ")).toEqual(["ΣΥΝΤΑΓΜΑ", "Σύνταγμα (Κέντρο)"]);
    expect(stationNames(stations, "Σύνταγμα (Κέντρο)")).toEqual(["Σύνταγμα (Κέντρο)", "ΣΥΝΤΑΓΜΑ"]);
  });
  it("a station alone asks only its own name", () => {
    expect(stationNames(stations, "ΟΜΟΝΟΙΑ")).toEqual(["ΟΜΟΝΟΙΑ"]);
  });
});

describe("stasyUrl", () => {
  // The same query as the app, so both share one Cloudflare cache entry.
  it("sends the name as it is, with n=4", () => {
    expect(stasyUrl("Σύνταγμα (Κέντρο)")).toBe(
      "https://transit.haroldpoi.dev/v1/rail/stasy/departures?stop=%CE%A3%CF%8D%CE%BD%CF%84%CE%B1%CE%B3%CE%BC%CE%B1%20(%CE%9A%CE%AD%CE%BD%CF%84%CF%81%CE%BF)&n=4");
  });
});

describe("boardRows", () => {
  const board = (stop: string, departures: StasyBoard["departures"], indicative = false): StasyBoard => ({ stop, indicative, departures });

  it("one row per line and headsign, the soonest first, minutes left", () => {
    const rows = boardRows([board("ΣΥΝΤΑΓΜΑ", [
      dep("M3", "ΔΗΜΟΤΙΚΟ ΘΕΑΤΡΟ", "15:23", 135),
      dep("M2", "ΑΝΘΟΥΠΟΛΗ", "15:22", 93),
      dep("M3", "ΔΗΜΟΤΙΚΟ ΘΕΑΤΡΟ", "15:30", 555),
      dep("M2", "ΑΝΘΟΥΠΟΛΗ", "15:27", 393),
    ])], 0);
    expect(rows).toEqual([
      { line: "M2", color: "#e30613", headsign: "ΑΝΘΟΥΠΟΛΗ", mins: [1, 6], times: ["15:22", "15:27"] },
      { line: "M3", color: "#0072bc", headsign: "ΔΗΜΟΤΙΚΟ ΘΕΑΤΡΟ", mins: [2, 9], times: ["15:23", "15:30"] },
    ]);
  });

  it("counts the seconds since the fetch and drops trains gone more than 30 s ago", () => {
    const rows = boardRows([board("ΣΥΝΤΑΓΜΑ", [dep("M2", "ΑΝΘΟΥΠΟΛΗ", "15:22", 20), dep("M2", "ΑΝΘΟΥΠΟΛΗ", "15:27", 320)])], 60);
    expect(rows[0].mins).toEqual([4]);
    const now = boardRows([board("ΣΥΝΤΑΓΜΑ", [dep("M2", "ΑΝΘΟΥΠΟΛΗ", "15:22", 40)])], 60);
    expect(now[0].mins).toEqual([0]);
  });

  it("shows only the next hour", () => {
    const rows = boardRows([board("ΣΥΝΤΑΓΜΑ", [dep("M3", "ΕΛ. ΒΕΝΙΖΕΛΟΣ", "15:48", 1680), dep("M3", "ΕΛ. ΒΕΝΙΖΕΛΟΣ", "16:24", 3840),
      dep("M2", "ΣΕΠΟΛΙΑ", "20:45", 19500)])], 0);
    expect(rows.map(r => `${r.headsign} ${r.times.join(",")}`)).toEqual(["ΕΛ. ΒΕΝΙΖΕΛΟΣ 15:48"]);
    expect(boardRows([board("ΣΥΝΤΑΓΜΑ", [dep("M2", "ΑΝΘΟΥΠΟΛΗ", "16:22", 3660)])], 120)[0].mins).toEqual([59]);
  });

  it("keeps at most `max` times per row", () => {
    const rows = boardRows([board("ΣΥΝΤΑΓΜΑ", [0, 1, 2, 3].map(i => dep("M2", "ΑΝΘΟΥΠΟΛΗ", `15:2${i}`, 60 * i)))], 0, 2);
    expect(rows[0].times).toEqual(["15:20", "15:21"]);
  });

  it("merges the boards of a transfer, without the same train twice", () => {
    const rows = boardRows([
      board("ΣΥΝΤΑΓΜΑ", [dep("M2", "ΕΛΛΗΝΙΚΟ", "15:29", 482)]),
      board("Σύνταγμα (Κέντρο)", [dep("T6", "Πικροδάφνη", "15:30", 515), dep("M2", "ΕΛΛΗΝΙΚΟ", "15:29", 482)]),
    ], 0);
    expect(rows.map(r => `${r.line} ${r.headsign} ${r.times.join(",")}`)).toEqual(["M2 ΕΛΛΗΝΙΚΟ 15:29", "T6 Πικροδάφνη 15:30"]);
  });

  it("leaves out the trains that end at this station", () => {
    const rows = boardRows([board("Σύνταγμα (Κέντρο)", [dep("T6", "Σύνταγμα (Κέντρο)", "15:35", 815), dep("T6", "Πικροδάφνη", "15:30", 515)])], 0);
    expect(rows.map(r => r.headsign)).toEqual(["Πικροδάφνη"]);
  });

  it("no boards or no departures: no rows", () => {
    expect(boardRows([], 0)).toEqual([]);
    expect(boardRows([board("ΣΥΝΤΑΓΜΑ", [])], 0)).toEqual([]);
  });
});

describe("nextBoards", () => {
  const b = (stop: string): StasyBoard => ({ stop, indicative: false, departures: [] });

  it("takes the boards when every name answered", () => {
    expect(nextBoards([{ status: 200, body: b("Α") }, { status: 200, body: b("Β") }], 1000))
      .toEqual({ boards: [b("Α"), b("Β")], at: 1000, failed: "" });
  });
  it("a cached answer (at: when it came) counts its trains down by its own age", () => {
    const dep = { line: "M2", route_color: "#e30613", headsign: "ΕΛΛΗΝΙΚΟ", t: "10:02", in_s: 120 };
    const board = (stop: string): StasyBoard => ({ stop, indicative: false, departures: [dep] });
    const got = nextBoards([{ status: 200, body: board("Α"), at: 0 }, { status: 200, body: board("Β") }], 60_000);
    expect(got.boards!.map(x => x.departures[0].in_s)).toEqual([60, 120]);
    expect(got.at).toBe(60_000);
    expect(dep.in_s).toBe(120);   // the cached answer itself is left as it was
  });
  it("a name the server does not know adds no trains", () => {
    expect(nextBoards([{ status: 200, body: b("Α") }, { status: 404, body: null }], 1000).boards).toEqual([b("Α")]);
    expect(nextBoards([{ status: 404, body: null }], 1000)).toEqual({ boards: null, at: 1000, failed: "error" });
  });
  it("one name warming up: no partial board", () => {
    expect(nextBoards([{ status: 200, body: b("Α") }, { status: 503, body: null }], 1000))
      .toEqual({ boards: null, at: 1000, failed: "warming" });
  });
  it("a failed round shows the failure, not the old boards", () => {
    expect(nextBoards([{ status: 0, body: null }], 2000)).toEqual({ boards: null, at: 2000, failed: "error" });
  });
});
