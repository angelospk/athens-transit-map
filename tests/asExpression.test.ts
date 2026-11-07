import { describe, expect, it } from "vitest";
import { asExpression } from "../src/lib/map/scene3d";

describe("asExpression", () => {
  it("converts the base map's legacy filters, and passes expressions through", () => {
    expect(asExpression(["all", ["==", "$type", "LineString"], ["in", "class", "motorway", "trunk"]]))
      .toEqual(["all", ["==", ["geometry-type"], "LineString"], ["match", ["get", "class"], ["motorway", "trunk"], true, false]]);
    expect(asExpression(["!in", "brunnel", "tunnel"])).toEqual(["match", ["get", "brunnel"], ["tunnel"], false, true]);
    expect(asExpression(["!has", "name"])).toEqual(["!", ["has", "name"]]);
    const e = ["==", ["get", "class"], "primary"];
    expect(asExpression(e)).toBe(e);
    expect(asExpression(["weird", "x"])).toBeNull();
  });
});
