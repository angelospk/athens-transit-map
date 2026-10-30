import { describe, expect, it } from "vitest";
import { railCheck, railHeads, railHitText, railNoneText, type RailSpec } from "../src/lib/railAlerts";
import type { V2Arrival, V2Pattern } from "../src/lib/v2";

const NOW = 1_800_000_000;
const spec: RailSpec = {
  stop: "stasy:συνταγμα-metro", name: "Σύνταγμα", line: "stasy:M3", label: "Μ3", toward: "Δουκίσσης Πλακεντίας",
  heads: ["Δ. ΠΛΑΚΕΝΤΙΑΣ", "ΑΕΡΟΔΡΟΜΙΟ"], min: 3, until: NOW + 7200,
};
const arr = (o: Partial<V2Arrival> = {}): V2Arrival => ({
  line: "stasy:M3", stop: spec.stop, headsign: "Δ. ΠΛΑΚΕΝΤΙΑΣ", at: NOW + 120, scheduled_at: NOW + 120, delay_s: null,
  source: "timetable", run: "stasy:run:1", vehicle: null, vehicle_label: null, platform: null, status: "scheduled", ...o,
});

describe("railCheck", () => {
  it("fires an arrival of the line and direction within min minutes, once", () => {
    const fired = new Map<string, number>();
    const r = railCheck(spec, [arr()], NOW, fired);
    expect(r.hits).toEqual([{ at: NOW + 120, live: false, run: "stasy:run:1" }]);
    expect(r.none).toBe(false);
    expect(railCheck(spec, [arr()], NOW + 20, fired).hits).toEqual([]);
  });

  it("matches the headsign without case and accents, any of the direction's headsigns", () => {
    const r = railCheck(spec, [arr({ headsign: "Αεροδρόμιο", run: "r2" })], NOW, new Map());
    expect(r.hits.map(h => h.run)).toEqual(["r2"]);
  });

  it("skips other lines, the other direction, far arrivals and departed ones", () => {
    const list = [
      arr({ line: "stasy:M2", run: "a" }),
      arr({ headsign: "ΔΗΜΟΤΙΚΟ ΘΕΑΤΡΟ", run: "b" }),
      arr({ at: NOW + 3 * 60 + 1, run: "c" }),
      arr({ at: NOW - 31, run: "d" }),
      arr({ stop: "stasy:other", run: "e" }),
    ];
    const r = railCheck(spec, list, NOW, new Map());
    expect(r.hits).toEqual([]);
    expect(r.none).toBe(false);   // run c still comes
  });

  it("says none when nothing of the line and direction is still to come", () => {
    expect(railCheck(spec, [], NOW, new Map()).none).toBe(true);
    expect(railCheck(spec, [arr({ headsign: "ΔΗΜΟΤΙΚΟ ΘΕΑΤΡΟ" }), arr({ at: NOW - 100 })], NOW, new Map()).none).toBe(true);
  });

  it("follows only its own run when it has one", () => {
    const one = { ...spec, run: "stasy:run:9" };
    const r = railCheck(one, [arr(), arr({ run: "stasy:run:9", at: NOW + 60, source: "live" })], NOW, new Map());
    expect(r.hits).toEqual([{ at: NOW + 60, live: true, run: "stasy:run:9" }]);
  });

  it("keys an arrival with no run by its scheduled time", () => {
    const fired = new Map<string, number>();
    expect(railCheck(spec, [arr({ run: null, at: NOW + 60, scheduled_at: NOW + 50 })], NOW, fired).hits).toHaveLength(1);
    expect(railCheck(spec, [arr({ run: null, at: NOW + 70, scheduled_at: NOW + 50 })], NOW + 5, fired).hits).toHaveLength(0);
    expect(railCheck(spec, [arr({ run: null, at: NOW + 150, scheduled_at: NOW + 150 })], NOW + 5, fired).hits).toHaveLength(1);
  });

  it("never fires an arrival with no run and no scheduled time: its key would change with each estimate", () => {
    const r = railCheck(spec, [arr({ run: null, scheduled_at: null, at: NOW + 60 })], NOW, new Map());
    expect(r).toEqual({ hits: [], none: false });
  });

  it("forgets fired arrivals after 2 hours", () => {
    const fired = new Map<string, number>([["old", NOW - 7300], ["new", NOW - 100]]);
    railCheck(spec, [], NOW, fired);
    expect([...fired.keys()]).toEqual(["new"]);
  });
});

describe("railHeads", () => {
  const pat = (headsign: string, direction: 0 | 1): V2Pattern => ({ id: headsign, headsign, direction, stops: [], shape: [] });
  const pats = [pat("Δ. ΠΛΑΚΕΝΤΙΑΣ", 0), pat("ΑΕΡΟΔΡΟΜΙΟ", 0), pat("ΔΗΜΟΤΙΚΟ ΘΕΑΤΡΟ", 1)];

  it("gives every headsign of the direction, and the arrival's own", () => {
    expect(railHeads(pats, 0, "ΠΑΛΛΗΝΗ")).toEqual(["Δ. ΠΛΑΚΕΝΤΙΑΣ", "ΑΕΡΟΔΡΟΜΙΟ", "ΠΑΛΛΗΝΗ"]);
    expect(railHeads(pats, 1, "ΔΗΜΟΤΙΚΟ ΘΕΑΤΡΟ")).toEqual(["ΔΗΜΟΤΙΚΟ ΘΕΑΤΡΟ"]);
  });

  it("gives only the headsign when the direction is unknown", () => {
    expect(railHeads(pats, null, "ΚΙΑΤΟ")).toEqual(["ΚΙΑΤΟ"]);
  });
});

describe("texts", () => {
  it("says the line, where it goes, the stop and the minutes", () => {
    expect(railHitText(spec, { at: NOW + 180, live: true, run: null }, NOW)).toBe("Μ3 προς Δουκίσσης Πλακεντίας: στο Σύνταγμα σε 3′.");
    expect(railHitText(spec, { at: NOW + 20, live: false, run: null }, NOW)).toBe("Μ3 προς Δουκίσσης Πλακεντίας: φτάνει τώρα στο Σύνταγμα (κατά το πρόγραμμα).");
  });

  it("says when nothing comes, so a strike is not silence", () => {
    expect(railNoneText(spec)).toBe("Μ3 προς Δουκίσσης Πλακεντίας: κανένα δρομολόγιο στο Σύνταγμα τώρα. Ίσως απεργία ή τέλος δρομολογίων.");
  });
});
