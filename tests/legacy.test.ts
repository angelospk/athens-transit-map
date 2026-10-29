import { describe, expect, it } from "vitest";
import { busStopCard, busVehicleCard, cardTitle, legacyOf, railLineCard, railStationCard, routeCard, stationCard, trainCard } from "../src/lib/legacy";

describe("cards for today's map taps", () => {
  it("gives /v2 ids", () => {
    expect(busVehicleCard("021", "12216")).toMatchObject({ kind: "vehicle", id: "oasa:12216", line: "oasa:021" });
    expect(busStopCard("400012", "Πλ. Καραϊσκάκη").id).toBe("oasa:400012");
    expect(stationCard("ΣΥΝΤΑΓΜΑ", ["M2", "M3"]).id).toBe("stasy:συνταγμα-metro");
    expect(stationCard("Άγιος  Νικόλαος", ["T6"]).id).toBe("stasy:αγιοσ νικολαοσ-tram");
    expect(railStationCard("abc", "Πειραιάς").id).toBe("proastiakos:abc");
    expect(trainCard({ kind: "metro", id: "40028" }, "M1", "M1", "stasy:run:40028:2026-10-29").id).toBe("stasy:run:40028:2026-10-29");
    expect(trainCard({ kind: "suburban", id: "1226" }, "PIRAIR", "1226")).toMatchObject({ id: "proastiakos:1226", line: "proastiakos:PIRAIR" });
    expect(railLineCard({ kind: "metro", id: "M2" }).id).toBe("stasy:M2");
  });
});

describe("legacyOf", () => {
  it("round-trips every tap", () => {
    expect(legacyOf(busVehicleCard("021", "12216"))).toEqual({ kind: "bus-vehicle", line: "021", id: "12216" });
    expect(legacyOf(routeCard("040", "5512"))).toEqual({ kind: "route", line: "040", variant: "5512" });
    expect(legacyOf({ kind: "line", id: "oasa:040" })).toEqual({ kind: "route", line: "040" });
    expect(legacyOf(busStopCard("400012", "x"))).toEqual({ kind: "bus-stop", code: "400012" });
    expect(legacyOf(stationCard("ΣΥΝΤΑΓΜΑ", ["M2"]))).toEqual({ kind: "station", name: "ΣΥΝΤΑΓΜΑ", folded: "συνταγμα" });
    expect(legacyOf({ kind: "stop", id: "stasy:συνταγμα-metro" })).toEqual({ kind: "station", folded: "συνταγμα" });
    expect(legacyOf(railStationCard("abc", "x"))).toEqual({ kind: "rail-station", id: "abc" });
    expect(legacyOf({ kind: "vehicle", id: "stasy:run:40028:2026-10-29", line: "stasy:M1" })).toEqual({ kind: "train", sel: { kind: "metro", id: "40028" } });
    expect(legacyOf(trainCard({ kind: "suburban", id: "1226" }, "PIRAIR", "x"))).toEqual({ kind: "train", sel: { kind: "suburban", id: "1226" } });
    expect(legacyOf(railLineCard({ kind: "suburban", id: "PIRAIR" }))).toEqual({ kind: "rail-line", line: { kind: "suburban", id: "PIRAIR" } });
  });
  it("knows no other source", () => {
    expect(legacyOf({ kind: "stop", id: "xyz:1" })).toBeNull();
  });
  it("titles a card that came without one", () => {
    expect(cardTitle({ kind: "stop", id: "oasa:1" })).toBe("Στάση");
    expect(cardTitle({ kind: "line", id: "stasy:M2" })).toBe("M2");
  });
});
