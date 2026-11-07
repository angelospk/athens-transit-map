import { afterEach, describe, expect, it, vi } from "vitest";
import { geocode } from "../src/lib/trip";

// A Photon answer: one street or house per [name, street, housenumber, district].
const answer = (rows: [string | null, string | null, string | null, string][]) => ({
  type: "FeatureCollection",
  features: rows.map(([name, street, housenumber, district]) => ({
    type: "Feature", geometry: { type: "Point", coordinates: [23.8, 37.9] },
    properties: { name, street, housenumber, district, type: name ? "street" : "house", osm_key: "highway" },
  })),
});

afterEach(() => vi.unstubAllGlobals());

describe("geocode: a side street the map does not name", () => {
  it("asks for the main street too, near the point, and puts it first", async () => {
    const asked: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: URL) => {
      asked.push(new URL(u));
      const q = new URL(u).searchParams.get("q");
      const body = q === "Πάροδος Κλεισθένους 7"
        ? answer([[null, "Κλεισθένους", "7", "Πειραιάς"]])                 // the number on a street of the name elsewhere
        : q === "Κλεισθένους" ? answer([["Κλεισθένους", null, null, "Παιανία"]]) : answer([]);
      return { ok: true, json: async () => body } as Response;
    }));
    const found = await geocode("Πάροδος Κλεισθένους 7", undefined, [37.95, 23.85]);
    expect(asked.map(u => u.searchParams.get("q"))).toEqual(["Πάροδος Κλεισθένους 7", "Κλεισθένους"]);
    expect(asked[1].searchParams.get("lat")).toBe("37.95");
    expect(found.map(p => p.label)).toEqual(["Κλεισθένους", "Κλεισθένους 7"]);
  });

  it("leaves a side street the map does name as it is", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => answer([["Πάροδος Ομήρου", null, null, "Χαλάνδρι"]]) }) as unknown as Response);
    vi.stubGlobal("fetch", fetch);
    const found = await geocode("Πάροδος Ομήρου", undefined, [38.02, 23.8]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(found.map(p => p.label)).toEqual(["Πάροδος Ομήρου"]);
  });
});
