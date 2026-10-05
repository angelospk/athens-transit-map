import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LinePoller, type FetchResult, type PollState } from "../src/lib/poller";
import type { LineLive } from "../src/lib/types";

const T0 = 1_791_100_000_000;

function body(nextInSec: number, nowMs = Date.now()): LineLive {
  const s = Math.floor(nowMs / 1000);
  return { line: "040", updated_at: s, next_update_at: s + nextInSec, vehicles: [] };
}

function setup(respond: (n: number) => FetchResult | Promise<FetchResult>, opts: { hidden?: () => boolean } = {}) {
  const starts: number[] = [];
  const signals: AbortSignal[] = [];
  const data: LineLive[] = [];
  const states: PollState[] = [];
  let inFlight = 0, maxInFlight = 0;
  const poller = new LinePoller({
    line: "040",
    fetchLine: async (_line, signal) => {
      starts.push(Date.now());
      signals.push(signal);
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      try { return await respond(starts.length); } finally { inFlight--; }
    },
    onData: d => data.push(d),
    onState: s => states.push(s),
    rand: () => 0,
    wall: () => Date.now(),
    mono: () => Date.now(),
    isHidden: opts.hidden ?? (() => false),
  });
  return { poller, starts, signals, data, states, maxInFlight: () => maxInFlight };
}

const gaps = (xs: number[]) => xs.slice(1).map((x, i) => x - xs[i]);

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); });
afterEach(() => { vi.useRealTimers(); });

