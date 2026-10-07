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

describe("AppState trip", () => {
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  const trip = (...ids: string[]) => ids.map(id => ({ id, variants: [`${id}-v`] }));

  it("replaces the picks with the trip's lines, each focused on its serving variants", () => {
    const app = new AppState();
    app.selected = ["040", "550"];
    app.setFocus("550", ["x"]);
    app.selectRoute("040", "5512");
    app.selectCityVehicle("Α1", "5");
    app.metroStation = "ΟΜΟΝΟΙΑ";
    const left = app.showTrip(trip("550", "Β2"));
    expect(left).toEqual([]);
    expect(app.selected).toEqual(["550", "Β2"]);
    expect(app.focus).toEqual({ "550": ["550-v"], "Β2": ["Β2-v"] });
    expect(app.tempLine).toBeNull();
    expect(app.selection).toBeNull();
    expect(app.metroStation).toBeNull();
  });

  it("keeps the first 5 lines and returns the rest", () => {
    const app = new AppState();
    expect(app.showTrip(trip("1", "2", "3", "4", "5", "6", "7"))).toEqual(["6", "7"]);
    expect(app.selected).toEqual(["1", "2", "3", "4", "5"]);
    expect(app.notice).toMatch(/6, 7/);
  });

  it("keeps a temporary line that the trip uses, now as a pick", () => {
    const app = new AppState();
    app.selectCityVehicle("Α1", "5");
    app.showTrip(trip("Α1"));
    expect(app.selected).toEqual(["Α1"]);
    expect(app.tempLine).toBeNull();
  });

  it("changes nothing for a trip with no lines", () => {
    const app = new AppState();
    app.selected = ["040"];
    app.showTrip([]);
    expect(app.selected).toEqual(["040"]);
  });

  it("frames only the latest trip's lines", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    const app = new AppState();
    const fits: string[][] = [];
    app.fit = ids => fits.push(ids);
    app.showTrip(trip("T1"));
    app.showTrip(trip("T2"));
    await new Promise(r => setTimeout(r, 0));
    expect(fits).toEqual([["T2"]]);
    vi.stubGlobal("fetch", () => new Promise(() => {}));
  });
});

describe("trip result buttons", () => {
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  const t = (line: string) => ({ line, walk: 0, stops: 1, variants: [{ id: `${line}-v`, i: 0, j: 1, from: 0, to: 1, walk: 0, stops: 1 }] });

  it("shows a line again in the trip's direction, and hides it", async () => {
    const { toggleTripLine } = await import("../src/lib/trip");
    const app = new AppState();
    app.showTrip([{ id: "R1", variants: ["R1-v"] }]);
    toggleTripLine(app, t("R1"));
    expect(app.selected).toEqual([]);
    toggleTripLine(app, t("R1"));
    expect(app.selected).toEqual(["R1"]);
    expect(app.focus).toEqual({ R1: ["R1-v"] });
  });

  it("leaves the picks and focus alone when the line limit is reached", async () => {
    const { toggleTripLine } = await import("../src/lib/trip");
    const app = new AppState();
    app.showTrip(["1", "2", "3", "4", "5"].map(id => ({ id, variants: [] })));
    toggleTripLine(app, t("6"));
    expect(app.selected).toHaveLength(5);
    expect(app.focus["6"]).toBeUndefined();
  });
});

describe("AppState stop alert", () => {
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  const spec = (...lines: string[]) => ({ n: 3, until: Date.now() / 1000 + 7200, label: "ΑΓΟΡΑ", lines: lines.map(line => ({ line, variants: [] })) });

  it("watches only the alert's lines that are still picked, none once all are gone", () => {
    const app = new AppState();
    app.selected = ["622", "550"];
    app.setAlert(spec("622", "550"));
    app.toggleLine("550");
    expect(app.alert?.lines.map(l => l.line)).toEqual(["622"]);
    app.toggleLine("622");
    expect(app.alert).toBeNull();
  });

  it("is gone once its time is over", () => {
    const app = new AppState();
    app.selected = ["622"];
    app.setAlert({ ...spec("622"), until: Date.now() / 1000 - 1 });
    expect(app.alert).toBeNull();
  });

  it("ends when a new trip is shown", () => {
    const app = new AppState();
    app.setAlert(spec("622"));
    app.showTrip([{ id: "622", variants: ["x"] }]);
    expect(app.alert).toBeNull();
  });

  it("keeps hits until dismissed", () => {
    const app = new AppState();
    app.alertHit({ line: "622", vehicle: "1", left: 2, stop: "s", delay_s: 60 }, "ΑΓΟΡΑ");
    expect(app.hits.map(h => h.text)).toEqual(["Το 622 είναι 2 στάσεις πριν από ΑΓΟΡΑ (καθυστέρηση 1′)."]);
    app.dismissHit(app.hits[0].id);
    expect(app.hits).toEqual([]);
  });
});

