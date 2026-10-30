import { describe, expect, it } from "vitest";
import { chipOf, findLines, findStops, lineStopPoints, pushRecent, toggleChip, type Recent, type StopEntry } from "../src/lib/finder";
import type { V2Line } from "../src/lib/v2";

const line = (id: string, mode: string, label: string | null, name: string, name_en: string | null = null): V2Line =>
  ({ id, mode, label, name, name_en, color: "#000", text_color: "#fff", source: id.split(":")[0] });

const lines: V2Line[] = [
  line("oasa:040", "bus", "040", "ΠΕΙΡΑΙΑΣ - ΣΥΝΤΑΓΜΑ", "PEIRAIAS - SYNTAGMA"),
  line("oasa:400", "bus", "400", "ΑΚΡΟΠΟΛΗ - ΠΕΙΡΑΙΑΣ"),
  line("oasa:Α1", "bus", "Α1", "ΠΕΙΡΑΙΑΣ - ΒΟΥΛΑ"),
  line("oasa:2", "trolley", "2", "ΚΥΨΕΛΗ - ΠΑΓΚΡΑΤΙ"),
  line("stasy:M3", "metro", "M3", "Δημοτικό Θέατρο - Αεροδρόμιο"),
  line("stasy:T6", "tram", "T6", "Σύνταγμα - Πικροδάφνη"),
  line("proastiakos:A1", "suburban", "A1", "Πειραιάς - Αεροδρόμιο"),
];

const stop = (id: string, name: string, modes: string[], ls: string[] = []): StopEntry => [id, name, 37.9, 23.7, modes, ls];
const stops: StopEntry[] = [
  stop("oasa:1", "ΣΥΝΤΑΓΜΑ", ["bus"], ["oasa:040"]),
  stop("oasa:2", "ΠΛ. ΣΥΝΤΑΓΜΑΤΟΣ", ["bus", "trolley"], ["oasa:2"]),
  stop("stasy:συνταγμα-metro", "Σύνταγμα", ["metro"], ["stasy:M3"]),
  stop("stasy:συνταγμα-tram", "Σύνταγμα", ["tram"], ["stasy:T6"]),
  stop("oasa:3", "ΑΓ. ΣΥΝΤΑΓΜΑΤΑΡΧΗΣ", ["bus"]),
  stop("oasa:4", "ΠΕΙΡΑΙΑΣ", ["bus"]),
];
const ids = <T extends { id: string } | StopEntry>(xs: T[]) => xs.map(x => (Array.isArray(x) ? x[0] : (x as { id: string }).id));

describe("chipOf", () => {
  it("puts trolleys under the bus chip and keeps the rail modes", () => {
    expect(["bus", "trolley", "metro", "tram", "suburban", "ferry"].map(chipOf)).toEqual(["bus", "bus", "metro", "tram", "suburban", null]);
  });
});

describe("findLines", () => {
  it("returns nothing for an empty query", () => {
    expect(findLines(lines, "  ", [])).toEqual([]);
  });
  it("puts the exact label first, then label prefixes, then name matches", () => {
    expect(ids(findLines(lines, "40", []))).toEqual(["oasa:040", "oasa:400"]);
    expect(ids(findLines(lines, "040", []))[0]).toBe("oasa:040");
  });
  it("reads Latin look-alikes and lowercase in a label", () => {
    expect(ids(findLines(lines, "a1", []))).toEqual(["oasa:Α1", "proastiakos:A1"]);
    expect(ids(findLines(lines, "m3", []))).toEqual(["stasy:M3"]);
  });
  it("matches the name without accents or case, Greek or English", () => {
    expect(ids(findLines(lines, "πειραιας", []))).toEqual(["oasa:040", "oasa:400", "oasa:Α1", "proastiakos:A1"]);
    expect(ids(findLines(lines, "syntagma", []))).toEqual(["oasa:040"]);
  });
  it("keeps only the chosen modes; trolleys count as bus", () => {
    expect(ids(findLines(lines, "πειραιας", ["suburban"]))).toEqual(["proastiakos:A1"]);
    expect(ids(findLines(lines, "2", ["bus"]))).toEqual(["oasa:2"]);
    expect(ids(findLines(lines, "συνταγμα", ["tram", "bus"]))).toEqual(["oasa:040", "stasy:T6"]);
  });
});

describe("findStops", () => {
  it("needs two letters", () => {
    expect(findStops(stops, "σ", [])).toEqual([]);
    expect(findStops(stops, "", [])).toEqual([]);
  });
  it("puts names that start with the query first (a station before the bus poles of the same rank), then a word that starts with it, then any match", () => {
    expect(ids(findStops(stops, "συνταγμα", []))).toEqual(
      ["stasy:συνταγμα-metro", "stasy:συνταγμα-tram", "oasa:1", "oasa:2", "oasa:3"]);
  });
  it("keeps only the chosen modes; a bus + trolley stop counts as bus", () => {
    expect(ids(findStops(stops, "συνταγμα", ["metro"]))).toEqual(["stasy:συνταγμα-metro"]);
    expect(ids(findStops(stops, "συνταγματος", ["bus"]))).toEqual(["oasa:2"]);
  });
});

describe("pushRecent", () => {
  const r = (id: string): Recent => ({ kind: "line", id, label: id });
  it("puts the newest first, once, and keeps five", () => {
    let list: Recent[] = [];
    for (const id of ["a", "b", "c", "d", "e", "f"]) list = pushRecent(list, r(id));
    expect(list.map(x => x.id)).toEqual(["f", "e", "d", "c", "b"]);
    expect(pushRecent(list, r("c")).map(x => x.id)).toEqual(["c", "f", "e", "d", "b"]);
  });
});

describe("toggleChip", () => {
  it("adds and removes a mode; all four modes are the same as none (Όλα)", () => {
    expect(toggleChip([], "bus")).toEqual(["bus"]);
    expect(toggleChip(["bus", "tram"], "bus")).toEqual(["tram"]);
    expect(toggleChip(["bus", "metro", "tram"], "suburban")).toEqual([]);
  });
});

describe("lineStopPoints", () => {
  it("gives [lon, lat] of every stop the line serves", () => {
    const s = [stop("a", "A", ["bus"], ["oasa:040"]), stop("b", "B", ["bus"], ["oasa:2"])];
    s[0][2] = 37.95; s[0][3] = 23.6;
    expect(lineStopPoints(s, "oasa:040")).toEqual([[23.6, 37.95]]);
    expect(lineStopPoints(s, "stasy:M3")).toEqual([]);
  });
});
