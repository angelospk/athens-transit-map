import { describe, expect, it } from "vitest";
import { ageLabel, ago, isStalePos, delayClass, delayText, duration, fmtDelay } from "../src/lib/format";

describe("duration", () => {
  it("speaks Greek minutes and seconds", () => {
    expect(duration(144)).toBe("2 λεπτά και 24 δευτερόλεπτα");
    expect(duration(1)).toBe("1 δευτερόλεπτο");
    expect(duration(60)).toBe("1 λεπτό");
    expect(duration(0)).toBe("0 δευτερόλεπτα");
    expect(duration(-61)).toBe("1 λεπτό και 1 δευτερόλεπτο");
  });
});

describe("fmtDelay", () => {
  it("handles on time, late and early", () => {
    expect(fmtDelay(0)).toBe("καμία");
    expect(fmtDelay(140)).toBe("2 λεπτά και 20 δευτερόλεπτα");
    expect(fmtDelay(-90)).toBe("1 λεπτό και 30 δευτερόλεπτα νωρίτερα");
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
    expect(ago(1000, 1_024_000)).toBe("πριν 24 δευτερόλεπτα");
    expect(ago(1030, 1_024_000)).toBe("πριν 0 δευτερόλεπτα");
  });
});

describe("delayText", () => {
  it("says the vehicle is unmatched when there is no delay", () => {
    expect(delayText(null)).toBe("χωρίς αντιστοίχιση σε δρομολόγιο");
    expect(delayText(0)).toBe("καμία");
    expect(delayText(144)).toBe("2 λεπτά και 24 δευτερόλεπτα");
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
