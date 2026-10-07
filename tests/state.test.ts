import { describe, expect, it, vi } from "vitest";
import { AppState } from "../src/lib/state.svelte";

vi.stubGlobal("history", { state: null, replaceState: () => {} });
vi.stubGlobal("location", { pathname: "/", search: "", hash: "" });

describe("AppState line removal", () => {
  it("clears selection and focus when the backend says the line does not exist (404)", () => {
    const app = new AppState();
    app.selected = ["040", "550"];
    app.selectRoute("040", "5512");
    app.setFocus("040", ["5512", "5535"]);
    (app as unknown as { onPollState(id: string, s: string): void }).onPollState("040", "unknown");
    expect(app.selected).toEqual(["550"]);
    expect(app.selection).toBeNull();
    expect(app.focus).toEqual({});
  });
});

describe("AppState city focus (temporary line)", () => {
  vi.stubGlobal("fetch", () => new Promise(() => {}));   // requests never settle in these tests
  const hook = (app: AppState) => app as unknown as { onData(id: string, d: unknown): void };

  it("shows a clicked city vehicle's line in detail without touching the picks, until unfocus", () => {
    const app = new AppState();
    app.selected = ["040"];
    app.selectCityVehicle("Α1", "5");
    expect(app.tempLine).toBe("Α1");
    expect(app.detailLines).toEqual(["040", "Α1"]);
    expect(app.selected).toEqual(["040"]);
    expect(app.selection).toEqual({ kind: "vehicle", line: "Α1", id: "5" });
    app.clearSelection();
    expect(app.tempLine).toBeNull();
    expect(app.detailLines).toEqual(["040"]);
  });

  it("uses no temporary line for a picked line, and replaces it on the next click", () => {
    const app = new AppState();
    app.selected = ["040"];
    app.selectCityVehicle("040", "1");
    expect(app.tempLine).toBeNull();
    app.selectCityVehicle("Α1", "5");
    app.selectCityVehicle("550", "7");
    expect(app.tempLine).toBe("550");
    app.selectVehicle("040", "1");
    expect(app.tempLine).toBeNull();
  });

  it("keeps the line when the user picks it", () => {
    const app = new AppState();
    app.selectCityVehicle("Α1", "5");
    app.toggleLine("Α1");
    expect(app.selected).toEqual(["Α1"]);
    expect(app.tempLine).toBeNull();
    expect(app.selection).toEqual({ kind: "vehicle", line: "Α1", id: "5" });
  });

  it("unfocuses when the vehicle leaves its line's data or the city layer is turned off", () => {
    const app = new AppState();
    app.selectCityVehicle("Α1", "5");
    hook(app).onData("Α1", { line: "Α1", updated_at: 1, next_update_at: 31, vehicles: [] });
    expect(app.selection).toBeNull();
    expect(app.tempLine).toBeNull();
    app.selectCityVehicle("Α1", "5");
    app.setCityOn(false);
    expect(app.tempLine).toBeNull();
    expect(app.cityOn).toBe(false);
  });

  it("drops the temporary line when a picked line's vehicle is clicked on the city layer", () => {
    const app = new AppState();
    app.selected = ["040"];
    app.selectCityVehicle("Α1", "5");
    app.selectCityVehicle("040", "1");
    expect(app.tempLine).toBeNull();
    expect(app.detailLines).toEqual(["040"]);
  });

  it("forgets a closed line's data, so a reopened line stays on the city layer until fresh data", () => {
    const app = new AppState();
    app.selectCityVehicle("Α1", "5");
    hook(app).onData("Α1", { line: "Α1", updated_at: 1, next_update_at: 31, vehicles: [{ id: "5" }] });
    expect(app.cityExclude.has("Α1")).toBe(true);
    app.clearSelection();
    expect(app.live["Α1"]).toBeUndefined();
    app.selectCityVehicle("Α1", "5");
    expect(app.cityExclude.has("Α1")).toBe(false);
  });

  it("forgets a deselected pick's data too", () => {
    const app = new AppState();
    app.toggleLine("040");
    hook(app).onData("040", { line: "040", updated_at: 1, next_update_at: 31, vehicles: [] });
    app.toggleLine("040");
    expect(app.live["040"]).toBeUndefined();
  });
});

