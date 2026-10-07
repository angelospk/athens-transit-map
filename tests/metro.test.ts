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
  it("draws only the pinned lines, every station always", () => {
    const fc = metroFC(data, ["M2"], null);
    expect(props(fc, "line").map(p => [p.id, p.color])).toEqual([["M2", "#e00"]]);
    expect(props(fc, "station").map(p => p.name)).toEqual(["ΠΕΙΡΑΙΑΣ", "ΟΜΟΝΟΙΑ", "ΣΥΝΤΑΓΜΑ", "Πικροδάφνη"]);
    expect(fc.features.find(f => f.properties!.id === "M2")!.geometry).toEqual({ type: "MultiLineString", coordinates: [[[23.70, 37.99], [23.74, 37.97]]] });
  });

  it("no pinned line: stations only", () => {
    const fc = metroFC(data, [], null);
    expect(props(fc, "line")).toEqual([]);
    expect(props(fc, "station")).toHaveLength(4);
  });

  it("marks the tapped station", () => {
    const st = props(metroFC(data, [], "ΟΜΟΝΟΙΑ"), "station");
    expect(st.filter(p => p.sel).map(p => p.name)).toEqual(["ΟΜΟΝΟΙΑ"]);
  });

  it("colours a station by its first line, marks an interchange, and lists its lines", () => {
    const st = props(metroFC(data, [], null), "station");
    expect(st.find(p => p.name === "ΠΕΙΡΑΙΑΣ")).toMatchObject({ color: "#0a0", lines: "M1", hub: false });
    expect(st.find(p => p.name === "ΟΜΟΝΟΙΑ")).toMatchObject({ lines: "M1 M2", hub: true });
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
