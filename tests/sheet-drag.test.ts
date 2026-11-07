import { describe, expect, it } from "vitest";
import { restAt } from "../src/lib/sheetDrag";

describe("restAt", () => {
  it("stays where it was let go, within its range", () => {
    expect(restAt(180, 0, 400, 0.1)).toBe(180);
    expect(restAt(-30, 0, 400, 0)).toBe(0);
    expect(restAt(520, 0, 400, 0)).toBe(400);
  });
  it("does not snap on a fast drag either", () => {
    expect(restAt(180, 0, 400, 1.2)).toBe(180);
    expect(restAt(180, 0, 400, -1.2)).toBe(180);
  });
});
