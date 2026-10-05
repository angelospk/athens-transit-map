import { describe, expect, it } from "vitest";
import { searchLines } from "../src/lib/search";
import index from "../src/fixtures/lines.json";
import type { LineInfo } from "../src/lib/types";

const lines = index.lines as LineInfo[];
const top = (q: string) => searchLines(lines, q)[0]?.id;

describe("searchLines", () => {
  it("finds Α1 from Latin, Greek and lowercase input", () => {
    expect(top("a1")).toBe("Α1");
    expect(top("A1")).toBe("Α1");
    expect(top("Α1")).toBe("Α1");
  });
  it("finds 040 with or without the leading zero", () => {
    expect(top("040")).toBe("040");
    expect(top("40")).toBe("040");
  });
  it("finds a line by part of its name, ignoring case and accents", () => {
    const name = lines.find(l => l.id === "040")!.name;
    const part = name.split(" ").find(w => w.length > 4)!;
    expect(searchLines(lines, part.toLowerCase()).map(l => l.id)).toContain("040");
  });
  it("lists every line, sorted, for an empty query", () => {
    const all = searchLines(lines, " ");
    expect(all).toHaveLength(lines.length);
    expect(all.findIndex(l => l.id === "2")).toBeLessThan(all.findIndex(l => l.id === "550"));
  });
});
