import { describe, expect, it } from "vitest";
import { byDayType, complete, gaps, hourBand, hourly, isWeekend, kmh, lineTrends, ranking, type DayStats, type LineStats } from "../src/lib/stats";

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

// Long-term helpers: complete days of known hours and lines.
const ld = (date: string, kmhAt: (h: number) => number | null, vehicles = 100, by_line: LineStats[] = []): DayStats => full({
  ...day(by_line),
  date,
  hours: Array.from({ length: 24 }, (_, h) => {
    const v = kmhAt(h);
    return { h, fixes: 10, vehicles, lines: 1, time_s: v == null ? 0 : 3600, dist_m: v == null ? 0 : v * 1000 };
  }),
});

describe("complete / isWeekend", () => {
  it("a day with gaps is not complete", () => {
    expect(complete(ld("2026-10-07", () => 10))).toBe(true);
    expect(complete(full(day([]), T0 + 12 * 3600))).toBe(false);
  });
  it("Saturday and Sunday are the weekend", () => {
    expect(["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12"].map(isWeekend)).toEqual([false, true, true, false]);
  });
});

describe("hourBand", () => {
  it("pools sums per hour, never a mean of means; min-max of the days", () => {
    const a = ld("2026-10-07", h => (h === 3 ? null : 10));
    // Day b: hour 8 has 3x the time of day a at 20 km/h; pooled = (10*1 + 20*3) / 4 = 17.5.
    const b = ld("2026-10-08", () => 20);
    b.hours[8] = { ...b.hours[8], time_s: 3 * 3600, dist_m: 3 * 20_000 };
    const band = hourBand([a, b]);
    expect(band).toHaveLength(24);
    expect(band[8].kmh).toBeCloseTo(17.5);
    expect(band[8]).toMatchObject({ min: 10, max: 20, n: 2 });
    expect(band[3]).toMatchObject({ kmh: 20, min: 20, max: 20, n: 1 });
    expect(hourBand([])[0]).toEqual({ h: 0, kmh: null, min: null, max: null, n: 0 });
  });
});

describe("byDayType", () => {
  it("splits weekdays from the weekend; vehicles a plain mean, speed pooled", () => {
    const t = byDayType([
      ld("2026-10-08", () => 10, 100), ld("2026-10-09", () => 20, 200),
      ld("2026-10-10", () => 30, 50),
    ]);
    expect(t.weekday.days).toBe(2);
    expect(t.weekend.days).toBe(1);
    expect(t.weekday.hours[9]).toMatchObject({ h: 9, vehicles: 150 });
    expect(t.weekday.hours[9].kmh).toBeCloseTo(15);
    expect(t.weekend.hours[9].vehicles).toBe(50);
    expect(t.weekend.hours[9].kmh).toBeCloseTo(30);
    expect(byDayType([]).weekend).toEqual({ days: 0, hours: expect.any(Array) });
    expect(byDayType([]).weekend.hours[0]).toEqual({ h: 0, vehicles: null, kmh: null });
  });
});

describe("lineTrends", () => {
  // Weekdays 07, 08, 09 (Wed-Fri), weekend 10, 11, Monday 12 the latest.
  const days = (latest: LineStats[]) => [
    ld("2026-10-07", () => 10, 100, [line("a", 20, 20), line("b", 10, 20), line("c", 15, 20), line("thin", 10, 20)]),
    ld("2026-10-08", () => 10, 100, [line("a", 20, 20), line("b", 20, 60), line("c", 15, 20)]),
    ld("2026-10-10", () => 10, 100, [line("a", 99, 20), line("b", 99, 20), line("c", 99, 20)]),
    ld("2026-10-12", () => 10, 100, latest),
  ];

  it("compares the latest day with the earlier days of its type, pooled", () => {
    const r = lineTrends(days([line("a", 10, 20), line("b", 22.5, 20), line("c", 15, 20), line("thin", 5, 14)]), 5)!;
    expect(r).toMatchObject({ date: "2026-10-12", weekend: false, baseDays: 2, eligible: 3 });
    // a: 20 -> 10 = -50 %. b: base (10*20 + 20*60) / 80 = 17.5 -> 22.5. c: no change, in neither list.
    expect(r.slower.map(x => x.line)).toEqual(["a"]);
    expect(r.slower[0].change).toBeCloseTo(-0.5);
    expect(r.faster.map(x => x.line)).toEqual(["b"]);
    expect(r.faster[0].base).toBeCloseTo(17.5);
    expect(r.faster[0].kmh).toBeCloseTo(22.5);
  });

  it("orders by change and keeps n", () => {
    const r = lineTrends(days([line("a", 18, 20), line("b", 1, 20), line("c", 14, 20)]), 2)!;
    expect(r.slower.map(x => x.line)).toEqual(["b", "a"]);
    expect(lineTrends(days([line("a", 18, 20), line("b", 1, 20), line("c", 14, 20)]), 1)!.slower.map(x => x.line)).toEqual(["b"]);
  });

  it("is null with fewer than 2 earlier days of the same type", () => {
    const d = days([]);
    expect(lineTrends(d.slice(0, 3), 5)).toBeNull(); // latest Saturday, no earlier weekend day
    expect(lineTrends([d[0], d[3]], 5)).toBeNull();
  });
});
