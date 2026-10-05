import { describe, expect, it } from "vitest";
import { CYCLE_S, mockLineAt } from "../src/lib/mock";
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
  it("404s unknown lines", () => {
    expect(mockLineAt("ΖΖΖ", 1_791_100_000).status).toBe(404);
  });
});
