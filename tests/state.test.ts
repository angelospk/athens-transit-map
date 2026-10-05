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
