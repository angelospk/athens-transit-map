import { describe, expect, it } from "vitest";
import { leaveNow, metresBetween, planStops, timeline, walkTo, type NowStop } from "../src/lib/now";
import type { StopRow } from "../src/lib/v2";

const row = (line: string, ats: number[], live = true): StopRow => ({
  line, dir: 0, headsign: "ΣΥΝΤΑΓΜΑ", vehicle: null,
  times: ats.map(at => ({ at, live, delay_s: 0, run: null, vehicle: null, platform: null })),
});
const now = 1_000_000;
const min = (m: number) => now + m * 60;

describe("leaveNow", () => {
  it("takes the first bus the walk can still reach, and when to set off", () => {
    const l = leaveNow([row("oasa:224", [min(2), min(9), min(20)])], 3, now)!;
    expect(l.at).toBe(min(9));          // the 2′ one leaves before the user gets there
    expect(l.inMin).toBe(9);
    expect(l.leaveIn).toBe(6);
    expect(l.nextAt).toBe(min(20));
  });

  it("says now when the walk takes all the time left", () => {
    expect(leaveNow([row("oasa:224", [min(4)])], 4, now)!.leaveIn).toBe(0);
  });

  it("prefers the favourite lines when one of them can be caught", () => {
    const rows = [row("oasa:235", [min(5)]), row("oasa:224", [min(12)])];
    expect(leaveNow(rows, 2, now, ["oasa:224"])!.line).toBe("oasa:224");
    expect(leaveNow(rows, 2, now)!.line).toBe("oasa:235");
  });

  it("falls back to any line when no favourite one can be caught", () => {
    const rows = [row("oasa:235", [min(5)]), row("oasa:224", [min(1)])];
    expect(leaveNow(rows, 2, now, ["oasa:224"])!.line).toBe("oasa:235");
  });

  it("is null when nothing can be caught", () => {
    expect(leaveNow([row("oasa:224", [min(1)])], 3, now)).toBeNull();
    expect(leaveNow([], 3, now)).toBeNull();
  });
});

describe("planStops and walkTo", () => {
  const me: [number, number] = [37.9763, 23.7497];
  const fav = (id: string, lat: number, lon: number): NowStop => ({ id, name: id, lat, lon, fav: true });
  const nearest: NowStop = { id: "n", name: "n", lat: 37.9765, lon: 23.7499, fav: false };

  it("keeps the favourite stops within reach, nearest first, then the nearest stop", () => {
    const far = fav("far", 38.05, 23.80), a = fav("a", 37.978, 23.751), b = fav("b", 37.9768, 23.7502);
    expect(planStops([far, a, b], nearest, me).map(s => s.id)).toEqual(["b", "a", "n"]);
  });

  it("without a location: the favourites as they are, else the nearest stop", () => {
    const a = fav("a", 0, 0);
    expect(planStops([a], nearest, null).map(s => s.id)).toEqual(["a"]);
    expect(planStops([], nearest, null).map(s => s.id)).toEqual(["n"]);
  });

  it("walks a quarter further than the crow flies, at 80 m a minute", () => {
    const s = { lat: 37.9763 + 400 / 110_540, lon: 23.7497 };   // 400 m north
    expect(Math.round(metresBetween(me, [s.lat, s.lon]))).toBe(400);
    expect(walkTo(me, s)).toBe(Math.ceil((400 * 1.25) / 80));
    expect(walkTo(null, s)).toBeNull();
  });
});

describe("timeline", () => {
  it("splits the wait into setting off, walking and waiting", () => {
    const t = timeline({ line: "x", headsign: "", dir: 0, at: 0, inMin: 8, leaveIn: 4, walk: 3, live: true, delay_s: 0, vehicle: null, nextAt: null });
    expect(t.leave).toBeCloseTo(4 / 8);
    expect(t.walk).toBeCloseTo(3 / 8);
    expect(t.wait).toBeCloseTo(1 / 8);
  });
});
