import { describe, expect, it } from "vitest";
import { wanted, type Seen } from "../src/lib/prefetch";
import type { MetroStation } from "../src/lib/metro";

const stations: MetroStation[] = [
  { name: "ΣΥΝΤΑΓΜΑ", lon: 23.7355, lat: 37.9755, lines: ["M2", "M3"] },
  { name: "Σύνταγμα (Κέντρο)", lon: 23.7347, lat: 37.9753, lines: ["T6"] },   // 76 m: the same interchange
  { name: "ΑΚΡΟΠΟΛΗ", lon: 23.7295, lat: 37.9686, lines: ["M2"] },
];
const f = (layer: string, x: number, props: Record<string, unknown>): Seen => ({ layer, px: [x, 0], props });

describe("wanted", () => {
  it("what is on screen, nearest the centre first, each once", () => {
    const got = wanted([
      f("metro-station", 300, { name: "ΑΚΡΟΠΟΛΗ" }),
      f("train-dot", 10, { kind: "metro", id: "t1" }),
      f("train-dot", 110, { kind: "suburban", id: "1226" }),
      f("suburban-station", 105, { id: "s9" }),
      f("train-dot", 10, { kind: "metro", id: "t1" }),   // the same feature from another tile
    ], [100, 0], stations);
    expect(got).toEqual([
      { kind: "suburban-station", id: "s9" }, { kind: "suburban-run", id: "1226" },
      { kind: "metro-run", id: "t1" }, { kind: "stasy", id: "ΑΚΡΟΠΟΛΗ" },
    ]);
  });
  it("a metro station asks every name of its interchange, as its card does", () => {
    expect(wanted([f("metro-station", 0, { name: "ΣΥΝΤΑΓΜΑ" })], [0, 0], stations))
      .toEqual([{ kind: "stasy", id: "ΣΥΝΤΑΓΜΑ" }, { kind: "stasy", id: "Σύνταγμα (Κέντρο)" }]);
  });
  it("at most `max`", () => {
    const many = Array.from({ length: 30 }, (_, i) => f("train-dot", i, { kind: "metro", id: `t${i}` }));
    expect(wanted(many, [0, 0], stations, 5).map(w => w.id)).toEqual(["t0", "t1", "t2", "t3", "t4"]);
  });
});
