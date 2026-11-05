import { describe, expect, it } from "vitest";
import { muniCards, routeLabel, simulate, stitch, todayRuns } from "../src/lib/muniLine";
import { parseTimetable, athensClock, type MuniTimetable } from "../src/lib/muniTimes";
import type { MunicipalData, MunicipalRoute } from "../src/lib/municipal";

// 2026-11-05 is a Thursday. 12:00 UTC is 14:00 in Athens (EET, UTC+2).
const at = (h: number, m: number, s = 0) => Date.UTC(2026, 10, 5, h - 2, m, s);

const route = (id: string, ref: string | null, name: string, m = "Δήμος Χ", shape: [number, number][][] = [[[38, 23], [38, 23.01]]],
  stops: string[] = []): MunicipalRoute => ({ id, ref, name, municipality: m, timetable_url: null, shape, stops });

const table = (lines: unknown[], municipality = "Δήμος Χ"): MuniTimetable => parseTimetable({
  municipality, checked: "2026-11-05", valid: "2025-26", source: "https://x.gr/t",
  watch: [{ url: "https://x.gr/t", kind: "times", sha256: "a".repeat(64) }], lines,
})!;

describe("muniCards", () => {
  const data: MunicipalData = { attribution: "", stops: {}, routes: [
    route("osm:r2", "010", "Δημοτικό Λεωφορείο 010: ΗΣΑΠ → Φιλοθέη"),
    route("osm:r1", "010", "Δημοτικό Λεωφορείο 010: Φιλοθέη → ΗΣΑΠ"),
    route("osm:r3", null, "Άνω Γραμμή από Μετρό προς Σμύρνη"),
    route("osm:r4", null, "Άνω Γραμμή από Σμύρνη προς Μετρό"),
    route("osm:r5", "Β1", "Δημοτικό Λεωφορείο Β1: Πολύδροσο → Κοιμητήριο"),
    route("osm:r6", "Β1", "Γραμμή Β1", "Δήμος Ψ"),   // the same ref in another municipality: another line
    route("osm:r7", null, "Δημοτικό Λεωφορείο: Κηφισίας → Νεραντζιώτισσα"),
  ] };
  const t = table([
    { routes: ["osm:r2"], ref: "010", name: "ΗΣΑΠ → Αγία Φιλοθέη", services: [{ days: [4], at: "ΗΣΑΠ", times: ["08:00"] }] },
    { routes: ["osm:r1"], ref: "010", name: "Αγία Φιλοθέη → ΗΣΑΠ", services: [{ days: [4], at: "Αγ. Γεωργίου", times: ["07:30"] }] },
    { routes: ["osm:r3"], group: "Άνω Γραμμή", name: "Μετρό → Νέα Σμύρνη", services: [{ days: [4], times: ["07:45"] }] },
    { routes: ["osm:r4"], group: "Άνω Γραμμή", name: "Νέα Σμύρνη → Μετρό", services: [{ days: [4], times: ["07:15"] }] },
  ]);
  const cards = muniCards(data, [t]);
  const of = (rid: string) => cards.find(c => c.routes.some(r => r.id === rid))!;

  it("puts the two directions of a line in one card: by ref, or by the timetable's group", () => {
    expect(of("osm:r1")).toBe(of("osm:r2"));
    expect(of("osm:r3")).toBe(of("osm:r4"));
    expect(of("osm:r5")).not.toBe(of("osm:r6"));
    expect(cards).toHaveLength(5);
  });
  it("names a card by its smallest OSM id, and orders its routes as the timetable lists them", () => {
    expect(of("osm:r2").id).toBe("muni:r1");
    expect(of("osm:r2").routes.map(r => r.id)).toEqual(["osm:r2", "osm:r1"]);
    expect(of("osm:r2").lines.map(l => l.name)).toEqual(["ΗΣΑΠ → Αγία Φιλοθέη", "Αγία Φιλοθέη → ΗΣΑΠ"]);
    expect(of("osm:r2").table).toBe(t);
    expect(of("osm:r5").table).toBeNull();
  });
  it("titles a card: the group, else one line's name, else both ends of two, else the OSM name without its prefix", () => {
    expect(of("osm:r3")).toMatchObject({ ref: null, name: "Άνω Γραμμή" });
    expect(of("osm:r1")).toMatchObject({ ref: "010", name: "ΗΣΑΠ ↔ Αγία Φιλοθέη" });
    expect(of("osm:r5")).toMatchObject({ ref: "Β1", name: "Πολύδροσο → Κοιμητήριο", municipality: "Δήμος Χ" });
    expect(of("osm:r7").name).toBe("Κηφισίας → Νεραντζιώτισσα");
  });
});

