import { describe, expect, it } from "vitest";
import { SwrCache } from "../src/lib/swr";

const ok = (body: unknown) => ({ status: 200, body });

describe("SwrCache", () => {
  it("one request for a key while it is fresh; again once it is older than the ttl", async () => {
    let t = 0, calls = 0;
    const c = new SwrCache(() => t);
    const load = async () => ok(++calls);
    expect((await c.get("a", 1000, load)).body).toBe(1);
    t = 999;
    expect((await c.get("a", 1000, load)).body).toBe(1);
    t = 1000;
    expect((await c.get("a", 1000, load)).body).toBe(2);
  });
  it("callers at the same time share one request", async () => {
    let calls = 0;
    const c = new SwrCache(() => 0);
    const load = () => new Promise<{ status: number; body: unknown }>(r => setTimeout(() => r(ok(++calls)), 5));
    const [x, y] = await Promise.all([c.get("a", 1000, load), c.get("a", 1000, load)]);
    expect([x.body, y.body, calls]).toEqual([1, 1, 1]);
  });
  it("peek gives the last good answer at once; a failure does not replace it", async () => {
    let t = 0;
    const c = new SwrCache(() => t);
    expect(c.peek("a")).toBeUndefined();
    await c.get("a", 1000, async () => ok("x"));
    t = 5000;
    expect((await c.get("a", 1000, async () => ({ status: 502, body: null }))).status).toBe(502);
    expect(c.peek("a")).toEqual({ status: 200, body: "x", at: 0 });
  });
  it("a thrown load is a status-0 answer, and the next call tries again", async () => {
    const c = new SwrCache(() => 0);
    expect((await c.get("a", 1000, async () => { throw new Error("net"); })).status).toBe(0);
    expect((await c.get("a", 1000, async () => ok(1))).body).toBe(1);
  });
  it("keeps at most `max` keys, the oldest dropped", async () => {
    const c = new SwrCache(() => 0, 2);
    for (const k of ["a", "b", "c"]) await c.get(k, 1000, async () => ok(k));
    expect([c.peek("a"), c.peek("b")?.body, c.peek("c")?.body]).toEqual([undefined, "b", "c"]);
  });
});
