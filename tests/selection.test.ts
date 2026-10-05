import { describe, expect, it } from "vitest";
import { MAX_LINES, normalizeLineId, parseSelection, selectionIds, serializeSelection, splitKnown, toggle } from "../src/lib/selection";

describe("parseSelection", () => {
  it("decodes, dedupes and maps Latin look-alikes to Greek", () => {
    expect(parseSelection("?l=040,A1,040,%CE%A72")).toEqual(["040", "Α1", "Χ2"]);
  });
  it("keeps at most 5 lines", () => {
    expect(parseSelection("?l=1,2,3,4,5,6")).toEqual(["1", "2", "3", "4", "5"]);
    expect(MAX_LINES).toBe(5);
  });
  it("ignores empty input", () => {
    expect(parseSelection("")).toEqual([]);
    expect(parseSelection("?l=,,")).toEqual([]);
    expect(parseSelection("?x=1")).toEqual([]);
  });
  it("uppercases lowercase input", () => {
    expect(parseSelection("?l=a1,χ95")).toEqual(["Α1", "Χ95"]);
  });
});

describe("serializeSelection", () => {
  it("round-trips through parseSelection", () => {
    const s = serializeSelection(["040", "Α1"]);
    expect(s.startsWith("?l=")).toBe(true);
    expect(parseSelection(s)).toEqual(["040", "Α1"]);
  });
  it("is empty for no lines", () => {
    expect(serializeSelection([])).toBe("");
  });
});

describe("toggle", () => {
  it("adds and removes", () => {
    expect(toggle(["040"], "550")).toEqual(["040", "550"]);
    expect(toggle(["040", "550"], "040")).toEqual(["550"]);
  });
  it("refuses a 6th line", () => {
    const five = ["1", "2", "3", "4", "5"];
    expect(toggle(five, "6")).toBe(five);
  });
});

describe("normalizeLineId", () => {
  it("only maps letters, never digits", () => {
    expect(normalizeLineId("b12")).toBe("Β12");
    expect(normalizeLineId("040")).toBe("040");
  });
});

describe("selectionIds", () => {
  it("returns every id so callers can tell the link was cut to 5", () => {
    expect(selectionIds("?l=1,2,3,4,5,6,7,8")).toHaveLength(8);
    expect(parseSelection("?l=1,2,3,4,5,6,7,8")).toEqual(["1", "2", "3", "4", "5"]);
  });
});

describe("splitKnown", () => {
  it("keeps known ids in order and returns the unknown ones", () => {
    expect(splitKnown(["040", "ΧΧΧ", "Α1", "999"], new Set(["040", "Α1"]))).toEqual({
      kept: ["040", "Α1"],
      dropped: ["ΧΧΧ", "999"],
    });
  });
});
