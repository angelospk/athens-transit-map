import { afterEach, describe, expect, it, vi } from "vitest";
import { oasaProxy } from "../server/oasa";
import { parseOasa, parseOasaRoutes } from "../src/lib/oasa";
import { groupRows, oasaGroups, oasaRows } from "../src/lib/stopboard";
import type { LineStatic } from "../src/lib/types";

afterEach(() => vi.useRealTimers());
const raw = [{ route_code: "3922", veh_code: "7047", btime2: "3" }];
const metadata = [{ RouteCode: "3922", LineID: "040", RouteDescr: "ΣΥΝΤΑΓΜΑ - ΠΕΙΡΑΙΑΣ" }];
const request = (path = "/oasa/stops/61000", method = "GET") => new Request(`http://localhost${path}`, { method });

describe("OASA arrivals", () => {
  it("accepts no arrivals, orders minutes and rejects malformed responses", () => {
    expect(parseOasa(null)).toEqual([]);
    expect(parseOasa([])).toEqual([]);
    expect(parseOasa([...raw, { ...raw[0], btime2: "0" }])?.map(a => a.minutes)).toEqual([0, 3]);
    for (const bad of [{}, "null", [{ ...raw[0], btime2: "" }], [{ ...raw[0], btime2: "-1" }], [{ ...raw[0], btime2: "NaN" }]])
      expect(parseOasa(bad)).toBeNull();
  });

  it("maps routes to lines, preserves OASA minutes, and resolves zero-padded vehicle ids", () => {
    const board = { stop_id: "1", updated_at: 1000, next_update_at: 1030, arrivals: parseOasa(raw)!, routes: parseOasaRoutes(metadata)! };
    expect(oasaRows(board, [{ line: "040", id: "07047" }], 1020)).toEqual([
      { line: "040", variant: "3922", vehicle: "07047", etaS: 1180, stopsAway: null, ageS: 0 },
    ]);
    expect(oasaRows(board, [], 1211)).toEqual([]);
  });

  it("shows route 5205 under 130 despite GTFS shape 5514 and never assigns a line by a matching shape id", () => {
    const board = { stop_id: "340109", updated_at: 1000, next_update_at: 1030,
      arrivals: [{ route_code: "5205", veh_code: "9", minutes: 44 }],
      routes: [{ code: "5205", line: "130", description: "ΠΕΙΡΑΙΑΣ - Ν. ΣΜΥΡΝΗ" }] };
    const st: LineStatic = { id: "130", variants: { "5514": { headsign: "ΠΕΙΡΑΙΑΣ", direction: 0, shape: [], stops: ["A", "B"] } },
      stops: { A: { name: "Α", lat: 0, lon: 0 }, B: { name: "ΠΕΙΡΑΙΑΣ", lat: 0, lon: 0 } } };
    const serve = [{ line: "130", variants: ["5514"] }];
    const rows = oasaRows(board, [], 1000);
    expect(rows).toMatchObject([{ line: "130", variant: "5205", etaS: 3640 }]);
    expect(oasaGroups(board, rows, serve, { "130": st })).toMatchObject([
      { line: "130", to: "ΠΕΙΡΑΙΑΣ", rows: [{ etaS: 3640 }] },
    ]);
    expect(oasaRows({ ...board, routes: [] }, [], 1000)).toEqual([]);
    expect(parseOasaRoutes([{ RouteCode: "5205", LineID: "130", RouteDescr: "ΠΕΙΡΑΙΑΣ - Ν. ΣΜΥΡΝΗ" }])).toEqual(board.routes);
    expect(parseOasaRoutes([{ RouteCode: "5205", LineCode: "999" }])).toBeNull();
    // The generic estimate's grouping still uses timetable variants.
    expect(groupRows([], serve, { "130": st })[0].variants).toEqual(["5514"]);
  });
});

describe("OASA proxy", () => {
  it("restricts upstream access to numeric stops and GET", async () => {
    const upstream = vi.fn();
    const handle = oasaProxy(upstream);
    expect(await handle(request("/other"))).toBeNull();
    for (const path of ["/oasa/stops/foo", "/oasa/stops/61000?act=other", "/oasa/https://example.com"])
      expect((await handle(request(path)))?.status).toBe(404);
    expect((await handle(request(undefined, "POST")))?.status).toBe(405);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("deduplicates requests, caches predictions and refreshes after 30 seconds", async () => {
    vi.useFakeTimers();
    const upstream = vi.fn(async (url: string | URL | Request, _options?: RequestInit) =>
      Response.json(String(url).includes("webRoutesForStop") ? metadata : raw));
    const handle = oasaProxy(upstream);
    const requests = Promise.all([handle(request()), handle(request())]);
    await vi.advanceTimersByTimeAsync(250);
    const [a, b] = await requests;
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(upstream.mock.calls[0][0]).toBe("https://telematics.oasa.gr/api/?act=getStopArrivals&p1=61000");
    expect(await a!.json()).toMatchObject({ stop_id: "61000", arrivals: [{ route_code: "3922", veh_code: "7047", minutes: 3 }] });
    expect(await b!.json()).toHaveProperty("arrivals");
    expect(await (await handle(request()))!.json()).toHaveProperty("routes", parseOasaRoutes(metadata));
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await handle(request()))!.headers.get("Cache-Control")).toBe("public, max-age=20");
    expect(upstream).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(20_000);
    expect((await handle(request()))!.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(3);   // cached metadata, only arrivals refresh
  });

  it("paces different stops and caches failures briefly without treating them as empty arrivals", async () => {
    vi.useFakeTimers();
    const upstream = vi.fn(async () => Response.json({ error: "bad response" }));
    const handle = oasaProxy(upstream);
    expect((await handle(request()))!.status).toBe(502);
    const second = handle(request("/oasa/stops/61001"));
    await vi.advanceTimersByTimeAsync(249);
    expect(upstream).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await second)!.status).toBe(502);
    await handle(request());
    expect(upstream).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    await handle(request());
    expect(upstream).toHaveBeenCalledTimes(3);
  });

  it("preserves predictions when metadata fails, then retries metadata on the next refresh", async () => {
    vi.useFakeTimers();
    let metadataWorks = false;
    const upstream = vi.fn(async (url: string | URL | Request) => Response.json(
      String(url).includes("webRoutesForStop") ? metadataWorks ? metadata : {} : raw));
    const handle = oasaProxy(upstream);
    const first = handle(request());
    await vi.advanceTimersByTimeAsync(250);
    expect(await (await first)!.json()).toMatchObject({ arrivals: [{ minutes: 3 }], routes: [] });
    metadataWorks = true;
    await vi.advanceTimersByTimeAsync(30_000);
    const retry = handle(request());
    await vi.advanceTimersByTimeAsync(250);
    expect(await (await retry)!.json()).toHaveProperty("routes", parseOasaRoutes(metadata));
    expect(upstream).toHaveBeenCalledTimes(4);
  });

  it("paces and caches edge callbacks without fetching from the coordinator", async () => {
    vi.useFakeTimers();
    const direct = vi.fn();
    const edge = vi.fn(async (act: string) => act === "getStopArrivals" ? raw : metadata);
    const handle = oasaProxy(direct);
    const response = handle(request(), edge);
    await vi.advanceTimersByTimeAsync(249);
    expect(edge).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await (await response)!.json()).toHaveProperty("routes", parseOasaRoutes(metadata));
    const otherEdge = vi.fn();
    expect((await handle(request(), otherEdge))!.status).toBe(200);
    expect(otherEdge).not.toHaveBeenCalled();
    expect(direct).not.toHaveBeenCalled();
  });
});
