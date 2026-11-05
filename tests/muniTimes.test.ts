import { describe, expect, it } from "vitest";
import { activeServices, athensClock, lineFor, nextDepartures, parseTimetable, reportText, timesSignature, type MuniTimetable } from "../src/lib/muniTimes";

// 2026-11-05 is a Thursday. 12:00 UTC is 14:00 in Athens (EET, UTC+2).
const THU_14 = Date.UTC(2026, 10, 5, 12, 0);
const SAT_9 = Date.UTC(2026, 10, 7, 7, 0);
const SUN_9 = Date.UTC(2026, 10, 8, 7, 0);
const JUL_THU_9 = Date.UTC(2026, 6, 2, 6, 0);   // EEST, UTC+3: 09:00 in Athens

const raw = {
  municipality: "Δήμος Χαλανδρίου",
  checked: "2026-11-05",
  valid: "Χειμερινό 2025-26",
  source: "https://www.chalandri.gr/yphresies/ypodomes-erga/dimotiki-sygkoinonia/",
  watch: [{ url: "https://www.chalandri.gr/yphresies/ypodomes-erga/dimotiki-sygkoinonia/", kind: "times", sha256: "ab" }],
  lines: [
    { routes: ["osm:r1", "osm:r2"], ref: "Β1", name: "Πολύδροσο → Κοιμητήριο", services: [
      { days: [1, 2, 3, 4, 5], season: { from: "09-15", to: "06-14" }, at: "Πολύδροσο", times: ["07:30", "09:00", "13:45", "14:00", "18:15"] },
      { days: [1, 2, 3, 4, 5], season: { from: "06-15", to: "09-14" }, label: "Θερινό", at: "Πολύδροσο", times: ["08:00", "12:00"] },
      { days: [6], at: "Πολύδροσο", times: ["10:00"] },
    ] },
    { routes: ["osm:r3"], ref: "Ι", name: "Κυκλική", services: [
      { days: [1, 2, 3, 4, 5, 6], every: 30, first: "08:00", last: "13:00" },
    ] },
  ],
};

describe("parseTimetable", () => {
  it("keeps a well-formed file", () => {
    const t = parseTimetable(raw);
    expect(t?.lines).toHaveLength(2);
    expect(t?.lines[0].services[0].at).toBe("Πολύδροσο");
  });
  it("rejects bad times, days or an empty line, so a typo never shows a wrong time", () => {
    const withLine = (services: unknown[]) => ({ ...raw, lines: [{ ...raw.lines[0], services }] });
    expect(parseTimetable(withLine([{ days: [1], times: ["7:30"] }]))).toBeNull();          // not HH:MM
    expect(parseTimetable(withLine([{ days: [1], times: ["24:10"] }]))).toBeNull();
    expect(parseTimetable(withLine([{ days: [1], times: ["09:00", "08:00"] }]))).toBeNull(); // not in order
    expect(parseTimetable(withLine([{ days: [8], times: ["09:00"] }]))).toBeNull();
    expect(parseTimetable(withLine([{ days: [], times: ["09:00"] }]))).toBeNull();
    expect(parseTimetable(withLine([{ days: [1], every: 0, first: "08:00", last: "09:00" }]))).toBeNull();
    expect(parseTimetable(withLine([{ days: [1], every: 30, first: "10:00", last: "09:00" }]))).toBeNull();
    expect(parseTimetable(withLine([{ days: [1], season: { from: "9-15", to: "06-14" }, times: ["09:00"] }]))).toBeNull();
    expect(parseTimetable(withLine([]))).toBeNull();
    expect(parseTimetable({ ...raw, checked: "5/11/2026" })).toBeNull();
    expect(parseTimetable(null)).toBeNull();
  });
});

describe("athensClock", () => {
  it("gives Athens date, weekday and minutes, in winter and in summer time", () => {
    expect(athensClock(THU_14)).toEqual({ date: "2026-11-05", md: "11-05", weekday: 4, minutes: 14 * 60 });
    expect(athensClock(SUN_9).weekday).toBe(7);
    expect(athensClock(JUL_THU_9)).toMatchObject({ md: "07-02", weekday: 4, minutes: 9 * 60 });
  });
});

describe("activeServices and nextDepartures", () => {
  const t = parseTimetable(raw)!;
  const b1 = t.lines[0], circ = t.lines[1];
  it("picks the services of the day and the season, a season wrapping the new year included", () => {
    expect(activeServices(b1, athensClock(THU_14)).map(s => s.times?.[0])).toEqual(["07:30"]);
    expect(activeServices(b1, athensClock(JUL_THU_9)).map(s => s.label)).toEqual(["Θερινό"]);
    expect(activeServices(b1, athensClock(SAT_9)).map(s => s.times?.[0])).toEqual(["10:00"]);
    expect(activeServices(b1, athensClock(SUN_9))).toEqual([]);
  });
  it("lists the next departures from now, with the stop they are timed at", () => {
    expect(nextDepartures(b1, athensClock(THU_14), 3)).toEqual([
      { time: "14:00", at: "Πολύδροσο", approx: false },
      { time: "18:15", at: "Πολύδροσο", approx: false },
    ]);
    expect(nextDepartures(b1, athensClock(SUN_9), 3)).toEqual([]);
  });
  it("spells out a frequency as approximate times", () => {
    const sat = nextDepartures(circ, athensClock(SAT_9), 3);
    expect(sat).toEqual([
      { time: "09:00", at: null, approx: true },
      { time: "09:30", at: null, approx: true },
      { time: "10:00", at: null, approx: true },
    ]);
    expect(nextDepartures(circ, athensClock(THU_14), 3)).toEqual([]);   // last at 13:00
  });
});

describe("lineFor", () => {
  it("finds the timetable line of an OSM route, or null", () => {
    const t = parseTimetable(raw)!;
    expect(lineFor([t], "osm:r2")?.line.ref).toBe("Β1");
    expect(lineFor([t], "osm:r9")).toBeNull();
  });
});

describe("reportText", () => {
  it("names the municipality, line, stop, the times shown and when, for a person to check", () => {
    const t = parseTimetable(raw)!;
    const s = reportText({ table: t, line: t.lines[0], stop: "Πλατεία", shown: ["14:00", "18:15"], clock: athensClock(THU_14), kind: "Δεν πέρασε", text: "Περίμενα 20′." });
    expect(s).toContain("[Δημοτικά]");
    expect(s).toContain("Δήμος Χαλανδρίου");
    expect(s).toContain("Β1");
    expect(s).toContain("Πλατεία");
    expect(s).toContain("14:00, 18:15");
    expect(s).toContain("2026-11-05 14:00");
    expect(s).toContain("ελέγχθηκε 2026-11-05");
    expect(s).toContain("Δεν πέρασε");
    expect(s).toContain("Περίμενα 20′.");
  });
});

describe("timesSignature", () => {
  it("keeps only the times on a page, normalised, so a new notice does not count as a change", () => {
    const a = timesSignature("<p>Αναχωρήσεις 7.30, 9:00 και 13:45</p><p>Ανακοίνωση 5/11/2026</p>");
    const b = timesSignature("<div>Νέα ανακοίνωση!</div><p>Αναχωρήσεις 07:30 · 09.00 · 13.45</p>");
    expect(a).toBe("07:30,09:00,13:45");
    expect(b).toBe(a);
    expect(timesSignature("Αναχωρήσεις 7.30, 9:15")).not.toBe(a);
    expect(timesSignature("τηλ. 210.6800 · 25.12 · 99:99")).toBe("");   // not times of day
  });
});
