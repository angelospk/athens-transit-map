import { describe, expect, it } from "vitest";
import { linesToward, pickWay } from "../src/lib/ways";
import type { TripIndex } from "../src/lib/trip";

const home: [number, number] = [37.9925, 23.8478], work: [number, number] = [37.9755, 23.7348];

describe("pickWay", () => {
  it("at home goes to work, at work goes home, whatever the hour", () => {
    expect(pickWay({ home: { at: home }, work: { at: work } }, home, 19)?.way).toBe("work");
    expect(pickWay({ home: { at: home }, work: { at: work } }, work, 8)?.way).toBe("home");
  });
  it("elsewhere: work before 14:00, home after", () => {
    const me: [number, number] = [38.0, 23.7];
    expect(pickWay({ home: { at: home }, work: { at: work } }, me, 9)?.way).toBe("work");
    expect(pickWay({ home: { at: home }, work: { at: work } }, me, 18)?.way).toBe("home");
  });
  it("only one place set: that one, unless the user is there", () => {
    expect(pickWay({ home: { at: home } }, [38.0, 23.7], 9)?.way).toBe("home");
    expect(pickWay({ home: { at: home } }, home, 9)).toBeNull();
  });
});

describe("linesToward", () => {
  // Stops: 0 here, 1 midway, 2 near work; line A runs 0→1→2, line B runs 2→1→0 (the other way), line C 0→1 only.
  const ix: TripIndex = { v: "t", s: [["Εδώ", 37.99, 23.80, "100"], ["Μέση", 37.98, 23.77, "101"], ["Δουλειά", 37.9757, 23.7350, "102"]],
    l: { A: { a: [0, 1, 2] }, B: { b: [2, 1, 0] }, C: { c: [0, 1] } } };
  it("keeps the lines that reach the place after this stop", () => {
    expect([...linesToward(ix, "100", work)]).toEqual(["A"]);
  });
});
