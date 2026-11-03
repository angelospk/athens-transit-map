import { describe, expect, it } from "vitest";
import {
  AGREE_M, MAX_MOVE_M, applyCorrections, deviceId, gpsFromAudit, markReported, parseCsv, reportedStops, decideCorrection, distM, offsetPoint, parseStopReports, stopReportText,
  type GpsMeasure, type StopReport,
} from "../src/lib/stopfix";

const STOP = { id: "10183", lat: 37.93843, lon: 23.63188 };
// A point d metres north (+) or east (east=true) of the stop.
const at = (d: number, east = false): [number, number] => offsetPoint([STOP.lat, STOP.lon], east ? 0 : d, east ? d : 0);
const rep = (device: string, d: number, east = false, t = 1): StopReport => {
  const [lat, lon] = at(d, east);
  return { stop: STOP.id, lat, lon, device, at: t };
};
const gps = (d: number, confidence: GpsMeasure["confidence"], suspect: boolean): GpsMeasure => {
  const [lat, lon] = at(d);
  return { lat, lon, confidence, suspect };
};

describe("offsetPoint / distM", () => {
  it("moves a point by metres and measures it back", () => {
    expect(distM([STOP.lat, STOP.lon], at(30))).toBeCloseTo(30, 0);
    expect(distM([STOP.lat, STOP.lon], at(30, true))).toBeCloseTo(30, 0);
  });
});

describe("stop report text", () => {
  it("round-trips through the feedback text, with a human part first", () => {
    const r = rep("a1b2c3d4e5f6", 22);
    const text = stopReportText({ name: "ΠΕΙΡΑΙΑΣ", from: [STOP.lat, STOP.lon], ...r });
    expect(text).toMatch(/^Λάθος θέση στάσης ΠΕΙΡΑΙΑΣ \(10183\): 22 μ/);
    const [back] = parseStopReports([{ text, at: 5 }]);
    expect(back.stop).toBe("10183");
    expect(back.device).toBe("a1b2c3d4e5f6");
    expect(distM([back.lat, back.lon], [r.lat, r.lon])).toBeLessThan(1);
    expect(back.at).toBe(5);
  });
  it("skips feedback rows that are not stop reports or are malformed", () => {
    expect(parseStopReports([{ text: "Το 040 άργησε", at: 1 }, { text: "#stopfix stop=1 lat=abc lon=23 dev=x", at: 2 }])).toEqual([]);
  });
});

describe("decideCorrection", () => {
  it("never moves a stop on reports alone below 3 independent devices", () => {
    const d = decideCorrection(STOP, null, [rep("a", 25), rep("b", 26)]);
    expect(d.apply).toBe(false);
  });

  it("counts one report per device per stop (the latest)", () => {
    const d = decideCorrection(STOP, null, [rep("a", 25, false, 1), rep("a", 26, false, 2), rep("a", 24, false, 3)]);
    expect(d.apply).toBe(false);
    if (!d.apply) expect(d.reports).toBe(1);
  });

  it("applies 3 independent reports that agree within AGREE_M when GPS has nothing to say", () => {
    const d = decideCorrection(STOP, null, [rep("a", 25), rep("b", 28), rep("c", 31)]);
    expect(d.apply).toBe(true);
    if (d.apply) {
      expect(d.basis).toBe("reports");
      expect(distM([d.lat, d.lon], at(28))).toBeLessThan(2);
    }
  });

  it("does not apply reports that spread over more than AGREE_M", () => {
    const d = decideCorrection(STOP, null, [rep("a", 10), rep("b", 10 + AGREE_M + 10), rep("c", 50)]);
    expect(d.apply).toBe(false);
  });

  it("finds an agreeing group of 3 among scattered reports (one troll does not block it)", () => {
    const d = decideCorrection(STOP, null, [rep("a", 25), rep("b", 27), rep("c", 29), rep("troll", -70)]);
    expect(d.apply).toBe(true);
  });

  it("finds a group of 3 that a greedy pruning misses", () => {
    // Metres north, east; (36,12) (32,26) (26,14)... at least one triple lies within AGREE_M pairwise.
    const pts = [[39, 3], [38, 28], [36, 12], [32, 26], [26, 14], [20, 9]];
    const rs = pts.map(([n, e], i) => { const [lat, lon] = offsetPoint([STOP.lat, STOP.lon], n, e); return { stop: STOP.id, lat, lon, device: `d${i}`, at: 1 }; });
    expect(decideCorrection(STOP, null, rs).apply).toBe(true);
  });

  it("finds a valid group among 40 scattered reports, quickly", () => {
    const rs: StopReport[] = [rep("x1", 50, true), rep("x2", 52, true), rep("x3", 54, true)];
    for (let i = 0; i < 40; i++) rs.push(rep(`s${i}`, ((i * 37) % 160) - 80, i % 2 === 0));   // spread over 160 m
    const t = performance.now();
    const d = decideCorrection(STOP, null, rs);
    expect(performance.now() - t).toBeLessThan(500);
    expect(d.apply).toBe(true);
  });

  it("stays fast with 45 reports that all agree, or many tied groups", () => {
    const all = Array.from({ length: 45 }, (_, i) => rep(`a${i}`, 30 + (i % 10)));
    const line = Array.from({ length: 45 }, (_, i) => rep(`l${i}`, -78 + i * 3.5));   // overlapping groups of 5
    for (const rs of [all, line]) {
      const t = performance.now();
      decideCorrection(STOP, null, rs);
      expect(performance.now() - t).toBeLessThan(500);
    }
  });

  it("drops reports that move the stop more than MAX_MOVE_M", () => {
    const d = decideCorrection(STOP, null, [rep("a", MAX_MOVE_M + 20), rep("b", MAX_MOVE_M + 22), rep("c", MAX_MOVE_M + 24)]);
    expect(d.apply).toBe(false);
    if (!d.apply) expect(d.reports).toBe(0);
  });

  it("refuses reports that a confident GPS measurement contradicts", () => {
    // Buses halt at the GTFS position; three people say 30 m north.
    const d = decideCorrection(STOP, gps(2, "high", false), [rep("a", 30), rep("b", 31), rep("c", 32)]);
    expect(d.apply).toBe(false);
    if (!d.apply) expect(d.reason).toMatch(/GPS/);
  });

  it("lets low-confidence GPS not block agreeing reports", () => {
    const d = decideCorrection(STOP, gps(2, "low", false), [rep("a", 30), rep("b", 31), rep("c", 32)]);
    expect(d.apply).toBe(true);
  });

  it("applies a confident GPS suspect on its own, at the halt point", () => {
    const d = decideCorrection(STOP, gps(35, "high", true), []);
    expect(d.apply).toBe(true);
    if (d.apply) {
      expect(d.basis).toBe("gps");
      expect(distM([d.lat, d.lon], at(35))).toBeLessThan(1);
    }
  });

  it("does not apply a medium-confidence GPS suspect without reports", () => {
    expect(decideCorrection(STOP, gps(35, "medium", true), []).apply).toBe(false);
  });

  it("with GPS support, places the stop where reports near the halt point put the pole", () => {
    const d = decideCorrection(STOP, gps(35, "high", true), [rep("a", 40)]);
    expect(d.apply).toBe(true);
    if (d.apply) {
      expect(d.basis).toBe("gps+reports");
      expect(distM([d.lat, d.lon], at(40))).toBeLessThan(1);
    }
  });

  it("refuses when GPS and an agreeing report group point to different places", () => {
    const d = decideCorrection(STOP, gps(35, "high", true), [rep("a", -30), rep("b", -31), rep("c", -32)]);
    expect(d.apply).toBe(false);
  });

  it("does not propose a move below MIN_MOVE_M", () => {
    expect(decideCorrection(STOP, null, [rep("a", 2), rep("b", 3), rep("c", 2)]).apply).toBe(false);
  });
});

