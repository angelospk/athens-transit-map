import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { placeSearch, type PlaceAnswer } from "../src/lib/placeSearch";
import type { Place } from "../src/lib/trip";

const place = (label: string): Place => ({ label, pts: [[37.97, 23.73]], lines: [], kind: "poi" });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(ask: (q: string, signal: AbortSignal) => Promise<Place[]>) {
  const got: PlaceAnswer[] = [];
  const s = placeSearch(ask, a => got.push(a));
  return { s, got, last: () => got[got.length - 1] };
}

describe("placeSearch (web#18)", () => {
  it("asks nothing below 3 letters, and says so at once", () => {
    const ask = vi.fn(async () => [place("x")]);
    const { s, last } = setup(ask);
    s.set("  Συ ");
    vi.advanceTimersByTime(1000);
    expect(ask).not.toHaveBeenCalled();
    expect(last()).toEqual({ q: "Συ", places: [], busy: false });
  });
  it("asks once, 300 ms after the last key, with the trimmed text", async () => {
    const ask = vi.fn(async (q: string) => [place(q)]);
    const { s, last } = setup(ask);
    s.set("Ακρ");
    vi.advanceTimersByTime(200);
    s.set("Ακρόπ");
    vi.advanceTimersByTime(200);
    s.set("Ακρόπολη ");
    expect(last()).toEqual({ q: "Ακρόπολη", places: [], busy: true });
    vi.advanceTimersByTime(299);
    expect(ask).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0]).toBe("Ακρόπολη");
    expect(last()).toEqual({ q: "Ακρόπολη", places: [place("Ακρόπολη")], busy: false });
  });
  it("aborts an older request and drops its late answer", async () => {
    const pending: { q: string; signal: AbortSignal; done: (p: Place[]) => void }[] = [];
    const ask = (q: string, signal: AbortSignal) => new Promise<Place[]>(done => pending.push({ q, signal, done }));
    const { s, got, last } = setup(ask);
    s.set("Πλάκα");
    await vi.advanceTimersByTimeAsync(300);
    s.set("Πλάκα Αθήνα");
    expect(pending[0].signal.aborted).toBe(true);
    pending[0].done([place("old")]);
    await vi.advanceTimersByTimeAsync(300);
    pending[1].done([place("new")]);
    await vi.advanceTimersByTimeAsync(0);
    expect(got.some(a => a.places.some(p => p.label === "old"))).toBe(false);
    expect(last()).toEqual({ q: "Πλάκα Αθήνα", places: [place("new")], busy: false });
  });
  it("answers with no places when the geocoder fails (offline, throttled)", async () => {
    const { s, last } = setup(async () => { throw new Error("HTTP 429"); });
    s.set("Μοναστηράκι");
    await vi.advanceTimersByTimeAsync(300);
    expect(last()).toEqual({ q: "Μοναστηράκι", places: [], busy: false });
  });
  it("stops: no request after it, and the one in flight is aborted", async () => {
    let signal: AbortSignal | null = null;
    const ask = vi.fn((_q: string, sg: AbortSignal) => { signal = sg; return new Promise<Place[]>(() => {}); });
    const { s, got } = setup(ask);
    s.set("Κηφισιά");
    await vi.advanceTimersByTimeAsync(300);
    s.set("Κηφισιάς");
    s.stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(signal!.aborted).toBe(true);
    expect(got[got.length - 1].busy).toBe(true);   // stop() says nothing more: the modal is gone
  });
});
