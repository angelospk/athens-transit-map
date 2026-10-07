import { describe, expect, it } from "vitest";
import { refreshCycle, ringAt } from "../src/lib/refresh";

describe("refreshCycle", () => {
  it("is none without data", () => {
    expect(refreshCycle([])).toBeNull();
  });

  it("follows the feed updated last, from its update to its next one", () => {
    expect(refreshCycle([{ updated_at: 100, next_update_at: 130 }, { updated_at: 112, next_update_at: 142 }]))
      .toEqual({ from: 112, to: 142 });
  });

  it("skips a feed whose times make no cycle", () => {
    expect(refreshCycle([{ updated_at: 100, next_update_at: 130 }, { updated_at: 120, next_update_at: 120 }, { updated_at: NaN, next_update_at: 9 }]))
      .toEqual({ from: 100, to: 130 });
    expect(refreshCycle([{ updated_at: 120, next_update_at: 100 }])).toBeNull();
  });
});

describe("ringAt", () => {
  const c = { from: 100, to: 130 };
  it("says how long the cycle is and how much has passed", () => {
    expect(ringAt(c, 110)).toEqual({ dur: 30, elapsed: 10 });
  });
  it("stays full when the next update is late", () => {
    expect(ringAt(c, 200)).toEqual({ dur: 30, elapsed: 30 });
  });
  it("starts at empty when the clock is behind the data", () => {
    expect(ringAt(c, 90)).toEqual({ dur: 30, elapsed: 0 });
  });
});
