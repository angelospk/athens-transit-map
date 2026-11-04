import { describe, expect, it } from "vitest";
import { CITIES, DEFAULT_CITY, isCityId, nearestCity, initialCity } from "../src/lib/cities";

describe("cities", () => {
  it("knows Athens and Thessaloniki; Athens is the default and ready", () => {
    expect(Object.keys(CITIES).sort()).toEqual(["athens", "thessaloniki"]);
    expect(DEFAULT_CITY).toBe("athens");
    expect(CITIES.athens.ready).toBe(true);
    for (const c of Object.values(CITIES)) {
      expect(c.center).toHaveLength(2);   // [lng, lat]
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.zoom).toBeGreaterThan(8);
    }
  });

  it("isCityId accepts only known ids", () => {
    expect(isCityId("athens")).toBe(true);
    expect(isCityId("thessaloniki")).toBe(true);
    expect(isCityId("patra")).toBe(false);
    expect(isCityId(null)).toBe(false);
    expect(isCityId(3)).toBe(false);
  });

  it("nearestCity: the city whose area holds the point; [lng, lat]", () => {
    expect(nearestCity([23.7275, 37.9838])).toBe("athens");      // Syntagma
    expect(nearestCity([23.94, 37.94])).toBe("athens");          // Athens airport
    expect(nearestCity([22.9444, 40.6401])).toBe("thessaloniki"); // Aristotelous
    expect(nearestCity([22.97, 40.52])).toBe("thessaloniki");     // Thessaloniki airport
  });

  it("nearestCity: null far from every city", () => {
    expect(nearestCity([21.7346, 38.2466])).toBeNull();   // Patra
    expect(nearestCity([25.1442, 35.3387])).toBeNull();   // Heraklion
    expect(nearestCity([22.42, 39.64])).toBeNull();       // Larissa
  });

  it("initialCity: ?city= wins, then the stored city, then the default", () => {
    expect(initialCity("?city=thessaloniki", "athens")).toBe("thessaloniki");
    expect(initialCity("?l=040&city=athens", "thessaloniki")).toBe("athens");
    expect(initialCity("", "thessaloniki")).toBe("thessaloniki");
    expect(initialCity("?city=patra", "thessaloniki")).toBe("thessaloniki");
    expect(initialCity("", "patra")).toBe("athens");
    expect(initialCity("", null)).toBe("athens");
  });
});
