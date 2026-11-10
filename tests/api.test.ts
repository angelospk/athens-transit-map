import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLines, fetchLineStatic, fetchV2Alerts, fetchV2Line, fetchV2LineVehicles, fetchV2Lines, fetchV2Run, fetchV2Stop, fetchV2Stops, fetchStop, getJSON, lineStaticUrl, lineUrl } from "../src/lib/api";

afterEach(() => vi.unstubAllGlobals());

describe("api", () => {
  it("percent-encodes Greek line ids", () => {
    expect(lineUrl("Α1")).toBe("https://transit.haroldpoi.dev/v1/lines/%CE%911");
    expect(lineStaticUrl("Α1")).toBe("https://angelospk.github.io/staseis-rt/static/v1/lines/%CE%911.json");
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
  it("rejects static files that are JSON of the wrong shape (an error page from a proxy)", async () => {
    vi.stubGlobal("fetch", async () => new Response('{"error":"rate limited"}', { status: 200 }));
    await expect(fetchLines()).rejects.toThrow();
    await expect(fetchLineStatic("QA-BAD-SHAPE")).rejects.toThrow();
  });
  it("rejects an empty lines index (it would drop every picked line as unknown)", async () => {
    vi.stubGlobal("fetch", async () => new Response('{"lines":[]}', { status: 200 }));
    await expect(fetchLines()).rejects.toThrow();
  });
  it("gives static requests a timeout, so a stalled one does not stay memoized", async () => {
    const f = vi.fn(async () => new Response('{"id":"x","variants":{},"stops":{}}', { status: 200 }));
    vi.stubGlobal("fetch", f);
    await fetchLineStatic("QA-TIMEOUT");
    expect((f.mock.calls[0] as unknown[])[1]).toMatchObject({ signal: expect.any(AbortSignal) });
  });
  it("accepts a well-formed static line file", async () => {
    vi.stubGlobal("fetch", async () => new Response('{"id":"x","variants":{},"stops":{}}', { status: 200 }));
    await expect(fetchLineStatic("QA-GOOD-SHAPE")).resolves.toMatchObject({ id: "x" });
  });
  // A 200 whose main field has the wrong type counts as a 503, so the search modal and the cards do not crash.
  it("rejects /v2 answers whose main field has the wrong type", async () => {
    const bodies: Record<string, unknown> = {
      lines: { lines: "x" }, stops: { stops: "x" }, alerts: { alerts: {} },
      "lines/qa%3Abad/vehicles": { vehicles: "x" },
      "lines/qa%3Abad": { line: { id: "qa:bad" }, patterns: "x", stops: {} },
      "stops/qa%3Abad": { stop: { id: "qa:bad" }, lines: "x", arrivals: [] },
      "runs/qa%3Abad": { run: { id: "qa:bad", stops: "x" } },
      "lines/qa%3Anostops": { line: { id: "qa:nostops" }, patterns: [] },
      "runs/qa%3Anostops": { run: { id: "qa:nostops" } },
      "lines/qa%3Aarr": { line: [], patterns: [], stops: {} },
      "stops/qa%3Aarr": { stop: [], lines: [], arrivals: [] },
    };
    vi.stubGlobal("fetch", async (u: string) => new Response(JSON.stringify(bodies[u.split("/v2/")[1]]), { status: 200 }));
    for (const r of await Promise.all([fetchV2Lines(), fetchV2Stops(), fetchV2Alerts(), fetchV2LineVehicles("qa:bad"),
      fetchV2Line("qa:bad"), fetchV2Stop("qa:bad"), fetchV2Run("qa:bad"), fetchV2Line("qa:nostops"), fetchV2Run("qa:nostops"),
      fetchV2Line("qa:arr"), fetchV2Stop("qa:arr")]))
      expect(r.status).toBe(503);
  });
  it("accepts well-formed /v2 answers", async () => {
    const bodies: Record<string, unknown> = {
      "lines/qa%3Agood/vehicles": { vehicles: [] },
      "lines/qa%3Agood": { line: { id: "qa:good" }, patterns: [], stops: {} },
      "stops/qa%3Agood": { stop: { id: "qa:good" }, lines: [], arrivals: [] },
      "runs/qa%3Agood": { run: { id: "qa:good", stops: [] } },
    };
    vi.stubGlobal("fetch", async (u: string) => new Response(JSON.stringify(bodies[u.split("/v2/")[1]]), { status: 200 }));
    for (const r of await Promise.all([fetchV2LineVehicles("qa:good"), fetchV2Line("qa:good"), fetchV2Stop("qa:good"), fetchV2Run("qa:good")]))
      expect(r.status).toBe(200);
  });
  it("fetchStop: a fresh ask passes every cache (memory, browser, CDN) and replaces the cached board", async () => {
    let n = 0;
    const f = vi.fn(async () => new Response(JSON.stringify({ stop: { id: "QA-FRESH" }, lines: [], arrivals: [], n: ++n }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    await fetchStop("QA-FRESH");
    await fetchStop("QA-FRESH");
    expect(f).toHaveBeenCalledTimes(1);   // cached 15 s
    const r = await fetchStop("QA-FRESH", true);
    expect(f).toHaveBeenCalledTimes(2);
    expect(String((f.mock.calls[1] as unknown[])[0])).toMatch(/\/v1\/stops\/QA-FRESH\?fresh=\d+$/);
    expect((r.body as { n: number }).n).toBe(2);
    expect(((await fetchStop("QA-FRESH")).body as { n: number }).n).toBe(2);   // the fresh copy is the cached one now
  });
});

