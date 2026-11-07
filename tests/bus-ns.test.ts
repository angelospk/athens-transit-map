// web#54: the bus ids of a page carry its city's namespace (oasa:040 in Athens and Thessaloniki, pat:101 in
// Patras); nothing may build or test a bus id with a hard-coded "oasa:".
import { afterEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

async function pageAt(path: string) {
  vi.resetModules();
  vi.stubGlobal("location", { pathname: path, search: "" });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return import("../src/lib/busNs");
}
afterEach(() => vi.unstubAllGlobals());

describe("BUS_NS (web#54)", () => {
  it("Athens and Thessaloniki: oasa", async () => {
    expect((await pageAt("/athens/")).BUS_NS).toBe("oasa");
    expect((await pageAt("/thessaloniki/")).BUS_NS).toBe("oasa");
  });

  it("a citybus.gr city: its backend code; busId and isBusId follow it", async () => {
    const m = await pageAt("/patras/stop/pat-403");
    expect(m.BUS_NS).toBe("pat");
    expect(m.busId("101")).toBe("pat:101");
    expect(m.isBusId("pat:101")).toBe(true);
    expect(m.isBusId("oasa:101")).toBe(false);
    expect(m.isBusId("muni:7")).toBe(false);
  });

  it("no source file outside busNs.ts, legacy.ts and favs.ts (old Athens data) writes a literal oasa: id", () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); } };
    walk("src/lib");
    const bad = files
      .filter(f => /\.(ts|svelte)$/.test(f) && !/(busNs|legacy|favs)\.ts$/.test(f))
      .flatMap(f => readFileSync(f, "utf8").split("\n").map((l, i) => [f, i + 1, l] as const))
      .filter(([, , l]) => /["'`]oasa:/.test(l) && !/^\s*(\/\/|\*)/.test(l));
    expect(bad.map(([f, i]) => `${f}:${i}`)).toEqual([]);
  });
});