describe("AppState lines without vehicles", () => {
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  const hook = (app: AppState) => app as unknown as { onData(id: string, d: unknown): void };
  const feed = (line: string, updated_at: number, vehicles: unknown[] = []) =>
    ({ line, updated_at, next_update_at: updated_at + 30, vehicles });
  const car = [{ id: "1", variant: null }];

  it("removes a picked line after two updates with no vehicles, with its focus and selection, and says so", () => {
    const app = new AppState();
    app.selected = ["040", "550"];
    app.setFocus("040", ["5513"]);
    hook(app).onData("040", feed("040", 100));
    expect(app.selected).toEqual(["040", "550"]);
    hook(app).onData("040", feed("040", 130));
    expect(app.selected).toEqual(["550"]);
    expect(app.focus).toEqual({});
    expect(app.live["040"]).toBeUndefined();
    expect(app.notice).toContain("040");
  });

  it("needs two empty updates in a row: one with vehicles in between starts over", () => {
    const app = new AppState();
    app.selected = ["040"];
    hook(app).onData("040", feed("040", 100));
    hook(app).onData("040", feed("040", 130, car));
    hook(app).onData("040", feed("040", 160));
    expect(app.selected).toEqual(["040"]);
  });

  it("counts an update once: the same data again, or older, is not a second one", () => {
    const app = new AppState();
    app.selected = ["040"];
    hook(app).onData("040", feed("040", 100));
    hook(app).onData("040", feed("040", 100));
    hook(app).onData("040", feed("040", 90));
    expect(app.selected).toEqual(["040"]);
  });

  it("a line taken off and picked again starts counting from zero", () => {
    const app = new AppState();
    app.toggleLine("040");
    hook(app).onData("040", feed("040", 100));
    app.toggleLine("040");
    app.toggleLine("040");
    hook(app).onData("040", feed("040", 130));
    expect(app.selected).toEqual(["040"]);
  });

  it("leaves the line shown from a city vehicle alone: it goes with its selection, with no count kept", () => {
    const app = new AppState();
    app.selectCityVehicle("Α1", "5");
    hook(app).onData("Α1", feed("Α1", 100));
    expect(app.tempLine).toBeNull();
    expect(app.selected).toEqual([]);
    expect(app.notice).toBeNull();
    app.toggleLine("Α1");   // picked later: no count from before
    hook(app).onData("Α1", feed("Α1", 130));
    expect(app.selected).toEqual(["Α1"]);
  });

  it("an older copy of the feed arriving late is not counted, with or without vehicles", () => {
    const app = new AppState();
    app.selected = ["040"];
    hook(app).onData("040", feed("040", 200, car));
    hook(app).onData("040", feed("040", 100));
    hook(app).onData("040", feed("040", 130));
    expect(app.selected).toEqual(["040"]);
    hook(app).onData("040", feed("040", 230));
    hook(app).onData("040", feed("040", 260));
    expect(app.selected).toEqual([]);
  });

  it("a late answer for a line that is no longer picked changes nothing", () => {
    const app = new AppState();
    app.selected = ["550"];
    hook(app).onData("040", feed("040", 100));
    hook(app).onData("040", feed("040", 130));
    expect(app.selected).toEqual(["550"]);
    expect(app.notice).toBeNull();
  });

  it("stops the stop alert of a removed line, and ends it when none is left", () => {
    const app = new AppState();
    app.selected = ["040", "550"];
    (app as unknown as { alertSpec: unknown }).alertSpec = { n: 2, until: Date.now() / 1000 + 3600, label: "Χ",
      lines: [{ line: "040", variants: [] }, { line: "550", variants: [] }] };
    expect(app.alert?.lines.map(l => l.line)).toEqual(["040", "550"]);
    hook(app).onData("040", feed("040", 100));
    hook(app).onData("040", feed("040", 130));
    expect(app.alert?.lines.map(l => l.line)).toEqual(["550"]);
    hook(app).onData("550", feed("550", 100));
    hook(app).onData("550", feed("550", 130));
    expect(app.alert).toBeNull();
  });

  it("two lines going empty together give one notice naming both", () => {
    const app = new AppState();
    app.selected = ["040", "550"];
    for (const t of [100, 130]) for (const l of app.selected.slice()) hook(app).onData(l, feed(l, t));
    expect(app.selected).toEqual([]);
    expect(app.notice).toContain("040");
    expect(app.notice).toContain("550");
  });
});

describe("AppState help hint", () => {
  vi.stubGlobal("fetch", () => new Promise(() => {}));

  it("shows the ? until it is pressed once, and then never again", () => {
    localStorage.removeItem("helpSeen");
    const app = new AppState();
    expect(app.helpSeen).toBe(false);
    app.markHelpSeen();
    expect(app.helpSeen).toBe(true);
    expect(new AppState().helpSeen).toBe(true);
  });
});
