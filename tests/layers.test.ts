import { describe, expect, it } from "vitest";
import { bounds, routesFC, stopsFC, variantFC, type DrawnLine } from "../src/lib/map/layers";
import data from "../src/fixtures/lines-040.json";
import type { LineStatic } from "../src/lib/types";

const line: DrawnLine = { id: "040", color: "#1a73e8", data: data as unknown as LineStatic };
const variant = Object.keys(line.data.variants)[0];

describe("layers", () => {
  it("flips [lat, lon] to [lon, lat]", () => {
    const f = routesFC([line]).features[0];
    const [lat, lon] = line.data.variants[f.properties!.variant].shape[0];
    expect(f.geometry.coordinates[0]).toEqual([lon, lat]);
    expect(routesFC([line]).features).toHaveLength(Object.keys(line.data.variants).length);
  });
  it("draws only the focused variants of a line", () => {
    const keep = new Set(["5513"]);
    const fc = routesFC([{ ...line, visible: keep }]);
    expect(fc.features.map(f => f.properties!.variant)).toEqual(["5513"]);
  });
  it("builds the stops of one variant in order", () => {
    const fc = stopsFC(line, variant);
    expect(fc.features.map(f => f.properties!.id)).toEqual(line.data.variants[variant].stops);
  });
  it("with `all`, builds the stops of every direction once each", () => {
    const ids = Object.values(line.data.variants).flatMap(v => v.stops.filter(id => line.data.stops[id]));
    const fc = stopsFC(line, variant, true);
    expect(fc.features.map(f => f.properties!.id)).toEqual([...new Set(ids)]);
    expect(fc.features.length).toBeGreaterThan(stopsFC(line, variant).features.length);
  });
  it("with `all`, needs no valid variant, only the line", () => {
    const n = stopsFC(line, variant, true).features.length;
    expect(stopsFC(line, null, true).features).toHaveLength(n);
    expect(stopsFC(line, "nope", true).features).toHaveLength(n);
    expect(stopsFC(undefined, variant, true).features).toEqual([]);
  });
  it("is empty for a null or unknown variant", () => {
    expect(variantFC(line, null).features).toEqual([]);
    expect(stopsFC(line, "nope").features).toEqual([]);
  });
  it("computes bounds around Athens", () => {
    const b = bounds([line])!;
    expect(b[0][0]).toBeGreaterThan(23.5);
    expect(b[1][1]).toBeLessThan(38.2);
    expect(bounds([])).toBeNull();
  });
});
