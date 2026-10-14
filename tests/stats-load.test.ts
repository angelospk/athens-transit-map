import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DayStats } from "../src/lib/stats";

const T0 = Date.UTC(2026, 9, 6, 21, 0) / 1000; // 2026-10-07 00:00 Athens
const dayFile = (date: string, first = T0): DayStats => ({
  version: 1, date, tz: "Europe/Athens", generated_at: 0, first_fix: first, last_fix: T0 + 86_399,
  files: 25, fixes: 24, vehicles: 1, lines: 1, by_line: [{ line: "1", fixes: 24, vehicles: 1, dist_m: 1, time_s: 1 }],
  hours: Array.from({ length: 24 }, (_, h) => ({ h, fixes: 1, vehicles: 1, lines: 1, dist_m: 1, time_s: 1 })),
});

const RAW = Symbol("malformed JSON");
let files: Record<string, unknown>;
let fail: Set<string>;
const fetchMock = vi.fn(async (url: string) => {
  const name = url.split("/v1/")[1];
  if (fail.has(name)) throw new TypeError("network");
  if (!(name in files)) return new Response("", { status: 404 });
  if (files[name] === RAW) return new Response("{not json", { status: 200 });
  return new Response(JSON.stringify(files[name]), { status: 200 });
});

async function load() {
  vi.resetModules();
  return import("../src/lib/stats");
}

beforeEach(() => {
  files = {};
  fail = new Set();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("validDay", () => {
  it("rejects a file that is not the day asked for or has broken hours", async () => {
    const { validDay } = await load();
    const d = dayFile("2026-10-07");
    expect(validDay(d, "2026-10-07")).toBe(true);
    expect(validDay(d, "2026-10-08")).toBe(false);
    expect(validDay({ ...d, version: 2 }, "2026-10-07")).toBe(false);
    expect(validDay({ ...d, hours: d.hours.slice(1) }, "2026-10-07")).toBe(false);
    expect(validDay({ ...d, hours: d.hours.map((h, i) => (i === 3 ? { ...h, h: 4 } : h)) }, "2026-10-07")).toBe(false);
    expect(validDay({ ...d, hours: d.hours.map((h, i) => (i === 3 ? { ...h, time_s: -1 } : h)) }, "2026-10-07")).toBe(false);
    expect(validDay({ ...d, by_line: [{ line: "1", dist_m: NaN }] } as unknown as DayStats, "2026-10-07")).toBe(false);
    expect(validDay(null, "2026-10-07")).toBe(false);
    expect(validDay({ ...d, tz: "Mars/Olympus" }, "2026-10-07")).toBe(false);
  });
});

describe("storedDays", () => {
  it("reads the newest days; partial and broken files are left out and counted", async () => {
    const { storedDays, LONG_DAYS } = await load();
    const dates = Array.from({ length: LONG_DAYS + 2 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);
    files["index.json"] = { version: 1, latest: dates.at(-1), days: dates };
    for (const d of dates) files[`days/${d}.json`] = dayFile(d);
    files[`days/${dates.at(-1)}.json`] = dayFile(dates.at(-1)!, T0 + 12 * 3600); // starts at noon
    files[`days/${dates.at(-2)}.json`] = { ...dayFile(dates.at(-2)!), hours: [] };
    const r = (await storedDays())!;
    expect(fetchMock).toHaveBeenCalledTimes(LONG_DAYS + 1);
    expect(r.days.map(d => d.date)).toEqual(dates.slice(2, -2));
    expect(r.partial).toBe(1);
    expect(r.bad).toBe(1);
  });

  it("a malformed day file is counted, not fatal; a malformed index throws", async () => {
    const { storedDays } = await load();
    files["index.json"] = { version: 1, latest: "2026-10-08", days: ["2026-10-07", "2026-10-08"] };
    files["days/2026-10-07.json"] = dayFile("2026-10-07");
    files["days/2026-10-08.json"] = RAW;
    const r = (await storedDays(0))!;
    expect(r.days.map(d => d.date)).toEqual(["2026-10-07"]);
    expect(r.bad).toBe(1);
    files["index.json"] = RAW;
    await expect(storedDays(3600_000)).rejects.toThrow();
  });

  it("caches an hour and shares a load in flight", async () => {
    const { storedDays } = await load();
    files["index.json"] = { version: 1, latest: "2026-10-07", days: ["2026-10-07"] };
    files["days/2026-10-07.json"] = dayFile("2026-10-07");
    const [a, b] = await Promise.all([storedDays(0), storedDays(0)]);
    expect(a).toBe(b);
    await storedDays(3599_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await storedDays(3600_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("no index yet is null; a failed fetch throws and is not cached", async () => {
    const { storedDays } = await load();
    expect(await storedDays(0)).toBeNull();
    files["index.json"] = { version: 1, latest: "2026-10-07", days: ["2026-10-07"] };
    fail.add("days/2026-10-07.json");
    await expect(storedDays(3600_000)).rejects.toThrow();
    fail.clear();
    files["days/2026-10-07.json"] = dayFile("2026-10-07");
    expect((await storedDays(3600_001))!.days).toHaveLength(1);
  });
});
