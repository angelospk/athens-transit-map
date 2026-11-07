import { describe, expect, it } from "vitest";
import { isLook3D, LOOKS } from "../src/lib/map/look3d";

describe("look3d", () => {
  it("knows its two looks, and nothing else", () => {
    expect(LOOKS.map(([v]) => v)).toEqual(["real", "toon"]);
    expect(isLook3D("toon")).toBe(true);
    expect(isLook3D("dark")).toBe(false);
    expect(isLook3D(null)).toBe(false);
  });
});
