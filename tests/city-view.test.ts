import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppState } from "../src/lib/state.svelte";

vi.stubGlobal("history", { state: null, replaceState: () => {} });
vi.stubGlobal("location", { pathname: "/", search: "", hash: "" });
vi.stubGlobal("document", { visibilityState: "visible", hidden: false, addEventListener: () => {} });
vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });

const T = 1_791_100_000;
const SYNTAGMA = { north: 37.98, south: 37.97, east: 23.74, west: 23.73 };   // z 13 tile 4636/3160, with the pad also 4636/3161 at most
const body = (updated_at: number, ids: string[]) => ({
  updated_at, next_update_at: updated_at + 30,
  vehicles: ids.map(id => ({ line: "040", id, lat: 37.975, lon: 23.735, position_at: T, bearing: null, variant: null,
    delay_s: null, speed: null })),
});
const json = (status: number, b: unknown) => ({ status, json: async () => b, headers: new Headers() });

let calls: string[];
let answer: (url: string) => Promise<unknown>;
const tilesCalls = () => calls.filter(u => u.includes("/v1/vehicles/tiles/"));
const flush = () => new Promise(r => setTimeout(r, 0));
const app$ = () => new AppState();

beforeEach(() => {
  calls = [];
  answer = async () => json(200, body(T, ["1"]));
  vi.stubGlobal("fetch", (url: string) => { calls.push(url); return answer(url); });
});
afterEach(() => vi.unstubAllEnvs());

describe("AppState city tiles", () => {
  it("fetches nothing before the map reports a view, and never the full /v1/vehicles", async () => {
    const app = app$();
    (app as unknown as { startCity(): void }).startCity();
    await flush();
    expect(calls.filter(u => u.endsWith("/v1/vehicles"))).toEqual([]);
    expect(tilesCalls()).toEqual([]);
  });

  it("the first view starts the poller, which loads the tiles of the view and shows them", async () => {
    const app = app$();
    app.setCityView(SYNTAGMA, 15);
    await new Promise(r => setTimeout(r, 20));
    expect(tilesCalls().every(u => u.includes("/tiles/13/"))).toBe(true);
    expect(tilesCalls().length).toBeGreaterThan(0);
    expect(app.city?.vehicles.map(v => v.id)).toEqual(["1"]);
  });

  it("a move to the same tiles asks for nothing; one tile more asks for that tile only", async () => {
    const app = app$();
    app.setCityView(SYNTAGMA, 15);
    await new Promise(r => setTimeout(r, 20));
    calls.length = 0;
    app.setCityView({ ...SYNTAGMA, north: SYNTAGMA.north + 0.0001 }, 15);
    await flush();
    expect(tilesCalls()).toEqual([]);
    const east = { ...SYNTAGMA, east: SYNTAGMA.east + 0.05, west: SYNTAGMA.west + 0.05 };
    app.setCityView(east, 15);
    await flush();
    expect(tilesCalls().length).toBeGreaterThan(0);
    expect(new Set(tilesCalls()).size).toBe(tilesCalls().length);
    expect(tilesCalls().some(u => u.includes("/tiles/13/4637/"))).toBe(true);
  });

  it("a failed tile keeps the last vehicles and the next moves do not retry at once (the poller does)", async () => {
    const app = app$();
    app.setCityView(SYNTAGMA, 15);
    await new Promise(r => setTimeout(r, 20));
    const before = app.city;
    answer = async () => json(404, { error: "not_found" });
    const east = { ...SYNTAGMA, east: SYNTAGMA.east + 0.05, west: SYNTAGMA.west + 0.05 };
    app.setCityView(east, 15);
    await flush();
    expect(app.city).toBe(before);
    calls.length = 0;
    app.setCityView({ ...east, east: east.east + 0.05, west: east.west + 0.05 }, 15);
    await flush();
    expect(tilesCalls()).toEqual([]);
    expect(calls.filter(u => u.endsWith("/v1/vehicles"))).toEqual([]);
  });

  it("an answer that comes after the layer was turned off does not show", async () => {
    const app = app$();
    app.setCityView(SYNTAGMA, 15);
    await new Promise(r => setTimeout(r, 20));
    const before = app.city;
    let release!: (v: unknown) => void;
    answer = () => new Promise(r => (release = r));
    const east = { ...SYNTAGMA, east: SYNTAGMA.east + 0.05, west: SYNTAGMA.west + 0.05 };
    app.setCityView(east, 15);
    app.setCityOn(false);
    release(json(200, body(T + 30, ["2"])));
    await flush();
    expect(app.city).toBe(before);
  });

  it("a zoom across 13 replaces the set: the z 9 tiles are fetched and the z 13 vehicles go", async () => {
    const app = app$();
    app.setCityView(SYNTAGMA, 15);
    await new Promise(r => setTimeout(r, 20));
    calls.length = 0;
    answer = async () => json(200, body(T + 1, ["9"]));
    app.setCityView(SYNTAGMA, 11);
    await flush();
    expect(tilesCalls().every(u => u.includes("/tiles/9/"))).toBe(true);
    expect(app.city?.vehicles.map(v => v.id)).toEqual(["9"]);
  });
});
