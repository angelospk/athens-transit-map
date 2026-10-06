import { describe, expect, it } from "vitest";
import { CYCLE_S, MOCK_SPEED, mockCityAt, mockLineAt, SYNTHETIC } from "../src/lib/mock";
import { isCityLive } from "../src/lib/city";
import { cumulativeLL, project } from "../src/lib/motion";
import type { CityLive } from "../src/lib/types";
import { distanceM } from "../src/lib/glide";
import { isLineLive } from "../src/lib/poller";

describe("mock backend", () => {
  it("answers in contract shape with a 30 s cycle", () => {
    const r = mockLineAt("040", 1_791_100_015);
    expect(r.status).toBe(200);
    expect(isLineLive(r.body)).toBe(true);
    const b = r.body as { updated_at: number; next_update_at: number };
    expect(b.next_update_at - b.updated_at).toBe(CYCLE_S);
    expect(b.updated_at).toBeLessThanOrEqual(1_791_100_015);
  });
  it("moves vehicles between cycles", () => {
    const a = mockLineAt("040", 1_791_100_000).body as { vehicles: { lat: number }[] };
    const b = mockLineAt("040", 1_791_100_030).body as { vehicles: { lat: number }[] };
    expect(a.vehicles.some((v, i) => v.lat !== b.vehicles[i].lat)).toBe(true);
  });
  it("moves vehicles at a bus-like speed and keeps next_stop_id ahead", () => {
    type V = { id: string; lat: number; lon: number; position_at: number; next_stop_id: string | null };
    const a = (mockLineAt("040", 1_791_100_000).body as { vehicles: V[] }).vehicles[0];
    const b = (mockLineAt("040", 1_791_100_030).body as { vehicles: V[] }).vehicles[0];
    const v = distanceM([a.lon, a.lat], [b.lon, b.lat]) / (b.position_at - a.position_at);
    expect(v).toBeGreaterThan(MOCK_SPEED * 0.5);   // straight-line distance <= distance along the route
    expect(v).toBeLessThanOrEqual(MOCK_SPEED * 1.01);
    expect(b.next_stop_id).not.toBeNull();
  });
  it("404s unknown lines", () => {
    expect(mockLineAt("ΖΖΖ", 1_791_100_000).status).toBe(404);
  });
  it("serves a city whose paths predict the next update", () => {
    const a = mockCityAt(1_791_100_000).body as CityLive, b = mockCityAt(1_791_100_030).body as CityLive;
    expect(isCityLive(a)).toBe(true);
    expect(a.vehicles.length).toBeGreaterThan(SYNTHETIC);
    const next = new Map(b.vehicles.map(v => [v.id, v]));
    // The next fix lies on the path the vehicle was given, about speed · dt along it.
    for (const v of a.vehicles.filter(v => v.speed && v.id.startsWith("S")).slice(0, 50)) {
      const w = next.get(v.id)!, geom = v.path!.map(([lat, lon]) => [lon, lat] as [number, number]);
      const p = project(geom, cumulativeLL(geom), [w.lon, w.lat]);
      expect(p.off).toBeLessThan(5);
      expect(p.s).toBeCloseTo(v.speed! * (w.position_at - v.position_at), -1);
    }
  });
});
