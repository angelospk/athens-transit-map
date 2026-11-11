import { describe, expect, it } from "vitest";
import { band, nextPlace, pickDetent, rubber, sheetPlaces, springStep } from "../src/lib/sheetDrag";

// The home sheet's places on a phone 800 px tall, as px from the top.
const places = { full: 60, half: 376, peek: 640 };

describe("pickDetent", () => {
  it("goes to the nearest place after a slow drag", () => {
    expect(pickDetent(places, 330, 0)).toBe("half");
    expect(pickDetent(places, 560, 0.05)).toBe("peek");
  });
  it("a flick carries it on: from the top, a firm one down goes past the middle to the foot", () => {
    expect(pickDetent(places, 120, 2.6)).toBe("peek");
    expect(pickDetent(places, 120, 0.8)).toBe("half");
  });
  it("a flick up from the middle goes to the top", () => {
    expect(pickDetent(places, 360, -1.2)).toBe("full");
  });
});

describe("rubber", () => {
  it("leaves a place within the range as it is", () => {
    expect(rubber(200, 60, 640)).toBe(200);
  });
  it("past an end, gives less and less", () => {
    const a = rubber(700, 60, 640), b = rubber(760, 60, 640);   // 60 px past, then 60 more
    expect(a).toBeGreaterThan(640);
    expect(a - 640).toBeLessThan(60);
    expect(b - a).toBeLessThan(a - 640);
    expect(rubber(0, 60, 640)).toBeLessThan(60);
  });
  it("is iOS's band: 0.55 of the finger at first, toward the screen's height", () => {
    expect(band(1, 844)).toBeCloseTo(0.55, 2);
    expect(band(100, 844)).toBeCloseTo((1 - 1 / (100 * 0.55 / 844 + 1)) * 844, 6);
    expect(band(1e6, 844)).toBeLessThan(844);
    expect(rubber(740, 60, 640, 844)).toBeCloseTo(640 + band(100, 844), 6);
  });
});

describe("springStep", () => {
  it("settles at its place in about a third of a second, overshooting only a little", () => {
    let x = 640, v = 0, t = 0, past = 0;
    while (t < 2 && !(Math.abs(x - 376) < 0.4 && Math.abs(v) < 12)) {
      [x, v] = springStep(x, v, 376, 1 / 240);
      past = Math.max(past, 376 - x);
      t += 1 / 240;
    }
    expect(t).toBeGreaterThan(0.25);
    expect(t).toBeLessThan(0.6);
    expect(past).toBeLessThan(0.03 * (640 - 376));
  });
});

describe("sheetPlaces", () => {
  it("a tall sheet (at its most) has three places: all of it, half the screen, its header", () => {
    expect(sheetPlaces(780, 90, 460, true)).toEqual({ full: 0, half: 320, peek: 690 });
  });
  it("a sheet that fits shows whole, or its header: no half place", () => {
    expect(sheetPlaces(400, 90, 460, false)).toEqual({ full: 0, peek: 310 });
  });
  it("a tall sheet whose half would hardly differ from all of it has no half place", () => {
    expect(sheetPlaces(500, 90, 470, true)).toEqual({ full: 0, peek: 410 });
  });
  it("a sheet no taller than its header has one place", () => {
    expect(sheetPlaces(100, 90, 460, false)).toEqual({ full: 0 });
  });
});

describe("nextPlace (a tap on the handle)", () => {
  it("steps up from the header to the default, from half to all, and down from all to the header", () => {
    expect(nextPlace("peek", { full: 0, half: 300, peek: 600 })).toBe("half");
    expect(nextPlace("peek", { full: 0, peek: 300 })).toBe("full");
    expect(nextPlace("half", { full: 0, half: 300, peek: 600 })).toBe("full");
    expect(nextPlace("full", { full: 0, half: 300, peek: 600 })).toBe("peek");
  });
});
