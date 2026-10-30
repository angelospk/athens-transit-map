import { describe, expect, it, vi } from "vitest";
import { FORM_FIELD, FORM_URL } from "../src/lib/idea";
import { MAX_TEXT, canSendFeedback, feedbackBody, fitInside, sendFeedback, type Feedback } from "../src/lib/feedback";
import { parseReleases } from "../src/lib/releases";
import { versionLabel } from "../src/lib/version";

const fb: Feedback = { text: "  Το 040 δεν φαίνεται  ", version: "0.2.0 · 30/10 · f89073b", page: "/?stop=oasa%3A10183", ua: "iPhone Safari" };

describe("canSendFeedback", () => {
  it("needs 3 to MAX_TEXT characters after trimming", () => {
    expect(canSendFeedback("ab ")).toBe(false);
    expect(canSendFeedback(" abc")).toBe(true);
    expect(canSendFeedback("x".repeat(MAX_TEXT + 1))).toBe(false);
  });
});

describe("feedbackBody", () => {
  it("is JSON with the trimmed text, version, page, device and no image key without one", () => {
    const b = JSON.parse(feedbackBody(fb));
    expect(b).toEqual({ text: "Το 040 δεν φαίνεται", version: fb.version, page: fb.page, ua: fb.ua });
  });
  it("carries the image as type + base64", () => {
    const b = JSON.parse(feedbackBody({ ...fb, image: { type: "image/jpeg", data: "AAEC" } }));
    expect(b.image).toEqual({ type: "image/jpeg", data: "AAEC" });
  });
});

describe("sendFeedback", () => {
  it("posts the JSON as text/plain to the Apps Script URL and needs its {ok: true}", async () => {
    const f = vi.fn(async () => Response.json({ ok: true }));
    expect(await sendFeedback(fb, "https://script.google.com/macros/s/X/exec", f)).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://script.google.com/macros/s/X/exec");
    expect(init.method).toBe("POST");
    expect(init.mode).toBeUndefined(); // cors: the reply must be read
    expect(typeof init.body).toBe("string"); // a string body is text/plain: no CORS preflight
    expect(JSON.parse(init.body as string).text).toBe("Το 040 δεν φαίνεται");
  });
  it("a refusal from the script (busy, too big) is not sent", async () => {
    expect(await sendFeedback(fb, "https://x", async () => Response.json({ ok: false, error: "busy" }))).toBe(false);
    expect(await sendFeedback(fb, "https://x", async () => new Response("<html>", { status: 200 }))).toBe(false);
    expect(await sendFeedback(fb, "https://x", async () => new Response(null, { status: 500 }))).toBe(false);
  });
  it("without an Apps Script URL falls back to the Google Form, text + version + page, no image", async () => {
    const f = vi.fn(async () => new Response(null));
    expect(await sendFeedback({ ...fb, image: { type: "image/png", data: "AAEC" } }, "", f)).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(FORM_URL);
    const text = new URLSearchParams(init.body as URLSearchParams).get(FORM_FIELD)!;
    expect(text).toContain("Το 040 δεν φαίνεται");
    expect(text).toContain(fb.version);
    expect(text).toContain(fb.page);
  });
  it("false when offline or the text cannot be sent", async () => {
    expect(await sendFeedback(fb, "https://x", async () => { throw new TypeError("Failed to fetch"); })).toBe(false);
    const f = vi.fn(async () => new Response(null));
    expect(await sendFeedback({ ...fb, text: " a " }, "https://x", f)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("fitInside", () => {
  it("scales the long side down to the limit, keeps the ratio, never up", () => {
    expect(fitInside(3000, 1500, 1600)).toEqual([1600, 800]);
    expect(fitInside(1170, 2532, 1600)).toEqual([739, 1600]);
    expect(fitInside(800, 600, 1600)).toEqual([800, 600]);
  });
});

describe("parseReleases", () => {
  const api = [
    { tag_name: "v0.3", name: "Γνώμη με εικόνα", html_url: "https://github.com/x/releases/tag/v0.3", published_at: "2026-10-30T21:00:00Z",
      draft: false, prerelease: false, body: "- Στείλε γνώμη με screenshot\r\n* Η έκδοση φαίνεται στο ⓘ\r\n\r\nΚαι κάτι ακόμα" },
    { tag_name: "v0.2.9", name: "", html_url: "u", published_at: "2026-10-29T10:00:00Z", draft: true, prerelease: false, body: "x" },
    { tag_name: "v0.1", name: null, html_url: "u1", published_at: "2026-10-25T09:01:22Z", draft: false, prerelease: false, body: null },
  ];
  it("keeps published releases, newest first, notes as lines without bullets", () => {
    const r = parseReleases(api);
    expect(r.map(x => x.tag)).toEqual(["v0.3", "v0.1"]);
    expect(r[0]).toEqual({ tag: "v0.3", title: "Γνώμη με εικόνα", date: "2026-10-30", url: "https://github.com/x/releases/tag/v0.3",
      notes: ["Στείλε γνώμη με screenshot", "Η έκδοση φαίνεται στο ⓘ", "Και κάτι ακόμα"] });
    expect(r[1].title).toBe("v0.1");
    expect(r[1].notes).toEqual([]);
  });
  it("an unexpected body is no releases, not a crash", () => {
    expect(parseReleases({ message: "API rate limit exceeded" })).toEqual([]);
  });
});

describe("versionLabel", () => {
  it("version, build day and short commit", () => {
    expect(versionLabel("0.2.0", "2026-10-30", "f89073bdeadbeef")).toBe("0.2.0 · 30/10 · f89073b");
    expect(versionLabel("0.2.0", "2026-10-30", "")).toBe("0.2.0 · 30/10");
  });
});
