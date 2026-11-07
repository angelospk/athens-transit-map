import { describe, expect, it } from "vitest";
import { glance, lineDiagram, lineSpeed, mainPattern, nextIndex } from "../src/lib/linediagram";
import type { V2Pattern, V2Run, V2Stop, V2Vehicle } from "../src/lib/v2";

const stop = (id: string): V2Stop => ({ id, name: `Στάση ${id}`, name_en: null, lat: 0, lon: 0, modes: ["bus"], lines: [], source: "oasa" });
const stops = Object.fromEntries(["a", "b", "c", "d", "e"].map(id => [id, stop(id)]));
const pat = (id: string, dir: 0 | 1, ids: string[]): V2Pattern => ({ id, headsign: "X", direction: dir, stops: ids, shape: [] });
const veh = (id: string, run: string | null, next: string | null, delay: number | null = 0): V2Vehicle => ({
  id, line: "oasa:224", run, mode: "bus", headsign: "X", label: id,
  position: { kind: "gps", lat: 0, lon: 0, bearing: null, at: 0 }, delay_s: delay, next_stop: next, motion: null, source: "oasa",
});
const run = (id: string, pattern: string, times: [string, number, boolean][]): V2Run => ({
  id, line: "oasa:224", headsign: "X", pattern, vehicle: null, vehicle_label: null, status: "running",
  stops: times.map(([s, at, passed]) => ({ stop: s, scheduled_at: at, at, delay_s: 0, source: "live", platform: null, passed })),
});
const now = 10_000;

describe("mainPattern", () => {
  it("takes the direction's pattern most vehicles run on, else the longest", () => {
    const ps = [pat("p1", 0, ["a", "b"]), pat("p2", 0, ["a", "b", "c"]), pat("q", 1, ["c", "a"])];
    expect(mainPattern(ps, 0)!.id).toBe("p2");
    const runs = { r1: run("r1", "p1", []), r2: run("r2", "p1", []) };
    expect(mainPattern(ps, 0, [veh("1", "r1", null), veh("2", "r2", null)], runs)!.id).toBe("p1");
    expect(mainPattern(ps, 1)!.id).toBe("q");
  });
});

describe("nextIndex", () => {
  const ids = ["a", "b", "c"];
  it("uses next_stop, else the first stop the run has not passed", () => {
    expect(nextIndex(veh("1", null, "b"), ids)).toBe(1);
    expect(nextIndex(veh("1", "r", "zz"), ids, run("r", "p", [["a", 1, true], ["c", 2, false]]))).toBe(2);
    expect(nextIndex(veh("1", null, "zz"), ids)).toBeNull();
  });
});

describe("lineDiagram", () => {
  const p = pat("p", 0, ["a", "b", "c", "d", "e"]);
  const runs = {
    r1: run("r1", "p", [["a", now - 300, true], ["b", now - 100, true], ["c", now + 60, false], ["d", now + 180, false], ["e", now + 300, false]]),
    r2: run("r2", "p", [["a", now + 120, false], ["b", now + 240, false], ["c", now + 420, false], ["d", now + 540, false], ["e", now + 660, false]]),
  };
  const items = lineDiagram(p, stops, [veh("1", "r1", "c", 30), veh("2", "r2", "a", 200)], runs, now, new Set(["d"]));

  it("puts each vehicle just before the stop it drives to", () => {
    expect(items.map(i => (i.kind === "stop" ? i.id : `[${i.id}]`))).toEqual(["[2]", "a", "b", "[1]", "c", "d", "e"]);
  });

  it("gives each stop the soonest arrival still to come, and marks the stops to mark", () => {
    const at = Object.fromEntries(items.flatMap(i => (i.kind === "stop" ? [[i.id, i.at]] : [])));
    expect(at).toEqual({ a: now + 120, b: now + 240, c: now + 60, d: now + 180, e: now + 300 });
    expect(items.find(i => i.kind === "stop" && i.id === "d")).toMatchObject({ here: true });
  });
});

describe("glance", () => {
  it("counts vehicles, averages delay and finds how often one passes", () => {
    const runs = {
      r1: run("r1", "p", [["c", now + 60, false]]),
      r2: run("r2", "p", [["c", now + 660, false]]),
      r3: run("r3", "p", [["c", now + 1380, false]]),
    };
    const g = glance([veh("1", "r1", null, 60), veh("2", "r2", null, 180), veh("3", "r3", null, null)], runs, now);
    expect(g).toEqual({ count: 3, delayMin: 2, everyMin: 11 });
  });

  it("has no numbers to give without vehicles", () => {
    expect(glance([], {}, now)).toEqual({ count: 0, delayMin: null, everyMin: null });
  });
});

describe("lineSpeed", () => {
  it("is the distance along the stops over the run's time", () => {
    // Three stops 0.01° of latitude apart (about 1.11 km each), 2.22 km in 10 minutes: about 13 km/h.
    const st = { a: { ...stop("a"), lat: 37.97 }, b: { ...stop("b"), lat: 37.98 }, c: { ...stop("c"), lat: 37.99 } };
    const p = pat("p", 0, ["a", "b", "c"]);
    const runs = { r: run("r", "p", [["a", 0, true], ["b", 300, true], ["c", 600, false]]) };
    expect(lineSpeed(p, st, [veh("1", "r", "c")], runs)).toBe(13);
    expect(lineSpeed(p, st, [], runs)).toBeNull();
  });
});
