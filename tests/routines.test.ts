import { describe, expect, it } from "vitest";
import { activeRoutine, athensNow, isRoutines, remindIn, type Routine } from "../src/lib/routines";

// Wednesday 2026-11-04, 07:30 in Athens (UTC+2).
const wed0730 = Date.UTC(2026, 10, 4, 5, 30);
const r = (over: Partial<Routine> = {}): Routine => ({
  id: "a", label: "Πρωί", on: true, stop: { id: "oasa:1", name: "Στάση", lat: 37.9, lon: 23.7 }, line: "oasa:224",
  days: [true, true, true, true, true, false, false], hour: 7, when: "leave", ...over,
});

describe("athensNow", () => {
  it("gives the Athens weekday (Monday 0), hour and day", () => {
    expect(athensNow(wed0730)).toEqual({ wd: 2, hour: 7, day: "2026-11-04" });
  });
});

describe("activeRoutine", () => {
  it("is in force on its days, from its hour for 3 hours, when on", () => {
    expect(activeRoutine([r()], wed0730)?.id).toBe("a");
    expect(activeRoutine([r({ hour: 8 })], wed0730)).toBeNull();
    expect(activeRoutine([r({ hour: 4 })], wed0730)).toBeNull();          // 04:00–07:00 is over
    expect(activeRoutine([r({ on: false })], wed0730)).toBeNull();
    expect(activeRoutine([r({ days: [true, true, false, true, true, false, false] })], wed0730)).toBeNull();
  });
});

describe("remindIn", () => {
  it("reminds at leave time, or a few minutes before the bus, and never for «only if something changes»", () => {
    expect(remindIn("leave", 12, 4)).toBe(480);
    expect(remindIn("before", 12, 4)).toBe(420);
    expect(remindIn("before", 3, 4)).toBe(0);
    expect(remindIn("change", 12, 4)).toBeNull();
  });
});

describe("isRoutines", () => {
  it("accepts well-formed routines only", () => {
    expect(isRoutines([r()])).toBe(true);
    expect(isRoutines([{ ...r(), days: [true] }])).toBe(false);
    expect(isRoutines("x")).toBe(false);
  });
});

describe("the bot's recurring alert for a routine", () => {
  it("has the days as bits from Monday, its hour and a 3-hour window", async () => {
    const { routineRep } = await import("../src/lib/routines");
    expect(routineRep(r())).toEqual({ days: 31, start: 420, len: 180 });
  });
  it("writes about as many stops before as the walk, or 5′, and none for «only if something changes»", async () => {
    const { routineStops } = await import("../src/lib/routines");
    expect(routineStops("leave", 5, 7)).toBe(4);
    expect(routineStops("leave", 20, 7)).toBe(7);
    expect(routineStops("before", 5, 7)).toBe(3);
    expect(routineStops("change", 5, 7)).toBeNull();
  });
});