describe("routeLabel", () => {
  const t = table([
    { routes: ["osm:r1"], ref: "010", name: "ΗΣΑΠ → Παράδεισος → Πολύδροσο", services: [{ days: [4], times: ["08:00"] }] },
    { routes: ["osm:r2", "osm:r3"], ref: "Β", name: "Γήπεδο – Μετρό", services: [{ days: [4], times: ["08:00"] }] },
  ]);
  it("says where a direction goes: the end of its own timetable line, else the OSM name", () => {
    expect(routeLabel(route("osm:r1", "010", "x"), t.lines)).toBe("Πολύδροσο");
    expect(routeLabel(route("osm:r2", "Β", "Γραμμή Β"), t.lines)).toBe("Γραμμή Β");
    expect(routeLabel(route("osm:r3", "Β", "Γραμμή Β (Δευτέρα λόγω Λαϊκής)"), t.lines)).toBe("Γραμμή Β (Δευτέρα λόγω Λαϊκής)");
    expect(routeLabel(route("osm:r9", "1", "Δημοτικό Λεωφορείο 1: Περισσός → Κέντρο"), [])).toBe("Κέντρο");
  });
});

describe("todayRuns", () => {
  const t = table([
    { routes: ["osm:r1"], name: "Α", services: [
      { days: [4], at: "Πλατεία", times: ["07:30", "14:00", "16:00"] },
      { days: [4], at: "Μετρό", times: ["08:00"] },
      { days: [6], at: "Πλατεία", times: ["10:00"] },
    ] },
    { routes: ["osm:r2"], name: "Β", services: [{ days: [4], every: 60, first: "13:00", last: "15:00" }] },
  ]);
  it("lists all of today's runs of a direction, in time order, the past ones marked", () => {
    expect(todayRuns(t.lines, "osm:r1", athensClock(at(14, 0)))).toEqual([
      { time: "07:30", at: "Πλατεία", approx: false, past: true },
      { time: "08:00", at: "Μετρό", approx: false, past: true },
      { time: "14:00", at: "Πλατεία", approx: false, past: false },
      { time: "16:00", at: "Πλατεία", approx: false, past: false },
    ]);
    expect(todayRuns(t.lines, "osm:r2", athensClock(at(14, 1))).map(r => [r.time, r.approx, r.past]))
      .toEqual([["13:00", true, true], ["14:00", true, true], ["15:00", true, false]]);
    expect(todayRuns(t.lines, "osm:r9", athensClock(at(14, 0)))).toEqual([]);
  });
});

describe("stitch", () => {
  it("joins the pieces of an OSM shape into one path, turning a piece round where it fits backwards", () => {
    const a: [number, number][] = [[0, 0], [0, 1]], b: [number, number][] = [[0, 2], [0, 1]], c: [number, number][] = [[0, 3], [0, 2]];
    expect(stitch([a, c, b])).toEqual([[0, 0], [0, 1], [0, 2], [0, 3]]);
    const mid = stitch([b, a, c]);   // the first piece in the middle: either way round, no jumps
    expect([mid, [...mid].reverse()]).toContainEqual([[0, 0], [0, 1], [0, 2], [0, 3]]);
    expect(stitch([a])).toEqual(a);
    expect(stitch([])).toEqual([]);
  });
});

