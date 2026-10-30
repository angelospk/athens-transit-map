import { describe, expect, it } from "vitest";
import { ageLabel, ageModeOf, ago, isGonePos, isStalePos, delayClass, delayText, duration, fmtDelay, passes } from "../src/lib/format";

describe("duration", () => {
  it("is short: seconds, then minutes and two-digit seconds (B10)", () => {
    expect(duration(144)).toBe("2′24″");
    expect(duration(1)).toBe("1″");
    expect(duration(60)).toBe("1′00″");
    expect(duration(0)).toBe("0″");
    expect(duration(-61)).toBe("1′01″");
    expect(duration(307)).toBe("5′07″");
    expect(duration(3725)).toBe("62′05″");
  });
});

describe("fmtDelay", () => {
  it("is signed and short: whole minutes from one minute, seconds under it", () => {
    expect(fmtDelay(0)).toBe("στην ώρα του");
    expect(fmtDelay(20)).toBe("στην ώρα του");
    expect(fmtDelay(-29)).toBe("στην ώρα του");
    expect(fmtDelay(45)).toBe("+45″");
    expect(fmtDelay(-12 - 30)).toBe("−42″");
    expect(fmtDelay(140)).toBe("+2′");
    expect(fmtDelay(170)).toBe("+3′");
    expect(fmtDelay(-90)).toBe("−2′");
    expect(delayText(null)).toBe("χωρίς δρομολόγιο");
  });
});

describe("delayClass", () => {
  it("uses the upstream buckets", () => {
    expect(delayClass(null)).toBe("none");
    expect(delayClass(-300)).toBe("ontime");
    expect(delayClass(120)).toBe("ontime");
    expect(delayClass(121)).toBe("late1");
    expect(delayClass(300)).toBe("late1");
    expect(delayClass(301)).toBe("late2");
    expect(delayClass(600)).toBe("late2");
    expect(delayClass(601)).toBe("late3");
  });
});

describe("ago", () => {
  it("counts seconds since a unix time and clamps skew to 0", () => {
    expect(ago(1000, 1_024_000)).toBe("πριν 24″");
    expect(ago(1030, 1_024_000)).toBe("πριν 0″");
  });
});

describe("delayText", () => {
  it("says the vehicle is unmatched when there is no delay", () => {
    expect(delayText(null)).toBe("χωρίς δρομολόγιο");
    expect(delayText(0)).toBe("στην ώρα του");
    expect(delayText(144)).toBe("+2′");
  });
});

describe("ageLabel", () => {
  it("is short: seconds under a minute, then minutes", () => {
    expect(ageLabel(0)).toBe("0″");
    expect(ageLabel(24.6)).toBe("24″");
    expect(ageLabel(59.9)).toBe("59″");
    expect(ageLabel(60)).toBe("1′");
    expect(ageLabel(150)).toBe("2′");
    expect(ageLabel(-5)).toBe("0″");
    expect(ageLabel(59.999)).toBe("59″");
    expect(isStalePos(90)).toBe(false);
    expect(isStalePos(90.5)).toBe(true);
  });
});

describe("passes", () => {
  const all = { fresh: false, onTime: false };
  it("shows everything without filters", () => {
    expect(passes(all, "late3", 300)).toBe(true);
    expect(passes(all, "none", 0)).toBe(true);
  });
  it("only fresh: hides the positions drawn as stale", () => {
    const f = { ...all, fresh: true };
    expect(passes(f, "ontime", 90)).toBe(true);
    expect(passes(f, "ontime", 91)).toBe(false);
  });
  it("only on time: up to 5 minutes late, not unmatched", () => {
    const f = { ...all, onTime: true };
    expect(passes(f, "ontime", 0)).toBe(true);
    expect(passes(f, "late1", 0)).toBe(true);
    expect(passes(f, "late2", 0)).toBe(false);
    expect(passes(f, "none", 0)).toBe(false);
  });
});

describe("gtfsEnded", () => {
  it("gives the end day only once it is past in Athens", async () => {
    const { gtfsEnded, dayMonth } = await import("../src/lib/format");
    const at = new Date("2026-10-06T22:30:00Z");   // 01:30 on the 7th in Athens
    expect(gtfsEnded("2026-10-06", at)).toBe("2026-10-06");
    expect(gtfsEnded("2026-10-07", at)).toBeNull();
    expect(gtfsEnded(undefined, at)).toBeNull();
    expect(dayMonth("2026-10-06")).toBe("6/10");
  });
});

describe("position age setting", () => {
  it("hides a position over 10 minutes old", () => {
    expect([isGonePos(600), isGonePos(601)]).toEqual([false, true]);
  });
  it("reads the stored mode, else moves the old checkbox (on = always), else only the old ones", () => {
    expect(ageModeOf("never", true)).toBe("never");
    expect(ageModeOf(null, true)).toBe("always");
    expect(ageModeOf(null, false)).toBe("old");
    expect(ageModeOf("bogus", null)).toBe("old");
  });
});
