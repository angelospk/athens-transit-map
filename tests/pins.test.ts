import { describe, expect, it } from "vitest";
import { dropPin, hueColor, inkOn, isPins, pinLinesFC, pinStopsFC, setPin, type Pin } from "../src/lib/pins";

const line: Pin = { kind: "line", id: "040", label: "040", color: "#b58cff", width: 2, vehicles: true, top: true };
const stop: Pin = { kind: "stop", id: "60001", label: "Ακαδημία", color: "#f0ae45", width: 2, vehicles: false, top: false, at: [23.73, 37.98] };

describe("pins", () => {
  it("validates what comes back from storage", () => {
    expect(isPins([line, stop])).toBe(true);
    expect(isPins([{ ...line, color: "red" }])).toBe(false);
    expect(isPins([{ ...stop, at: undefined }])).toBe(false);
  });
  it("sets, replaces and drops", () => {
    const a = setPin([line], stop);
    expect(a).toHaveLength(2);
    expect(setPin(a, { ...line, color: "#46c267" })[0].color).toBe("#46c267");
    expect(dropPin(a, "line", "040")).toEqual([stop]);
  });
  it("keeps only the pins on top while something else is open", () => {
    expect(pinStopsFC([stop], true).features).toHaveLength(0);
    expect(pinStopsFC([stop], false).features[0].properties).toMatchObject({ name: "Ακαδημία", color: "#f0ae45" });
    const fc = pinLinesFC([line], () => [[[23.7, 37.9], [23.8, 38]]], true);
    expect(fc.features[0].properties).toMatchObject({ id: "040", w: 5 });
  });
  it("picks a readable ink and a hue", () => {
    expect(inkOn("#f4f5f7")).toBe("#0a1424");
    expect(inkOn("#2563eb")).toBe("#ffffff");
    expect(hueColor(0)).toMatch(/^#[0-9a-f]{6}$/);
  });
});
