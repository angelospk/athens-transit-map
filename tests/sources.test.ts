import { describe, expect, it } from "vitest";
import { BACKEND_REPO, GTFS_PAGE, TILE_CREDITS } from "../src/lib/sources";

describe("data sources", () => {
  it("links to the backend repo and the OASA GTFS dataset", () => {
    expect(BACKEND_REPO).toBe("https://github.com/angelospk/athens-transit-rt");
    expect(GTFS_PAGE).toBe("https://data.gov.gr/dataset/fb049bb1-aea6-4443-95fa-8b941dd6a057");
  });

  it("keeps the three credits of the tile style, with their links", () => {
    expect(TILE_CREDITS.map(c => [c.text, c.href])).toEqual([
      ["OpenFreeMap", "https://openfreemap.org"],
      ["© OpenMapTiles", "https://www.openmaptiles.org/"],
      ["OpenStreetMap", "https://www.openstreetmap.org/copyright"],
    ]);
  });
});
