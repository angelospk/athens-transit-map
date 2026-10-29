import { describe, expect, it } from "vitest";
import { byDestination, clockHM, destColor, lineTrains, stasyPlace, stopRows, trainsFC, type StasyVehicle, type SuburbanTrain } from "../src/lib/trains";
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
  const row = (to: string, inMin: number, delay: number | null = 0, live = false) => ({ t: "", expected: "", delay, to, platform: null, in: inMin, live });

  it("one row per destination, in the order of its first train, at most three times each", () => {
    const g = byDestination([row("Αεροδρόμιο", 4, 0, true), row("Κιάτο", 9, 3, true), row("Αεροδρόμιο", 33), row("Αεροδρόμιο", 50), row("Αεροδρόμιο", 70)]);
    expect(g).toEqual([
      { to: "Αεροδρόμιο", times: [{ in: 4, delay: 0, live: true }, { in: 33, delay: 0, live: false }, { in: 50, delay: 0, live: false }] },
      { to: "Κιάτο", times: [{ in: 9, delay: 3, live: true }] },
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

describe("lineTrains", () => {
  const place = (name: string, at: number) => ({ name, lat: 37.98, lon: 23.7, at });
  const v = (trip: string, line: string, headsign: string, next: string, at: number) =>
    ({ trip, line, route_color: "#0a0", headsign, from: place("Α", at - 60), to: place(next, at) });
  it("lists a metro line's trains by destination, soonest first", () => {
    const r = lineTrains({ kind: "metro", id: "M2" },
      [v("a", "M2", "ΕΛΛΗΝΙΚΟ", "ΣΥΝΤΑΓΜΑ", 200), v("b", "M1", "ΚΗΦΙΣΙΑ", "ΟΜΟΝΟΙΑ", 50), v("c", "M2", "ΑΝΘΟΥΠΟΛΗ", "ΟΜΟΝΟΙΑ", 100), v("d", "M2", "ΕΛΛΗΝΙΚΟ", "ΑΚΡΟΠΟΛΗ", 150)], [], 90);
    expect(r.map(t => t.sel.id)).toEqual(["c", "d", "a"]);
    expect(r[0]).toMatchObject({ sel: { kind: "metro", id: "c" }, to: "ΑΝΘΟΥΠΟΛΗ", next: "ΟΜΟΝΟΙΑ", at: 100, delay: null });
  });
  it("lists a suburban corridor's trains, without ones whose fix is too old", () => {
    const t = (train: string, corridor: string, position_at: number) => ({ train, corridor, service: "", lat: 38, lon: 23.7, course: null,
      speed_kmh: 50, delay_min: 3, from: "Π", to: "ΑΕΡΟΔΡΟΜΙΟ", next_station: "ΝΕΡΑΤΖΙΩΤΙΣΣΑ", position_at });
    const r = lineTrains({ kind: "suburban", id: "c1" }, [], [t("1", "c1", 1000), t("2", "c2", 1000), t("3", "c1", 0)], 1000);
    expect(r).toEqual([{ sel: { kind: "suburban", id: "1" }, to: "ΑΕΡΟΔΡΟΜΙΟ", next: "ΝΕΡΑΤΖΙΩΤΙΣΣΑ", at: null, delay: 3, pos: [23.7, 38] }]);
  });
});
