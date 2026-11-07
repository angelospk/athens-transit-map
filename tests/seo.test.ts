import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appPage, build, fileOf, homePage, homePath, linePage, linePath, linesPage, linesPath, movedPage, robots, sitemap, slug, stopPage, stopPath, SITE, type GetJson, type LineDetail, type SeoLine, type StopEntry } from "../scripts/seo";

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

// The built index.html, cut down: the prerendered pages are this shell with their own head and content (web#47).
const SHELL = readFileSync(join(__dirname, "..", "index.html"), "utf8");

describe("paths (web#47: every city on its own path)", () => {
  it("slug turns every ':' into '-'", () => {
    expect(slug("oasa:100001")).toBe("oasa-100001");
    expect(slug("stasy:αγ.-δημητριοσ-metro")).toBe("stasy-αγ.-δημητριοσ-metro");
  });
  it("stop, line, home and all-lines paths carry the city and no .html", () => {
    expect(stopPath("athens", "oasa:100001")).toBe("/athens/stop/oasa-100001");
    expect(linePath("thessaloniki", "oasa:01A")).toBe("/thessaloniki/line/oasa-01A");
    expect(homePath("athens")).toBe("/athens/");
    expect(linesPath("thessaloniki")).toBe("/thessaloniki/lines");
  });
  it("fileOf: the file that serves a path (GitHub Pages and Cloudflare Pages serve /x from x.html)", () => {
    expect(fileOf("/athens/stop/oasa-100001")).toBe("athens/stop/oasa-100001.html");
    expect(fileOf("/athens/")).toBe("athens/index.html");
    expect(fileOf("/athens/lines")).toBe("athens/lines.html");
  });
});

describe("appPage: the map's shell with a page's own head and content", () => {
  const html = appPage(SHELL, { title: "Τ <1>", description: "Δ & ε", canonical: `${SITE}/athens/x`, body: "<h1>Γεια</h1>", ld: { "@type": "BusStop" } });
  it("replaces title, description, canonical and the Open Graph tags, once each", () => {
    expect(html.match(/<title>/g)!.length).toBe(1);
    expect(html).toContain("<title>Τ &lt;1&gt;</title>");
    expect(html).toContain('<meta name="description" content="Δ &amp; ε">');
    expect(html).toContain(`<link rel="canonical" href="${SITE}/athens/x">`);
    expect(html).toContain(`<meta property="og:url" content="${SITE}/athens/x">`);
    expect(html).toContain('<meta property="og:title" content="Τ &lt;1&gt;">');
    expect(html).toContain('<meta property="og:description" content="Δ &amp; ε">');
    expect(html).not.toContain(`href="${SITE}/"`);
  });
  it("keeps the app: its script and the #app mount point, which holds the content until the map mounts", () => {
    expect(html).toContain('<script type="module" src="/src/main.ts"></script>');
    expect(html).toMatch(/<div id="app"><div class="seo">[\s\S]*<h1>Γεια<\/h1>[\s\S]*<\/div><\/div>/);
    expect(html).toContain('<script type="application/ld+json">{"@type":"BusStop"}</script>');
  });
  it("refuses a shell it cannot fill, so a deploy never ships pages without the map", () => {
    expect(() => appPage("<html><body></body></html>", { title: "a", description: "b", canonical: "c", body: "d" })).toThrow();
  });
});

