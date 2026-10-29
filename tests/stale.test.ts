import { describe, expect, it } from "vitest";
import { RELOAD_MS, shouldReload } from "../src/lib/stale";

describe("shouldReload", () => {
  it("reloads the first time", () => expect(shouldReload(null, 1000)).toBe(true));
  it("does not reload again within RELOAD_MS", () => expect(shouldReload(1000, 1000 + RELOAD_MS - 1)).toBe(false));
  it("reloads again after RELOAD_MS", () => expect(shouldReload(1000, 1000 + RELOAD_MS)).toBe(true));
  it("waits when the stored time is in the future (clock changed)", () => expect(shouldReload(5000, 1000)).toBe(false));
});
