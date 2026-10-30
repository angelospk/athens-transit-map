import { describe, expect, it, vi } from "vitest";
import { FORM_FIELD, FORM_URL, MAX_IDEA, canSend, sendIdea } from "../src/lib/idea";

describe("canSend", () => {
  it("needs 3 to MAX_IDEA characters after trimming", () => {
    expect(canSend("ab")).toBe(false);
    expect(canSend("   ab   ")).toBe(false);
    expect(canSend("  abc ")).toBe(true);
    expect(canSend("x".repeat(MAX_IDEA))).toBe(true);
    expect(canSend("x".repeat(MAX_IDEA + 1))).toBe(false);
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
