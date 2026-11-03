// docs/feedback/Code.gs runs on Google Apps Script; here it runs in a sandbox with the services it uses
// mocked, to check the Turnstile part: no secret, today's rows; a secret, a Verified column; never a lost row.
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const SRC = readFileSync(new URL("../docs/feedback/Code.gs", import.meta.url), "utf8");

function gs(props: Record<string, string>, fetchReply?: (url: string, o: { payload: Record<string, string> }) => { code: number; body: string }) {
  const rows: unknown[][] = [];
  const header: Record<string, unknown> = {};
  const tab = {
    getLastRow: () => rows.length,
    appendRow: (r: unknown[]) => { rows.push(r); },
    getRange: (a1: string) => ({ isBlank: () => !(a1 in header) && !(rows[0] && rows[0][a1.charCodeAt(0) - 65] != null), setValue: (v: unknown) => { header[a1] = v; } }),
  };
  const fetch = vi.fn((url: string, o: { payload: Record<string, string> }) => {
    if (!fetchReply) throw new Error("no network");
    const r = fetchReply(url, o);
    return { getResponseCode: () => r.code, getContentText: () => r.body };
  });
  const ctx: Record<string, unknown> = {
    console: { error: () => {}, log: () => {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => props[k] ?? null, setProperty: () => {} }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => tab, insertSheet: () => tab }) },
    ContentService: { createTextOutput: (s: string) => ({ s, setMimeType() { return this; } }), MimeType: { JSON: "json" } },
    Utilities: { formatDate: () => "2026-11-04" },
    UrlFetchApp: { fetch },
  };
  runInNewContext(SRC, ctx);
  const post = (body: object) => {
    const contents = JSON.stringify(body);
    const out = (ctx.doPost as (e: object) => { s: string })({ postData: { contents, length: contents.length } });
    return JSON.parse(out.s);
  };
  return { post, rows, header, fetch, ctx };
}

const body = { text: "Λάθος θέση στάσης", version: "0.3.0", page: "/", ua: "ua" };

describe("Code.gs bot check", () => {
  it("without TURNSTILE_SECRET: no check, no network, the Verified cell stays empty", () => {
    const g = gs({ SHEET_ID: "s" });
    expect(g.post({ ...body, turnstile: "tok" })).toEqual({ ok: true });
    expect(g.fetch).not.toHaveBeenCalled();
    expect(g.rows[0]).toContain("Verified");
    expect(g.rows[1][7]).toBe("");
  });
  it("with the secret: posts secret + token to siteverify and marks the row true", () => {
    const g = gs({ SHEET_ID: "s", TURNSTILE_SECRET: "sec" }, () => ({ code: 200, body: JSON.stringify({ success: true }) }));
    expect(g.post({ ...body, turnstile: "tok" })).toEqual({ ok: true });
    const [url, o] = g.fetch.mock.calls[0];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(o.payload).toEqual({ secret: "sec", response: "tok" });
    expect(g.rows[1][7]).toBe(true);
  });
  it("a failed check, no token, or an error keeps the row, marked false", () => {
    const no = gs({ SHEET_ID: "s", TURNSTILE_SECRET: "sec" }, () => ({ code: 200, body: JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }) }));
    expect(no.post({ ...body, turnstile: "bad" })).toEqual({ ok: true });
    expect(no.rows[1][7]).toBe(false);

    const none = gs({ SHEET_ID: "s", TURNSTILE_SECRET: "sec" }, () => ({ code: 200, body: "{}" }));
    expect(none.post(body)).toEqual({ ok: true });
    expect(none.fetch).not.toHaveBeenCalled();   // nothing to check
    expect(none.rows[1][7]).toBe(false);

    const long = gs({ SHEET_ID: "s", TURNSTILE_SECRET: "sec" }, () => ({ code: 200, body: "{}" }));
    long.post({ ...body, turnstile: "x".repeat(2049) });
    expect(long.fetch).not.toHaveBeenCalled();
    expect(long.rows[1][7]).toBe(false);

    const down = gs({ SHEET_ID: "s", TURNSTILE_SECRET: "sec" });   // fetch throws
    expect(down.post({ ...body, turnstile: "tok" })).toEqual({ ok: true });
    expect(down.rows[1][7]).toBe(false);

    const html = gs({ SHEET_ID: "s", TURNSTILE_SECRET: "sec" }, () => ({ code: 502, body: "<html>" }));
    html.post({ ...body, turnstile: "tok" });
    expect(html.rows[1][7]).toBe(false);
  });
  it("a Sheet made before the Verified column gets its header", () => {
    const g = gs({ SHEET_ID: "s" });
    g.rows.push(["Ώρα", "Κείμενο", "Έκδοση", "Σελίδα", "Συσκευή", "Εικόνα", "Logs"]);
    g.post(body);
    expect(g.header.H1).toBe("Verified");
  });
  it("checkTurnstileSetup reports what siteverify says about the secret", () => {
    const g = gs({ TURNSTILE_SECRET: "sec" }, () => ({ code: 200, body: JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }) }));
    expect((g.ctx.checkTurnstileSetup as () => string)()).toMatch(/invalid-input-response/);
    expect((gs({}).ctx.checkTurnstileSetup as () => string)()).toMatch(/TURNSTILE_SECRET/);
  });
});
