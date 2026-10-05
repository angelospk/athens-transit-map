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
