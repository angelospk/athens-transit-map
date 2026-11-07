import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { byCity, pushApi } from "../bot/http";

const ORIGIN = "https://bus.haroldpoi.dev";
let server: Server, base = "", calls: { method: string; path: string; body: unknown }[] = [];

beforeAll(async () => {
  const web = async (req: { method: string; path: string; body: unknown }) => { calls.push(req); return { status: 201, body: { id: "x", until: 1 } }; };
  server = createServer(pushApi({ web }, { key: "KEY", origins: [ORIGIN], rate: 3 }));
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

const post = (body: string, headers: Record<string, string> = { origin: ORIGIN, "cf-connecting-ip": "1.1.1.1" }) =>
  fetch(`${base}/alerts`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });

describe("push HTTP API", () => {
  it("gives the public key to anyone, never cached", async () => {
    const r = await fetch(`${base}/key`);
    expect(await r.json()).toEqual({ key: "KEY" });
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("answers the preflight and allows only the map's origin", async () => {
    const pre = await fetch(`${base}/alerts`, { method: "OPTIONS", headers: { origin: ORIGIN } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(pre.headers.get("access-control-allow-methods")).toMatch(/POST/);
    const other = await fetch(`${base}/alerts`, { method: "OPTIONS", headers: { origin: "https://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
    expect((await post("{}", { origin: "https://evil.example" })).status).toBe(403);
    expect((await post("{}", {})).status).toBe(403);
  });

  it("passes JSON on to the bot, refuses bad JSON and big bodies", async () => {
    calls = [];
    const ok = await post(JSON.stringify({ p: "1abc" }), { origin: ORIGIN, "cf-connecting-ip": "2.2.2.2" });
    expect(ok.status).toBe(201);
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(calls).toEqual([{ method: "POST", path: "/alerts", body: { p: "1abc" } }]);
    expect((await post("{", { origin: ORIGIN, "cf-connecting-ip": "3.3.3.3" })).status).toBe(400);
    expect((await post(JSON.stringify({ p: "a".repeat(5000) }), { origin: ORIGIN, "cf-connecting-ip": "4.4.4.4" })).status).toBe(413);
    const del = await fetch(`${base}/alerts/abc?x=1`, { method: "DELETE", headers: { origin: ORIGIN } });
    expect(del.status).toBe(201);
    expect(calls.at(-1)).toEqual({ method: "DELETE", path: "/alerts/abc", body: null });
  });

  it("limits new alerts per IP", async () => {
    const h = { origin: ORIGIN, "cf-connecting-ip": "9.9.9.9" };
    const codes = [];
    for (let k = 0; k < 4; k++) codes.push((await post("{}", h)).status);
    expect(codes).toEqual([201, 201, 201, 429]);
    expect((await post("{}", { ...h, "cf-connecting-ip": "8.8.8.8" })).status).toBe(201);
  });

  it("refuses other methods", async () => {
    expect((await fetch(`${base}/alerts`, { method: "PUT", headers: { origin: ORIGIN } })).status).toBe(405);
  });
});

describe("push API of several cities", () => {
  type Req = { method: string; path: string; body: unknown };
  const city = (name: string, del = 204) => {
    const seen: Req[] = [];
    return { seen, web: async (r: Req) => { seen.push(r); return r.method === "DELETE" ? { status: del } : { status: 201, body: { id: name, until: 1 } }; } };
  };

  it("sends a new alert to the city it names, Athens when it names none", async () => {
    const ath = city("ath"), the = city("the");
    const web = byCity({ athens: ath, thessaloniki: the }, "athens").web;
    expect((await web({ method: "POST", path: "/alerts", body: { p: "1", sub: {} } })).body).toEqual({ id: "ath", until: 1 });
    expect((await web({ method: "POST", path: "/alerts", body: { p: "1", sub: {}, city: "athens" } })).body).toEqual({ id: "ath", until: 1 });
    expect((await web({ method: "POST", path: "/alerts", body: { p: "1", sub: {}, city: "thessaloniki" } })).body).toEqual({ id: "the", until: 1 });
    expect(ath.seen).toHaveLength(2);
    expect(the.seen).toHaveLength(1);
  });

  it("refuses an unknown city, and rail alerts outside the first city", async () => {
    const ath = city("ath"), the = city("the");
    const web = byCity({ athens: ath, thessaloniki: the }, "athens").web;
    for (const c of ["patra", 3, "__proto__", "toString"])
      expect((await web({ method: "POST", path: "/alerts", body: { p: "1", city: c } })).status).toBe(400);
    expect((await web({ method: "POST", path: "/alerts", body: { rail: {}, sub: {}, city: "thessaloniki" } })).status).toBe(400);
    expect((await web({ method: "POST", path: "/alerts", body: { rail: {}, tg: true, city: "thessaloniki" } })).status).toBe(400);
    expect((await web({ method: "POST", path: "/alerts", body: { rail: {}, sub: {} } })).status).toBe(201);
    expect(the.seen).toEqual([]);
  });

  it("stops an alert in every city (ids are random), and says when one could not save", async () => {
    const ath = city("ath"), the = city("the");
    const web = byCity({ athens: ath, thessaloniki: the }, "athens").web;
    expect((await web({ method: "DELETE", path: "/alerts/x", body: null })).status).toBe(204);
    expect(ath.seen).toHaveLength(1);
    expect(the.seen).toHaveLength(1);
    const bad = byCity({ athens: city("ath"), thessaloniki: city("the", 503) }, "athens").web;
    expect((await bad({ method: "DELETE", path: "/alerts/x", body: null })).status).toBe(503);
  });

  it("leaves other requests to the first city", async () => {
    const ath = city("ath"), the = city("the");
    await byCity({ athens: ath, thessaloniki: the }, "athens").web({ method: "GET", path: "/nope", body: null });
    expect(ath.seen).toHaveLength(1);
    expect(the.seen).toEqual([]);
  });
});
