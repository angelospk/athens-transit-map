import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { debounce, throttle } from "../src/lib/debounce";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("debounce", () => {
  it("calls once, 300 ms after the last call, with the last arguments", () => {
    const f = vi.fn(), d = debounce(f, 300);
    d(1); vi.advanceTimersByTime(299); d(2); vi.advanceTimersByTime(299);
    expect(f).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledWith(2);
  });

  it("a call after the wait starts a new round", () => {
    const f = vi.fn(), d = debounce(f, 300);
    d("a"); vi.advanceTimersByTime(300); d("b"); vi.advanceTimersByTime(300);
    expect(f.mock.calls).toEqual([["a"], ["b"]]);
  });

  it("cancel drops the pending call", () => {
    const f = vi.fn(), d = debounce(f, 300);
    d(); d.cancel(); vi.advanceTimersByTime(1000);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("throttle", () => {
  it("calls at most once per window, 'ms' after the first call, with the last arguments", () => {
    const f = vi.fn(), t = throttle(f, 1000);
    t(1); vi.advanceTimersByTime(400); t(2); vi.advanceTimersByTime(400); t(3);
    expect(f).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(f.mock.calls).toEqual([[3]]);
    t(4); vi.advanceTimersByTime(1000);
    expect(f.mock.calls).toEqual([[3], [4]]);
  });

  it("cancel drops the pending call and allows a new window", () => {
    const f = vi.fn(), t = throttle(f, 1000);
    t(1); t.cancel(); vi.advanceTimersByTime(2000);
    expect(f).not.toHaveBeenCalled();
    t(2); vi.advanceTimersByTime(1000);
    expect(f.mock.calls).toEqual([[2]]);
  });
});
