import { describe, expect, it } from "vitest";
import { findMuniLines, findMuniStops, muniPlaces } from "../src/lib/finder";
import type { MuniCard } from "../src/lib/muniLine";
import type { MunicipalRoute, MunicipalStop } from "../src/lib/municipal";

const route = (id: string, ref: string | null, name: string, municipality: string, stops: string[] = []): MunicipalRoute =>
  ({ id, ref, name, municipality, timetable_url: null, shape: [], stops });
const card = (r: MunicipalRoute): MuniCard =>
  ({ id: `muni:${r.id}`, ref: r.ref, name: r.name, municipality: r.municipality, routes: [r], table: null, lines: [] });

const routes = [
  route("osm:r1", "Α", "Γραμμή Α", "Δήμος Αγίου Δημητρίου", ["osm:n1", "osm:n2"]),
  route("osm:r2", "1", "Κηφισίας - Νερατζιώτισσα", "Δήμος Αμαρουσίου", ["osm:n3"]),
  route("osm:r3", null, "Άνω Γραμμή", "Δήμος Νέας Σμύρνης", ["osm:n4"]),
  route("osm:r4", "Β1", "Β1 Χαλάνδρι", "Δήμος Παπάγου-Χολαργού", ["osm:n5"]),
];
const cards = routes.map(card);
const stops: Record<string, MunicipalStop> = {
  "osm:n1": { name: "Έβρου", lat: 0, lon: 0 },
  "osm:n2": { name: null, lat: 0, lon: 0 },
  "osm:n3": { name: "Αγίου Γεωργίου", lat: 0, lon: 0 },
  "osm:n4": { name: "Πλατεία Νέας Σμύρνης", lat: 0, lon: 0 },
  "osm:n5": { name: "ΕΒΡΟΥ", lat: 0, lon: 0 },
};

describe("findMuniLines", () => {
  it("finds a line by its letter or number first, any case", () => {
    expect(findMuniLines(cards, "α").map(c => c.id)[0]).toBe("muni:osm:r1");
    expect(findMuniLines(cards, "b1").map(c => c.id)).toEqual(["muni:osm:r4"]);   // Latin b1 = Β1
  });
  it("finds every line of a municipality by the name people say (nominative, no accents)", () => {
    expect(findMuniLines(cards, "Χολαργός").map(c => c.id)).toEqual(["muni:osm:r4"]);
    expect(findMuniLines(cards, "μαρουσι").map(c => c.id)).toEqual(["muni:osm:r2"]);
    expect(findMuniLines(cards, "ΝΕΑ ΣΜΥΡΝΗ").map(c => c.id)).toEqual(["muni:osm:r3"]);
    expect(findMuniLines(cards, "Άγιος Δημήτριος").map(c => c.id)).toEqual(["muni:osm:r1"]);
  });
  it("finds a line by a word of its name", () => {
    expect(findMuniLines(cards, "κηφισιας").map(c => c.id)).toEqual(["muni:osm:r2"]);
  });
  it("finds nothing for an empty query", () => {
    expect(findMuniLines(cards, "  ")).toEqual([]);
  });
});

describe("findMuniStops", () => {
  it("finds named stops in any case, with their municipality; unnamed stops never", () => {
    const hits = findMuniStops(stops, routes, "εβρου");
    expect(hits.map(h => [h.id, h.municipality])).toEqual([["osm:n1", "Δήμος Αγίου Δημητρίου"], ["osm:n5", "Δήμος Παπάγου-Χολαργού"]]);
    expect(findMuniStops(stops, routes, "ε")).toEqual([]);   // under 2 letters
  });
});

describe("muniPlaces", () => {
  it("lists each municipality once, by name without «Δήμος», sorted", () => {
    expect(muniPlaces(routes)).toEqual(["Αγίου Δημητρίου", "Αμαρουσίου", "Νέας Σμύρνης", "Παπάγου-Χολαργού"]);
  });
});
