import { describe, expect, it } from "vitest";
import { HELD_MAX_MS, heldNote, isWarmingBody, refreshHeld, type Held } from "../src/lib/held";

const parse = (b: unknown) => (b && typeof b === "object" && Array.isArray((b as { vehicles?: unknown }).vehicles) ? (b as { vehicles: number[] }) : null);
const good = (vehicles: number[]) => ({ status: 200, body: { vehicles } });
const T0 = 1_000_000;

describe("isWarmingBody", () => {
  it("a /v2 body whose source says warming_up", () => {
    expect(isWarmingBody({ sources: [{ id: "pat", state: "warming_up" }], lines: [], stops: [] })).toBe(true);
    expect(isWarmingBody({ sources: [{ state: "ok" }, { state: "warming_up" }] })).toBe(true);
  });
  it("an ok body, a body without sources, and junk are not warming", () => {
    expect(isWarmingBody({ sources: [{ state: "ok" }], vehicles: [] })).toBe(false);
    expect(isWarmingBody({ vehicles: [] })).toBe(false);
    expect(isWarmingBody(null)).toBe(false);
    expect(isWarmingBody("warming_up")).toBe(false);
    expect(isWarmingBody({ sources: "warming_up" })).toBe(false);
  });
});

describe("refreshHeld", () => {
  it("a good answer replaces the list and clears the failed mark", () => {
    const old: Held<{ vehicles: number[] }> = { value: { vehicles: [1, 2] }, at: T0, failed: true };
    expect(refreshHeld(old, good([3]), parse, T0 + 20_000)).toEqual({ value: { vehicles: [3] }, at: T0 + 20_000, failed: false });
  });
  it("a good but truly empty answer clears the list (night, no buses)", () => {
    const old: Held<{ vehicles: number[] }> = { value: { vehicles: [1, 2] }, at: T0, failed: false };
    expect(refreshHeld(old, good([]), parse, T0 + 20_000)?.value.vehicles).toEqual([]);
  });
  it.each([
    ["503", { status: 503, body: { error: "warming_up" } }],
    ["502 with an HTML page", { status: 502, body: null }],
    ["a timeout / network error (status 0)", { status: 0, body: null }],
    ["200 of another shape", { status: 200, body: { oops: 1 } }],
    ["200 that says warming_up, with an empty list", { status: 200, body: { sources: [{ state: "warming_up" }], vehicles: [] } }],
    ["200 with no body", { status: 200, body: null }],
  ])("%s keeps the last list, marked failed, with its time", (_, r) => {
    const old: Held<{ vehicles: number[] }> = { value: { vehicles: [1, 2] }, at: T0, failed: false };
    expect(refreshHeld(old, r, parse, T0 + 60_000)).toEqual({ value: { vehicles: [1, 2] }, at: T0, failed: true });
  });
  it("the time of the last good answer does not move on repeated failures", () => {
    let h: Held<{ vehicles: number[] }> | null = refreshHeld(null, good([1]), parse, T0);
    h = refreshHeld(h, { status: 503, body: null }, parse, T0 + 20_000);
    h = refreshHeld(h, { status: 0, body: null }, parse, T0 + 40_000);
    expect(h).toEqual({ value: { vehicles: [1] }, at: T0, failed: true });
  });
  it("drops the list after HELD_MAX_MS without a good answer (10 min)", () => {
    expect(HELD_MAX_MS).toBe(600_000);
    const old: Held<{ vehicles: number[] }> = { value: { vehicles: [1] }, at: T0, failed: true };
    expect(refreshHeld(old, { status: 503, body: null }, parse, T0 + HELD_MAX_MS - 1)).not.toBeNull();
    expect(refreshHeld(old, { status: 503, body: null }, parse, T0 + HELD_MAX_MS)).toBeNull();
  });
  it("a good answer after a long outage starts again", () => {
    const old: Held<{ vehicles: number[] }> = { value: { vehicles: [1] }, at: T0, failed: true };
    expect(refreshHeld(old, good([9]), parse, T0 + 3_600_000)?.value.vehicles).toEqual([9]);
  });
  it("a failure with nothing held stays null", () => {
    expect(refreshHeld(null, { status: 503, body: null }, parse, T0)).toBeNull();
  });
});

describe("heldNote", () => {
  const h = (failed: boolean): Held<number> => ({ value: 1, at: T0, failed });
  it("no note while the last refresh was good", () => {
    expect(heldNote(h(false), T0 + 400_000)).toBeNull();
    expect(heldNote(null, T0)).toBeNull();
  });
  it("one neutral line with the age of the last position", () => {
    expect(heldNote(h(true), T0 + 180_000)).toBe("Ενημέρωση σε εξέλιξη · τελευταία θέση πριν από 3′");
    expect(heldNote(h(true), T0 + 40_000)).toBe("Ενημέρωση σε εξέλιξη · τελευταία θέση πριν από 40″");
  });
  it("a clock that went back does not show a negative age", () => {
    expect(heldNote(h(true), T0 - 5_000)).toBe("Ενημέρωση σε εξέλιξη · τελευταία θέση πριν από 0″");
  });
});
