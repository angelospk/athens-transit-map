import { describe, expect, it } from "vitest";
import { cardFromUrl, cityInUrl, pageCityOf, pageUrl, parsePath, slug, unslug } from "../src/lib/paths";

// web#47: every city on its own path; a stop or line card is a path, so a shared link is also its prerendered page.
describe("slug / unslug", () => {
  it("slug turns every ':' into '-'; unslug turns the first '-' back (a namespace has no '-')", () => {
    expect(slug("oasa:400075")).toBe("oasa-400075");
    expect(unslug("oasa-400075")).toBe("oasa:400075");
    expect(unslug(slug("stasy:αγια-βαρβαρα-metro"))).toBe("stasy:αγια-βαρβαρα-metro");
    expect(unslug(slug("proastiakos:12"))).toBe("proastiakos:12");
    expect(unslug(slug("oasa:Β12"))).toBe("oasa:Β12");
  });
  it("unslug: no namespace or an empty part is no id", () => {
    expect(unslug("400075")).toBeNull();
    expect(unslug("-400075")).toBeNull();
    expect(unslug("oasa-")).toBeNull();
    expect(unslug("")).toBeNull();
  });
});

describe("parsePath", () => {
  it("a city home", () => {
    expect(parsePath("/athens/")).toEqual({ city: "athens", card: null });
    expect(parsePath("/thessaloniki")).toEqual({ city: "thessaloniki", card: null });
  });
  it("a stop and a line card, also as the prerendered file name and with a trailing slash", () => {
    expect(parsePath("/athens/stop/oasa-400075")).toEqual({ city: "athens", card: { kind: "stop", id: "oasa:400075" } });
    expect(parsePath("/athens/stop/oasa-400075.html")).toEqual({ city: "athens", card: { kind: "stop", id: "oasa:400075" } });
    expect(parsePath("/thessaloniki/line/oasa-01A/")).toEqual({ city: "thessaloniki", card: { kind: "line", id: "oasa:01A" } });
  });
  it("percent-encoded Greek ids decode", () => {
    expect(parsePath(encodeURI("/athens/stop/stasy-αγια-βαρβαρα-metro"))).toEqual({
      city: "athens", card: { kind: "stop", id: "stasy:αγια-βαρβαρα-metro" },
    });
    expect(parsePath(encodeURI("/athens/line/oasa-Β12"))?.card).toEqual({ kind: "line", id: "oasa:Β12" });
  });
  it("no city, an unknown city or a bad card part: nothing, and never a throw", () => {
    expect(parsePath("/")).toEqual({ city: null, card: null });
    expect(parsePath("/index.html")).toEqual({ city: null, card: null });
    expect(parsePath("/stop/oasa-400075.html")).toEqual({ city: null, card: null });   // the old Athens page
    expect(parsePath("/patra/stop/oasa-1")).toEqual({ city: null, card: null });
    expect(parsePath("/athens/stats/")).toEqual({ city: "athens", card: null });
    expect(parsePath("/athens/stop/400075")).toEqual({ city: "athens", card: null });
    expect(parsePath("/athens/vehicle/oasa-1")).toEqual({ city: "athens", card: null });
    expect(parsePath("/athens/stop/%E0%A4%A")).toEqual({ city: "athens", card: null });
    expect(parsePath("/constructor/")).toEqual({ city: null, card: null });
  });
});

describe("cardFromUrl", () => {
  it("the path's card wins over the query", () => {
    expect(cardFromUrl("/athens/stop/oasa-1", "?stop=oasa:2")).toEqual({ kind: "stop", id: "oasa:1" });
  });
  it("a line path keeps ?dir=", () => {
    expect(cardFromUrl("/athens/line/oasa-040", "?dir=1")).toEqual({ kind: "line", id: "oasa:040", dir: 1 });
    expect(cardFromUrl("/athens/line/oasa-040", "?dir=7")).toEqual({ kind: "line", id: "oasa:040" });
  });
  it("old links and vehicles still come from the query", () => {
    expect(cardFromUrl("/", "?stop=oasa%3A400075")).toEqual({ kind: "stop", id: "oasa:400075" });
    expect(cardFromUrl("/athens/", "?line=oasa:040&vehicle=oasa:1234")).toEqual({ kind: "vehicle", id: "oasa:1234", line: "oasa:040" });
    expect(cardFromUrl("/athens/", "")).toBeNull();
  });
});

describe("pageUrl", () => {
  it("no card: the city home, with the line picks", () => {
    expect(pageUrl("athens", null, [])).toBe("/athens/");
    expect(pageUrl("thessaloniki", null, ["oasa:01", "oasa:02"])).toBe("/thessaloniki/?l=oasa%3A01,oasa%3A02");
  });
  it("a stop or line card is a path; ?dir= and picks stay in the query", () => {
    expect(pageUrl("athens", { kind: "stop", id: "oasa:400075", title: "x" }, [])).toBe("/athens/stop/oasa-400075");
    expect(pageUrl("athens", { kind: "line", id: "oasa:040", dir: 1 }, ["oasa:040"])).toBe("/athens/line/oasa-040?l=oasa%3A040&dir=1");
    expect(pageUrl("athens", { kind: "stop", id: "stasy:αγια-βαρβαρα-metro" }, []))
      .toBe(`/athens/stop/${encodeURIComponent("stasy-αγια-βαρβαρα-metro")}`);
  });
  it("a vehicle has no page: the city home with ?line= and ?vehicle=", () => {
    expect(pageUrl("athens", { kind: "vehicle", id: "oasa:1234", line: "oasa:040" }, []))
      .toBe("/athens/?line=oasa%3A040&vehicle=oasa%3A1234");
  });
  it("round trip: what pageUrl writes, cardFromUrl reads back", () => {
    for (const card of [{ kind: "stop", id: "stasy:αγ.-δημητριοσ-metro" }, { kind: "line", id: "oasa:Β12", dir: 0 }] as const) {
      const u = new URL(pageUrl("athens", card, []), "https://staseis.gr");
      expect(cardFromUrl(u.pathname, u.search)).toEqual(card);
      expect(parsePath(u.pathname).city).toBe("athens");
    }
  });
});

describe("the city of a page load", () => {
  it("the path wins, then ?city=, then the last choice, then Athens", () => {
    expect(pageCityOf("/thessaloniki/stop/oasa-1", "?city=athens", "athens")).toBe("thessaloniki");
    expect(pageCityOf("/", "?city=thessaloniki", "athens")).toBe("thessaloniki");
    expect(pageCityOf("/", "", "thessaloniki")).toBe("thessaloniki");
    expect(pageCityOf("/", "?city=patra", "nowhere")).toBe("athens");
  });
  it("cityInUrl: a path or ?city= names the city (a hand pick or a shared link); the bare / does not", () => {
    expect(cityInUrl("/athens/", "")).toBe(true);
    expect(cityInUrl("/", "?city=thessaloniki")).toBe(true);
    expect(cityInUrl("/", "?city=patra")).toBe(false);
    expect(cityInUrl("/", "?stop=oasa:1")).toBe(false);
    expect(cityInUrl("/stop/oasa-1.html", "")).toBe(false);
  });
});
