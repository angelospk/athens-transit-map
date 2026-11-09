// transit-health (ops/transit-health): the anomaly rules, the 2-run persistence and the output lines.
// Fixtures: trimmed real responses of 2026-11-09 (Athens /v2/vehicles, a Patras z9 tile).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  athensHour, inService, fromV2, fromTiles, tilesFor, evaluateCity, step, formatMessage, logLine,
  type HealthConfig, type Sample, type CityResult, type HealthState,
} from "../ops/transit-health/rules";

const fx = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/transit-health/${name}`, import.meta.url), "utf8"));
const athensBody = fx("athens-v2-vehicles.json");
const patrasTile = fx("patras-tile-9-286-197.json");

const cfg: HealthConfig = {
  maxAgeS: 120, minSample: 5, maxNoPositionRatio: 0.1, maxStaleRatio: 0.6, maxNoDirectionRatio: 0.2,
  feedOldS: 300, serviceHours: [7, 22], persistRuns: 2,
  minVehicles: { athens: 100, patras: 3 }, checkDirection: ["athens", "thessaloniki"],
};

const NOW = 1_794_213_000;
// A sample of n positioned vehicles, `old` of them older than 120 s, all with a direction.
function sample(city: string, n: number, old = 0, extra: Partial<Sample> = {}): Sample {
  const vehicles = Array.from({ length: n }, (_, i) => ({ hasPosition: true, at: NOW - (i < old ? 200 : 30), direction: 0 as number | null | undefined }));
  return { city, error: null, updatedAt: NOW - 5, sources: [], vehicles, ...extra };
}
const codes = (r: CityResult) => r.anomalies.map((a) => a.code).sort();

describe("time", () => {
  it("athensHour follows EET/EEST", () => {
    expect(athensHour(new Date("2026-11-09T05:30:00Z"))).toBe(7);   // UTC+2
    expect(athensHour(new Date("2026-07-01T04:00:00Z"))).toBe(7);   // UTC+3
    expect(athensHour(new Date("2026-11-09T22:10:00Z"))).toBe(0);
  });
  it("inService: start inclusive, end exclusive", () => {
    expect(inService(6, cfg)).toBe(false);
    expect(inService(7, cfg)).toBe(true);
    expect(inService(21, cfg)).toBe(true);
    expect(inService(22, cfg)).toBe(false);
    expect(inService(3, cfg)).toBe(false);
  });
});

describe("normalise", () => {
  it("fromV2 reads a real Athens /v2/vehicles body", () => {
    const s = fromV2("athens", athensBody);
    expect(s.city).toBe("athens");
    expect(s.error).toBeNull();
    expect(s.updatedAt).toBe(athensBody.updated_at);
    expect(s.sources).toEqual([{ id: "oasa", state: "ok" }]);
    expect(s.vehicles).toHaveLength(30);
    expect(s.vehicles[0]).toEqual({ hasPosition: true, at: athensBody.vehicles[0].position.at, direction: athensBody.vehicles[0].direction });
    expect(s.vehicles.filter((v) => v.direction == null)).toHaveLength(2);
  });
  it("fromV2: null position and a missing direction key", () => {
    const s = fromV2("athens", { updated_at: NOW, vehicles: [{ id: "a", position: null, direction: 1 }, { id: "b", position: { lat: 1, lon: 2, at: NOW } }] });
    expect(s.vehicles).toEqual([{ hasPosition: false, at: null, direction: 1 }, { hasPosition: true, at: NOW, direction: null }]);
    expect(s.sources).toEqual([]);
  });
  it("fromTiles dedupes by id across tiles and keeps the newest updated_at", () => {
    const other = { ...patrasTile, updated_at: patrasTile.updated_at + 7, vehicles: [patrasTile.vehicles[0], { ...patrasTile.vehicles[1], id: "new" }] };
    const s = fromTiles("patras", [patrasTile, other]);
    expect(s.vehicles).toHaveLength(9);
    expect(s.updatedAt).toBe(patrasTile.updated_at + 7);
    expect(s.sources).toEqual([]);
    expect(s.vehicles[0]).toEqual({ hasPosition: true, at: patrasTile.vehicles[0].position_at, direction: undefined });
  });
  it("fromTiles: a vehicle without lat/lon has no position", () => {
    const s = fromTiles("patras", [{ updated_at: NOW, vehicles: [{ id: "x", lat: null, lon: null, position_at: null }] }]);
    expect(s.vehicles).toEqual([{ hasPosition: false, at: null, direction: undefined }]);
  });
  it("tilesFor covers a [south, west, north, east] box at z9", () => {
    expect(tilesFor([38.12, 21.6, 38.34, 21.87])).toEqual([[286, 196], [286, 197], [287, 196], [287, 197]]);
    expect(tilesFor([38.2, 21.7, 38.21, 21.71])).toEqual([[286, 197]]);
  });
});

describe("evaluateCity", () => {
  it("the real Athens fixture is healthy", () => {
    const s = fromV2("athens", athensBody);
    const r = evaluateCity({ ...s, vehicles: [...s.vehicles, ...s.vehicles, ...s.vehicles, ...s.vehicles] }, cfg, athensBody.updated_at, true);
    expect(r.anomalies).toEqual([]);
    expect(r.count).toBe(120);
  });
  it("the real Patras tile is healthy", () => {
    const r = evaluateCity(fromTiles("patras", [patrasTile]), cfg, patrasTile.updated_at, true);
    expect(r.anomalies).toEqual([]);
  });
  it("stale: more than maxStaleRatio of positioned vehicles older than maxAgeS", () => {
    expect(codes(evaluateCity(sample("patras", 10, 7), cfg, NOW, true))).toEqual(["stale"]);
    expect(codes(evaluateCity(sample("patras", 10, 6), cfg, NOW, true))).toEqual([]);
    const r = evaluateCity(sample("patras", 10, 7), cfg, NOW, true);
    expect(r.anomalies[0].detail).toBe("7/10 older than 120s");
  });
  it("ratio rules need minSample vehicles", () => {
    expect(codes(evaluateCity(sample("patras", 4, 4), cfg, NOW, true))).toEqual([]);
  });
  it("no_position", () => {
    const s = sample("patras", 10);
    s.vehicles[0] = { hasPosition: false, at: null, direction: 0 };
    expect(codes(evaluateCity(s, cfg, NOW, true))).toEqual([]);           // 1/10 = 0.1, not above
    s.vehicles[1] = { hasPosition: false, at: null, direction: 0 };
    const r = evaluateCity(s, cfg, NOW, true);
    expect(codes(r)).toEqual(["no_position"]);
    expect(r.anomalies[0].detail).toBe("2/10 without position");
  });
  it("no_direction only for checkDirection cities", () => {
    const vs = Array.from({ length: 10 }, (_, i) => ({ hasPosition: true, at: NOW, direction: i < 3 ? null : 1 }));
    const r = evaluateCity({ ...sample("athens", 0), vehicles: vs }, { ...cfg, minVehicles: {} }, NOW, true);
    expect(codes(r)).toEqual(["no_direction"]);
    expect(r.anomalies[0].detail).toBe("3/10 without direction");
    const tiles = vs.map((v) => ({ ...v, direction: undefined }));
    expect(codes(evaluateCity({ ...sample("patras", 0), vehicles: tiles }, cfg, NOW, true))).toEqual([]);
  });
  it("empty: fewer than minVehicles in service hours", () => {
    const r = evaluateCity(sample("athens", 50), cfg, NOW, true);
    expect(codes(r)).toEqual(["empty"]);
    expect(r.anomalies[0].detail).toBe("50 vehicles < 100");
    expect(codes(evaluateCity(sample("drama", 0), cfg, NOW, true))).toEqual([]);   // no minimum configured
  });
  it("feed_old: updated_at older than feedOldS, or missing", () => {
    const r = evaluateCity(sample("patras", 10, 0, { updatedAt: NOW - 400 }), cfg, NOW, true);
    expect(codes(r)).toEqual(["feed_old"]);
    expect(r.anomalies[0].detail).toBe("updated 400s ago");
    expect(evaluateCity(sample("patras", 10, 0, { updatedAt: null }), cfg, NOW, true).anomalies)
      .toEqual([{ code: "feed_old", detail: "no updated_at" }]);
  });
  it("source: a stale or down source", () => {
    const r = evaluateCity(sample("athens", 150, 0, { sources: [{ id: "oasa", state: "stale" }, { id: "stasy", state: "indicative" }] }), cfg, NOW, true);
    expect(r.anomalies).toEqual([{ code: "source", detail: "oasa=stale" }]);
  });
  it("error wins: only the error code is checked", () => {
    const r = evaluateCity(sample("athens", 0, 0, { error: "HTTP 502" }), cfg, NOW, true);
    expect(r.anomalies).toEqual([{ code: "error", detail: "HTTP 502" }]);
    expect(r.checked).toEqual(["error"]);
    expect(r.count).toBe(0);
  });
  it("error is checked at night too", () => {
    expect(evaluateCity(sample("athens", 0, 0, { error: "timeout" }), cfg, NOW, false).anomalies)
      .toEqual([{ code: "error", detail: "timeout" }]);
  });
  it("night: only error is checked; nothing else can fire", () => {
    const r = evaluateCity(sample("athens", 3, 3, { updatedAt: null, sources: [{ id: "oasa", state: "down" }] }), cfg, NOW, false);
    expect(r.anomalies).toEqual([]);
    expect(r.checked).toEqual(["error"]);
  });
  it("ratio codes are checked only when the sample is big enough (a quiet hour cannot recover them)", () => {
    expect([...evaluateCity(sample("patras", 4), cfg, NOW, true).checked].sort()).toEqual(["empty", "error", "feed_old", "source"]);
    const s = sample("patras", 6);
    s.vehicles[0] = s.vehicles[1] = { hasPosition: false, at: null, direction: 0 };
    expect([...evaluateCity(s, cfg, NOW, true).checked].sort()).toEqual(["empty", "error", "feed_old", "no_direction", "no_position", "source"]);
  });
  it("day: every code is checked", () => {
    expect([...evaluateCity(sample("patras", 10), cfg, NOW, true).checked].sort())
      .toEqual(["empty", "error", "feed_old", "no_direction", "no_position", "source", "stale"]);
  });
});

describe("step (persistence, new and recovered only)", () => {
  const bad = (city = "athens", code = "stale", detail = "7/10 older than 120s"): CityResult =>
    ({ city, count: 10, anomalies: [{ code, detail }], checked: ["error", code] });
  const good = (city = "athens", code = "stale"): CityResult => ({ city, count: 10, anomalies: [], checked: ["error", code] });
  const night = (city = "athens"): CityResult => ({ city, count: 10, anomalies: [], checked: ["error"] });

  it("fires once after persistRuns runs, then stays quiet, then recovers after persistRuns clean runs", () => {
    let s: HealthState = {};
    let out = step(s, [bad()], 2); expect(out.events).toEqual([]); s = out.state;
    out = step(s, [bad()], 2);
    expect(out.events).toEqual([{ city: "athens", code: "stale", kind: "new", detail: "7/10 older than 120s" }]); s = out.state;
    out = step(s, [bad()], 2); expect(out.events).toEqual([]); s = out.state;
    out = step(s, [good()], 2); expect(out.events).toEqual([]); s = out.state;
    out = step(s, [good()], 2); expect(out.events).toEqual([{ city: "athens", code: "stale", kind: "recovered" }]); s = out.state;
    out = step(s, [good()], 2); expect(out.events).toEqual([]);
  });
  it("one bad run between good runs never fires", () => {
    let s: HealthState = {};
    for (const r of [bad(), good(), bad(), good()]) { const o = step(s, [r], 2); expect(o.events).toEqual([]); s = o.state; }
  });
  it("an unchecked code keeps its state (night does not recover or reset)", () => {
    let s = step(step({}, [bad()], 2).state, [bad()], 2).state;
    let o = step(s, [night()], 2); expect(o.events).toEqual([]); s = o.state;
    o = step(s, [night()], 2); expect(o.events).toEqual([]); s = o.state;
    o = step(s, [bad()], 2); expect(o.events).toEqual([]); s = o.state;      // still active, no repeat
    o = step(s, [good()], 2); s = o.state;
    o = step(s, [good()], 2); expect(o.events.map((e) => e.kind)).toEqual(["recovered"]);
    // a pending hit survives a night too
    s = step({}, [bad("patras")], 2).state;
    s = step(s, [night("patras")], 2).state;
    expect(step(s, [bad("patras")], 2).events.map((e) => e.kind)).toEqual(["new"]);
  });
  it("cities are independent; prev is not mutated", () => {
    const s0 = step({}, [bad("athens"), bad("patras", "empty", "0 vehicles < 3")], 2).state;
    const snapshot = JSON.stringify(s0);
    const o = step(s0, [bad("athens"), good("patras", "empty")], 2);
    expect(o.events).toEqual([{ city: "athens", code: "stale", kind: "new", detail: "7/10 older than 120s" }]);
    expect(JSON.stringify(s0)).toBe(snapshot);
  });
  it("persistRuns 1 fires on the first run", () => {
    expect(step({}, [bad()], 1).events.map((e) => e.kind)).toEqual(["new"]);
  });
});

describe("output", () => {
  it("formatMessage: null without events", () => {
    expect(formatMessage([])).toBeNull();
  });
  it("formatMessage: one message for all events of a run", () => {
    expect(formatMessage([
      { city: "athens", code: "stale", kind: "new", detail: "7/10 older than 120s" },
      { city: "patras", code: "empty", kind: "recovered" },
    ])).toEqual({
      title: "Staseis: 1 new, 1 recovered",
      body: "🔴 athens stale: 7/10 older than 120s\n🟢 patras empty recovered",
    });
  });
  it("logLine: one line, per-city status, events", () => {
    const results: CityResult[] = [
      { city: "athens", count: 998, anomalies: [], checked: [] },
      { city: "thessaloniki", count: 0, anomalies: [{ code: "error", detail: "HTTP 502" }], checked: ["error"] },
      { city: "patras", count: 9, anomalies: [{ code: "stale", detail: "" }, { code: "no_position", detail: "" }], checked: [] },
    ];
    expect(logLine("2026-11-09T08:00:00Z", true, results, [{ city: "patras", code: "stale", kind: "new", detail: "" }]))
      .toBe("2026-11-09T08:00:00Z day athens=998 thessaloniki=error patras=9!stale+no_position | new: patras/stale | recovered: -");
    expect(logLine("2026-11-09T01:00:00Z", false, [results[0]], []))
      .toBe("2026-11-09T01:00:00Z night athens=998 | new: - | recovered: -");
  });
});
