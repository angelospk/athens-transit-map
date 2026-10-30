import { describe, expect, it } from "vitest";
import { diffKeys, mapProvider, regionFor, spanZoom, viewOf } from "../src/lib/apple/logic";

describe("mapProvider", () => {
  it("is osm unless the query asks for apple", () => {
    expect(mapProvider("")).toBe("osm");
    expect(mapProvider("?line=040")).toBe("osm");
    expect(mapProvider("?map=apple")).toBe("apple");
    expect(mapProvider("?line=040&map=apple")).toBe("apple");
    expect(mapProvider("?map=APPLE")).toBe("osm");
    expect(mapProvider("?map=google")).toBe("osm");
  });
});

describe("viewOf", () => {
  it("turns a centre and span into the edges the city tiles want", () => {
    expect(viewOf({ lat: 38, lon: 23.7 }, { lat: 0.2, lon: 0.4 })).toEqual({ north: 38.1, south: 37.9, east: 23.9, west: 23.5 });
  });
});

describe("spanZoom", () => {
  it("gives the web-mercator zoom of a longitude span across a width", () => {
    expect(spanZoom(360, 256)).toBeCloseTo(0);
    expect(spanZoom(360 / 2 ** 14, 256)).toBeCloseTo(14);
    expect(spanZoom(360 / 2 ** 14, 512)).toBeCloseTo(15);   // twice the pixels, one zoom in
  });
  it("is 0 for a bad span", () => {
    expect(spanZoom(0, 390)).toBe(0);
    expect(spanZoom(NaN, 390)).toBe(0);
  });
});

describe("regionFor", () => {
  it("frames [[w,s],[e,n]] bounds with a margin", () => {
    const r = regionFor([[23.6, 37.9], [23.8, 38.1]], 1.2);
    expect(r.center.lat).toBeCloseTo(38);
    expect(r.center.lon).toBeCloseTo(23.7);
    expect(r.span.lat).toBeCloseTo(0.24);
    expect(r.span.lon).toBeCloseTo(0.24);
  });
  it("keeps a minimum span for a single point", () => {
    const r = regionFor([[23.7, 38], [23.7, 38]]);
    expect(r.span.lat).toBeGreaterThan(0);
    expect(r.span.lon).toBeGreaterThan(0);
  });
});

describe("diffKeys", () => {
  it("splits the next keys into added and kept, and lists the removed", () => {
    expect(diffKeys(new Set(["a", "b", "c"]), ["b", "c", "d", "d"])).toEqual({ added: ["d"], kept: ["b", "c"], removed: ["a"] });
    expect(diffKeys(new Set(), [])).toEqual({ added: [], kept: [], removed: [] });
  });
});