describe("applyCorrections", () => {
  it("replaces the position of a corrected stop and leaves the rest", () => {
    const c = { "10183": { lat: 37.9385, lon: 23.6319, basis: "gps" as const, note: "" } };
    expect(applyCorrections("10183", 37.93843, 23.63188, c)).toEqual([37.9385, 23.6319]);
    expect(applyCorrections("999", 37.1, 23.2, c)).toEqual([37.1, 23.2]);
  });
});

describe("parseCsv", () => {
  it("reads quoted cells with commas, quotes and newlines (a Sheet export)", () => {
    expect(parseCsv('Ώρα,Κείμενο\n1/11,"a, ""b""\n#stopfix x"\n2/11,plain\n')).toEqual([["Ώρα", "Κείμενο"], ["1/11", 'a, "b"\n#stopfix x'], ["2/11", "plain"]]);
  });
});

describe("gpsFromAudit", () => {
  const row = { halt_lat: "37.9", halt_lon: "23.7", confidence: "high", suspect: "1", osm_check: "agrees" };
  it("lets only a suspect that OSM confirms move a stop on its own", () => {
    expect(gpsFromAudit(row)).toEqual({ lat: 37.9, lon: 23.7, confidence: "high", suspect: true });
  });
  it("makes an unconfirmed suspect (often a junction queue) unable to move a stop, but still able to contradict reports", () => {
    for (const osm_check of ["none", "other", "gtfs"]) expect(gpsFromAudit({ ...row, osm_check })).toEqual({ lat: 37.9, lon: 23.7, confidence: "medium", suspect: false });
  });
  it("keeps the confidence of a stop that is not suspect", () => {
    expect(gpsFromAudit({ ...row, suspect: "0", osm_check: "", confidence: "medium" })).toEqual({ lat: 37.9, lon: 23.7, confidence: "medium", suspect: false });
  });
  it("has nothing without a halt position", () => {
    expect(gpsFromAudit({ ...row, halt_lat: "" })).toBeNull();
  });
});

describe("browser storage", () => {
  it("survives a storage that throws on access", () => {
    const bad = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } } as unknown as Storage;
    expect(deviceId(bad)).toBe("anon");
    expect(reportedStops(bad)).toEqual([]);
    expect(() => markReported("1", bad)).not.toThrow();
  });
  it("survives a missing localStorage getter that throws", () => {
    const d = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("SecurityError"); } });
    try {
      expect(reportedStops()).toEqual([]);
      expect(deviceId()).toBe("anon");
      expect(() => markReported("1")).not.toThrow();
    } finally {
      if (d) Object.defineProperty(globalThis, "localStorage", d); else delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  });
  it("remembers the stops this device reported and keeps one device id", () => {
    const m = new Map<string, string>();
    const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } as unknown as Storage;
    const id = deviceId(st);
    expect(id).toMatch(/^[a-f0-9]{12}$/);
    expect(deviceId(st)).toBe(id);
    markReported("10183", st);
    expect(reportedStops(st)).toEqual(["10183"]);
  });
});
