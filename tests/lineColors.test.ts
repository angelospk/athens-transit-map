import { describe, expect, it } from "vitest";
import { assignSlots, colorOf, PALETTE } from "../src/lib/lineColors";

// WCAG relative luminance and contrast ratio.
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe("PALETTE", () => {
  it("has a distinct colour for 5 picks and the line shown from the city layer", () => {
    expect(PALETTE.length).toBeGreaterThanOrEqual(6);
    expect(new Set(PALETTE.map(c => c.bg.toLowerCase())).size).toBe(PALETTE.length);
  });
  it("keeps the line number readable (WCAG AA, 4.5:1)", () => {
    for (const c of PALETTE) expect(contrast(c.bg, c.fg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("assignSlots", () => {
  it("gives lines the first free slots in order", () => {
    expect([...assignSlots(["040", "Α1", "550"], new Map())]).toEqual([["040", 0], ["Α1", 1], ["550", 2]]);
  });
  it("keeps the colour of a line while it stays", () => {
    const a = assignSlots(["040", "Α1", "550"], new Map());
    const b = assignSlots(["040", "550"], a);
    expect(b.get("550")).toBe(2);
    const c = assignSlots(["040", "550", "Χ95"], b);
    expect(c.get("Χ95")).toBe(1);   // the freed slot
    expect(c.get("550")).toBe(2);
  });
  it("drops lines that left", () => {
    expect(assignSlots(["040"], new Map([["Α1", 0]])).has("Α1")).toBe(false);
  });
  it("never gives two lines the same slot", () => {
    const ids = ["1", "2", "3", "4", "5", "6"];
    expect(new Set(assignSlots(ids, new Map()).values()).size).toBe(6);
  });
  it("wraps when there are more lines than colours", () => {
    const ids = Array.from({ length: PALETTE.length + 1 }, (_, i) => String(i));
    expect(assignSlots(ids, new Map()).get(String(PALETTE.length))).toBe(0);
  });
});

describe("colorOf", () => {
  it("is the palette colour of the slot", () => {
    expect(colorOf(new Map([["040", 1]]), "040")).toEqual(PALETTE[1]);
  });
  it("is undefined for a line without a slot", () => {
    expect(colorOf(new Map(), "040")).toBeUndefined();
  });
});
