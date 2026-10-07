import { describe, expect, it } from "vitest";
import { clampDrag, settle } from "../src/lib/sheet";

describe("clampDrag", () => {
  it("an open sheet moves down only, up to the range", () => {
    expect(clampDrag("open", -30, 200)).toBe(0);
    expect(clampDrag("open", 70, 200)).toBe(70);
    expect(clampDrag("open", 900, 200)).toBe(200);
  });
  it("a peeking sheet moves up only, up to the range", () => {
    expect(clampDrag("peek", 30, 200)).toBe(0);
    expect(clampDrag("peek", -70, 200)).toBe(-70);
    expect(clampDrag("peek", -900, 200)).toBe(-200);
  });
});

describe("settle", () => {
  it("an open sheet peeks after a long enough drag down, else springs back", () => {
    expect(settle("open", 79, 300)).toBe("open");
    expect(settle("open", 80, 300)).toBe("peek");
    expect(settle("open", -200, 300)).toBe("open");
  });
  it("a peeking sheet opens after a long enough drag up, else stays", () => {
    expect(settle("peek", -79, 300)).toBe("peek");
    expect(settle("peek", -80, 300)).toBe("open");
    expect(settle("peek", 200, 300)).toBe("peek");
  });
  it("a short range needs a third of it, not 80px", () => {
    expect(settle("open", 29, 90)).toBe("open");
    expect(settle("open", 30, 90)).toBe("peek");
  });
  it("with nothing to hide it stays open", () => {
    expect(settle("open", 500, 0)).toBe("open");
    expect(settle("peek", -500, 0)).toBe("open");
  });
});
