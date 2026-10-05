import { describe, expect, it } from "vitest";
import { ClockOffset, gapFloor, outcomeDelay } from "../src/lib/schedule";

const wall = 1_791_100_000_000;
const sec = wall / 1000;

describe("outcomeDelay ok", () => {
  const ok = (nextIn: number, interval = 30) =>
    ({ kind: "ok", nextUpdateAt: sec + nextIn, updatedAt: sec + nextIn - interval }) as const;

  it("waits until next_update_at + 1..3 s jitter", () => {
    expect(outcomeDelay({ outcome: ok(30), wallNow: wall, offsetMs: 0, jitter: 0 })).toBe(31_000);
    expect(outcomeDelay({ outcome: ok(30), wallNow: wall, offsetMs: 0, jitter: 1 })).toBe(33_000);
  });
  it("applies the server clock offset", () => {
    // server is 10 s ahead of the client: next update is 10 s sooner in client time
    expect(outcomeDelay({ outcome: ok(30), wallNow: wall, offsetMs: 10_000, jitter: 0 })).toBe(21_000);
  });
  it("clamps to [0, interval] so a skewed clock cannot stall polling", () => {
    expect(outcomeDelay({ outcome: ok(-100), wallNow: wall, offsetMs: 0, jitter: 0 })).toBe(1_000);
    expect(outcomeDelay({ outcome: ok(3600), wallNow: wall, offsetMs: 0, jitter: 0 })).toBe(31_000);
  });
  it("caps at 300 s when the interval is invalid", () => {
    const bad = { kind: "ok", nextUpdateAt: sec + 3600, updatedAt: sec + 3600 } as const;
    expect(outcomeDelay({ outcome: bad, wallNow: wall, offsetMs: 0, jitter: 0 })).toBe(301_000);
  });
});

describe("outcomeDelay failures", () => {
  it("retries warming_up after 10..12 s", () => {
    expect(outcomeDelay({ outcome: { kind: "warming" }, wallNow: wall, offsetMs: 0, jitter: 0 })).toBe(10_000);
    expect(outcomeDelay({ outcome: { kind: "warming" }, wallNow: wall, offsetMs: 0, jitter: 1 })).toBe(12_000);
  });
  it("backs off 10, 20, 40, 80, 120 s (cap)", () => {
    const d = (errors: number) => outcomeDelay({ outcome: { kind: "error", errors }, wallNow: wall, offsetMs: 0, jitter: 0 });
    expect([d(1), d(2), d(3), d(4), d(5), d(9)]).toEqual([10_000, 20_000, 40_000, 80_000, 120_000, 120_000]);
  });
});

describe("gapFloor", () => {
  it("is 5 s visible and 60 s hidden", () => {
    expect(gapFloor(false)).toBe(5_000);
    expect(gapFloor(true)).toBe(60_000);
  });
});

describe("ClockOffset", () => {
  it("is 0 before any response", () => {
    expect(new ClockOffset().ms).toBe(0);
  });
  it("detects a client clock that is 60 s slow", () => {
    const c = new ClockOffset();
    // server time = client + 60 s. A response fetched right after an update: t ≈ interval.
    const serverNow = sec + 60;
    c.observe(serverNow + 29, serverNow - 1, wall);
    expect(Math.abs(c.ms - 60_000)).toBeLessThanOrEqual(16_000);
    // a second response fetched just after the next update narrows the bounds
    c.observe(serverNow + 31 + 28, serverNow + 31 - 2, wall + 31_000);
    expect(Math.abs(c.ms - 60_000)).toBeLessThanOrEqual(2_000);
  });
  it("keeps 0 when a single response does not rule it out", () => {
    const c = new ClockOffset();
    c.observe(sec + 30, sec, wall);        // fresh response, accurate client clock
    expect(c.ms).toBe(0);
    c.observe(sec + 30, sec, wall + 29_000); // same cached copy shortly before it expires
    expect(c.ms).toBe(0);
  });
  it("detects a fast client clock once a nearly expired copy is seen", () => {
    const c = new ClockOffset();
    const serverNow = sec - 45;   // client 45 s ahead
    c.observe(serverNow + 30, serverNow, wall);
    c.observe(serverNow + 30, serverNow, wall + 29_000);
    expect(Math.abs(c.ms + 45_000)).toBeLessThanOrEqual(3_000);
  });
  it("resets when bounds contradict (clock jump)", () => {
    const c = new ClockOffset();
    c.observe(sec + 30, sec, wall);
    c.observe(sec + 30, sec, wall + 3_600_000); // the client clock jumped an hour forward
    expect(c.ms).toBeGreaterThanOrEqual(-3_600_000);
    expect(c.ms).toBeLessThanOrEqual(-3_568_000);
  });
  it("ignores invalid intervals", () => {
    const c = new ClockOffset();
    c.observe(sec + 30, sec + 40, wall);
    c.observe(Number.NaN, sec, wall);
    expect(c.ms).toBe(0);
  });
});
