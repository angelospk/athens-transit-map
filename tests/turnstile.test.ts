import { describe, expect, it, vi } from "vitest";
import { TURNSTILE_SRC, TokenBox, turnstileOn } from "../src/lib/turnstile";

// The loaded script is remembered per module: a fresh module for each test.
const fresh = async () => { vi.resetModules(); return (await import("../src/lib/turnstile")).loadTurnstile; };

describe("turnstileOn", () => {
  it("needs both the site key and the Apps Script URL (the old form cannot check a token)", () => {
    expect(turnstileOn("0x4AAA", "https://script.google.com/x")).toBe(true);
    expect(turnstileOn("", "https://script.google.com/x")).toBe(false);
    expect(turnstileOn("0x4AAA", "")).toBe(false);
  });
});

// A document with just what loadTurnstile touches.
function fakeDoc() {
  const added: { src: string; async: boolean; onload?: () => void; onerror?: () => void; remove: () => void }[] = [];
  const doc = {
    createElement: () => ({ src: "", async: false, remove: vi.fn() }),
    head: { appendChild: (s: (typeof added)[number]) => { added.push(s); return s; } },
  } as unknown as Document;
  return { doc, added };
}

describe("loadTurnstile", () => {
  it("adds the explicit-render script once and resolves to window.turnstile", async () => {
    const loadTurnstile = await fresh();
    const { doc, added } = fakeDoc();
    const api = { render: vi.fn() };
    const g = { turnstile: undefined as unknown };
    const a = loadTurnstile(doc, g);
    const b = loadTurnstile(doc, g);
    expect(added).toHaveLength(1);
    expect(added[0].src).toBe(TURNSTILE_SRC);
    expect(TURNSTILE_SRC).toBe("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit");
    g.turnstile = api;
    added[0].onload!();
    expect(await a).toBe(api);
    expect(await b).toBe(api);
  });
  it("a failed load rejects, and the next call tries again", async () => {
    const loadTurnstile = await fresh();
    const { doc, added } = fakeDoc();
    const g = { turnstile: undefined as unknown };
    const a = loadTurnstile(doc, g);
    added[0].onerror!();
    await expect(a).rejects.toThrow();
    loadTurnstile(doc, g);
    expect(added).toHaveLength(2);
  });
  it("a script that loads without defining turnstile rejects", async () => {
    const loadTurnstile = await fresh();
    const { doc, added } = fakeDoc();
    const a = loadTurnstile(doc, { turnstile: undefined });
    added[0].onload!();
    await expect(a).rejects.toThrow();
  });
});

describe("TokenBox", () => {
  it("take() gives the token and empties the box: a token is good for one check only", async () => {
    const box = new TokenBox();
    box.set("t1");
    expect(await box.take(0)).toBe("t1");
    expect(await box.take(0)).toBe("");
  });
  it("take() waits for a token that is still coming, up to the limit", async () => {
    vi.useFakeTimers();
    try {
      const box = new TokenBox();
      const p = box.take(4000);
      vi.advanceTimersByTime(1000);
      box.set("t2");
      expect(await p).toBe("t2");
      const q = box.take(4000);
      vi.advanceTimersByTime(4001);
      expect(await q).toBe("");   // no token: the report goes out unverified, not lost
    } finally { vi.useRealTimers(); }
  });
  it("an expired token is dropped", async () => {
    const box = new TokenBox();
    box.set("t3");
    box.clear();
    expect(await box.take(0)).toBe("");
  });
});
