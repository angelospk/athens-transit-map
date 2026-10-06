import { describe, expect, it } from "vitest";
import { linkTransfers, metroFC, type MetroData } from "../src/lib/metro";

const data: MetroData = {
  source: "test",
  lines: [
    { id: "M1", name: "ΓΡΑΜΜΗ 1", color: "#0a0", paths: [[[23.64, 37.94], [23.72, 37.97]]] },
    { id: "M2", name: "ΓΡΑΜΜΗ 2", color: "#e00", paths: [[[23.70, 37.99], [23.74, 37.97]]] },
    { id: "T6", name: "ΓΡΑΜΜΗ 6 ΤΡΑΜ", color: "#f90", paths: [[[23.73, 37.97], [23.70, 37.93]]] },
  ],
  stations: [
    { name: "ΠΕΙΡΑΙΑΣ", lon: 23.64, lat: 37.94, lines: ["M1"] },
    { name: "ΟΜΟΝΟΙΑ", lon: 23.72, lat: 37.98, lines: ["M1", "M2"] },
    { name: "ΣΥΝΤΑΓΜΑ", lon: 23.74, lat: 37.97, lines: ["M2"] },
    { name: "Πικροδάφνη", lon: 23.70, lat: 37.93, lines: ["T6"] },
  ],
};

const props = (fc: GeoJSON.FeatureCollection, kind: string) =>
  fc.features.filter(f => f.properties!.kind === kind).map(f => f.properties!);

describe("metroFC", () => {
  it("draws every line and station, all on, without a focus", () => {
    const fc = metroFC(data, null);
    expect(props(fc, "line").map(p => [p.id, p.color, p.on])).toEqual([["M1", "#0a0", true], ["M2", "#e00", true], ["T6", "#f90", true]]);
    expect(props(fc, "station").every(p => p.on)).toBe(true);
    expect(fc.features.find(f => f.properties!.id === "M1")!.geometry).toEqual({ type: "MultiLineString", coordinates: [[[23.64, 37.94], [23.72, 37.97]]] });
  });

  it("a focused station turns on its lines and the stations on them, the rest off", () => {
    const fc = metroFC(data, "ΣΥΝΤΑΓΜΑ");
    expect(props(fc, "line").filter(p => p.on).map(p => p.id)).toEqual(["M2"]);
    expect(props(fc, "station").filter(p => p.on).map(p => p.name)).toEqual(["ΟΜΟΝΟΙΑ", "ΣΥΝΤΑΓΜΑ"]);
  });

  it("an interchange turns on all of its lines", () => {
    const fc = metroFC(data, "ΟΜΟΝΟΙΑ");
    expect(props(fc, "line").filter(p => p.on).map(p => p.id)).toEqual(["M1", "M2"]);
    expect(props(fc, "station").filter(p => !p.on).map(p => p.name)).toEqual(["Πικροδάφνη"]);
  });

  it("colours a station by its first line, an interchange in white, and lists its lines", () => {
    const st = props(metroFC(data, null), "station");
    expect(st.find(p => p.name === "ΠΕΙΡΑΙΑΣ")).toMatchObject({ color: "#0a0", lines: "M1", hub: false });
    expect(st.find(p => p.name === "ΟΜΟΝΟΙΑ")).toMatchObject({ lines: "M1 M2", hub: true });
  });

  it("an unknown focus is no focus", () => {
    expect(props(metroFC(data, "ΠΟΥΘΕΝΑ"), "line").every(p => p.on)).toBe(true);
  });
});

describe("linkTransfers", () => {
  it("gives stations of other lines within TRANSFER_M each other's lines, own lines first", () => {
    const st = [
      { name: "ΣΥΝΤΑΓΜΑ", lon: 23.7353, lat: 37.9755, lines: ["M2", "M3"] },
      { name: "Σύνταγμα (Κέντρο)", lon: 23.7350, lat: 37.9749, lines: ["T6"] },   // ~70 m
      { name: "ΑΚΡΟΠΟΛΗ", lon: 23.7290, lat: 37.9687, lines: ["M2"] },            // ~900 m
    ];
    expect(linkTransfers(st).map(s => s.lines)).toEqual([["M2", "M3", "T6"], ["T6", "M2", "M3"], ["M2"]]);
  });
});
