import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lineQuality, statsLineId, yesterday, type QualityDay } from "../src/lib/quality";

const hw = (cv_h: number, wait_min = 6.4, mean_headway_s = 480, dir = 0, line = "040") =>
  ({ line, dir, n: 90, mean_headway_s, median_headway_s: 450, cv_h, wait_min, ewt_min: 1, off_headway_share: 0.2, los: "D" });
const otp = (share: number | undefined, measured = 20, line = "pat:601") =>
  ({ line, runs: measured + 2, measured, on_time: 0, early: 0, late: 0, ...(share === undefined ? {} : { share }) });
const day = (o: Partial<QualityDay>): QualityDay => o;

describe("lineQuality: frequent direction (headways)", () => {
  it("green at cv_h 0.39, without the usual wait", () => {
    expect(lineQuality(day({ headways: { by_line: [hw(0.39, 4.4)] } }), "040", 0))
      .toEqual({ level: "ok", title: "Κανονικά χθες", text: "περίμενες ~4′" });
  });
  it("yellow just above 0.39 and at 0.74, with the usual wait", () => {
    for (const cv of [0.391, 0.74])
      expect(lineQuality(day({ headways: { by_line: [hw(cv, 6.4, 480)] } }), "040", 0))
        .toEqual({ level: "warn", title: "Αραιά χθες", text: "περίμενες ~6′ (κανονικά ~4′)" });
  });
  it("red above 0.74", () => {
    expect(lineQuality(day({ headways: { by_line: [hw(0.75, 9.6, 540)] } }), "040", 0))
      .toEqual({ level: "bad", title: "Πολύ αραιά χθες", text: "περίμενες ~10′ (κανονικά ~5′)" });
  });
  it("only the shown direction counts", () => {
    const d = day({ headways: { by_line: [hw(0.2, 4, 480, 1)] } });
    expect(lineQuality(d, "040", 0)).toBeNull();
    expect(lineQuality(d, "040", null)).toBeNull();   // direction unknown: no pill
    expect(lineQuality(d, "040", 1)?.level).toBe("ok");
  });
  it("an old day without wait_min shows nothing", () => {
    const { wait_min: _, ...old } = hw(0.3);
    expect(lineQuality(day({ headways: { by_line: [old as never] } }), "040", 0)).toBeNull();
  });
  it("headways win over the origin OTP", () => {
    const d = day({ headways: { by_line: [hw(0.2, 4, 480, 0, "pat:601")] }, origin_otp: { by_line: [otp(0.5)] } });
    expect(lineQuality(d, "pat:601", 0)?.title).toBe("Κανονικά χθες");
  });
});

describe("lineQuality: sparse line (origin_otp, per line)", () => {
  const q = (share: number | undefined, measured = 20) => lineQuality(day({ origin_otp: { by_line: [otp(share, measured)] } }), "pat:601", 0);
  it("green at 80%", () => {
    expect(q(0.8)).toEqual({ level: "ok", title: "Συνήθως στην ώρα του", text: "χθες 8 στα 10 δρομολόγια στην ώρα τους" });
  });
  it("yellow from 70% to 79%", () => {
    expect(q(0.799)).toEqual({ level: "warn", title: "Αργεί συχνά", text: "χθες 8 στα 10 δρομολόγια στην ώρα τους" });
    expect(q(0.7)?.level).toBe("warn");
  });
  it("red under 70%", () => {
    expect(q(0.699)).toEqual({ level: "bad", title: "Αργεί πολύ", text: "χθες 7 στα 10 δρομολόγια στην ώρα τους" });
  });
  it("needs at least 5 measured runs", () => {
    expect(q(0.9, 4)).toBeNull();
    expect(q(0.9, 5)?.level).toBe("ok");
  });
  it("no share, no pill; the direction does not matter", () => {
    expect(q(undefined)).toBeNull();
    expect(lineQuality(day({ origin_otp: { by_line: [otp(0.9)] } }), "pat:601", null)?.level).toBe("ok");
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

describe("yesterdayDay: one fetch per session", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { vi.resetModules(); vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
  afterEach(() => vi.unstubAllGlobals());

  it("fetches days/<yesterday>.json once and shares it", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ version: 1, date: "2026-11-11", headways: { by_line: [] } })));
    const { yesterdayDay } = await import("../src/lib/quality");
    const now = Date.UTC(2026, 10, 12, 12);
    const [a, b] = await Promise.all([yesterdayDay(now), yesterdayDay(now)]);
    expect(a).toBe(b);
    expect(await yesterdayDay(now + 60_000)).toBe(a);
    expect(await yesterdayDay(now + 5 * 3600_000)).toBe(a);   // a found day is kept while it is yesterday
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/days\/2026-11-11\.json$/);
  });
  it("404 or another date gives null; a network failure is asked again later", async () => {
    const { yesterdayDay } = await import("../src/lib/quality");
    const now = Date.UTC(2026, 10, 12, 12);
    fetchMock.mockRejectedValueOnce(new TypeError("network"));
    expect(await yesterdayDay(now)).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    expect(await yesterdayDay(now)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await yesterdayDay(now)).toBeNull();   // a 404 is kept for an hour
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ version: 1, date: "2026-11-10" })));
    expect(await yesterdayDay(now + 3600_000)).toBeNull();   // asked again; another date is not yesterday
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