describe("stopPage", () => {
  const html = stopPage("athens", s1, [l040, lB12], SHELL);
  it("has the name in the title and h1", () => {
    expect(html).toMatch(/<title>[^<]*14η ΝΤΑΜΑΡΙΑ[^<]*<\/title>/);
    expect(html).toMatch(/<h1[^>]*>[^<]*14η ΝΤΑΜΑΡΙΑ/);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('lang="el"');
  });
  it("has a meta description naming its lines", () => {
    const m = html.match(/<meta name="description" content="([^"]*)"/);
    expect(m![1]).toContain("040");
    expect(m![1]).toContain("Β12");
  });
  it("is served from staseis.gr (bus.haroldpoi.dev only redirects there)", () => {
    expect(SITE).toBe("https://staseis.gr");
  });
  it("has an absolute canonical URL on the city's path, percent-encoded", () => {
    expect(html).toContain(`<link rel="canonical" href="${SITE}/athens/stop/oasa-100001">`);
    expect(html).toContain(`<meta property="og:url" content="${SITE}/athens/stop/oasa-100001">`);
    const metro = stopPage("athens", sMetro, [m2], SHELL);
    expect(metro).toContain(`<link rel="canonical" href="${SITE}${encodeURI("/athens/stop/stasy-αγια-βαρβαρα-metro")}">`);
  });
  it("is the map itself (no «Δες στον χάρτη» link) and links each known line page", () => {
    expect(html).not.toContain("?stop=");
    expect(html).toContain(`href="${encodeURI("/athens/line/oasa-040")}"`);
    expect(html).toContain(`href="${encodeURI("/athens/line/oasa-Β12")}"`);
    expect(html).not.toContain("missing");
  });
  it("carries JSON-LD with the place type and coordinates", () => {
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
    expect(ld["@type"]).toBe("BusStop");
    expect(ld.geo.latitude).toBe(38.06593);
    expect(ld.geo.longitude).toBe(23.71307);
  });
  it("escapes HTML in names, also inside JSON-LD", () => {
    const evil: StopEntry = ["oasa:9", 'Α & Β <x> "q" </script>', 38, 23, ["bus"], []];
    const out = stopPage("athens", evil, [], SHELL);
    expect(out).toContain("Α &amp; Β &lt;x&gt;");
    expect(out).not.toContain("<x>");
    expect(out).not.toContain('"q" </script>');
  });
  it("a Thessaloniki stop names its own city and links its own pages", () => {
    const t: StopEntry = ["oasa:1011", "ΠΛΑΤΕΙΑ ΑΝΤΙΓΟΝΙΔΩΝ", 40.64, 22.94, ["bus"], ["oasa:16"]];
    const l16: SeoLine = { id: "oasa:16", mode: "bus", label: "16", name: "Α - Β", color: "#000080", text_color: "#fff" };
    const out = stopPage("thessaloniki", t, [l16], SHELL);
    expect(out).toContain(`<link rel="canonical" href="${SITE}/thessaloniki/stop/oasa-1011">`);
    expect(out).toContain('href="/thessaloniki/line/oasa-16"');
    expect(out).toContain("Θεσσαλονίκη");
    expect(out).not.toContain("Αθήνα");
    expect(out).toContain('<a href="/thessaloniki/lines">Όλες οι γραμμές</a>');
  });
});

describe("linePage", () => {
  const html = linePage("athens", detail040, SHELL);
  it("has label and name in title and h1", () => {
    expect(html).toMatch(/<title>[^<]*040[^<]*ΠΕΙΡΑΙΑΣ - ΣΥΝΤΑΓΜΑ[^<]*<\/title>/);
    expect(html).toMatch(/<h1[^>]*>[^<]*040/);
  });
  it("has canonical and description, and is the map itself", () => {
    expect(html).toContain(`<link rel="canonical" href="${SITE}/athens/line/oasa-040">`);
    expect(html).toMatch(/<meta name="description" content="[^"]*040[^"]*"/);
    expect(html).not.toContain("?line=");
  });
  it("lists one stop list per headsign, the longest pattern of each", () => {
    expect(html.match(/<h2[^>]*>[^<]*ΠΕΙΡΑΙΑΣ - ΣΥΝΤΑΓΜΑ/g)!.length).toBe(1);
    expect(html.match(/<h2[^>]*>[^<]*ΣΥΝΤΑΓΜΑ - ΠΕΙΡΑΙΑΣ/g)!.length).toBe(1);
    expect(html.match(/href="\/athens\/stop\/oasa-100002"/g)!.length).toBe(2);
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
    const out = linePage("athens", branch, SHELL);
    expect(out).toContain('href="/athens/stop/oasa-100003"');
    expect(out).toContain("3 στάσεις");
  });
  it("names and links every stop in order", () => {
    const i = html.indexOf("14η ΝΤΑΜΑΡΙΑ");
    const j = html.indexOf("ΓΕΦΥΡΑ ΑΤΤΙΚΗΣ ΟΔΟΥ");
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
  });
});

