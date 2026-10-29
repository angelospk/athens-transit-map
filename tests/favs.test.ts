import { describe, expect, it } from "vitest";
import {
  busFavIds, emptyFavs, loadFavs, lineSummary, toggleLine, toggleStop, type FavStop,
} from "../src/lib/favs";

const stop = (id: string, extra: Partial<FavStop> = {}): FavStop => ({ id, name: id, lat: 37.9, lon: 23.7, ...extra });

describe("loadFavs", () => {
  it("reads fav.v2 and drops what is not a stop or a line", () => {
    const f = loadFavs({ stops: [stop("oasa:1"), { id: 3 }, null], lines: [{ id: "stasy:M3", label: "M3" }, { label: "x" }] }, null);
    expect(f.stops.map(s => s.id)).toEqual(["oasa:1"]);
    expect(f.lines).toEqual([{ id: "stasy:M3", label: "M3" }]);
  });
  it("moves the old bus favourites to lines once, when there is no fav.v2", () => {
    expect(loadFavs(null, ["040", "A7", 5]).lines).toEqual([{ id: "oasa:040", label: "040" }, { id: "oasa:A7", label: "A7" }]);
    expect(loadFavs({ stops: [], lines: [] }, ["040"]).lines).toEqual([]);
    expect(loadFavs("garbage", null)).toEqual(emptyFavs());
  });
});

describe("editing", () => {
  it("toggles a stop and a line by id, adding at the end", () => {
    let f = toggleStop(emptyFavs(), stop("oasa:1"));
    f = toggleStop(f, stop("stasy:συνταγμα-metro"));
    expect(f.stops.map(s => s.id)).toEqual(["oasa:1", "stasy:συνταγμα-metro"]);
    expect(toggleStop(f, stop("oasa:1")).stops.map(s => s.id)).toEqual(["stasy:συνταγμα-metro"]);
    const g = toggleLine(toggleLine(emptyFavs(), { id: "oasa:040", label: "040" }), { id: "stasy:M3", label: "M3" });
    expect(g.lines.map(l => l.id)).toEqual(["oasa:040", "stasy:M3"]);
    expect(toggleLine(g, { id: "oasa:040", label: "040" }).lines.map(l => l.id)).toEqual(["stasy:M3"]);
  });
  it("names the favourite bus lines by their /v1 ids", () => {
    expect(busFavIds({ stops: [], lines: [{ id: "oasa:040", label: "040" }, { id: "stasy:M3", label: "M3" }] })).toEqual(["040"]);
  });
});

describe("lineSummary", () => {
  it("counts the vehicles on the way and the late ones (over 3′)", () => {
    expect(lineSummary([])).toBe("κανένα στον δρόμο");
    expect(lineSummary([{ delay_s: 30 }, { delay_s: null }, { delay_s: -60 }])).toBe("3 στον δρόμο · όλα στην ώρα τους");
    expect(lineSummary([{ delay_s: 400 }, { delay_s: 0 }])).toBe("2 στον δρόμο · 1 αργεί");
    expect(lineSummary([{ delay_s: 400 }, { delay_s: 200 }])).toBe("2 στον δρόμο · 2 αργούν");
    expect(lineSummary([{ delay_s: 180 }])).toBe("1 στον δρόμο · όλα στην ώρα τους");
  });
});
