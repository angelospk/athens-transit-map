import { describe, expect, it, vi } from "vitest";
import { FORM_FIELD, FORM_URL, MAX_IDEA, canSend, countVisit, loadIdea, markPeeked, markSent, peekDelayMs, sendIdea, wasPeeked } from "../src/lib/idea";

function mem() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}
const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };

describe("peekDelayMs", () => {
  it("opens at 15 s on the first visit and 30 s on the second", () => {
    expect(peekDelayMs({ sent: false, visits: 1 })).toBe(15_000);
    expect(peekDelayMs({ sent: false, visits: 2 })).toBe(30_000);
  });
  it("never opens from the third visit on, or once an idea was sent", () => {
    expect(peekDelayMs({ sent: false, visits: 3 })).toBeNull();
    expect(peekDelayMs({ sent: false, visits: 9 })).toBeNull();
    expect(peekDelayMs({ sent: false, visits: 0 })).toBeNull();
    expect(peekDelayMs({ sent: true, visits: 1 })).toBeNull();
  });
});

describe("canSend", () => {
  it("needs 3 to MAX_IDEA characters after trimming", () => {
    expect(canSend("ab")).toBe(false);
    expect(canSend("   ab   ")).toBe(false);
    expect(canSend("  abc ")).toBe(true);
    expect(canSend("x".repeat(MAX_IDEA))).toBe(true);
    expect(canSend("x".repeat(MAX_IDEA + 1))).toBe(false);
  });
});

describe("visits and sent state", () => {
  it("counts a visit once per tab session", () => {
    const local = mem();
    expect(countVisit(local, mem())).toEqual({ sent: false, visits: 1 });
    const session = mem();
    expect(countVisit(local, session)).toEqual({ sent: false, visits: 2 });
    expect(countVisit(local, session)).toEqual({ sent: false, visits: 2 });   // a reload in the same tab
    expect(countVisit(local, mem())).toEqual({ sent: false, visits: 3 });
  });
  it("remembers a sent idea", () => {
    const local = mem();
    expect(loadIdea(local).sent).toBe(false);
    markSent(local);
    expect(loadIdea(local).sent).toBe(true);
    expect(countVisit(local, mem())).toEqual({ sent: true, visits: 1 });
  });
  it("ignores junk in storage", () => {
    const local = mem();
    local.setItem("ideaVisits", "\"lots\"");
    local.setItem("ideaSent", "1");
    expect(loadIdea(local)).toEqual({ sent: false, visits: 0 });
  });
  it("blocked storage: no visit counted, so the label never opens by itself", () => {
    expect(countVisit(blocked, blocked)).toEqual({ sent: false, visits: 0 });
    expect(() => markSent(blocked)).not.toThrow();
  });
});

describe("sendIdea", () => {
  it("posts the trimmed text to the Google Form field, no-cors", async () => {
    const f = vi.fn(async () => new Response(null));
    expect(await sendIdea("  ειδοποίηση για το 040  ", f)).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(FORM_URL);
    expect(init.method).toBe("POST");
    expect(init.mode).toBe("no-cors");
    expect(new URLSearchParams(init.body as URLSearchParams).get(FORM_FIELD)).toBe("ειδοποίηση για το 040");
  });
  it("returns false when the request fails (offline)", async () => {
    expect(await sendIdea("abc", async () => { throw new TypeError("Failed to fetch"); })).toBe(false);
  });
  it("sends nothing that canSend rejects", async () => {
    const f = vi.fn(async () => new Response(null));
    expect(await sendIdea(" a ", f)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("peeked in this tab", () => {
  it("a reload after the label opened does not open it again", () => {
    const session = mem();
    expect(wasPeeked(session)).toBe(false);
    markPeeked(session);
    expect(wasPeeked(session)).toBe(true);
    expect(wasPeeked(mem())).toBe(false);   // a new tab: a new visit
  });
  it("blocked storage counts as peeked, so nothing opens by itself", () => {
    expect(wasPeeked(blocked)).toBe(true);
    expect(() => markPeeked(blocked)).not.toThrow();
  });
});
