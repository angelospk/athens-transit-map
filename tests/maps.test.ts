import { describe, expect, it } from "vitest";
import { walkUrl } from "../src/lib/maps";

describe("walkUrl", () => {
  it("opens Google Maps walking directions from where the phone is", () => {
    expect(walkUrl([37.98123456, 23.7])).toBe("https://www.google.com/maps/dir/?api=1&destination=37.981235%2C23.7&travelmode=walking");
  });
  it("starts at a given point", () => {
    expect(walkUrl([37.98, 23.7], [38, 23.71])).toBe("https://www.google.com/maps/dir/?api=1&origin=38%2C23.71&destination=37.98%2C23.7&travelmode=walking");
  });
});
