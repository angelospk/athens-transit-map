import { describe, expect, it } from "vitest";
import { destGroups, destsOf, GROUP_TITLE } from "../src/lib/destinations";

describe("destinations", () => {
  it("Athens has the three groups, in order", () => {
    expect(destGroups("athens").map(g => g.title)).toEqual(Object.values(GROUP_TITLE));
  });
  it("every place of Athens is in Attica", () => {
    for (const d of destsOf("athens")) {
      expect(d.at[0]).toBeGreaterThan(37.6); expect(d.at[0]).toBeLessThan(38.4);
      expect(d.at[1]).toBeGreaterThan(23.3); expect(d.at[1]).toBeLessThan(24.2);
    }
  });
  it("every place of Thessaloniki is near the city", () => {
    for (const d of destsOf("thessaloniki")) {
      expect(Math.abs(d.at[0] - 40.63)).toBeLessThan(0.2);
      expect(Math.abs(d.at[1] - 22.94)).toBeLessThan(0.2);
    }
  });
  it("labels are unique per city", () => {
    for (const c of ["athens", "thessaloniki"] as const) {
      const l = destsOf(c).map(d => d.label);
      expect(new Set(l).size).toBe(l.length);
    }
  });
});
