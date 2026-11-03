import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasDelays, MIN_DELAY_RUNS, slowLines, type DayStats, type LineDelay } from "../src/lib/stats";

const day = (date: string, by_line?: LineDelay[]): DayStats => ({
  version: 1, date, tz: "Europe/Athens", generated_at: 0, first_fix: 0, last_fix: 0, files: 1, fixes: 1, vehicles: 1, lines: 1,
  by_line: [], hours: Array.from({ length: 24 }, (_, h) => ({ h, fixes: 1, vehicles: 1, lines: 1, dist_m: 1, time_s: 1 })),
  ...(by_line ? { start_delay: { runs: by_line.reduce((s, l) => s + l.runs, 0), by_line } } : {}),
});
// A line's day from its start delays in seconds.
const ld = (line: string, ...ds: number[]): LineDelay => {
  const m = new Map<number, number>();
  for (const d of ds) m.set(Math.floor(d / 60), (m.get(Math.floor(d / 60)) ?? 0) + 1);
  const s = [...ds].sort((a, b) => a - b);
  return { line, runs: ds.length, mean_s: Math.round(ds.reduce((a, b) => a + b, 0) / ds.length), p90_s: s[Math.ceil(ds.length * 0.9) - 1],
    sum_s: ds.reduce((a, b) => a + b, 0), minutes: [...m].sort((a, b) => a[0] - b[0]) };
};
const times = (n: number, v: number) => Array.from({ length: n }, () => v);

describe("hasDelays", () => {
  it("is false for days without start_delay, or with a broken one", () => {
    expect(hasDelays([day("2026-11-01"), day("2026-11-02")])).toBe(false);
    expect(hasDelays([{ ...day("2026-11-01"), start_delay: { runs: 1, by_line: "x" } } as unknown as DayStats])).toBe(false);
    expect(hasDelays([day("2026-11-01"), day("2026-11-02", [ld("040", 60)])])).toBe(true);
  });
});

describe("slowLines", () => {
  it("adds the days up: mean from the sums, p90 from the merged minute histograms", () => {
    const r = slowLines([
      day("2026-11-09", [ld("040", ...times(5, 240), ...times(5, 360))]),
      day("2026-11-10", [ld("040", ...times(8, 60), ...times(2, 180))]),
    ], 7, 10, 20);
    // 20 runs, (1200 + 1800 + 480 + 360) / 20 = 192 s; the 18th of 20 is in minute 6, so up to 7 min.
    expect(r.rows).toEqual([{ line: "040", runs: 20, mean_s: 192, p90_min: 7 }]);
    expect(r).toMatchObject({ days: 2, runs: 20, eligible: 1 });
  });

  it("leaves out lines under the threshold and days before the window", () => {
    const r = slowLines([
      day("2026-11-03", [ld("A", ...times(30, 900))]), // 8 days before the newest: outside 7
      day("2026-11-04", [ld("A", ...times(5, 600)), ld("B", ...times(20, 60))]),
      day("2026-11-10", [ld("C", ...times(19, 1200))]),
    ], 7);
    expect(MIN_DELAY_RUNS).toBe(20);
    expect(r.rows.map(l => l.line)).toEqual(["B"]);
    expect(r).toMatchObject({ days: 2, runs: 44, eligible: 1 });
    const all = slowLines([day("2026-11-03", [ld("A", ...times(30, 900))]), day("2026-11-10")], 28);
    expect(all.rows.map(l => l.line)).toEqual(["A"]);
  });

  it("sorts by the exact mean, not the rounded one", () => {
    // P: 120.4 s, p90 < 3 min; Q: 119.75 s, p90 < 7 min. Rounded, both are 120 and Q would win on p90.
    const p = ld("P", ...times(18, 120), 124, 124), q = ld("Q", ...times(15, 77), 80, 80, 360, 360, 360);
    expect(slowLines([day("2026-11-10", [p, q])], 7).rows.map(l => l.line)).toEqual(["P", "Q"]);
  });

  it("sorts by mean, then p90, then line; keeps n; early starts are negative", () => {
    const r = slowLines([day("2026-11-10", [
      ld("Z", ...times(20, 120)), ld("Y", ...times(10, 0), ...times(10, 240)), ld("X", ...times(20, 120)), ld("W", ...times(20, -45)),
    ])], 7, 3);
    expect(r.rows.map(l => l.line)).toEqual(["Y", "X", "Z"]);
    expect(r.eligible).toBe(4);
    const w = slowLines([day("2026-11-10", [ld("W", ...times(20, -45))])], 7).rows[0];
    expect(w).toEqual({ line: "W", runs: 20, mean_s: -45, p90_min: 0 });
  });

  it("skips broken line entries and is empty without any measured day", () => {
    const broken = { line: "Q", runs: "5", sum_s: 1, minutes: null } as unknown as LineDelay;
    const r = slowLines([day("2026-11-10", [broken, ld("B", ...times(20, 60))])], 7);
    expect(r.rows.map(l => l.line)).toEqual(["B"]);
    const short = { ...ld("H", ...times(20, 60)), minutes: [] } as LineDelay; // counts do not add up to runs
    expect(slowLines([day("2026-11-10", [short])], 7).rows).toEqual([]);
    expect(slowLines([day("2026-11-10")], 7)).toEqual({ days: 0, runs: 0, eligible: 0, rows: [] });
    expect(slowLines([], 7)).toEqual({ days: 0, runs: 0, eligible: 0, rows: [] });
  });
});

describe("storedDays().all", () => {
  const files: Record<string, unknown> = {};
  beforeEach(() => vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const name = url.split("/v1/")[1];
    return name in files ? new Response(JSON.stringify(files[name]), { status: 200 }) : new Response("", { status: 404 });
  })));
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the partial days too, for the start delays; `days` stays the complete ones", async () => {
    vi.resetModules();
    const { storedDays } = await import("../src/lib/stats");
    const T0 = Date.UTC(2026, 10, 8, 22, 0) / 1000; // 2026-11-09 00:00 Athens
    const full = (date: string, first: number): DayStats => ({ ...day(date, [ld("040", 60)]), first_fix: first, last_fix: first + 86_399, fixes: 24 });
    files["index.json"] = { version: 1, latest: "2026-11-10", days: ["2026-11-09", "2026-11-10"] };
    files["days/2026-11-09.json"] = full("2026-11-09", T0);
    files["days/2026-11-10.json"] = full("2026-11-10", T0 + 86_400 + 12 * 3600); // starts at noon
    const r = (await storedDays())!;
    expect(r.days.map(d => d.date)).toEqual(["2026-11-09"]);
    expect(r.all.map(d => d.date)).toEqual(["2026-11-09", "2026-11-10"]);
    expect(r.partial).toBe(1);
  });
});
