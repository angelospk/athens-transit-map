import { describe, expect, it } from "vitest";
import { municipalFC, parseMunicipal } from "../src/lib/municipal";

const body = {
  routes: [
    { id: "osm:r1", ref: "Β1", name: "Δημοτικό Λεωφορείο Β1: Πολύδροσο → Κοιμητήριο", municipality: "Δήμος Χαλανδρίου",
      timetable_url: "https://www.chalandri.gr/x/", shape: [[[38.02, 23.8], [38.03, 23.81]], [[38.04, 23.82], [38.05, 23.83]]],
      stops: ["osm:n1", "osm:n2"] },
    { id: "osm:r2", ref: "Β2", name: "Δημοτικό Λεωφορείο Β2", municipality: "Δήμος Χαλανδρίου",
      timetable_url: "https://www.chalandri.gr/x/", shape: [[[38.03, 23.81], [38.02, 23.8]]], stops: ["osm:n2"] },
    { id: "osm:r3", ref: null, name: "Τοπική κυκλική", municipality: "Δήμος Πουθενά", timetable_url: null,
      shape: [[[37.9, 23.7], [37.91, 23.71]]], stops: [] },
  ],
  stops: { "osm:n1": { name: "Πολύδροσο", lat: 38.02, lon: 23.8 }, "osm:n2": { name: null, lat: 38.03, lon: 23.81 } },
  updated_at: 1793793600,
  attribution: "© OpenStreetMap contributors (ODbL)",
};

describe("parseMunicipal", () => {
  it("keeps a body with routes", () => {
    const d = parseMunicipal(body);
    expect(d?.routes).toHaveLength(3);
    expect(d?.attribution).toBe("© OpenStreetMap contributors (ODbL)");
  });

  it("is null before the backend has data, and for anything else", () => {
    expect(parseMunicipal({ routes: [], stops: {}, updated_at: null, attribution: "x" })).toBeNull();
    expect(parseMunicipal(null)).toBeNull();
    expect(parseMunicipal({ error: "not_found" })).toBeNull();
    expect(parseMunicipal("<html>")).toBeNull();
    expect(parseMunicipal({ routes: "x", stops: {} })).toBeNull();
  });

  it("drops a malformed route instead of failing the layer", () => {
    const d = parseMunicipal({ ...body, routes: [...body.routes, { id: "osm:r9", name: 3 }, null] });
    expect(d?.routes.map(r => r.id)).toEqual(["osm:r1", "osm:r2", "osm:r3"]);
  });
});

describe("municipalFC", () => {
  const fc = municipalFC(parseMunicipal(body)!);
  const lines = fc.features.filter(f => f.properties?.kind === "line");
  const stops = fc.features.filter(f => f.properties?.kind === "stop");

  it("draws each route as a MultiLineString in [lon, lat]", () => {
    expect(lines).toHaveLength(3);
    expect(lines[0].geometry).toEqual({ type: "MultiLineString",
      coordinates: [[[23.8, 38.02], [23.81, 38.03]], [[23.82, 38.04], [23.83, 38.05]]] });
    expect(lines[0].properties).toMatchObject({ m: "Δήμος Χαλανδρίου", url: "https://www.chalandri.gr/x/",
      title: "Β1 · Δημοτικό Λεωφορείο Β1: Πολύδροσο → Κοιμητήριο" });
    expect(lines[2].properties).toMatchObject({ m: "Δήμος Πουθενά", url: "", title: "Τοπική κυκλική" });
  });

  it("links only http(s) pages", () => {
    const bad = { ...body, routes: [{ ...body.routes[0], timetable_url: "javascript:alert(1)" }] };
    expect(municipalFC(parseMunicipal(bad)!).features[0].properties?.url).toBe("");
  });

  it("draws each stop once, with the lines that call there", () => {
    expect(stops).toHaveLength(2);
    expect(stops[0].geometry).toEqual({ type: "Point", coordinates: [23.8, 38.02] });
    expect(stops[0].properties).toMatchObject({ name: "Πολύδροσο", lines: "Β1", m: "Δήμος Χαλανδρίου" });
    expect(stops[1].properties).toMatchObject({ name: "Στάση", lines: "Β1, Β2" });
  });
});
