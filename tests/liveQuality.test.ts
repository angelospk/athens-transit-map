import { describe, expect, it } from "vitest";
import { haloFC, hasLiveQuality, levelClass, levelsByKey, segmentText, vehiclePhrase, type Segment, type VehicleQuality } from "../src/lib/liveQuality";
import type { DrawnLine } from "../src/lib/map/layers";

const hq = (o: Partial<VehicleQuality>): VehicleQuality =>
  ({ level: "normal", basis: "headway", gap_s: 300, usual_headway_s: 300, stop: "oasa:1", bunched: false, early: false, ...o });
const sq = (o: Partial<VehicleQuality>): VehicleQuality =>
  ({ level: "normal", basis: "schedule", gap_s: null, usual_headway_s: null, stop: null, bunched: false, early: false, ...o });

describe("hasLiveQuality", () => {
  it("Athens and Thessaloniki only", () => {
    expect(["athens", "thessaloniki", "patra", "volos"].map(c => hasLiveQuality(c))).toEqual([true, true, false, false]);
  });
});

describe("levelClass", () => {
  it("maps the scale onto the colour classes; anything else is grey", () => {
    expect(["normal", "worse", "much_worse", "unknown", "new_level", null, undefined].map(levelClass))
      .toEqual(["ontime", "late1", "late3", "none", "none", "none", "none"]);
  });
});

describe("vehiclePhrase", () => {
  it("no quality object (older backend, metro, citybus): null, the caller keeps the delay text", () => {
    expect(vehiclePhrase(null, 120)).toBeNull();
    expect(vehiclePhrase(undefined, 120)).toBeNull();
  });
  it("headway basis: the gap to the bus ahead, in whole minutes", () => {
    expect(vehiclePhrase(hq({ gap_s: 720, level: "much_worse" }), 30)).toEqual({ text: "12′ μετά", level: "much_worse" });
    expect(vehiclePhrase(hq({ gap_s: 330 }), null)).toEqual({ text: "6′ μετά", level: "normal" });
  });
  it("headway basis: at least 1′", () => {
    expect(vehiclePhrase(hq({ gap_s: 20, usual_headway_s: 30 }), null)?.text).toBe("1′ μετά");
  });
  it("bunched wins over the gap", () => {
    expect(vehiclePhrase(hq({ gap_s: 60, bunched: true, level: "much_worse" }), null)).toEqual({ text: "κολλητά", level: "much_worse" });
  });
  it("schedule basis: the delay with a sign", () => {
    expect(vehiclePhrase(sq({ level: "worse" }), 420)).toEqual({ text: "+7′", level: "worse" });
    expect(vehiclePhrase(sq({}), 75)).toEqual({ text: "+1′", level: "normal" });
  });
  it("schedule basis: early", () => {
    expect(vehiclePhrase(sq({ level: "worse", early: true }), -130)).toEqual({ text: "νωρίτερα 2′", level: "worse" });
  });
  it("schedule basis under half a minute either way: στην ώρα", () => {
    expect(vehiclePhrase(sq({}), 25)?.text).toBe("στην ώρα");
    expect(vehiclePhrase(sq({}), -50)?.text).toBe("στην ώρα");
  });
  it("unknown, or no measure behind the level: a dash", () => {
    expect(vehiclePhrase(hq({ level: "unknown", gap_s: null }), 200)).toEqual({ text: "—", level: "unknown" });
    expect(vehiclePhrase(hq({ level: "worse", gap_s: null }), 200)).toEqual({ text: "—", level: "unknown" });
    expect(vehiclePhrase(sq({ level: "normal" }), null)).toEqual({ text: "—", level: "unknown" });
    expect(vehiclePhrase({ ...hq({}), level: "weird" as never }, null)).toEqual({ text: "—", level: "unknown" });
  });
});

describe("levelsByKey", () => {
  it("keys the levels like the map's vehicles: native line / native vehicle id", () => {
    const m = levelsByKey("040", [
      { id: "oasa:52134", quality: hq({ level: "worse" }) },
      { id: "oasa:7", quality: null },
      { id: "oasa:8" },
    ]);
    expect([...m]).toEqual([["040/52134", "worse"], ["040/7", "unknown"], ["040/8", "unknown"]]);
  });
});