describe("AppState metro lines and favourites", () => {
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  const mem = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  });
  const metro = { source: "t", stations: [{ name: "ΟΜΟΝΟΙΑ", lon: 0, lat: 0, lines: ["M1", "M2"] }],
    lines: ["M1", "M2", "M3"].map(id => ({ id, name: id, color: "#000", paths: [] })) };
  const fresh = () => { mem.clear(); return new AppState(); };

  it("pins and unpins metro lines, and remembers them", () => {
    const app = fresh();
    expect(app.metroLines).toEqual([]);
    app.toggleMetroLine("M2");
    app.toggleMetroLine("M1");
    expect(app.metroLines).toEqual(["M2", "M1"]);
    app.toggleMetroLine("M2");
    expect(app.metroLines).toEqual(["M1"]);
    expect(new AppState().metroLines).toEqual(["M1"]);
  });

  it("sets all or none at once", () => {
    const app = fresh();
    app.metro = metro;
    app.setMetroLines(["M1", "M2", "M3"]);
    expect(app.metroLines).toEqual(["M1", "M2", "M3"]);
    app.setMetroLines([]);
    expect(app.metroLines).toEqual([]);
  });

  it("turns the old single metro switch into all lines once the data loads", () => {
    mem.clear();
    mem.set("metroOn", "true");
    const app = new AppState();
    app.metro = metro;
    (app as unknown as { migrateMetro(): void }).migrateMetro();
    expect(app.metroLines).toEqual(["M1", "M2", "M3"]);
    expect(mem.get("metroLines")).toBe('["M1","M2","M3"]');
  });

  it("keeps lines already chosen over the old switch", () => {
    mem.clear();
    mem.set("metroOn", "true");
    mem.set("metroLines", "[]");
    const app = new AppState();
    app.metro = metro;
    (app as unknown as { migrateMetro(): void }).migrateMetro();
    expect(app.metroLines).toEqual([]);
    expect(mem.has("metroOn")).toBe(false);
  });

  it("a tapped station and a selected vehicle exclude each other", () => {
    const app = fresh();
    app.selectStation("ΟΜΟΝΟΙΑ");
    expect(app.metroStation).toBe("ΟΜΟΝΟΙΑ");
    app.selectCityVehicle("040", "1");
    expect(app.metroStation).toBeNull();
    app.selectStation("ΟΜΟΝΟΙΑ");
    expect(app.selection).toBeNull();
  });

  it("stars and unstars lines, and remembers them", () => {
    const app = fresh();
    app.toggleFavorite("040");
    app.toggleFavorite("550");
    app.toggleFavorite("040");
    expect(app.favorites).toEqual(["550"]);
    expect(new AppState().favorites).toEqual(["550"]);
  });

  it("shows all favourites at once, up to the line limit, keeping the picks", () => {
    const app = fresh();
    app.lines = ["1", "2", "3", "4", "5", "6"].map(id => ({ id, name: id, color: "#000", text_color: "#fff" })) as never;
    app.selected = ["1"];
    for (const id of ["2", "3", "4", "5", "6"]) app.toggleFavorite(id);
    app.showFavorites();
    expect(app.selected).toEqual(["1", "2", "3", "4", "5"]);
    expect(app.notice).toMatch(/4 από τις 5/);
  });

  it("frames all the added favourites at once", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    const app = fresh();
    // Line ids no other test used: fetchLineStatic keeps one request per line for the whole run.
    app.lines = ["F1", "F2"].map(id => ({ id, name: id, color: "#000", text_color: "#fff" })) as never;
    const fits: string[][] = [];
    app.fit = ids => fits.push(ids);
    app.toggleFavorite("F1");
    app.toggleFavorite("F2");
    app.showFavorites();
    await new Promise(r => setTimeout(r, 0));
    expect(fits).toEqual([["F1", "F2"]]);
    vi.stubGlobal("fetch", () => new Promise(() => {}));
  });
});
