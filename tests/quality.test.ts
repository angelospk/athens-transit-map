import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dayBars, halfMin, lastDates, lineQuality, pickDay, statsLineId, yesterday, type QualityDay } from "../src/lib/quality";

const hw = (cv_h: number, wait_min = 6.4, mean_headway_s = 480, dir = 0, line = "040") =>
  ({ line, dir, n: 90, mean_headway_s, median_headway_s: 450, cv_h, wait_min, ewt_min: 1, off_headway_share: 0.2, los: "D" });
const otp = (share: number | undefined, measured = 20, line = "pat:601") =>
  ({ line, runs: measured + 2, measured, on_time: 0, early: 0, late: 0, ...(share === undefined ? {} : { share }) });
const day = (o: Partial<QualityDay>): QualityDay => o;

const pick = (q: ReturnType<typeof lineQuality>) => q && { kind: q.kind, level: q.level, text: q.text };

describe("halfMin", () => {
  it("rounds to the nearest half minute", () => {
    expect([4.5, 4.24, 4.26, 7, 6.9, 0.4, 0.2, 10.75].map(halfMin)).toEqual(["4½", "4", "4½", "7", "7", "½", "0", "11"]);
  });
});

describe("lineQuality: frequent direction (headways)", () => {
  it("3 bars at cv_h 0.39, without the usual wait", () => {
    expect(pick(lineQuality(day({ headways: { by_line: [hw(0.39, 4.4)] } }), "040", 0)))
      .toEqual({ kind: "wait", level: 3, text: "αναμονή ~4½′" });
  });
  it("2 bars just above 0.39 and at 0.74, with the usual wait", () => {
    for (const cv of [0.391, 0.74])
      expect(pick(lineQuality(day({ headways: { by_line: [hw(cv, 6.4, 480)] } }), "040", 0)))
        .toEqual({ kind: "wait", level: 2, text: "αναμονή ~6½′ (κανονικά ~4′)" });
  });
  it("1 bar above 0.74", () => {
    expect(pick(lineQuality(day({ headways: { by_line: [hw(0.75, 7.0, 540)] } }), "040", 0)))
      .toEqual({ kind: "wait", level: 1, text: "αναμονή ~7′ (κανονικά ~4½′)" });
  });
  it("keeps the window of the headways block", () => {
    const q = lineQuality(day({ headways: { from_h: 7, to_h: 21, by_line: [hw(0.2)] } }), "040", 0);
    expect(q?.kind === "wait" && [q.from_h, q.to_h]).toEqual([7, 21]);
  });
  it("only the shown direction counts", () => {
    const d = day({ headways: { by_line: [hw(0.2, 4, 480, 1)] } });
    expect(lineQuality(d, "040", 0)).toBeNull();
    expect(lineQuality(d, "040", null)).toBeNull();   // direction unknown: no pill
    expect(lineQuality(d, "040", 1)?.level).toBe(3);
  });
  it("an old day without wait_min shows nothing", () => {
    const { wait_min: _, ...old } = hw(0.3);
    expect(lineQuality(day({ headways: { by_line: [old as never] } }), "040", 0)).toBeNull();
  });
  it("headways win over the origin OTP", () => {
    const d = day({ headways: { by_line: [hw(0.2, 4, 480, 0, "pat:601")] }, origin_otp: { by_line: [otp(0.5)] } });
    expect(lineQuality(d, "pat:601", 0)?.kind).toBe("wait");
  });
});

describe("lineQuality: sparse line (origin_otp, per line)", () => {
  const q = (share: number | undefined, measured = 20) => pick(lineQuality(day({ origin_otp: { by_line: [otp(share, measured)] } }), "pat:601", 0));
  it("3 bars at 80%", () => {
    expect(q(0.8)).toEqual({ kind: "otp", level: 3, text: "8 στα 10 δρομολόγια στην ώρα" });
  });
  it("2 bars from 70% to 79%", () => {
    expect(q(0.799)).toEqual({ kind: "otp", level: 2, text: "8 στα 10 δρομολόγια στην ώρα" });
    expect(q(0.7)?.level).toBe(2);
  });
  it("1 bar under 70%", () => {
    expect(q(0.699)).toEqual({ kind: "otp", level: 1, text: "7 στα 10 δρομολόγια στην ώρα" });
  });
  it("needs at least 5 measured runs", () => {
    expect(q(0.9, 4)).toBeNull();
    expect(q(0.9, 5)?.level).toBe(3);
  });
  it("no share, no pill; the direction does not matter", () => {
    expect(q(undefined)).toBeNull();
    expect(lineQuality(day({ origin_otp: { by_line: [otp(0.9)] } }), "pat:601", null)?.level).toBe(3);
  });
});

describe("lineQuality: missing data", () => {
  it("no day, no block, no entry for the line, malformed entries", () => {
    expect(lineQuality(null, "040", 0)).toBeNull();
    expect(lineQuality(day({}), "040", 0)).toBeNull();
    expect(lineQuality(day({ headways: { by_line: [hw(0.2, 4, 480, 0, "041")] } }), "040", 0)).toBeNull();
    expect(lineQuality(day({ headways: { by_line: "x" as never } }), "040", 0)).toBeNull();
    expect(lineQuality(day({ headways: { by_line: [{ ...hw(0.2), cv_h: "0.2" } as never] } }), "040", 0)).toBeNull();
    expect(lineQuality(day({ origin_otp: { by_line: [{ ...otp(0.9), measured: "9" } as never] } }), "pat:601", 0)).toBeNull();
  });
});

