import { describe, expect, it } from "vitest";
import { arriveOrder, athensAt, dayLabel, dayOf, quick, slots, wall, whenLabel } from "../src/lib/when";

// Saturday 7 November 2026, 20:33 in Athens (UTC+2).
const NOW = Date.UTC(2026, 10, 7, 18, 33) / 1000;

describe("when", () => {
  it("reads and makes Athens wall times, across days and the summer-time change", () => {
    expect(wall(NOW)).toMatchObject({ d: 7, min: 20 * 60 + 33, wd: 6 });
    expect(athensAt(NOW, 1, 9 * 60)).toBe(Date.UTC(2026, 10, 8, 7, 0) / 1000);
    // 28 March 2027 is summer time's first day (UTC+3): 09:00 there is 06:00 UTC.
    const mar = Date.UTC(2027, 2, 27, 10) / 1000;
    expect(athensAt(mar, 1, 9 * 60)).toBe(Date.UTC(2027, 2, 28, 6, 0) / 1000);
    expect(dayOf(NOW, athensAt(NOW, 2, 60))).toBe(2);
  });
  it("names the days and the choice", () => {
    expect(dayLabel(NOW, 0)).toBe("Σήμερα");
    expect(dayLabel(NOW, 1)).toBe("Αύριο");
    expect(dayLabel(NOW, 2)).toBe("Δευ 9");
    expect(whenLabel({ kind: "now" }, NOW)).toBe("Τώρα");
    expect(whenLabel({ kind: "leave", at: athensAt(NOW, 0, 21 * 60 + 30) }, NOW)).toBe("Φεύγω 21:30");
    expect(whenLabel({ kind: "arrive", at: athensAt(NOW, 1, 9 * 60), early: 5 }, NOW)).toBe("Φτάνω αύριο ως 09:00");
  });
  it("offers times from now to the planner's day end, 03:00", () => {
    const s = slots(NOW);
    expect(s[0]).toBe(20 * 60 + 35);
    expect(s.at(-1)).toBe(24 * 60 + 2 * 60 + 55);
    expect(quick(NOW)).toEqual([21 * 60, 21 * 60 + 30, 22 * 60, 22 * 60 + 30]);
    // At 01:30 the day is nearly over: up to 02:55.
    const late = Date.UTC(2026, 10, 7, 23, 30) / 1000;
    expect(slots(late)[0]).toBe(60 + 35);
    expect(slots(late).at(-1)).toBe(2 * 60 + 55);
    expect(whenLabel({ kind: "leave", at: athensAt(NOW, 0, 24 * 60 + 30) }, NOW)).toBe("Φεύγω αύριο 00:30");
  });
  it("puts first the route that leaves latest and still arrives in time", () => {
    const at = athensAt(NOW, 1, 9 * 60), t = (h: number, m: number) => athensAt(NOW, 1, h * 60 + m);
    const its = [
      { depart_at: t(8, 12), arrive_at: t(8, 49) },
      { depart_at: t(8, 21), arrive_at: t(8, 55) },
      { depart_at: t(8, 27), arrive_at: t(8, 58) },
      { depart_at: t(8, 35), arrive_at: t(9, 3) },
      { depart_at: t(6, 0), arrive_at: t(6, 40) },
    ];
    expect(arriveOrder(its, at, 5).map(f => [f.margin, f.tone])).toEqual([[5, "ok"], [2, "tight"], [11, "ok"], [-3, "late"]]);
  });
});
