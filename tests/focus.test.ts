import { describe, expect, it } from "vitest";
import { STOP_ZOOM, VEHICLE_ZOOM, focusZoom, stopPin } from "../src/lib/focus";
import type { MetroData } from "../src/lib/metro";
import type { SuburbanData } from "../src/lib/suburban";
import type { TripIndex } from "../src/lib/trip";

const stopIx: TripIndex = { v: "t", s: [["Α", 37.98, 23.7, "100"], ["Β", 37.99, 23.71, "101"]], l: {} };
const metro: MetroData = { source: "t", lines: [], stations: [{ name: "Σύνταγμα", lon: 23.735, lat: 37.975, lines: ["M2"] }] };
const suburban: SuburbanData = { corridors: {}, stations: [{ id: "ATH", name: "Αθήνα", en: "Athens", lat: 37.99, lon: 23.72, corridors: [] }] };
const none = { busStop: null, stopIx, metroStation: null, metro, railStation: null, suburban };

describe("stopPin", () => {
  it("the open bus stop's point, as [lon, lat]", () => {
    expect(stopPin({ ...none, busStop: 1 })).toEqual([23.71, 37.99]);
  });
  it("the open metro or tram station's point", () => {
    expect(stopPin({ ...none, metroStation: "Σύνταγμα" })).toEqual([23.735, 37.975]);
  });
  it("the open suburban station's point", () => {
    expect(stopPin({ ...none, railStation: "ATH" })).toEqual([23.72, 37.99]);
  });
  it("null with no stop open, or one whose data is not in yet or unknown", () => {
    expect(stopPin(none)).toBeNull();
    expect(stopPin({ ...none, busStop: 0, stopIx: null })).toBeNull();
    expect(stopPin({ ...none, busStop: 9 })).toBeNull();
    expect(stopPin({ ...none, metroStation: "Άγνωστος", metro: null })).toBeNull();
    expect(stopPin({ ...none, railStation: "XXX" })).toBeNull();
  });
});

describe("focusZoom", () => {
  it("zooms in to the minimum when the map is further out, even if the point is in view", () => {
    expect(focusZoom(12, true, STOP_ZOOM)).toBe(STOP_ZOOM);
    expect(focusZoom(13, true, VEHICLE_ZOOM)).toBe(VEHICLE_ZOOM);
  });
  it("keeps a closer zoom, and moves only when the point is out of view (under the sheet)", () => {
    expect(focusZoom(17, false, STOP_ZOOM)).toBe(17);
    expect(focusZoom(17, true, STOP_ZOOM)).toBeNull();
    expect(focusZoom(STOP_ZOOM, true, STOP_ZOOM)).toBeNull();
  });
});
