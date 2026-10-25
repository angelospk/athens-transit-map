import { describe, expect, it } from "vitest";
import { DARK_PAINT, lightenDark } from "../src/lib/map/basemap";
import darkLayers from "../src/fixtures/openfreemap-dark-layers.json";

// A stand-in for the MapLibre map: the style's layer ids, and the paint calls it receives.
function fakeMap(ids: string[]) {
  const calls: [string, string, unknown][] = [];
  return {
    calls,
    getStyle: () => ({ layers: ids.map(id => ({ id })) }),
    setPaintProperty: (id: string, prop: string, value: unknown) => void calls.push([id, prop, value]),
  };
}

describe("lightenDark", () => {
  it("paints every listed layer the style has", () => {
    const m = fakeMap(["background", "highway_minor", "place_city"]);
    lightenDark(m);
    expect(m.calls).toContainEqual(["background", "background-color", DARK_PAINT.background["background-color"]]);
    expect(m.calls).toContainEqual(["highway_minor", "line-color", DARK_PAINT.highway_minor["line-color"]]);
    expect(m.calls.filter(([id, p]) => id === "place_city" && !p.endsWith("-transition")).map(([, p]) => p)).toEqual(["text-color", "text-halo-color"]);
  });

  it("leaves layers it does not know, and skips listed layers the style lacks", () => {
    const m = fakeMap(["speed", "building"]);
    lightenDark(m);
    expect(m.calls.every(([id]) => id === "building")).toBe(true);
    expect(m.calls).toContainEqual(["building", "fill-color-transition", { duration: 0, delay: 0 }]);
    expect(m.calls.length).toBeGreaterThan(0);
  });

  // The layer ids of tiles.openfreemap.org/styles/dark (fetched 2026-10-26). If OpenFreeMap renames one, refresh the
  // fixture and this test names the paint that no longer applies.
  it("knows only layers of OpenFreeMap's dark style", () => {
    expect(Object.keys(DARK_PAINT).filter(id => !darkLayers.includes(id))).toEqual([]);
    expect(darkLayers.some(id => id.startsWith("place_"))).toBe(true);
  });

  it("lightens the near-black colours of OpenFreeMap's dark style", () => {
    expect(DARK_PAINT.background["background-color"]).not.toBe("rgb(12,12,12)");
    expect(DARK_PAINT.highway_minor["line-color"]).not.toBe("#181818");
  });
});
