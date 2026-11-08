import { describe, expect, it } from "vitest";
import { pickDetent, rubber, springStep } from "../src/lib/sheetDrag";

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
    const a = rubber(700, 60, 640), b = rubber(800, 60, 640);
    expect(a).toBeGreaterThan(640);
    expect(a - 640).toBeLessThan(60);
    expect(b - a).toBeLessThan(a - 640);
    expect(rubber(0, 60, 640)).toBeLessThan(60);
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
