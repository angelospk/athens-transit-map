import { describe, expect, it } from "vitest";
import { Diag } from "../src/lib/diag";

describe("Diag", () => {
  it("records requests as host + path without the query, status and ms, newest last, at most 20", async () => {
    let t = 1000;
    const d = new Diag(() => t);
    const f = d.wrap(async (url: RequestInfo | URL) => {
      t += 120;
      return new Response(null, { status: String(url).includes("bad") ? 503 : 200 });
    });
    await f("https://transit.haroldpoi.dev/v2/stops/oasa%3A10183?q=Σύνταγμα");
    await f(new URL("https://transit.haroldpoi.dev/v2/bad"));
    for (let i = 0; i < 25; i++) await f(`https://x.dev/r/${i}`);
    const s = d.snapshot();
    expect(s.requests).toHaveLength(20);
    expect(s.requests.at(-1)).toEqual({ at: t, url: "x.dev/r/24", status: 200, ms: 120 });
    const d2 = new Diag(() => t);
    const g = d2.wrap(f);
    await g("https://transit.haroldpoi.dev/v2/stops/oasa%3A10183?q=Σύνταγμα");
    expect(d2.snapshot().requests[0].url).toBe("transit.haroldpoi.dev/v2/stops/oasa%3A10183");
  });

  it("a request that throws is recorded with status 0 and its error, and still throws", async () => {
    const d = new Diag(() => 5);
    const f = d.wrap(async () => { throw new TypeError("Failed to fetch"); });
    await expect(f("https://a.dev/x")).rejects.toThrow("Failed to fetch");
    expect(d.snapshot().requests[0]).toEqual({ at: 5, url: "a.dev/x", status: 0, ms: 0, error: "TypeError: Failed to fetch" });
  });

  it("skips URLs it is told to skip (the feedback POST itself)", async () => {
    const d = new Diag(() => 0, ["script.google.com"]);
    const f = d.wrap(async () => new Response(null));
    await f("https://script.google.com/macros/s/X/exec");
    expect(d.snapshot().requests).toEqual([]);
  });

  it("keeps the last 10 page errors, messages cut to 300 characters", () => {
    const d = new Diag(() => 7);
    for (let i = 0; i < 12; i++) d.error(`e${i}`);
    d.error("x".repeat(400));
    const s = d.snapshot();
    expect(s.errors).toHaveLength(10);
    expect(s.errors.at(-1)).toEqual({ at: 7, message: "x".repeat(300) });
    expect(s.errors[0].message).toBe("e3");
  });

  it("the snapshot is a copy and JSON-safe", () => {
    const d = new Diag(() => 1);
    d.error("a");
    const s = d.snapshot();
    s.errors.push({ at: 0, message: "b" });
    expect(d.snapshot().errors).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(d.snapshot()))).toEqual(d.snapshot());
  });

  it("errors never keep a URL's query, fragment or credentials", async () => {
    const d = new Diag(() => 1);
    d.error("failed https://user:pw@api.x/v1/geo?q=Home+Street&token=abc#frag, see http://a.b/c?d=1");
    const fail = d.wrap(async () => { throw new TypeError("bad https://u:p@h.io/p?key=s"); });
    await expect(fail("https://h.io/p")).rejects.toThrow();
    const s = d.snapshot();
    expect(s.errors[0].message).toBe("failed https://api.x/v1/geo, see http://a.b/c");
    expect(s.requests[0].error).toBe("TypeError: bad https://h.io/p");
    d.error("HTTPS://a@b:c@H.io/x?k=1,2 and wss://w.io/s#t.");
    expect(d.snapshot().errors[1].message).toBe("https://h.io/x and wss://w.io/s.");
    d.error("no route /search?q=Home&x=1 here? yes");
    expect(d.snapshot().errors[2].message).toBe("no route /search here? yes");
  });
});
