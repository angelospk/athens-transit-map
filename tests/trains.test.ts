import { describe, expect, it } from "vitest";
import { byDestination, clockHM, destColor, stasyPlace, stopRows, trainsFC, type StasyVehicle, type SuburbanTrain } from "../src/lib/trains";
import type { Corridor } from "../src/lib/suburban";

const veh = (from: number, to: number, trip = "t1", line = "M2"): StasyVehicle => ({
  trip, line, route_color: "#e30613", headsign: "ΕΛΛΗΝΙΚΟ",
  from: { name: "ΣΥΝΤΑΓΜΑ", lat: 38, lon: 23, at: from }, to: { name: "ΑΚΡΟΠΟΛΗ", lat: 38.01, lon: 23.02, at: to },
});

describe("stasyPlace", () => {
  it("moves the train between its two stops on the clock", () => {
    const p = stasyPlace(veh(1000, 1100), 1050);
    expect(p.pos[0]).toBeCloseTo(23.01, 6);
    expect(p.pos[1]).toBeCloseTo(38.005, 6);
    expect(p.h).toBeGreaterThan(0);
    expect(p.h).toBeLessThan(90);   // north-east
  });
  it("waits at the stop it left before its time and at the next one after", () => {
    expect(stasyPlace(veh(1000, 1100), 900).pos).toEqual([23, 38]);
    expect(stasyPlace(veh(1000, 1100), 1200).pos).toEqual([23.02, 38.01]);
    expect(stasyPlace(veh(1000, 1000), 1000).pos).toEqual([23.02, 38.01]);
  });
  it("on the line's track when it has one: round a corner, not across it", () => {
    // from [23, 38] east to the corner [23.02, 38], then north to [23.02, 38.01] (the `to` stop).
    const track: [number, number][] = [[38, 23], [38, 23.02], [38.01, 23.02]];
    const p = stasyPlace(veh(1000, 1100), 1099, [track]);
    expect(p.pos[0]).toBeCloseTo(23.02, 4);   // on the north leg: the straight line would be west of it
    expect(p.h).toBeCloseTo(0, 0);
  });
  it("a train standing at a stop (both places that stop) stays there with no heading", () => {
    const v = veh(1000, 1040);
    v.to = { ...v.from, at: 1040 };
    expect(stasyPlace(v, 1020)).toEqual({ pos: [23, 38], h: null });
  });
});

const corridors: Record<string, Corridor> = {
  PIRAIR: { name: "Πειραιάς – Αεροδρόμιο", color: "#7E57C2", stations: [], path: [] },
};
const sub = (train: string, corridor: string, at: number, course: number | null = 90): SuburbanTrain => ({
  train, corridor, service: "Suburban", lat: 38.05, lon: 23.73, course, speed_kmh: 80, delay_min: 0,
  from: "Πειραιάς", to: "Αεροδρόμιο", next_station: "Κάτω Αχαρναί", position_at: at,
});

describe("trainsFC", () => {
  const nowS = 10_000;
  const fc = trainsFC({
    stasy: [veh(9950, 10_050)],
    suburban: [sub("1226", "PIRAIR", nowS - 20), sub("1228", "PIRAIR", nowS - 200, null), sub("1500", "LARISA", nowS),
      sub("1230", "PIRAIR", nowS - 700)],
    corridors, nowS, sel: { kind: "suburban", id: "1226" },
  });
  const props = fc.features.map(f => f.properties!);

  it("draws the metro trains in their line's colour and the suburban ones in their corridor's", () => {
    expect(props.map(p => [p.kind, p.id, p.color])).toEqual([
      ["metro", "t1", "#e30613"], ["suburban", "1226", "#7E57C2"], ["suburban", "1228", "#7E57C2"],
    ]);
    expect(fc.features[1].geometry).toEqual({ type: "Point", coordinates: [23.73, 38.05] });
  });
  it("leaves out trains of other corridors and GPS fixes over 10 minutes old; fades fixes over 90 s", () => {
    expect(props.map(p => p.stale)).toEqual([false, false, true]);
  });
  it("gives a heading only when it is known, and marks the tapped train", () => {
    expect(props.map(p => p.h ?? null)).toEqual([expect.any(Number), 90, null]);
    expect(props.map(p => p.sel)).toEqual([false, true, false]);
  });
});

describe("stopRows", () => {
  // 17:00 Athens (UTC+2 in winter) = 15:00 UTC.
  const base = Date.UTC(2026, 10, 2, 15, 0, 0) / 1000;
  const stops = [{ name: "Α", at: base - 300 }, { name: "Β", at: base + 60 }, { name: "Γ", at: base + 600, delay: 2 }];

  it("times in Athens, gone stops muted, the next one marked, the delay added", () => {
    expect(stopRows(stops, base)).toEqual([
      { name: "Α", t: "16:55", gone: true, next: false, delay: 0 },
      { name: "Β", t: "17:01", gone: false, next: true, delay: 0 },
      { name: "Γ", t: "17:12", gone: false, next: false, delay: 2 },
    ]);
  });
  it("a run delay applies to the stops without their own", () => {
    expect(stopRows(stops, base, 5).map(r => [r.t, r.delay, r.gone])).toEqual([["17:00", 5, false], ["17:06", 5, false], ["17:12", 2, false]]);
  });
  it("clockHM is Athens time", () => {
    expect(clockHM(base)).toBe("17:00");
  });
});

describe("byDestination", () => {
  const row = (to: string, inMin: number, delay: number | null = 0) => ({ t: "", expected: "", delay, to, platform: null, in: inMin });

  it("one row per destination, in the order of its first train, at most three times each", () => {
    const g = byDestination([row("Αεροδρόμιο", 4), row("Κιάτο", 9, 3), row("Αεροδρόμιο", 33), row("Αεροδρόμιο", 50), row("Αεροδρόμιο", 70)]);
    expect(g).toEqual([
      { to: "Αεροδρόμιο", times: [{ in: 4, delay: 0 }, { in: 33, delay: 0 }, { in: 50, delay: 0 }] },
      { to: "Κιάτο", times: [{ in: 9, delay: 3 }] },
    ]);
  });
});

describe("destColor", () => {
  const data = {
    corridors: { KIATO: { name: "", color: "#D9822B", stations: [], path: [] }, PIRAIR: { name: "", color: "#7E57C2", stations: [], path: [] } },
    stations: [
      { id: "p", name: "Πειραιάς", en: "", lat: 0, lon: 0, corridors: ["KIATO", "PIRAIR"] },
      { id: "x", name: "Αεροδρόμιο", en: "", lat: 0, lon: 0, corridors: ["PIRAIR"] },
    ],
  };
  it("the colour of the corridor the station shares with the destination, else the station's first", () => {
    expect(destColor(data, "p", "Αεροδρόμιο")).toBe("#7E57C2");
    expect(destColor(data, "p", " αεροδρόμιο ")).toBe("#7E57C2");
    expect(destColor(data, "p", "Λάρισα")).toBe("#D9822B");
  });
});
