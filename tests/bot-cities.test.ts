import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CITYBUS, citybusUrls } from "../bot/cities";

// The citybus.gr cities the bot watches (web push only), as staseis-rt serves them: /v1/cities there.
const CODES = "agq axd art ver vol dra her ioa kva kso kat cfu kzi kom lam lra mes mjt nao xan pat pto ser cha chq jkh sal jsi";

describe("citybus cities in the bot", () => {
  it("are the 28 cities of staseis-rt, in its order, each slug once", () => {
    expect(CITYBUS.map(c => c.code).join(" ")).toBe(CODES);
    const slugs = CITYBUS.map(c => c.slug);
    expect(new Set(slugs).size).toBe(28);
    expect(slugs).not.toContain("athens");
    expect(slugs).not.toContain("thessaloniki");
    for (const s of slugs) expect(s).toMatch(/^[a-z]+$/);
  });

  it("read the city's own path on the API and the map's stop index of its slug", () => {
    expect(citybusUrls("https://staseis-rt.haroldpoi.dev/", "https://staseis.gr", { slug: "patras", code: "pat" })).toEqual({
      api: "https://staseis-rt.haroldpoi.dev/pat",
      static: "https://staseis-rt.haroldpoi.dev/pat/static/v1",
      trips: "https://staseis.gr/trips-patras.json",
    });
  });

  // No index yet: too many stops without a direction (tests/towards.test.ts), #57.
  const NO_INDEX = ["kastoria", "ptolemaida", "skiathos"];
  it("each have the map's stop index, rebuilt daily by citybus-stops.yml", () => {
    const wf = readFileSync(".github/workflows/citybus-stops.yml", "utf8");
    for (const c of CITYBUS.filter(c => !NO_INDEX.includes(c.slug))) {
      expect(existsSync(`public/trips-${c.slug}.json`), c.slug).toBe(true);
      expect(wf).toContain(`${c.slug}:${c.code}`);
    }
  });
});
