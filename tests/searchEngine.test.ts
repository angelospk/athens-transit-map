import { describe, expect, it } from "vitest";
import { intents, lineAlias, nameScore, ownEnd, parseTrip, searchLines, searchStops, slips, tokens } from "../src/lib/searchEngine";
import type { StopEntry } from "../src/lib/finder";
import type { V2Line } from "../src/lib/v2";

const L = (id: string, label: string, name: string, mode = "bus"): V2Line => ({ id, label, name, mode, name_en: null, color: "#000", text_color: "#fff", source: "x" });
const lines = [L("oasa:040", "040", "ΠΕΙΡΑΙΑΣ - ΣΥΝΤΑΓΜΑ"), L("oasa:400", "400", "ΠΕΙΡΑΙΑΣ - ΑΚΡΟΠΟΛΗ"), L("stasy:M2", "M2", "Ανθούπολη - Ελληνικό", "metro"),
  L("stasy:M1", "M1", "Πειραιάς - Κηφισιά", "metro"), L("stasy:T6", "T6", "Σύνταγμα - Π. Φάληρο", "tram")];
const S = (id: string, name: string, lat: number, lon: number, modes: string[], ls: string[]): StopEntry => [id, name, lat, lon, modes, ls];
const stops = [S("a", "ΣΥΝΤΑΓΜΑ", 37.975, 23.735, ["bus"], ["oasa:040"]), S("b", "Σύνταγμα", 37.975, 23.735, ["metro"], ["stasy:M2"]),
  S("c", "ΠΛΑΤΕΙΑ ΑΓΙΟΥ ΓΕΩΡΓΙΟΥ", 37.98, 23.73, ["bus"], ["oasa:400"]), S("d", "Αεροδρόμιο", 37.936, 23.944, ["metro"], ["stasy:M3"]),
  S("e", "ΚΗΦΙΣΙΑ", 38.07, 23.81, ["metro"], ["stasy:M1"]), S("f", "ΛΕΩΦΟΡΟΣ ΣΥΓΓΡΟΥ", 37.96, 23.72, ["bus"], ["oasa:040"])];

describe("words", () => {
  it("drops the dots of short forms", () => { expect(tokens("Λεωφ. Συγγρού")).toEqual(["λεωφ", "συγγρου"]); });
  it("counts slips", () => { expect(slips("συνταμγα", "συνταγμα", 1)).toBe(1); expect(slips("abc", "xyz", 1)).toBe(2); });
  it("finds words in any order, by their start", () => {
    expect(nameScore(tokens("Αγ. Γεωργίου πλ"), "ΠΛΑΤΕΙΑ ΑΓΙΟΥ ΓΕΩΡΓΙΟΥ").s).toBeGreaterThanOrEqual(0);
    expect(nameScore(tokens("γεωργιου αγιου"), "ΠΛΑΤΕΙΑ ΑΓΙΟΥ ΓΕΩΡΓΙΟΥ").s).toBeGreaterThanOrEqual(0);
    expect(nameScore(tokens("ομονοια"), "ΠΛΑΤΕΙΑ ΑΓΙΟΥ ΓΕΩΡΓΙΟΥ").s).toBe(-1);
  });
  it("forgives a slip", () => {
    const r = nameScore(tokens("συνταμγα"), "ΣΥΝΤΑΓΜΑ");
    expect(r.s).toBeGreaterThanOrEqual(0); expect(r.typo).toBe(true);
  });
});

describe("lines", () => {
  it("by number first, then by name", () => {
    expect(searchLines(lines, "40").map(x => x.item.label)).toEqual(["040", "400"]);   // 400 begins with 40 too
    expect(searchLines(lines, "πειραιας").map(x => x.item.label).sort()).toEqual(["040", "400", "M1"]);
  });
  it("by the names people use", () => {
    expect(lineAlias("Κόκκινη γραμμή")).toEqual(["Μ2"]);
    expect(searchLines(lines, "ΗΣΑΠ").map(x => x.item.id)).toEqual(["stasy:M1"]);
    expect(searchLines(lines, "τραμ").map(x => x.item.id)).toEqual(["stasy:T6"]);
  });
});

describe("stops", () => {
  it("a station before a bus pole of the same name, and Greeklish", () => {
    expect(searchStops(stops, "syntagma").map(x => x.item[0])).toEqual(["b", "a"]);
  });
  it("by a common name", () => {
    expect(searchStops(stops, "αεροδρόμιο")[0].item[0]).toBe("d");
    expect(searchStops(stops, "Ελ. Βενιζέλος")[0].item[0]).toBe("d");
  });
  it("short forms", () => { expect(searchStops(stops, "Λεωφ. Συγγρ")[0].item[0]).toBe("f"); });
  it("nearer first when two match alike", () => {
    const near = searchStops(stops, "", ["metro"], { at: [38.07, 23.81] }, () => true);
    expect(near[0].item[0]).toBe("e");
  });
});

describe("two asks in one", () => {
  it("a line at a stop", () => {
    const [i] = intents(lines, stops, "040 Σύνταγμα");
    expect(i.kind).toBe("lineAt");
    if (i.kind === "lineAt") expect([i.line.label, i.stop[0]]).toEqual(["040", "a"]);
  });
  it("a trip", () => {
    const [i] = intents(lines, stops, "από Σύνταγμα προς Κηφισιά");
    expect(i.kind).toBe("trip");
    if (i.kind === "trip") expect([i.from[1], i.to[0]]).toEqual(["Σύνταγμα", "e"]);
    expect(intents(lines, stops, "Σύνταγμα → Αεροδρόμιο")[0].kind).toBe("trip");
  });
});

describe("trips as people type them", () => {
  it("without «από», with the user's own words", () => {
    expect(parseTrip("συνταγμα προς σπιτι")).toEqual({ from: "συνταγμα", to: "σπιτι" });
    expect(parseTrip("Σπίτι για δουλειά")).toEqual({ from: "σπιτι", to: "δουλεια" });
    expect(parseTrip("από εδώ στο Σύνταγμα")).toEqual({ from: "εδω", to: "συνταγμα" });
    expect(parseTrip("Πλατεία Στο Κέντρο")).toBeNull();   // «στο» alone is not a trip without «από»
    expect([ownEnd("σπιτι"), ownEnd("Η θέση μου"), ownEnd("Δουλειά"), ownEnd("Σύνταγμα")]).toEqual(["home", "me", "work", null]);
  });
});