describe("homePage and linesPage", () => {
  it("the city home is the map, with the city in title and canonical, and links to all lines and the stats", () => {
    const html = homePage("thessaloniki", [l040], SHELL);
    expect(html).toContain(`<link rel="canonical" href="${SITE}/thessaloniki/">`);
    expect(html).toMatch(/<title>[^<]*Θεσσαλονίκη[^<]*<\/title>/);
    expect(html).toContain('href="/thessaloniki/lines"');
    expect(html).toContain('href="/thessaloniki/stats/"');
    expect(html).toContain('<script type="module" src="/src/main.ts"></script>');
  });
  it("all lines: a plain page per city, every line linked, grouped by mode, in label order", () => {
    const html = linesPage("athens", [lB12, l040, m2]);
    expect(html).toContain(`<link rel="canonical" href="${SITE}/athens/lines">`);
    expect(html).toContain('href="/athens/line/oasa-040"');
    expect(html).toContain('href="/athens/line/stasy-M2"');
    expect(html.indexOf("/athens/line/oasa-040")).toBeLessThan(html.indexOf(encodeURI("/athens/line/oasa-Β12")));
    expect(html).toMatch(/<h2>Μετρό<\/h2>/);
    expect(html).toContain('href="/athens/"');
    expect(html).not.toContain('src="/src/main.ts"');
    expect(html).toContain('<footer><a href="/athens/">Στάσεις</a>');
    expect(html).toMatch(/<meta name="description" content="Οι 3 γραμμές στην Αθήνα/);
  });
});

describe("movedPage: an old Athens URL (GitHub Pages has no real 301)", () => {
  const html = movedPage("/athens/stop/oasa-100001");
  it("points canonical and an immediate refresh at the new path, with a plain link as well", () => {
    expect(html).toContain(`<link rel="canonical" href="${SITE}/athens/stop/oasa-100001">`);
    expect(html).toContain('<meta http-equiv="refresh" content="0; url=/athens/stop/oasa-100001">');
    expect(html).toContain('href="/athens/stop/oasa-100001"');
    expect(html).toContain('<meta name="robots" content="noindex">');
  });
  it("encodes a Greek path", () => {
    expect(movedPage("/athens/stop/stasy-αγια-βαρβαρα-metro")).toContain(encodeURI("/athens/stop/stasy-αγια-βαρβαρα-metro"));
  });
});

describe("sitemap and robots", () => {
  it("sitemap lists absolute, encoded, XML-escaped URLs", () => {
    const xml = sitemap(["/", "/athens/stop/stasy-αγια-βαρβαρα-metro", "/line/a&b"]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain(`<loc>${SITE}/</loc>`);
    expect(xml).toContain(`<loc>${SITE}${encodeURI("/athens/stop/stasy-αγια-βαρβαρα-metro")}</loc>`);
    expect(xml).toContain(`<loc>${SITE}/line/a&amp;b</loc>`);
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
  const l16: SeoLine = { id: "oasa:16", mode: "bus", label: "16", name: "Α - Β", color: "#000080", text_color: "#fff" };
  const thess: Record<string, unknown> = {
    "lines": { lines: [l16] },
    "stops": { stops: [["oasa:1011", "ΑΝΤΙΓΟΝΙΔΩΝ", 40.64, 22.94, ["bus"], ["oasa:16"]]] },
    "lines/oasa%3A16": { line: l16, patterns: [{ id: "oasa:9", headsign: "Β", direction: 0, stops: ["oasa:1011"] }], stops: { "oasa:1011": { id: "oasa:1011", name: "ΑΝΤΙΓΟΝΙΔΩΝ" } } },
  };
  const from = (data: Record<string, unknown>): GetJson => async p => {
    if (!(p in data)) throw new Error(`404 ${p}`);
    return data[p];
  };
  const both = (city: string) => from(city === "athens" ? api : thess);
  const read = (out: string, f: string) => readFileSync(join(out, f), "utf8");

  it("writes per city a home, an all-lines page and a page per stop and line, plus the sitemap, robots.txt and 404.html", async () => {
    const out = mkdtempSync(join(tmpdir(), "seo-"));
    const n = await build(out, both, { shell: SHELL, legacy: false });
    expect(n.cities).toEqual([{ id: "athens", stops: 2, lines: 2 }, { id: "thessaloniki", stops: 1, lines: 1 }]);
    expect(read(out, "athens/stop/oasa-100001.html")).toContain("14η ΝΤΑΜΑΡΙΑ");
    expect(existsSync(join(out, "athens/stop/stasy-αγια-βαρβαρα-metro.html"))).toBe(true);
    expect(read(out, "athens/line/stasy-M2.html")).toContain("Αγία Βαρβάρα");
    expect(read(out, "thessaloniki/stop/oasa-1011.html")).toContain("ΑΝΤΙΓΟΝΙΔΩΝ");
    expect(read(out, "thessaloniki/index.html")).toContain(`${SITE}/thessaloniki/`);
    expect(read(out, "athens/lines.html")).toContain('href="/athens/line/oasa-040"');
    expect(read(out, "404.html")).toContain('<div id="app">');
    const xml = read(out, "sitemap.xml");
    // home + per city (home, all lines, lines, stops): 1 + (2+2+2) + (2+1+1)
    expect(xml.match(/<url>/g)!.length).toBe(11);
    expect(xml).toContain(`<loc>${SITE}/athens/lines</loc>`);
    expect(xml).toContain(`<loc>${SITE}/thessaloniki/stop/oasa-1011</loc>`);
    expect(read(out, "robots.txt")).toContain("Sitemap:");
    expect(existsSync(join(out, "stop/oasa-100001.html"))).toBe(false);
  });

  it("legacy: every old Athens page moves to its new path, not listed in the sitemap", async () => {
    const out = mkdtempSync(join(tmpdir(), "seo-"));
    await build(out, both, { shell: SHELL, legacy: true });
    expect(read(out, "stop/oasa-100001.html")).toContain("url=/athens/stop/oasa-100001");
    expect(read(out, "line/oasa-040.html")).toContain("url=/athens/line/oasa-040");
    expect(read(out, "lines.html")).toContain("url=/athens/lines");
    expect(existsSync(join(out, "stop/oasa-1011.html"))).toBe(false);   // Thessaloniki had no old pages
    expect(read(out, "sitemap.xml")).not.toContain(`${SITE}/stop/`);
  });

  it("lists extra pages (the stats pages) in the sitemap", async () => {
    const out = mkdtempSync(join(tmpdir(), "seo-"));
    await build(out, both, { shell: SHELL, legacy: false, extraPaths: ["/athens/stats/"] });
    expect(read(out, "sitemap.xml")).toContain(`<loc>${SITE}/athens/stats/</loc>`);
  });

  it("fails the build when Athens' API fails, so a deploy never drops its pages", async () => {
    const out = mkdtempSync(join(tmpdir(), "seo-"));
    const broken = (city: string) => (city === "athens"
      ? async (p: string) => (p === "lines/stasy%3AM2" ? Promise.reject(new Error("503")) : from(api)(p))
      : from(thess));
    await expect(build(out, broken, { shell: SHELL, legacy: false })).rejects.toThrow();
  });

  it("another city's failure skips only that city: Athens still deploys", async () => {
    const out = mkdtempSync(join(tmpdir(), "seo-"));
    const down = (city: string) => (city === "athens" ? from(api) : async () => Promise.reject(new Error("503")));
    const n = await build(out, down, { shell: SHELL, legacy: false });
    expect(n.cities[0]).toEqual({ id: "athens", stops: 2, lines: 2 });
    expect(n.cities[1]).toMatchObject({ id: "thessaloniki", stops: 0, lines: 0 });
    expect(n.cities[1].skipped).toMatch(/503/);
    expect(read(out, "sitemap.xml")).not.toContain("/thessaloniki/");
  });

  it("fails while a source is still warming up, so a restart never publishes a short sitemap", async () => {
    const out = mkdtempSync(join(tmpdir(), "seo-"));
    const warming = (city: string) => async (p: string) =>
      city === "athens" && p === "stops" ? { stops: [s1], sources: [{ id: "stasy", state: "warming_up", updated_at: null }] } : both(city)(p);
    await expect(build(out, warming, { shell: SHELL, legacy: false })).rejects.toThrow(/warming_up/);
  });
});

describe("the map's own page (index.html)", () => {
  it("names its canonical home and carries link-preview tags", () => {
    expect(SHELL).toContain(`<link rel="canonical" href="${SITE}/">`);
    expect(SHELL).toContain(`<meta property="og:url" content="${SITE}/">`);
    expect(SHELL).toContain(`<meta property="og:image" content="${SITE}/icon-512.png">`);
    expect(SHELL).toMatch(/<meta property="og:title" content="[^"]+">/);
    expect(SHELL).toMatch(/<meta property="og:description" content="[^"]+">/);
    expect(SHELL).toContain('<meta name="twitter:card" content="summary">');
  });
});
