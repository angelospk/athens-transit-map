import { describe, expect, it } from "vitest";
import { addRelief, reliefPaint, reliefStrength, RELIEF_LAYER } from "../src/lib/map/relief";

describe("relief", () => {
  it("fades out by street level, softer in dark", () => {
    const l = reliefPaint(false)["hillshade-exaggeration"] as unknown[], d = reliefPaint(true)["hillshade-exaggeration"] as unknown[];
    expect((reliefStrength(false, true) as number[]).at(-1)).toBeGreaterThan(0);   // 3D: kept up close
    expect(l.at(-1)).toBe(0);
    expect(d[4] as number).toBeLessThan(l[4] as number);
  });
  it("goes under the buildings, once, hidden on a phone", () => {
    const added: { layer: { id: string; layout: { visibility: string } }; before?: string }[] = [];
    const ids = new Set<string>(), srcs = new Set<string>();
    const m = {
      getStyle: () => ({ layers: [{ id: "background" }, { id: "building" }, { id: "highway_minor", type: "line", "source-layer": "transportation" }] }),
      getSource: (id: string) => (srcs.has(id) ? {} : undefined),
      getLayer: (id: string) => (ids.has(id) ? {} : undefined),
      addSource: (id: string) => { srcs.add(id); },
      addLayer: (layer: { id: string; layout: { visibility: string } }, before?: string) => { ids.add(layer.id); added.push({ layer, before }); },
    };
    addRelief(m, false, false);
    addRelief(m, false, true);
    expect(added).toHaveLength(1);
    expect(added[0].layer.id).toBe(RELIEF_LAYER);
    expect(added[0].before).toBe("building");
    expect(added[0].layer.layout.visibility).toBe("none");
  });
});

describe("mountains", () => {
  it("keeps the city flat and raises the mountains above the floor", async () => {
    const { flatten, flattenTerrarium, FLAT_M } = await import("../src/lib/map/relief");
    expect(flatten(150)).toBe(0);          // the Acropolis
    expect(flatten(-20)).toBe(0);          // the sea
    expect(flatten(1026)).toBe(1026 - FLAT_M);   // Υμηττός
    // Terrarium: h = R*256 + G + B/256 - 32768. 1026.5 m → 726.5 m after.
    const v = 1026.5 + 32768, px = new Uint8ClampedArray([Math.floor(v) >> 8, Math.floor(v) & 255, 128, 255]);
    flattenTerrarium(px);
    expect(px[0] * 256 + px[1] + px[2] / 256 - 32768).toBeCloseTo(726.5, 1);
  });
});
