import { describe, expect, it } from "vitest";
import { athensClock, matchDirection, scheduleUrl, timetableView, type ScheduleDirection } from "../src/lib/timetable";

const dir = (headsign: string, deps: [string, boolean?][], direction = 0): ScheduleDirection =>
  ({ direction, headsign, departures: deps.map(([t, seen]) => (seen === undefined ? { t, trip: "" } : { t, trip: "", seen })) });

describe("scheduleUrl", () => {
  it("percent-encodes Greek line ids", () => {
    expect(scheduleUrl("Α1")).toBe("https://transit.haroldpoi.dev/v1/lines/%CE%911/schedule");
  });
});

describe("matchDirection", () => {
  const dirs = [dir("ΣΥΝΤΑΓΜΑ", []), dir("ΠΕΙΡΑΙΑΣ", [], 1)];
  it("matches the end of the variant's headsign, brackets and accents left out", () => {
    expect(matchDirection(dirs, "ΠΕΙΡΑΙΑΣ - ΣΥΝΤΑΓΜΑ(ΠΡΟΣΩΡΙΝΗ ΛΟΓΩ ΕΡΓΩΝ)")).toBe(dirs[0]);
    expect(matchDirection(dirs, "ΣΥΝΤΑΓΜΑ - ΠΕΙΡΑΙΑΣ (22:00-06:00) (ΠΡΟΣΩΡΙΝΗ ΛΟΓΩ ΕΡΓΩΝ)")).toBe(dirs[1]);
    expect(matchDirection([dir("Πειραιάς", [])], "ΣΥΝΤΑΓΜΑ - ΠΕΙΡΑΙΑΣ")).not.toBeNull();
  });
  it("one name inside the other counts", () => {
    expect(matchDirection([dir("ΚΗΦΙΣΙΑ", [])], "ΑΘΗΝΑ - ΚΗΦΙΣΙΑ ΠΛΑΤΕΙΑ")?.headsign).toBe("ΚΗΦΙΣΙΑ");
  });
  it("spaces do not count", () => {
    expect(matchDirection([dir("Ν. ΚΗΦΙΣΙΑ", []), dir("ΧΑΛΚΟΚΟΝΔΥΛΗ", [], 1)], "ΧΑΛΚΟΚΟΝΔΥΛΗ - ΜΕΤΑΜΟΡΦΩΣΗ - Ν.  ΚΗΦΙΣΙΑ")?.headsign).toBe("Ν. ΚΗΦΙΣΙΑ");
    expect(matchDirection([dir("Ν. ΣΜΥΡΝΗ (ΚΥΚΛΙΚΗ)", []), dir("ΠΕΙΡΑΙΑΣ", [], 1)], "ΠΕΙΡΑΙΑΣ - Ν.ΣΜΥΡΝΗ (ΠΡΟΣΩΡΙΝΗ ΛΟΓΩ ΕΡΓΩΝ)")?.headsign).toBe("Ν. ΣΜΥΡΝΗ (ΚΥΚΛΙΚΗ)");
  });
  it("a dash without spaces splits the places too", () => {
    expect(matchDirection([dir("ΖΩΦΡΙΑ", []), dir("ΣΤ. ΑΤΤΙΚΗ", [], 1)], "ΣΤ. ΑΤΤΙΚΗ-ΖΩΦΡΙΑ")?.headsign).toBe("ΖΩΦΡΙΑ");
  });
  it("a timetable of one direction (circular line) is every variant's", () => {
    const one = [dir("Ν. ΚΥΨΕΛΗ (ΚΥΚΛΙΚΗ)", [])];
    expect(matchDirection(one, "ΑΚΑΔΗΜΙΑ - ΝΕΑ ΚΥΨΕΛΗ")).toBe(one[0]);
  });
  it("the exact destination wins over one that contains it", () => {
    const two = [dir("ΚΗΦΙΣΙΑ", []), dir("Ν. ΚΗΦΙΣΙΑ", [], 1)];
    expect(matchDirection(two, "ΠΕΙΡΑΙΑΣ - Ν. ΚΗΦΙΣΙΑ")?.headsign).toBe("Ν. ΚΗΦΙΣΙΑ");
    expect(matchDirection(two, "ΠΕΙΡΑΙΑΣ - ΚΗΦΙΣΙΑ")?.headsign).toBe("ΚΗΦΙΣΙΑ");
    expect(matchDirection([dir("Ν. ΚΗΦΙΣΙΑ", []), dir("ΚΑΤΩ ΚΗΦΙΣΙΑ", [], 1)], "ΠΕΙΡΑΙΑΣ - ΚΗΦΙΣΙΑ")).toBeNull();   // two partial: unsure
  });
  it("no match: null", () => {
    expect(matchDirection(dirs, "ΑΘΗΝΑ - ΓΛΥΦΑΔΑ")).toBeNull();
    expect(matchDirection(dirs, "")).toBeNull();
  });
});

describe("athensClock", () => {
  it("minutes since Athens midnight of the timetable's day", () => {
    expect(athensClock(Date.UTC(2026, 9, 28, 13, 25), "2026-10-28")).toBe(15 * 60 + 25);   // EET, UTC+2
    expect(athensClock(Date.UTC(2026, 6, 1, 21, 5), "2026-07-02")).toBe(5);                 // EEST, UTC+3
  });
  it("past midnight, yesterday's timetable counts on (24:10 style) until it is asked again", () => {
    expect(athensClock(Date.UTC(2026, 9, 28, 22, 10), "2026-10-28")).toBe(24 * 60 + 10);
  });
});

describe("timetableView", () => {
  it("marks runs gone, missed (seen: false) and the next three; counts the runs seen", () => {
    const v = timetableView(dir("ΣΥΝΤΑΓΜΑ", [["14:00", true], ["14:20", false], ["14:40"], ["15:00"], ["15:20"], ["15:40"], ["16:00"]]), 14 * 60 + 50);
    expect(v.items.map(i => `${i.t} ${i.state}`)).toEqual([
      "14:00 gone", "14:20 missed", "14:40 gone", "15:00 next", "15:20 next", "15:40 next", "16:00 later",
    ]);
    expect([v.seen, v.known]).toEqual([1, 2]);
  });
  it("a run at the current minute is next", () => {
    expect(timetableView(dir("Χ", [["15:00"]]), 15 * 60).items[0].state).toBe("next");
  });
  it("shows times past midnight as clock times", () => {
    const v = timetableView(dir("Χ", [["23:50"], ["24:10"], ["25:05"]]), 23 * 60);
    expect(v.items.map(i => i.t)).toEqual(["23:50", "00:10", "01:05"]);
    expect(v.items.map(i => i.state)).toEqual(["next", "next", "next"]);
  });
  it("a run with a seen flag is gone, even an hour ahead on the night clocks go back", () => {
    const v = timetableView(dir("Χ", [["03:30", true], ["03:45", false], ["04:00"]]), 3 * 60 + 10);
    expect(v.items.map(i => i.state)).toEqual(["gone", "missed", "next"]);
  });
  it("a run not yet known stays unmarked even if seen is missing", () => {
    const v = timetableView(dir("Χ", [["10:00"], ["10:30"]]), 12 * 60);
    expect(v.items.map(i => i.state)).toEqual(["gone", "gone"]);
    expect([v.seen, v.known]).toEqual([0, 0]);
  });
});
