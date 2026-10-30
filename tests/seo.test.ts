import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { build, linePage, linePath, robots, sitemap, slug, stopPage, stopPath, SITE, type LineDetail, type SeoLine, type StopEntry } from "../scripts/seo";

const l040: SeoLine = { id: "oasa:040", mode: "bus", label: "040", name: "ΠΕΙΡΑΙΑΣ - ΣΥΝΤΑΓΜΑ", color: "#153ce0", text_color: "#ffffff" };
const lB12: SeoLine = { id: "oasa:Β12", mode: "bus", label: "Β12", name: "ΑΝΩ ΛΙΟΣΙΑ - ΚΑΜΑΤΕΡΟ", color: "#153ce0", text_color: "#ffffff" };
const m2: SeoLine = { id: "stasy:M2", mode: "metro", label: "M2", name: "Ανθούπολη - Ελληνικό", color: "#e30613", text_color: "#ffffff" };

const s1: StopEntry = ["oasa:100001", "14η ΝΤΑΜΑΡΙΑ", 38.06593, 23.71307, ["bus"], ["oasa:040", "oasa:Β12", "oasa:missing"]];
const sMetro: StopEntry = ["stasy:αγια-βαρβαρα-metro", "Αγία Βαρβάρα", 37.98995, 23.65934, ["metro"], ["stasy:M2"]];

const detail040: LineDetail = {
  line: l040,
  patterns: [
    { id: "oasa:1", headsign: "ΠΕΙΡΑΙΑΣ - ΣΥΝΤΑΓΜΑ", direction: 0, stops: ["oasa:100001", "oasa:100002"] },
    { id: "oasa:2", headsign: "ΣΥΝΤΑΓΜΑ - ΠΕΙΡΑΙΑΣ", direction: 1, stops: ["oasa:100002", "oasa:100001"] },
    { id: "oasa:3", headsign: "ΠΕΙΡΑΙΑΣ - ΣΥΝΤΑΓΜΑ", direction: 0, stops: ["oasa:100001"] },
  ],
  stops: {
    "oasa:100001": { id: "oasa:100001", name: "14η ΝΤΑΜΑΡΙΑ" },
    "oasa:100002": { id: "oasa:100002", name: "ΓΕΦΥΡΑ ΑΤΤΙΚΗΣ ΟΔΟΥ" },
  },
};

describe("paths", () => {
  it("slug turns every ':' into '-'", () => {
    expect(slug("oasa:100001")).toBe("oasa-100001");
    expect(slug("stasy:αγ.-δημητριοσ-metro")).toBe("stasy-αγ.-δημητριοσ-metro");
  });
  it("stop and line paths", () => {
    expect(stopPath("oasa:100001")).toBe("/stop/oasa-100001.html");
    expect(linePath("oasa:Β12")).toBe("/line/oasa-Β12.html");
  });
});

describe("stopPage", () => {
  const html = stopPage(s1, [l040, lB12]);
  it("has the name in the title and h1", () => {
    expect(html).toMatch(/<title>[^<]*14η ΝΤΑΜΑΡΙΑ[^<]*<\/title>/);
    expect(html).toMatch(/<h1[^>]*>[^<]*14η ΝΤΑΜΑΡΙΑ/);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('lang="el"');
  });
  it("has a meta description naming its lines", () => {
    const m = html.match(/<meta name="description" content="([^"]*)"/);
    expect(m).not.toBeNull();
    expect(m![1]).toContain("040");
    expect(m![1]).toContain("Β12");
  });
  it("has an absolute canonical URL, percent-encoded", () => {
    expect(html).toContain(`<link rel="canonical" href="${SITE}/stop/oasa-100001.html">`);
    const metro = stopPage(sMetro, [m2]);
    expect(metro).toContain(`<link rel="canonical" href="${SITE}${encodeURI("/stop/stasy-αγια-βαρβαρα-metro.html")}">`);
  });
  it("links to the live map card and to each known line page", () => {
    expect(html).toContain('href="/?stop=oasa%3A100001"');
    expect(html).toContain(`href="${encodeURI("/line/oasa-040.html")}"`);
    expect(html).toContain(`href="${encodeURI("/line/oasa-Β12.html")}"`);
    expect(html).not.toContain("missing");
  });
  it("carries JSON-LD with the place type and coordinates", () => {
    const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(m).not.toBeNull();
    const ld = JSON.parse(m![1]);
    expect(ld["@type"]).toBe("BusStop");
    expect(ld.geo.latitude).toBe(38.06593);
    expect(ld.geo.longitude).toBe(23.71307);
    expect(JSON.parse(stopPage(sMetro, [m2]).match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1])["@type"]).toBe("SubwayStation");
  });
  it("escapes HTML in names, also inside JSON-LD", () => {
    const evil: StopEntry = ["oasa:9", 'Α & Β <x> "q" </script>', 38, 23, ["bus"], []];
    const out = stopPage(evil, []);
    expect(out).toContain("Α &amp; Β &lt;x&gt;");
    expect(out).not.toContain("<x>");
    expect(out.match(/<\/script>/g)!.length).toBe(1);
  });
});

