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
