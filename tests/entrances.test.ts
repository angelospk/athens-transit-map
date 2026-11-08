import { describe, expect, it } from "vitest";
import { ahead, bearing, isEntrance, newId, normElevation, normHeading, withEdits, type Entrance3D } from "../src/lib/entrances";

const at: [number, number] = [37.975096, 23.735739];
const stairs: Entrance3D = { id: "syntagma-1", kind: "stairs", name: "Σύνταγμα", at, heading: 75 };
const lift: Entrance3D = { id: "syntagma-lift-1", kind: "elevator", name: "Σύνταγμα", at: [37.97505, 23.73577], heading: 75 };

describe("withEdits", () => {
  it("lays this device's edits over the published entrances", () => {
    const moved = { ...stairs, heading: 120 };
    expect(withEdits([stairs, lift], { [stairs.id]: moved })).toEqual([moved, lift]);
  });
  it("drops one removed (null) and adds new ones at the end", () => {
    const added: Entrance3D = { id: "omonoia-1", name: "Ομόνοια", at: [37.984, 23.728], heading: 0 };
    expect(withEdits([stairs, lift], { [lift.id]: null, [added.id]: added })).toEqual([stairs, added]);
  });
  it("leaves them as published without edits", () => {
    expect(withEdits([stairs], {})).toEqual([stairs]);
  });
});

describe("headings", () => {
  it("keeps a heading within 0-360", () => {
    expect(normHeading(-15)).toBe(345);
    expect(normHeading(360)).toBe(0);
    expect(normHeading(725)).toBe(5);
  });
  it("finds the bearing to a point ahead, both ways round", () => {
    for (const h of [0, 45, 75, 180, 270, 359]) expect(bearing(at, ahead(at, h, 11))).toBeCloseTo(h % 360, 0);
  });
  it("puts a point ahead the given metres away", () => {
    const p = ahead(at, 90, 100);
    const dx = (p[1] - at[1]) * Math.cos((at[0] * Math.PI) / 180) * 111320;
    expect(dx).toBeCloseTo(100, 0);
    expect(p[0]).toBeCloseTo(at[0], 6);
  });
});

describe("normElevation", () => {
  it("rounds to the centimetre and stays within ±20 m", () => {
    expect(normElevation(-0.30000000000000004)).toBe(-0.3);
    expect(normElevation(1.234)).toBe(1.23);
    expect(normElevation(-99)).toBe(-20);
  });
});

describe("newId", () => {
  it("makes a free id from the station's name, accents dropped", () => {
    expect(newId("Σύνταγμα", [])).toBe("συνταγμα-1");
    expect(newId("Σύνταγμα", ["συνταγμα-1"])).toBe("συνταγμα-2");
    expect(newId("Σύνταγμα lift", [])).toBe("συνταγμα-lift-1");
  });
});

describe("isEntrance", () => {
  it("accepts a whole one and turns away a broken one", () => {
    expect(isEntrance(stairs)).toBe(true);
    expect(isEntrance({ ...stairs, at: [37.9] })).toBe(false);
    expect(isEntrance({ ...stairs, heading: "east" })).toBe(false);
  });
});