// A straight route along a parallel, 3 stops ~1.1 km apart (lat 0, lon 0 / 0.01 / 0.02).
const line = (variants: Record<string, string[]>, visible?: string[]): DrawnLine => ({
  id: "040", color: "#123456", visible: visible && new Set(visible),
  data: {
    id: "040",
    stops: { A: { name: "ΚΑΛΛΙΘΕΑ", lat: 0, lon: 0 }, B: { name: "ΦΙΞ", lat: 0, lon: 0.01 }, C: { name: "ΣΥΝΤΑΓΜΑ", lat: 0, lon: 0.02 } },
    variants: Object.fromEntries(Object.entries(variants).map(([id, stops]) => {
      const lon = stops.map(s => ({ A: 0, B: 0.01, C: 0.02 })[s as "A"]);
      const shape: [number, number][] = [];
      for (let x = Math.min(...lon); x <= Math.max(...lon) + 1e-9; x += 0.0025) shape.push([0, +x.toFixed(4)]);
      if (lon[0] > lon[lon.length - 1]) shape.reverse();
      return [id, { headsign: "", direction: 0, shape, stops }];
    })),
  },
});
const seg = (o: Partial<Segment>): Segment =>
  ({ pattern: "oasa:5512", from: "oasa:A", to: "oasa:B", level: "worse", ratio: 0.7, speed: 3.9, usual_speed: 5.3, n: 3, ...o });

describe("haloFC", () => {
  it("only worse and much_worse segments get a halo, cut from stop to stop", () => {
    const fc = haloFC([line({ "5512": ["A", "B", "C"] })], new Map([["040", [
      seg({}), seg({ from: "oasa:B", to: "oasa:C", level: "normal" }),
    ]]]));
    expect(fc.features).toHaveLength(1);
    const f = fc.features[0];
    expect(f.properties).toMatchObject({ level: "worse", line: "040", from: "ΚΑΛΛΙΘΕΑ", to: "ΦΙΞ", speed: 3.9, usual: 5.3 });
    const c = f.geometry.coordinates;
    expect(c[0][0]).toBeCloseTo(0, 6);
    expect(c[c.length - 1][0]).toBeCloseTo(0.01, 6);
  });
  it("much_worse too; unknown and normal never", () => {
    const fc = haloFC([line({ "5512": ["A", "B", "C"] })], new Map([["040", [
      seg({ level: "much_worse" }), seg({ from: "oasa:B", to: "oasa:C", level: "unknown" }),
    ]]]));
    expect(fc.features.map(f => f.properties!.level)).toEqual(["much_worse"]);
  });
  it("a pattern that is not drawn (another direction focused, or unknown) gets none", () => {
    const l = line({ "5512": ["A", "B", "C"], "5513": ["C", "B", "A"] }, ["5513"]);
    expect(haloFC([l], new Map([["040", [seg({})]]])).features).toHaveLength(0);
    expect(haloFC([line({ "5512": ["A", "B", "C"] })], new Map([["040", [seg({ pattern: "oasa:999" })]]])).features).toHaveLength(0);
  });
  it("stops that do not follow each other in the pattern give no halo", () => {
    expect(haloFC([line({ "5512": ["A", "B", "C"] })], new Map([["040", [seg({ from: "oasa:A", to: "oasa:C" })]]])).features).toHaveLength(0);
  });
  it("the same stop pair of two patterns is drawn once", () => {
    const l = line({ "5512": ["A", "B", "C"], "5535": ["A", "B"] });
    const fc = haloFC([l], new Map([["040", [seg({}), seg({ pattern: "oasa:5535" })]]]));
    expect(fc.features).toHaveLength(1);
  });
  it("a line without segments, or not drawn: nothing", () => {
    expect(haloFC([line({ "5512": ["A", "B"] })], new Map()).features).toEqual([]);
    expect(haloFC([], new Map([["040", [seg({})]]])).features).toEqual([]);
  });
});

describe("segmentText", () => {
  it("names the stops and the speeds in km/h", () => {
    expect(segmentText({ level: "worse", from: "Καλλιθέα", to: "Φιξ", speed: 3.9, usual: 5.3 }))
      .toBe("Καλλιθέα → Φιξ · πιο αργά από συνήθως: 14 km/h (συνήθως 19)");
    expect(segmentText({ level: "much_worse", from: "Α", to: "Β", speed: 1.9, usual: 5 }))
      .toBe("Α → Β · πολύ πιο αργά από συνήθως: 7 km/h (συνήθως 18)");
  });
  it("without a usual speed, no brackets", () => {
    expect(segmentText({ level: "worse", from: "Α", to: "Β", speed: 3.9, usual: null })).toBe("Α → Β · πιο αργά από συνήθως: 14 km/h");
  });
});
