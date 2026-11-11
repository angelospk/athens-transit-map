import { describe, expect, it } from "vitest";
import { CITIES } from "../src/lib/cities";
import { basesFor, cityUrl, favKey, recentKey, statsBaseFor } from "../src/lib/cityBases";

describe("Thessaloniki live (web#40)", () => {
  it("Thessaloniki is ready; only Athens has rail (metro, tram, Proastiakos, municipal, OASA alerts)", () => {
    expect(CITIES.thessaloniki.ready).toBe(true);
    expect(CITIES.athens.rail).toBe(true);
    expect(CITIES.thessaloniki.rail).toBe(false);
  });

  it("basesFor: Athens keeps its defaults and VITE_API_BASE / VITE_STATIC_BASE", () => {
    expect(basesFor("athens", {})).toEqual({
      api: "https://transit.haroldpoi.dev",
      static: "https://angelospk.github.io/staseis-rt/static/v1",
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

  it("basesFor: a citybus.gr city is a path of the one staseis-rt instance, by its code (web#54)", () => {
    expect(basesFor("patras", { VITE_API_BASE: "http://x:1" })).toEqual({
      api: "https://staseis-rt.haroldpoi.dev/pat",
      static: "https://staseis-rt.haroldpoi.dev/pat/static/v1",
    });
    expect(basesFor("heraklion", { VITE_API_BASE_CITYBUS: "http://minipc:10449/" })).toEqual({
      api: "http://minipc:10449/her",
      static: "http://minipc:10449/her/static/v1",
    });
  });

  it("statsBaseFor: Athens reads v1 of the stats branch, Thessaloniki its own folder; the base may be overridden", () => {
    const raw = "https://raw.githubusercontent.com/angelospk/staseis-rt/stats/v1";
    expect(statsBaseFor("athens", {})).toBe(raw);
    expect(statsBaseFor("thessaloniki", {})).toBe(`${raw}/thessaloniki`);
    expect(statsBaseFor("thessaloniki", { VITE_STATS_BASE: "http://x/v1/" })).toBe("http://x/v1/thessaloniki");
  });

  it("cityUrl: a city switch opens the city's home (web#47); the old city's lines and cards mean nothing there", () => {
    expect(cityUrl("thessaloniki")).toBe("/thessaloniki/");
    expect(cityUrl("athens")).toBe("/athens/");
  });

  it("favKey: Athens keeps fav.v2 (no migration); other cities get their own key", () => {
    expect(favKey("athens")).toBe("fav.v2");
    expect(favKey("thessaloniki")).toBe("fav.v2.thessaloniki");
  });

  it("recentKey: the search's recent picks are per city too; Athens keeps recent.v2 (web#54 review)", () => {
    expect(recentKey("athens")).toBe("recent.v2");
    expect(recentKey("patras")).toBe("recent.v2.patras");
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
    expect(tripsFile("patras")).toBe("trips-patras.json");
    const [w2, s2, e2, n2] = GEOCODE_BOX.patras.split(",").map(Number);
    expect(w2 < 21.74 && e2 > 21.74 && s2 < 38.25 && n2 > 38.25).toBe(true);   // Patras centre inside
  });
});
