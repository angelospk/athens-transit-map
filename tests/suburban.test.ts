import { describe, expect, it } from "vitest";
import { boardNote, suburbanFC, suburbanUrl, trainRows, type SuburbanData, type Train } from "../src/lib/suburban";

const data: SuburbanData = {
  corridors: {
    KIATO: { name: "Πειραιάς – Κιάτο", color: "#D9822B", stations: ["p", "a"], path: [[37.948, 23.643], [38.021, 23.718]] },
    PIRAIR: { name: "Πειραιάς – Αεροδρόμιο", color: "#7E57C2", stations: ["p", "a", "x"], path: [[37.948, 23.643], [37.936, 23.944]] },
  },
  stations: [
    { id: "p", name: "Πειραιάς", en: "Piraeus", lat: 37.948, lon: 23.643, corridors: ["KIATO", "PIRAIR"] },
    { id: "a", name: "Αγ. Ανάργυροι", en: "Ag. Anargyroi", lat: 38.021, lon: 23.718, corridors: ["KIATO", "PIRAIR", "PIRAIR"] },
    { id: "x", name: "Αεροδρόμιο", en: "Airport", lat: 37.936, lon: 23.944, corridors: ["PIRAIR"] },
  ],
};

const props = (fc: GeoJSON.FeatureCollection, kind: string) => fc.features.filter(f => f.properties!.kind === kind).map(f => f.properties!);

describe("suburbanFC", () => {
  it("draws every corridor in lon/lat order and every station, the tapped one marked", () => {
    const fc = suburbanFC(data, "a");
    expect(props(fc, "line").map(p => [p.id, p.color])).toEqual([["KIATO", "#D9822B"], ["PIRAIR", "#7E57C2"]]);
    expect(fc.features[0].geometry).toEqual({ type: "LineString", coordinates: [[23.643, 37.948], [23.718, 38.021]] });
    expect(props(fc, "station").map(p => [p.id, p.name, p.color, p.sel])).toEqual([
      ["p", "Πειραιάς", "#D9822B", false], ["a", "Αγ. Ανάργυροι", "#D9822B", true], ["x", "Αεροδρόμιο", "#7E57C2", false],
    ]);
  });
});

describe("suburbanUrl", () => {
  it("asks the station's next 10 trains", () => {
    expect(suburbanUrl("6928c3c150ab5bc72b39cee5")).toBe("https://transit.haroldpoi.dev/v1/rail/suburban/stations/6928c3c150ab5bc72b39cee5/departures?n=10");
  });
});

describe("trainRows", () => {
  const tr = (t: string, to: string, delay_min: number | null = 0, status = "scheduled", platform: string | null = null): Train =>
    ({ train: "1", from: "Αθήνα", to, t, delay_min, platform, status });

  it("expected time with the delay, platform when known", () => {
    const rows = trainRows([tr("17:34", "Χαλκίδα"), tr("17:41", "Κιάτο", 7, "delayed", "3"), tr("17:44", "Πειραιάς", null)], 17 * 60 + 30);
    expect(rows).toEqual([
      { t: "17:34", expected: "17:34", delay: 0, to: "Χαλκίδα", platform: null, in: 4, live: false },
      { t: "17:44", expected: "17:44", delay: null, to: "Πειραιάς", platform: null, in: 14, live: false },
      { t: "17:41", expected: "17:48", delay: 7, to: "Κιάτο", platform: "3", in: 18, live: true },
    ]);
  });
  it("leaves out completed runs and trains gone more than a minute ago (by their expected time)", () => {
    const rows = trainRows([tr("17:20", "Κιάτο", 0, "completed"), tr("17:25", "Χαλκίδα"), tr("17:22", "Αεροδρόμιο", 10, "delayed")], 17 * 60 + 30);
    expect(rows.map(r => r.to)).toEqual(["Αεροδρόμιο"]);
  });
  it("sorts by expected time", () => {
    const rows = trainRows([tr("17:40", "Κιάτο", 15), tr("17:45", "Χαλκίδα")], 17 * 60 + 30);
    expect(rows.map(r => r.to)).toEqual(["Χαλκίδα", "Κιάτο"]);
  });
  it("past midnight, a late train of the evening before is yesterday's", () => {
    const rows = trainRows([tr("00:20", "Κιάτο"), tr("23:55", "Χαλκίδα", 20), tr("23:50", "Πειραιάς", 10)], 5);
    expect(rows.map(r => [r.to, r.expected, r.in])).toEqual([["Χαλκίδα", "00:15", 10], ["Κιάτο", "00:20", 15]]);
    expect(trainRows([tr("23:55", "Χαλκίδα", 20)], 17)).toEqual([]);
    expect(trainRows([tr("23:59", "Χαλκίδα")], 0).map(r => r.expected)).toEqual(["23:59"]);
  });
  it("a train after midnight comes after the late evening ones", () => {
    const rows = trainRows([tr("00:10", "Κιάτο"), tr("23:55", "Χαλκίδα", 20)], 23 * 60 + 50);
    expect(rows.map(r => [r.to, r.expected])).toEqual([["Κιάτο", "00:10"], ["Χαλκίδα", "00:15"]]);
  });
  it("live: a train under way with a delay (0 too: on time is an observation), as /v2 says source live", () => {
    const rows = trainRows([tr("17:34", "Αεροδρόμιο", 0, "in_progress"), tr("17:40", "Χαλκίδα", 0), tr("17:45", "Κιάτο", null, "in_progress")], 17 * 60 + 30);
    expect(rows.map(r => [r.to, r.live])).toEqual([["Αεροδρόμιο", true], ["Χαλκίδα", false], ["Κιάτο", false]]);
  });
});

describe("boardNote", () => {
  it("says which times are live when some are, and only 'timetable' when none is", () => {
    expect(boardNote([{ live: true }, { live: false }])).toBe("● ζωντανά, από τα τρένα σε κίνηση· τα άλλα από το πρόγραμμα της Hellenic Train.");
    expect(boardNote([{ live: false }])).toBe("Από το πρόγραμμα της Hellenic Train.");
    expect(boardNote([])).toBe("Από το πρόγραμμα της Hellenic Train.");
  });
});
