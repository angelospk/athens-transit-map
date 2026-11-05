import { describe, expect, it } from "vitest";
import { CITIES } from "../src/lib/cities";
import { basesFor, cityUrl, favKey, autoCityOnFix } from "../src/lib/cityBases";

describe("Thessaloniki live (web#40)", () => {
  it("Thessaloniki is ready; only Athens has rail (metro, tram, Proastiakos, municipal, OASA alerts)", () => {
    expect(CITIES.thessaloniki.ready).toBe(true);
    expect(CITIES.athens.rail).toBe(true);
    expect(CITIES.thessaloniki.rail).toBe(false);
  });

  it("basesFor: Athens keeps its defaults and VITE_API_BASE / VITE_STATIC_BASE", () => {
    expect(basesFor("athens", {})).toEqual({
      api: "https://transit.haroldpoi.dev",
      static: "https://angelospk.github.io/athens-transit-rt/static/v1",
    });
    expect(basesFor("athens", { VITE_API_BASE: "http://x:1/", VITE_STATIC_BASE: "http://s/v1/" }))
      .toEqual({ api: "http://x:1", static: "http://s/v1" });
  });

  it("basesFor: Thessaloniki has its own instance, which also serves static/v1; VITE_API_BASE does not touch it", () => {
    expect(basesFor("thessaloniki", { VITE_API_BASE: "http://x:1" })).toEqual({
      api: "https://transit-thess.haroldpoi.dev",
      static: "https://transit-thess.haroldpoi.dev/static/v1",
    });
    expect(basesFor("thessaloniki", { VITE_API_BASE_THESSALONIKI: "https://minipc.example.ts.net:10445/" })).toEqual({
      api: "https://minipc.example.ts.net:10445",
      static: "https://minipc.example.ts.net:10445/static/v1",
    });
  });

  it("cityUrl: a city switch keeps only ?city= (the old city's lines and cards mean nothing there) and the path", () => {
    expect(cityUrl("/?lines=040,550&card=stop:1#x", "thessaloniki")).toBe("/?city=thessaloniki");
    expect(cityUrl("/thessaloniki/?city=athens", "athens")).toBe("/thessaloniki/?city=athens");
  });

  it("favKey: Athens keeps fav.v2 (no migration); other cities get their own key", () => {
    expect(favKey("athens")).toBe("fav.v2");
    expect(favKey("thessaloniki")).toBe("fav.v2.thessaloniki");
  });

  it("autoCityOnFix: a ?city= in the URL (a hand pick or a shared link) wins over the first location fix", () => {
    expect(autoCityOnFix("")).toBe(true);
    expect(autoCityOnFix("?lines=040")).toBe(true);
    expect(autoCityOnFix("?city=thessaloniki")).toBe(false);
    expect(autoCityOnFix("?city=patra")).toBe(true);   // unknown city: ignored
  });
});

describe("per-city stop index and geocoder area (web#40 review)", async () => {
  const { tripsFile, GEOCODE_BOX } = await import("../src/lib/trip");
  it("Athens keeps trips.json; Thessaloniki has its own index and Photon box", () => {
    expect(tripsFile("athens")).toBe("trips.json");
    expect(tripsFile("thessaloniki")).toBe("trips-thessaloniki.json");
    const [w, s, e, n] = GEOCODE_BOX.thessaloniki.split(",").map(Number);
    expect(w < 22.94 && e > 22.94 && s < 40.63 && n > 40.63).toBe(true);   // Aristotelous inside
    expect(GEOCODE_BOX.athens).toBe("23.35,37.65,24.15,38.25");
  });
});
