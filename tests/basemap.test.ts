import { describe, expect, it } from "vitest";
import { PALETTE, basePaint, paintBase } from "../src/lib/map/basemap";
import darkLayers from "../src/fixtures/openfreemap-dark-layers.json";

// A stand-in for the MapLibre map: the style's layers, and the calls it receives.
function fakeMap(ids: string[]) {
  const paint: [string, string, unknown][] = [], layout: [string, string, unknown][] = [], added: { id: string }[] = [];
  return {
    paint, layout, added,
    getStyle: () => ({ layers: ids.map(id => ({ id, "source-layer": id.startsWith("place_") ? "place" : id.startsWith("poi") ? "poi" : undefined })) }),
    getLayer: (id: string) => ids.includes(id) || added.some(l => l.id === id),
    setPaintProperty: (id: string, prop: string, value: unknown) => void paint.push([id, prop, value]),
    setLayoutProperty: (id: string, prop: string, value: unknown) => void layout.push([id, prop, value]),
    hasImage: () => false,
    addImage: () => undefined,
    addLayer: (l: { id: string }, before?: string) => void added.push({ ...l, before } as never),
  };
}

describe("paintBase", () => {
  it("paints the light and the dark theme differently", () => {
    const light = fakeMap(["background", "landuse_park"]), dark = fakeMap(["background", "landuse_park"]);
    paintBase(light, false);
    paintBase(dark, true);
    expect(light.paint).toContainEqual(["background", "background-color", PALETTE.light.land]);
    expect(dark.paint).toContainEqual(["background", "background-color", PALETTE.dark.land]);
    expect(light.paint).toContainEqual(["landuse_park", "fill-color", PALETTE.light.park]);
  });

  it("writes place and street names in Greek only, in their own case", () => {
    const m = fakeMap(["place_suburb", "highway_name_other"]);
    paintBase(m, true);
    for (const id of ["place_suburb", "highway_name_other"]) {
      expect(m.layout).toContainEqual([id, "text-field", ["coalesce", ["get", "name:el"], ["get", "name"]]]);
      expect(m.layout).toContainEqual([id, "text-transform", "none"]);
    }
  });

  it("hides the points of interest and their names, and adds the greens once", () => {
    const m = fakeMap(["building", "poi_r1", "poi_r20", "place_suburb"]);
    paintBase(m, false);
    paintBase(m, false);
    expect(m.added.some(l => l.id === "base-poi")).toBe(false);
    expect(m.layout.filter(([, prop, v]) => prop === "visibility" && v === "none").map(([id]) => id).sort()).toEqual(["poi_r1", "poi_r1", "poi_r20", "poi_r20"]);
    expect(m.layout.some(([id, prop]) => id === "place_suburb" && prop === "visibility")).toBe(false);
    expect(m.added.filter(l => l.id.startsWith("base-green")).length).toBe(3);
  });

  it("leaves layers it does not know", () => {
    const m = fakeMap(["speed"]);
    paintBase(m, false);
    expect(m.paint.filter(([id]) => id === "speed")).toEqual([]);
  });

  // The layer ids of tiles.openfreemap.org/styles/dark (fetched 2026-10-26). If OpenFreeMap renames one, refresh the
  // fixture and this test names the paint that no longer applies.
  it("knows only layers of OpenFreeMap's dark style", () => {
    expect(Object.keys(basePaint(PALETTE.dark)).filter(id => !darkLayers.includes(id))).toEqual([]);
  });
});
