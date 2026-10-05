import { afterEach, describe, expect, it, vi } from "vitest";
import { getJSON, lineStaticUrl, lineUrl } from "../src/lib/api";

afterEach(() => vi.unstubAllGlobals());

describe("api", () => {
  it("percent-encodes Greek line ids", () => {
    expect(lineUrl("Α1")).toBe("https://transit.haroldpoi.dev/v1/lines/%CE%911");
    expect(lineStaticUrl("Α1")).toBe("https://angelospk.github.io/athens-transit-rt/static/v1/lines/%CE%911.json");
  });
  it("keeps the HTTP status when the body is not JSON", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>rate limited</html>", { status: 429 }));
    expect(await getJSON("x")).toEqual({ status: 429, body: null });
  });
  it("returns the Date header as server time when CORS exposes it", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200, headers: { Date: "Mon, 05 Oct 2026 09:00:00 GMT" } }));
    expect((await getJSON("x")).date).toBe(Date.UTC(2026, 9, 5, 9));
  });
  it("maps network errors to status 0", async () => {
    vi.stubGlobal("fetch", async () => { throw new TypeError("offline"); });
    expect(await getJSON("x")).toEqual({ status: 0, body: null });
  });
  it("does not bust the cache", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", f);
    await getJSON(lineUrl("040"));
    expect(f).toHaveBeenCalledWith("https://transit.haroldpoi.dev/v1/lines/040", { signal: undefined });
  });
});
