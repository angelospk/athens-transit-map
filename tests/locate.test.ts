import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { distanceM } from "../src/lib/glide";
import { Locator, measuredSpeed, nextInterval, userPlan, type Fix, type LocState } from "../src/lib/locate";

const fix = (lon: number, at: number, extra: Partial<Fix> = {}): Fix =>
  ({ pos: [lon, 37.97], acc: 10, at, speed: null, heading: null, ...extra });

describe("measuredSpeed and nextInterval", () => {
  it("trusts the device speed when accurate, else two fixes that moved beyond their accuracy", () => {
    expect(measuredSpeed(null, fix(23.7, 0, { speed: 12 }))).toBe(12);
    expect(measuredSpeed(null, fix(23.7, 0, { speed: 12, acc: 150 }))).toBeNull();
    expect(measuredSpeed(fix(23.7, 0), fix(23.701, 10_000))).toBeCloseTo(8.8, 1);   // 88 m in 10 s
    expect(measuredSpeed(fix(23.7, 0, { acc: 50 }), fix(23.7004, 10_000))).toBe(0);   // 35 m < 50 m accuracy
    expect(measuredSpeed(fix(23.7, 0), fix(23.7, 0))).toBeNull();
    expect(measuredSpeed(null, fix(23.7, 0, { speed: NaN }))).toBeNull();
  });
  it("polls every 5 s in a vehicle, 10 s walking, then backs off to 30 s", () => {
    expect(nextInterval(8, 3)).toEqual({ ms: 5000, still: 0 });
    expect(nextInterval(1, 3)).toEqual({ ms: 10_000, still: 0 });
    expect(nextInterval(0, 0)).toEqual({ ms: 15_000, still: 1 });
    expect(nextInterval(null, 1)).toEqual({ ms: 20_000, still: 2 });
    expect(nextInterval(0, 9)).toEqual({ ms: 30_000, still: 10 });
  });
});

describe("userPlan", () => {
  it("heads on along the heading for at most 5 s when moving with a good fix", () => {
    const p = userPlan(fix(23.7, 1000_000, { heading: 90 }), 10);
    expect(p.target(1000)).toBe(0);
    expect(p.target(1002)).toBeCloseTo(20, 5);
    expect(p.target(1100)).toBeCloseTo(50, 5);
    expect(distanceM(p.geom[0], p.geom[1])).toBeCloseTo(50, 0);
    expect(p.geom[1][0]).toBeGreaterThan(23.7);   // east
  });
  it("stays at the fix when standing, unsure or without heading", () => {
    expect(userPlan(fix(23.7, 0, { heading: 90 }), 0.3).geom).toHaveLength(1);
    expect(userPlan(fix(23.7, 0, { heading: null }), 10).geom).toHaveLength(1);
    expect(userPlan(fix(23.7, 0, { heading: 90, acc: 80 }), 10).geom).toHaveLength(1);
  });
});

describe("Locator", () => {
  type Cb = { ok: (p: GeolocationPosition) => void; err: (e: GeolocationPositionError) => void };
  let calls: Cb[];
  let hidden: boolean;
  const pos = (lon: number, t: number, speed: number | null = null) =>
    ({ timestamp: t, coords: { longitude: lon, latitude: 37.97, accuracy: 10, speed, heading: null } }) as unknown as GeolocationPosition;
  const make = () => {
    const states: LocState[] = [], fixes: Fix[] = [];
    const l = new Locator({
      geo: { getCurrentPosition: (ok, err) => calls.push({ ok, err }) },
      onFix: f => fixes.push(f), onState: s => states.push(s), isHidden: () => hidden,
    });
    return { l, states, fixes };
  };
  beforeEach(() => { vi.useFakeTimers(); calls = []; hidden = false; });
  afterEach(() => vi.useRealTimers());

  it("polls one request at a time, faster while moving", async () => {
    const { l, fixes, states } = make();
    l.start();
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60_000);   // a permission prompt left open: no second request
    expect(calls).toHaveLength(1);
    calls[0].ok(pos(23.7, Date.now(), 10));
    expect(states).toEqual(["searching", "on"]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(2);
    calls[1].ok(pos(23.7, Date.now(), 0));
    await vi.advanceTimersByTimeAsync(14_999);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(3);
    expect(fixes).toHaveLength(2);
  });

  it("ignores late callbacks after stop, and stops for good when denied", async () => {
    const { l, fixes, states } = make();
    l.start();
    l.stop();
    calls[0].ok(pos(23.7, Date.now()));
    expect(fixes).toHaveLength(0);
    l.start();
    calls[1].err({ code: 1 } as GeolocationPositionError);
    expect(states.at(-1)).toBe("denied");
    await vi.advanceTimersByTimeAsync(300_000);
    expect(calls).toHaveLength(2);
  });

  it("retries an unavailable position with backoff, and pauses while hidden", async () => {
    const { l, states } = make();
    l.start();
    calls[0].err({ code: 3 } as GeolocationPositionError);
    expect(states.at(-1)).toBe("unavailable");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toHaveLength(2);
    calls[1].ok(pos(23.7, Date.now()));
    hidden = true;
    l.visibilityChanged();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toHaveLength(2);
    hidden = false;
    l.visibilityChanged();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(3);                // overdue: at once
  });

  it("drops a fix older than the last one", () => {
    const { l, fixes } = make();
    l.start();
    calls[0].ok(pos(23.7, 5000));
    vi.advanceTimersByTime(15_000);
    calls[1].ok(pos(23.8, 4000));
    expect(fixes).toHaveLength(1);
  });

  it("keeps one request in flight across stop and start", () => {
    const { l, fixes } = make();
    l.start();
    l.stop();
    l.start();
    expect(calls).toHaveLength(1);              // the browser request is still pending
    calls[0].ok(pos(23.7, Date.now()));         // stale for the new session: ask again
    expect(fixes).toHaveLength(0);
    expect(calls).toHaveLength(2);
    calls[1].ok(pos(23.7, Date.now() + 1));
    expect(fixes).toHaveLength(1);
    l.stop();
    calls.length = 0;
  });
});

