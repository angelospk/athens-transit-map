import { describe, expect, it } from "vitest";
import { gaps, hourly, kmh, ranking, type DayStats, type LineStats } from "../src/lib/stats";

const line = (id: string, speed: number, hours: number): LineStats =>
  ({ line: id, fixes: 1, vehicles: 1, time_s: hours * 3600, dist_m: (speed / 3.6) * hours * 3600 });

const day = (by_line: LineStats[], fixesPerHour: (h: number) => number = () => 10): DayStats => ({
  version: 1, date: "2026-10-06", tz: "Europe/Athens", generated_at: 0, first_fix: 0, last_fix: 0,
  files: 1, fixes: 0, vehicles: 0, lines: by_line.length, by_line,
  hours: Array.from({ length: 24 }, (_, h) => ({ h, fixes: fixesPerHour(h), vehicles: h, lines: 1, dist_m: h * 100, time_s: h ? 36 : 0 })),
});

describe("kmh", () => {
  it("is null without time", () => {
    expect(kmh(100, 0)).toBeNull();
    expect(kmh(1000, 360)).toBe(10);
  });
});

describe("hourly", () => {
  it("keeps 24 hours; an hour without time has no speed", () => {
    const h = hourly(day([]));
    expect(h).toHaveLength(24);
    expect(h[0]).toEqual({ h: 0, vehicles: 0, kmh: null });
    expect(h[5].kmh).toBeCloseTo(50);
  });
});

describe("ranking", () => {
  it("drops lines under the threshold and sorts both ends", () => {
    const lines = [line("a", 10, 20), line("b", 5, 20), line("c", 30, 20), line("d", 1, 14.9), line("e", 20, 15)];
    const r = ranking(day(lines), 2);
    expect(r.slow.map(x => x.line)).toEqual(["b", "a"]);
    expect(r.fast.map(x => x.line)).toEqual(["c", "e"]);
    expect(r.eligible).toBe(4);
    expect(r.fast[0]).toMatchObject({ line: "c", km: 600, hours: 20 });
    expect(r.fast[0].kmh).toBeCloseTo(30);
  });

  it("never shows a line in both lists, and breaks ties by line id", () => {
    const r = ranking(day([line("b", 10, 20), line("a", 10, 20), line("c", 12, 20)]), 10);
    expect(r.slow.map(x => x.line)).toEqual(["a"]);
    expect(r.fast.map(x => x.line)).toEqual(["c", "b"]);
    expect(ranking(day([]), 10)).toEqual({ slow: [], fast: [], eligible: 0 });
  });
});

// 00:00 and 23:59 on 2026-10-06 in Athens (UTC+3).
const T0 = Date.UTC(2026, 9, 5, 21, 0) / 1000, T24 = T0 + 86_399;
const full = (d: DayStats, first = T0, last = T24): DayStats => ({ ...d, fixes: 1, first_fix: first, last_fix: last });

describe("gaps", () => {
  it("names the hours before the first fix and after the last", () => {
    expect(gaps(full(day([]), T0 + 2 * 3600 + 600))).toEqual([0, 1]);
    expect(gaps(full(day([]), T0, T0 + 21 * 3600))).toEqual([22, 23]);
    expect(gaps({ ...day([]), fixes: 0 })).toHaveLength(24);
  });

  it("names the service hours without any fix", () => {
    expect(gaps(full(day([])))).toEqual([]);
    // Night hours 1-4 are often empty: not a gap.
    expect(gaps(full(day([], h => (h >= 1 && h <= 4 ? 0 : 5))))).toEqual([]);
    expect(gaps(full(day([], h => (h < 12 ? 0 : 5))))).toEqual([5, 6, 7, 8, 9, 10, 11]);
  });
});