describe("LinePoller", () => {
  it("fetches at once, then at next_update_at + jitter", async () => {
    const t = setup(() => ({ status: 200, body: body(30) }));
    t.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.starts).toEqual([T0]);
    expect(t.data).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30_999);
    expect(t.starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.starts).toHaveLength(2);
    t.poller.stop();
  });

  it("waits for next_update_at when the client clock is 45 s fast", async () => {
    // Fake time is the server clock; the cached snapshot changes every 30 s.
    const snap = () => { const u = Math.floor((Date.now() - T0) / 30_000) * 30 + T0 / 1000; return { line: "040", updated_at: u, next_update_at: u + 30, vehicles: [] }; };
    const starts: number[] = [];
    const poller = new LinePoller({
      line: "040",
      fetchLine: async () => { starts.push(Date.now()); return { status: 200, body: snap() }; },
      onData: () => {}, onState: () => {}, rand: () => 0,
      wall: () => Date.now() + 45_000, mono: () => Date.now(), isHidden: () => false,
    });
    poller.start();
    await vi.advanceTimersByTimeAsync(95_000);
    expect(starts).toEqual([T0, T0 + 31_000, T0 + 61_000, T0 + 91_000]);
    poller.stop();
  });

  it("never fetches faster than every 5 s when next_update_at is stale", async () => {
    const t = setup(() => ({ status: 200, body: body(-100) }));
    t.poller.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.starts.length).toBe(13);
    for (const g of gaps(t.starts)) expect(g).toBeGreaterThanOrEqual(5_000);
    t.poller.stop();
  });

  it("backs off on 429 and 5xx, and resets after a success", async () => {
    const codes = [429, 500, 502, 200, 503];
    const t = setup(n => {
      const status = codes[n - 1] ?? 200;
      return status === 200 ? { status, body: body(30) } : status === 503 ? { status, body: { error: "warming_up" } } : { status, body: null };
    });
    t.poller.start();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    const g = gaps(t.starts);
    expect(g.slice(0, 4)).toEqual([10_000, 20_000, 40_000, 31_000]);
    expect(g[4]).toBe(10_000); // 503 warming_up retries after 10 s, not 80 s
    expect(t.states).toContain("backoff");
    t.poller.stop();
  });

  it("treats network errors (status 0) like 5xx", async () => {
    const t = setup(n => (n === 1 ? { status: 0, body: null } : { status: 200, body: body(30) }));
    t.poller.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(gaps(t.starts)).toEqual([10_000]);
    t.poller.stop();
  });

  it("stops for good on 404", async () => {
    const t = setup(() => ({ status: 404, body: { error: "unknown_line" } }));
    t.poller.start();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(t.starts).toHaveLength(1);
    expect(t.states.at(-1)).toBe("unknown");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits 60 s while hidden and catches up on return without a burst", async () => {
    let hidden = false;
    const t = setup(() => ({ status: 200, body: body(30) }), { hidden: () => hidden });
    t.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    hidden = true;
    t.poller.visibilityChanged();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(t.starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.starts).toHaveLength(2);
    // back to visible 2 s after a fetch: next fetch is due at the normal target, not sooner than 5 s
    await vi.advanceTimersByTimeAsync(2_000);
    hidden = false;
    t.poller.visibilityChanged();
    await vi.advanceTimersByTimeAsync(2_999);
    expect(t.starts).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(28_000);
    expect(t.starts).toHaveLength(3);
    for (const g of gaps(t.starts)) expect(g).toBeGreaterThanOrEqual(5_000);
    t.poller.stop();
  });

  it("fetches at once on return to visible when the data is overdue", async () => {
    let hidden = true;
    const t = setup(() => ({ status: 200, body: body(30) }), { hidden: () => hidden });
    t.poller.start();
    await vi.advanceTimersByTimeAsync(45_000); // hidden: next fetch at 60 s
    hidden = false;
    t.poller.visibilityChanged();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.starts).toEqual([T0, T0 + 45_000]);
    t.poller.stop();
  });

  it("stop() aborts the in-flight request and leaves no timers", async () => {
    let release!: (r: FetchResult) => void;
    const t = setup(() => new Promise<FetchResult>(r => { release = r; }));
    t.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    t.poller.stop();
    expect(t.signals[0].aborted).toBe(true);
    release({ status: 200, body: body(30) });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.data).toHaveLength(0);
    expect(t.starts).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never has two requests in flight, even with slow responses", async () => {
    const t = setup(() => new Promise<FetchResult>(r => setTimeout(() => r({ status: 200, body: body(-10) }), 8_000)));
    t.poller.start();
    await vi.advanceTimersByTimeAsync(3_000);
    t.poller.visibilityChanged(); // a visibility event mid-flight must not start a second request
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.maxInFlight()).toBe(1);
    for (const g of gaps(t.starts)) expect(g).toBeGreaterThanOrEqual(8_000);
    t.poller.stop();
  });

  it("ignores malformed 200 bodies and backs off", async () => {
    const t = setup(n => (n === 1 ? { status: 200, body: { nope: true } } : { status: 200, body: body(30) }));
    t.poller.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.data).toHaveLength(1);
    expect(gaps(t.starts)).toEqual([10_000]);
    t.poller.stop();
  });

  it("retries a failure that took 8 s no earlier than 18 s after its start", async () => {
    const t = setup(n => n === 1
      ? new Promise<FetchResult>(r => setTimeout(() => r({ status: 500, body: null }), 8_000))
      : { status: 200, body: body(30) });
    t.poller.start();
    await vi.advanceTimersByTimeAsync(17_999);
    expect(t.starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.starts).toEqual([T0, T0 + 18_000]);
    t.poller.stop();
  });

  it("postpones an armed timer when the tab hides just before it fires", async () => {
    let hidden = false;
    const t = setup(() => ({ status: 200, body: body(30) }), { hidden: () => hidden });
    t.poller.start();
    await vi.advanceTimersByTimeAsync(30_999);
    hidden = true;
    t.poller.visibilityChanged();
    await vi.advanceTimersByTimeAsync(28_000);
    expect(t.starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_001);
    expect(t.starts).toEqual([T0, T0 + 60_000]);
    t.poller.stop();
  });

  it("does not bypass backoff when the tab is shown again", async () => {
    let hidden = false;
    const t = setup(n => (n === 1 ? { status: 429, body: null } : { status: 200, body: body(30) }), { hidden: () => hidden });
    t.poller.start();
    await vi.advanceTimersByTimeAsync(2_000);
    for (let i = 0; i < 6; i++) { hidden = !hidden; t.poller.visibilityChanged(); }
    await vi.advanceTimersByTimeAsync(7_999);
    expect(t.starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.starts).toEqual([T0, T0 + 10_000]);
    t.poller.stop();
  });

  it("start() twice makes one request", async () => {
    const t = setup(() => ({ status: 200, body: body(30) }));
    t.poller.start();
    t.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.starts).toHaveLength(1);
    t.poller.stop();
  });

  it("keeps the 5 s floor across stop/start and drops the old result", async () => {
    let n = 0;
    const releases: ((r: FetchResult) => void)[] = [];
    const t = setup(() => { n++; return new Promise<FetchResult>(r => releases.push(r)); });
    t.poller.start();
    await vi.advanceTimersByTimeAsync(1_000);
    t.poller.stop();
    t.poller.start();
    await vi.advanceTimersByTimeAsync(3_999);
    expect(n).toBe(1);
    releases[0]({ status: 200, body: body(30) }); // old request ignores abort and answers late
    await vi.advanceTimersByTimeAsync(1);
    expect(n).toBe(2);
    expect(t.data).toHaveLength(0);
    t.poller.stop();
  });

  it("keeps backoff across stop/start", async () => {
    const t = setup(n => (n === 1 ? { status: 429, body: null } : { status: 200, body: body(30) }));
    t.poller.start();
    await vi.advanceTimersByTimeAsync(1_000);
    t.poller.stop();
    t.poller.start();
    await vi.advanceTimersByTimeAsync(8_999);
    expect(t.starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.starts).toHaveLength(2);
    t.poller.stop();
  });

  it("times out a hung request after 15 s and backs off", async () => {
    const t = setup(n => (n === 1 ? new Promise<FetchResult>(() => {}) : { status: 200, body: body(30) }));
    t.poller.start();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(t.signals[0].aborted).toBe(true);
    expect(t.states.at(-1)).toBe("backoff");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.starts).toEqual([T0, T0 + 25_000]);
    t.poller.stop();
  });
});