describe("simulate", () => {
  // 1.5 km due east (at 38° N, 0.01° of longitude is ~0.876 km): ~1.75 km, so at 15 km/h about 7 min.
  const east = route("osm:r1", "1", "x", "Δήμος Χ", [[[38, 23], [38, 23.02]]], ["s1", "s2"]);
  const stops = { s1: { name: "Πλατεία", lat: 38, lon: 23 }, s2: { name: "Μετρό Δάφνης", lat: 38, lon: 23.01 } };
  const lines = table([{ routes: ["osm:r1"], name: "Α", services: [
    { days: [4], at: "Πλατεία", times: ["14:00"] },
    { days: [4], at: "Μετρό", times: ["14:00"] },          // leaves halfway, at the stop named like it
  ] }]).lines;

  it("puts a bus that left at 14:00 along the path, by an assumed speed, and only while it runs", () => {
    const v = simulate(east, stops, lines, at(14, 3), 15);
    expect(v).toHaveLength(2);
    const fromStart = v.find(x => x.at === "Πλατεία")!;
    expect(fromStart.dep).toBe("14:00");
    expect(fromStart.lat).toBeCloseTo(38, 6);
    expect(fromStart.lon).toBeCloseTo(23 + 0.75 / 87.6 * 1, 3);   // 3 min at 15 km/h = 0.75 km
    expect(fromStart.bearing).toBeCloseTo(90, 0);
    const fromMid = v.find(x => x.at === "Μετρό")!;
    expect(fromMid.lon).toBeCloseTo(23.01 + 0.75 / 87.6, 3);
    expect(simulate(east, stops, lines, at(13, 59), 15)).toEqual([]);
    expect(simulate(east, stops, lines, at(14, 4), 15).map(x => x.at)).toEqual(["Πλατεία"]);   // the halfway one arrived
    expect(simulate(east, stops, lines, at(14, 8), 15)).toEqual([]);
  });
  it("gives each simulated bus a stable id, from its route, stop and time", () => {
    const [a] = simulate(east, stops, lines, at(14, 1), 15), [b] = simulate(east, stops, lines, at(14, 2), 15);
    expect(a.id).toBe(b.id);
    expect(a.id).toContain("osm:r1");
  });
  it("goes round a circular route (its ends meet) past its start", () => {
    const loop = route("osm:r2", "1", "x", "Δήμος Χ", [[[38, 23], [38, 23.01], [38.001, 23.005], [38, 23]]]);
    const l = table([{ routes: ["osm:r2"], name: "Κ", services: [{ days: [4], at: "Μετρό", times: ["14:00"] }] }]).lines;
    const st = { m: { name: "Μετρό Δάφνης", lat: 38, lon: 23.01 } };
    // ~1.78 km round; it leaves from the second corner (0.88 km in): 4 min later (1 km) it is past the end, near the
    // first corner again, still running; after a full round it has arrived
    const [v] = simulate({ ...loop, stops: ["m"] }, st, l, at(14, 4), 15);
    expect(v.lat).toBeCloseTo(38, 3);
    expect(v.lon).toBeGreaterThan(23);
    expect(v.lon).toBeLessThan(23.002);
    expect(simulate({ ...loop, stops: ["m"] }, st, l, at(14, 8), 15)).toEqual([]);
  });
  it("starts a bus at a terminus it cannot find among the stops only when it is the line's one terminus", () => {
    const one = table([{ routes: ["osm:r1"], name: "Α", services: [{ days: [4], at: "Βεργίνας", times: ["14:00"] }] }]).lines;
    const two = table([{ routes: ["osm:r1"], name: "Α", services: [
      { days: [4], at: "Βεργίνας", times: ["14:00"] },
      { days: [4], at: "Ηλιούπολη", times: ["14:00"] },   // neither is a stop name: where each starts is unknown
    ] }]).lines;
    expect(simulate(east, stops, one, at(14, 3), 15).map(x => x.at)).toEqual(["Βεργίνας"]);
    expect(simulate(east, stops, two, at(14, 3), 15)).toEqual([]);
    expect(simulate({ ...east, stops: [] }, stops, one, at(14, 3), 15)).toEqual([]);   // no stops: no known way round
  });
  it("with one known stop, runs an open path away from the stop a service leaves from", () => {
    const back = { ...east, shape: [[[38, 23.02], [38, 23]]] as [number, number][][], stops: ["s1"] };
    const one = table([{ routes: ["osm:r1"], name: "Α", services: [{ days: [4], at: "Πλατεία", times: ["14:00"] }] }]).lines;
    const [v] = simulate(back, stops, one, at(14, 3), 15);
    expect(v?.lon).toBeCloseTo(23 + 0.75 / 87.6, 3);
  });
  it("runs the path the way the route's stops go, whichever way OSM drew it", () => {
    const back = { ...east, shape: [[[38, 23.02], [38, 23]]] as [number, number][][] };   // drawn west, stops go east
    const [v] = simulate(back, stops, lines, at(14, 3), 15).filter(x => x.at === "Πλατεία");
    expect(v.lon).toBeCloseTo(23 + 0.75 / 87.6, 3);
    expect(v.bearing).toBeCloseTo(90, 0);
  });
  it("leaves nothing to show with no path, and none on another day", () => {
    expect(simulate({ ...east, shape: [] }, stops, lines, at(14, 3), 15)).toEqual([]);
    expect(simulate(east, stops, lines, Date.UTC(2026, 10, 6, 12, 3), 15)).toEqual([]);   // a Friday
  });
});