describe("linePage", () => {
  const html = linePage(detail040);
  it("has label and name in title and h1", () => {
    expect(html).toMatch(/<title>[^<]*040[^<]*ΠΕΙΡΑΙΑΣ - ΣΥΝΤΑΓΜΑ[^<]*<\/title>/);
    expect(html).toMatch(/<h1[^>]*>[^<]*040/);
  });
  it("has canonical, description and the live map link", () => {
    expect(html).toContain(`<link rel="canonical" href="${SITE}/line/oasa-040.html">`);
    expect(html).toMatch(/<meta name="description" content="[^"]*040[^"]*"/);
    expect(html).toContain('href="/?line=oasa%3A040"');
  });
  it("lists one stop list per headsign, the longest pattern of each", () => {
    expect(html.match(/<h2[^>]*>[^<]*ΠΕΙΡΑΙΑΣ - ΣΥΝΤΑΓΜΑ/g)!.length).toBe(1);
    expect(html.match(/<h2[^>]*>[^<]*ΣΥΝΤΑΓΜΑ - ΠΕΙΡΑΙΑΣ/g)!.length).toBe(1);
    expect(html.match(/href="\/stop\/oasa-100002\.html"/g)!.length).toBe(2);
  });
  it("keeps a branch of the same headsign that has stops the longest pattern lacks", () => {
    const branch: LineDetail = {
      ...detail040,
      patterns: [
        { id: "oasa:1", headsign: "Α", direction: 0, stops: ["oasa:100001", "oasa:100002"] },
        { id: "oasa:4", headsign: "Α", direction: 0, stops: ["oasa:100003"] },
      ],
      stops: { ...detail040.stops, "oasa:100003": { id: "oasa:100003", name: "ΚΛΑΔΟΣ" } },
    };
    const out = linePage(branch);
    expect(out).toContain('href="/stop/oasa-100003.html"');
    expect(out).toContain("3 στάσεις");
  });
  it("names and links every stop in order", () => {
    const i = html.indexOf("14η ΝΤΑΜΑΡΙΑ");
    const j = html.indexOf("ΓΕΦΥΡΑ ΑΤΤΙΚΗΣ ΟΔΟΥ");
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    expect(html).toContain('href="/stop/oasa-100001.html"');
  });
});

describe("sitemap and robots", () => {
  it("sitemap lists absolute, encoded, XML-escaped URLs", () => {
    const xml = sitemap(["/", "/stop/stasy-αγια-βαρβαρα-metro.html", "/line/a&b.html"]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain(`<loc>${SITE}/</loc>`);
    expect(xml).toContain(`<loc>${SITE}${encodeURI("/stop/stasy-αγια-βαρβαρα-metro.html")}</loc>`);
    expect(xml).toContain(`<loc>${SITE}/line/a&amp;b.html</loc>`);
    expect(xml.match(/<url>/g)!.length).toBe(3);
  });
  it("robots allows all and names the sitemap", () => {
    expect(robots()).toContain("User-agent: *");
    expect(robots()).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  });
});

describe("build", () => {
  const api: Record<string, unknown> = {
    "lines": { lines: [l040, m2] },
    "stops": { stops: [s1, sMetro] },
    "lines/oasa%3A040": detail040,
    "lines/stasy%3AM2": { line: m2, patterns: [{ id: "stasy:M2-0", headsign: "Ελληνικό", direction: 0, stops: ["stasy:αγια-βαρβαρα-metro"] }], stops: { "stasy:αγια-βαρβαρα-metro": { id: "stasy:αγια-βαρβαρα-metro", name: "Αγία Βαρβάρα" } } },
  };
  const get = async (p: string) => {
    if (!(p in api)) throw new Error(`404 ${p}`);
    return api[p];
  };

  it("writes a page per stop and line, the sitemap and robots.txt", async () => {
    const out = mkdtempSync(join(tmpdir(), "seo-"));
    const n = await build(out, get);
    expect(n).toEqual({ stops: 2, lines: 2 });
    expect(readFileSync(join(out, "stop/oasa-100001.html"), "utf8")).toContain("14η ΝΤΑΜΑΡΙΑ");
    expect(existsSync(join(out, "stop/stasy-αγια-βαρβαρα-metro.html"))).toBe(true);
    expect(readFileSync(join(out, "line/stasy-M2.html"), "utf8")).toContain("Αγία Βαρβάρα");
    const xml = readFileSync(join(out, "sitemap.xml"), "utf8");
    expect(xml.match(/<url>/g)!.length).toBe(5); // home + 2 lines + 2 stops
    expect(readFileSync(join(out, "robots.txt"), "utf8")).toContain("Sitemap:");
  });

  it("fails the build when the API fails, so a deploy never drops the pages", async () => {
    const out = mkdtempSync(join(tmpdir(), "seo-"));
    const broken = async (p: string) => (p === "lines/stasy%3AM2" ? Promise.reject(new Error("503")) : get(p));
    await expect(build(out, broken)).rejects.toThrow();
  });

  it("fails while a source is still warming up, so a restart never publishes a short sitemap", async () => {
    const out = mkdtempSync(join(tmpdir(), "seo-"));
    const warming = async (p: string) =>
      p === "stops" ? { stops: [s1], sources: [{ id: "stasy", state: "warming_up", updated_at: null }] } : get(p);
    await expect(build(out, warming)).rejects.toThrow(/warming_up/);
    const down = async (p: string) =>
      p === "lines" ? { lines: [], sources: [{ id: "oasa", state: "down", updated_at: null }] } : get(p);
    await expect(build(out, down)).rejects.toThrow(/down/);
  });
});