describe("pickDay: yesterday, else the day before", () => {
  const y = day({ origin_otp: { by_line: [] } }), b = day({ headways: { by_line: [] } });
  it("yesterday's file wins, even without data for the line", () => {
    expect(pickDay(y, b)).toEqual({ day: y, word: "Χθες", back: 1 });
    expect(pickDay(y, null)).toEqual({ day: y, word: "Χθες", back: 1 });
  });
  it("no file for yesterday yet: the day before, as «Προχθές»", () => {
    expect(pickDay(null, b)).toEqual({ day: b, word: "Προχθές", back: 2 });
  });
  it("neither day: no pill", () => {
    expect(pickDay(null, null)).toBeNull();
  });
});

describe("lastDates and dayBars", () => {
  it("7 dates ending at the given one, oldest first, across a month end", () => {
    expect(lastDates("2026-11-03", 7)).toEqual(["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"]);
  });
  it("one bar per day of the same kind; a day without data is an empty slot", () => {
    const days = [
      { date: "a", day: day({ origin_otp: { by_line: [otp(0.85)] } }) },
      { date: "b", day: null },
      { date: "c", day: day({ origin_otp: { by_line: [otp(0.6, 3)] } }) },   // too few runs
      { date: "d", day: day({ origin_otp: { by_line: [otp(0.72)] } }) },
    ];
    expect(dayBars(days, "otp", "pat:601", null)).toEqual([{ date: "a", value: 0.85, level: 3 }, null, null, { date: "d", value: 0.72, level: 2 }]);
    expect(dayBars([{ date: "a", day: day({ headways: { by_line: [hw(0.8, 9.2)] } }) }], "wait", "040", 0)).toEqual([{ date: "a", value: 9.2, level: 1 }]);
    expect(dayBars([{ date: "a", day: day({ origin_otp: { by_line: [otp(0.9, 20, "040")] } }) }], "wait", "040", 0)).toEqual([null]);
  });
});

describe("statsLineId", () => {
  it("Athens and Thessaloniki: the native id; citybus.gr: the namespaced card id", () => {
    expect(statsLineId("athens", "oasa:040")).toBe("040");
    expect(statsLineId("thessaloniki", "oasa:31")).toBe("31");
    expect(statsLineId("patras", "pat:601")).toBe("pat:601");
  });
});

describe("yesterday", () => {
  it("is the day before in Athens time", () => {
    expect(yesterday(Date.UTC(2026, 10, 12, 10, 0))).toBe("2026-11-11"); // 12:00 Athens on 11-12
    expect(yesterday(Date.UTC(2026, 10, 12, 22, 30))).toBe("2026-11-12"); // 00:30 Athens on 11-13
    expect(yesterday(Date.UTC(2026, 10, 12, 21, 59))).toBe("2026-11-11"); // 23:59 Athens on 11-12
  });
});

describe("dayFile and shownDay: one fetch per file per session", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { vi.resetModules(); vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
  afterEach(() => vi.unstubAllGlobals());
  const file = (date: string) => new Response(JSON.stringify({ version: 1, date, headways: { by_line: [] } }));

  it("fetches days/<yesterday>.json once and shares it", async () => {
    fetchMock.mockImplementation(async () => file("2026-11-11"));
    const { shownDay } = await import("../src/lib/quality");
    const now = Date.UTC(2026, 10, 12, 12);
    const [a, b] = await Promise.all([shownDay(now), shownDay(now)]);
    expect(a?.word).toBe("Χθες");
    expect(a?.date).toBe("2026-11-11");
    expect(a?.day).toBe(b?.day);
    expect((await shownDay(now + 5 * 3600_000))?.day).toBe(a?.day);   // a found day is kept
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/days\/2026-11-11\.json$/);
  });
  it("yesterday not written yet: the day before, as «Προχθές»; yesterday asked again after an hour", async () => {
    fetchMock.mockImplementation(async (url: string) => url.endsWith("2026-11-10.json") ? file("2026-11-10") : new Response("", { status: 404 }));
    const { shownDay } = await import("../src/lib/quality");
    const now = Date.UTC(2026, 10, 12, 6);
    expect(await shownDay(now)).toMatchObject({ word: "Προχθές", date: "2026-11-10" });
    expect(await shownDay(now + 60_000)).toMatchObject({ word: "Προχθές" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockImplementation(async () => file("2026-11-11"));
    expect(await shownDay(now + 3600_000)).toMatchObject({ word: "Χθες", date: "2026-11-11" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("neither day, another date or a network failure gives null; a failure is asked again", async () => {
    const { dayFile, shownDay } = await import("../src/lib/quality");
    const now = Date.UTC(2026, 10, 12, 12);
    fetchMock.mockResolvedValue(new Response("", { status: 404 }));
    expect(await shownDay(now)).toBeNull();
    fetchMock.mockReset();
    fetchMock.mockRejectedValueOnce(new TypeError("network"));
    expect(await dayFile("2026-11-01", now)).toBeNull();
    fetchMock.mockResolvedValueOnce(file("2026-10-31"));
    expect(await dayFile("2026-11-01", now)).toBeNull();   // asked again; another date is not that day
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
