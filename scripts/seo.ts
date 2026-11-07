// Prerendered SEO pages for the map: one page per stop and per line, plus sitemap.xml and
// robots.txt. The app is a single page, so search engines and link previews see nothing
// without these. Every page lives under a city (web#47). Run by `bun scripts/seo.ts dist`
// after `vite build`.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { basesFor } from "../src/lib/cityBases";
import { CITIES, type CityId } from "../src/lib/cities";

// The site's one host: bus.haroldpoi.dev answers with a 301 to it.
export const SITE = "https://staseis.gr";

export interface SeoLine {
  id: string;
  mode: string;
  label: string;
  name: string;
  color: string;
  text_color: string;
}

// [id, name, lat, lon, modes, lineIds] — the /v2/stops tuple.
export type StopEntry = [string, string, number, number, string[], string[]];

export interface Pattern {
  id: string;
  headsign: string;
  direction: number;
  stops: string[];
}

export interface LineDetail {
  line: SeoLine;
  patterns: Pattern[];
  stops: Record<string, { id: string; name: string }>;
}

export type GetJson = (path: string) => Promise<unknown>;

const MODE_WORD: Record<string, string> = {
  bus: "Λεωφορείο",
  trolley: "Τρόλεϊ",
  metro: "Μετρό",
  tram: "Τραμ",
  suburban: "Προαστιακός",
};

const PLACE_TYPE: Record<string, string> = {
  bus: "BusStop",
  trolley: "BusStop",
  metro: "SubwayStation",
  tram: "TrainStation",
  suburban: "TrainStation",
};

export const escape = (s: string | null | undefined) =>
  String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Suburban lines carry no label in /v2/lines: their name is the label.
const labelOf = (l: SeoLine) => l.label || l.name;
const head = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" ");

// A line or stop id may hold ":" (oasa:040) and Greek letters; the file name keeps the Greek,
// so the page reads /athens/stop/stasy-αγια-βαρβαρα-metro.html.
export const slug = (id: string) => id.replaceAll(":", "-");
export const stopPath = (city: CityId, id: string) => `/${city}/stop/${slug(id)}`;
export const linePath = (city: CityId, id: string) => `/${city}/line/${slug(id)}`;
export const homePath = (city: CityId) => `/${city}/`;
export const linesPath = (city: CityId) => `/${city}/lines`;

// The file that serves a path: GitHub Pages and Cloudflare Pages answer /x from x.html and
// /x/ from x/index.html.
export const fileOf = (path: string) => {
  const p = path.replace(/^\//, "");
  return p.endsWith("/") ? `${p}index.html` : `${p}.html`;
};

// "in the city", with the article Greek needs (στην Αθήνα, στη Θεσσαλονίκη).
const IN_CITY: Record<CityId, string> = { athens: "στην Αθήνα", thessaloniki: "στη Θεσσαλονίκη" };
const FOOTER_PHRASE: Record<CityId, string> = {
  athens: `λεωφορείων, τρόλεϊ, μετρό και τραμ ${IN_CITY.athens}`,
  thessaloniki: `λεωφορείων ${IN_CITY.thessaloniki}`,
};

// The footer's links; layout() wraps them in <footer>, an app page adds the tag itself.
const footerLinks = (city: CityId) =>
  `<a href="/${city}/">Στάσεις</a> · ζωντανός χάρτης ${FOOTER_PHRASE[city]} · <a href="${linesPath(city)}">Όλες οι γραμμές</a>`;
const footer = (city: CityId) => `<footer>${footerLinks(city)}</footer>`;

// The plain pages (the all-lines page, the stats pages) are documents of their own.
const STYLE = `<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#16181d;--dim:#5b6270;--card:#f3f5f9;--line:#dfe3ea}
@media (prefers-color-scheme:dark){:root{--bg:#14161a;--fg:#eceef2;--dim:#9aa2b1;--card:#1d2026;--line:#2b3038}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:40rem;margin:0 auto;padding:1.25rem 1rem 3rem}
a{color:inherit}
.kicker{margin:0;color:var(--dim);font-size:.8rem;letter-spacing:.06em;text-transform:uppercase}
h1{margin:.15rem 0 .5rem;font-size:1.6rem;line-height:1.25}
h2{margin:1.75rem 0 .5rem;font-size:1.05rem}
.lead{margin:0 0 1.25rem;color:var(--dim)}
.cta{display:block;margin:1.25rem 0;padding:.85rem 1rem;border-radius:.7rem;background:var(--card);border:1px solid var(--line);text-decoration:none;font-weight:600}
.lines{list-style:none;margin:0;padding:0}
.lines li{display:flex;gap:.6rem;align-items:center;padding:.5rem 0;border-bottom:1px solid var(--line)}
.badge{flex:none;min-width:2.6rem;padding:.2rem .5rem;border-radius:.4rem;text-align:center;font-weight:700;font-size:.85rem;text-decoration:none}
.lines a.ln{text-decoration:none}
ol{margin:0;padding-left:1.4rem}
ol li{padding:.2rem 0}
ol a{text-decoration:none}
footer{max-width:40rem;margin:0 auto;padding:1rem;color:var(--dim);font-size:.85rem}
</style>`;

// The app's own page is the shell of index.html with a page's head and content. The style is
// scoped to .seo: the app around it must look exactly as it does on the map's own page.
const SEO_STYLE = `<style>
.seo{color-scheme:light dark;--bg:#fff;--fg:#16181d;--dim:#5b6270;--card:#f3f5f9;--line:#dfe3ea;max-width:40rem;margin:0 auto;padding:1.25rem 1rem 3rem;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--fg);background:var(--bg)}
@media (prefers-color-scheme:dark){.seo{--bg:#14161a;--fg:#eceef2;--dim:#9aa2b1;--card:#1d2026;--line:#2b3038}}
.seo *{box-sizing:border-box}
.seo a{color:inherit}
.seo .kicker{margin:0;color:var(--dim);font-size:.8rem;letter-spacing:.06em;text-transform:uppercase}
.seo h1{margin:.15rem 0 .5rem;font-size:1.6rem;line-height:1.25}
.seo h2{margin:1.75rem 0 .5rem;font-size:1.05rem}
.seo .lead{margin:0 0 1.25rem;color:var(--dim)}
.seo .cta{display:block;margin:1.25rem 0;padding:.85rem 1rem;border-radius:.7rem;background:var(--card);border:1px solid var(--line);text-decoration:none;font-weight:600}
.seo .lines{list-style:none;margin:0;padding:0}
.seo .lines li{display:flex;gap:.6rem;align-items:center;padding:.5rem 0;border-bottom:1px solid var(--line)}
.seo .badge{flex:none;min-width:2.6rem;padding:.2rem .5rem;border-radius:.4rem;text-align:center;font-weight:700;font-size:.85rem;text-decoration:none}
.seo .lines a.ln{text-decoration:none}
.seo ol{margin:0;padding-left:1.4rem}
.seo ol li{padding:.2rem 0}
.seo ol a{text-decoration:none}
.seo footer{margin:1.5rem 0 0;padding:1rem 0 0;border-top:1px solid var(--line);color:var(--dim);font-size:.85rem}
</style>`;

// The JSON-LD is inlined in a <script> tag, so a name with "</script>" must not close it.
export const jsonLd = (data: unknown) => JSON.stringify(data).replaceAll("<", "\\u003c");

export function layout(o: { title: string; description: string; canonical: string; body: string; ld?: unknown; style?: string; footer?: string }): string {
  return `<!doctype html>
<html lang="el">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(o.title)}</title>
<meta name="description" content="${escape(o.description)}">
<link rel="canonical" href="${escape(o.canonical)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Στάσεις">
<meta property="og:locale" content="el_GR">
<meta property="og:title" content="${escape(o.title)}">
<meta property="og:description" content="${escape(o.description)}">
<meta property="og:url" content="${escape(o.canonical)}">
<meta property="og:image" content="${SITE}/icon-512.png">
<meta name="twitter:card" content="summary">
${o.ld === undefined ? "" : `<script type="application/ld+json">${jsonLd(o.ld)}</script>\n`}${STYLE}
${o.style ?? ""}</head>
<body>
<main>
${o.body}
</main>
<footer>${o.footer ?? footerLinks("athens")}</footer>
</body>
</html>
`;
}

// index.html with this page's head and content: the map still mounts over .seo, so a visitor
// gets the app, and a crawler gets the page. A shell without a marker is refused, so a deploy
// never ships pages without the map.
export function appPage(shell: string, o: { title: string; description: string; canonical: string; body: string; ld?: unknown }): string {
  const title = escape(o.title), description = escape(o.description), canonical = escape(o.canonical);
  let html = shell;
  // The values arrive as functions, so a "$" in a name cannot break the replacement.
  const replace = (re: RegExp, value: string, what: string) => {
    if (!re.test(html)) throw new Error(`appPage: the shell has no ${what}`);
    html = html.replace(re, () => value);
  };
  replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`, "title");
  replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${description}">`, "description");
  replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${canonical}">`, "canonical");
  replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${title}">`, "og:title");
  replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${description}">`, "og:description");
  replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${canonical}">`, "og:url");
  replace(/<\/head>/, `${o.ld === undefined ? "" : `<script type="application/ld+json">${jsonLd(o.ld)}</script>`}${SEO_STYLE}</head>`, "</head>");
  replace(/<div id="app"><\/div>/, `<div id="app"><div class="seo">${o.body}</div></div>`, '<div id="app"></div>');
  return html;
}

// Only the lines the stop names and the caller knows: a line missing from the /v2/lines list
// has no page to link to.
const stopLines = (stop: StopEntry, lines: SeoLine[]) => {
  const byId = new Map(lines.map(l => [l.id, l]));
  return stop[5].map(id => byId.get(id)).filter((l): l is SeoLine => !!l);
};

export function stopPage(city: CityId, stop: StopEntry, lines: SeoLine[], shell: string): string {
  const [id, name, lat, lon, modes] = stop;
  const known = stopLines(stop, lines);
  const labels = known.map(labelOf);
  const canonical = SITE + encodeURI(stopPath(city, id));
  const title = [`Στάση ${name}`, labels.length ? labels.join(", ") : "", CITIES[city].name].filter(Boolean).join(" · ");
  const description = `Στάση ${name} · ${CITIES[city].name}: γραμμές ${labels.join(", ") || "—"}. Ζωντανός χάρτης με τη θέση των οχημάτων και πότε φτάνουν.`;
  const rows = known.map(
    l => `<li><a class="badge" href="${escape(encodeURI(linePath(city, l.id)))}" style="background:${escape(l.color)};color:${escape(l.text_color)}">${escape(labelOf(l) || MODE_WORD[l.mode] || l.name)}</a> <a class="ln" href="${escape(encodeURI(linePath(city, l.id)))}">${escape(l.name)}</a></li>`,
  );
  const body = `<p class="kicker">Στάση</p>
<h1>${escape(name)}</h1>
<p class="lead">${known.length ? `Γραμμές: ${escape(labels.join(", "))}` : "Καμία γραμμή σε κυκλοφορία"}</p>
${rows.length ? `<ul class="lines">\n${rows.join("\n")}\n</ul>` : ""}`;
  return appPage(shell, {
    title,
    description,
    canonical,
    body: `${body}\n${footer(city)}`,
    ld: {
      "@context": "https://schema.org",
      "@type": PLACE_TYPE[modes[0] ?? ""] ?? "BusStop",
      name,
      url: canonical,
      geo: { "@type": "GeoCoordinates", latitude: lat, longitude: lon },
    },
  });
}

const MODE_GROUP: Record<string, string> = { bus: "Λεωφορεία", trolley: "Τρόλεϊ", metro: "Μετρό", tram: "Τραμ", suburban: "Προαστιακός" };

// Every line page from one place: the map itself (a script) links none, so search engines
// reach the line pages, and through them the stops, from here and the footer.
export function linesPage(city: CityId, lines: SeoLine[]): string {
  const order = Object.keys(MODE_WORD);
  const name = CITIES[city].name;
  const modes = [...new Set(lines.map(l => l.mode))].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  const sections = modes.map(mode => {
    const rows = lines.filter(l => l.mode === mode)
      .sort((a, b) => labelOf(a).localeCompare(labelOf(b), "el", { numeric: true }))
      .map(l => `<li><a class="badge" href="${escape(encodeURI(linePath(city, l.id)))}" style="background:${escape(l.color)};color:${escape(l.text_color)}">${escape(labelOf(l))}</a> <a class="ln" href="${escape(encodeURI(linePath(city, l.id)))}">${escape(l.name)}</a></li>`);
    return `<h2>${escape(MODE_GROUP[mode] ?? mode)}</h2>\n<ul class="lines">\n${rows.join("\n")}\n</ul>`;
  });
  return layout({
    title: `Όλες οι γραμμές · ${name} · Στάσεις`,
    description: `Οι ${lines.length} γραμμές ${IN_CITY[city]}: στάσεις και ζωντανή θέση οχημάτων.`,
    canonical: SITE + linesPath(city),
    body: `<p class="kicker">Στάσεις</p>\n<h1>Όλες οι γραμμές · ${escape(name)}</h1>\n<a class="cta" href="${escape(encodeURI(homePath(city)))}">Άνοιξε τον ζωντανό χάρτη ›</a>\n${sections.join("\n")}`,
    footer: footerLinks(city),
  });
}

export function linePage(city: CityId, detail: LineDetail, shell: string): string {
  const { line, patterns, stops } = detail;
  const canonical = SITE + encodeURI(linePath(city, line.id));
  const mode = MODE_WORD[line.mode] ?? line.mode;
  const ids = new Set(patterns.flatMap(p => p.stops));
  const title = `${head(mode, line.label, line.name)} · στάσεις και ζωντανή θέση · Στάσεις`;
  const description = `${head(mode, line.label, line.name)} (${CITIES[city].name}): ${ids.size} στάσεις, ζωντανή θέση οχημάτων και χάρτης στο Στάσεις.`;
  // One list per headsign, the longest pattern first; a shorter one is listed too only when it
  // has stops the ones before it lack (a branch), so no stop of the line is left without a link.
  const listed: Pattern[] = [];
  const covered = new Map<string, Set<string>>();
  for (const p of [...patterns].sort((a, b) => b.stops.length - a.stops.length)) {
    const seen = covered.get(p.headsign) ?? new Set<string>();
    if (seen.size && p.stops.every(id => seen.has(id))) continue;
    p.stops.forEach(id => seen.add(id));
    covered.set(p.headsign, seen);
    listed.push(p);
  }
  const sections = listed.map(p => {
    const items = p.stops
      .map(sid => stops[sid])
      .filter((s): s is { id: string; name: string } => !!s)
      .map(s => `<li><a href="${escape(encodeURI(stopPath(city, s.id)))}">${escape(s.name)}</a></li>`);
    return `<section>\n<h2>${escape(p.headsign)}</h2>\n<ol>\n${items.join("\n")}\n</ol>\n</section>`;
  });
  const body = `<p class="kicker">${escape(mode)}</p>
<h1>${escape(head(line.label, line.name))}</h1>
<p class="lead">${ids.size} στάσεις</p>
${sections.join("\n")}`;
  return appPage(shell, { title, description, canonical, body: `${body}\n${footer(city)}` });
}

// The city's home is the map itself: the page names the city so a search lands here, and it
// links the all-lines page and the stats, which a crawler cannot reach from the app.
export function homePage(city: CityId, lines: SeoLine[], shell: string, hasStats: boolean): string {
  const name = CITIES[city].name;
  const canonical = SITE + encodeURI(homePath(city));
  const body = `<p class="kicker">Στάσεις</p>
<h1>${escape(name)}</h1>
<p class="lead">Ζωντανός χάρτης ${FOOTER_PHRASE[city]}: θέση οχημάτων, καθυστέρηση και πότε φτάνει το επόμενο.</p>
<a class="cta" href="${escape(encodeURI(linesPath(city)))}">Όλες οι γραμμές ›</a>
${hasStats ? `<p><a href="${escape(encodeURI(`/${city}/stats/`))}">Στατιστικά δικτύου</a></p>` : ""}`;
  return appPage(shell, {
    title: `Στάσεις · ζωντανός χάρτης · ${name}`,
    description: `Ζωντανός χάρτης ${FOOTER_PHRASE[city]}: ${lines.length} γραμμές με θέση οχημάτων, καθυστέρηση και χρόνο άφιξης.`,
    canonical,
    body: `${body}\n${footer(city)}`,
  });
}

// An old Athens URL on its own path (the site moved, web#47). GitHub Pages has no real 301,
// so the page points canonical and an immediate refresh at the new path and offers a link.
export function movedPage(to: string): string {
  const href = escape(encodeURI(to));
  return `<!doctype html>
<html lang="el">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Μετακινήθηκε · Στάσεις</title>
<link rel="canonical" href="${SITE}${href}">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=${href}">
</head>
<body>
<p><a href="${href}">Στάσεις</a></p>
</body>
</html>
`;
}

export function sitemap(paths: string[]): string {
  const urls = paths.map(p => `<url><loc>${escape(SITE + encodeURI(p))}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

export const robots = () => `User-agent: *
Allow: /

Sitemap: ${SITE}/sitemap.xml
`;

// Six requests at a time: the API is one small box and answers the whole line list in seconds.
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export interface CityBuilt {
  id: CityId;
  stops: number;
  lines: number;
  skipped?: string;
}

// Writes every page of every city and both index files. Athens' API error rejects (a deploy
// must not drop its pages); another city's error skips only that city, with no pages and no
// sitemap entries for it. legacy: the old Athens paths move to the new one, outside the sitemap.
// extraPaths: pages written by other scripts (the stats pages), listed in the same sitemap.
export async function build(
  outDir: string,
  getJsonFor: (city: CityId) => GetJson,
  o: { shell: string; legacy?: boolean; extraPaths?: string[]; cities?: CityId[] },
): Promise<{ cities: CityBuilt[] }> {
  const ids = o.cities ?? (Object.keys(CITIES) as CityId[]);
  const cities: CityBuilt[] = [];
  const paths: string[] = ["/", ...(o.extraPaths ?? [])];

  const writeAt = async (rel: string, html: string) => {
    const file = join(outDir, rel);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, html);
  };
  const writePath = (path: string, html: string) => writeAt(fileOf(path), html);

  for (const city of ids) {
    const getJson = getJsonFor(city);
    // A Source loading or down can answer with empty lists (CONTRACT.md /v2): its pages would vanish.
    const complete = async <T>(path: string) => {
      const body = (await getJson(path)) as T & { sources?: { id: string; state: string }[] };
      const bad = body.sources?.find(s => s.state === "warming_up" || s.state === "down");
      if (bad) throw new Error(`${path}: ${bad.id} ${bad.state}`);
      return body;
    };
    // Only the API may skip a city other than Athens: a page or write error fails the build.
    let lines: SeoLine[], stops: StopEntry[], details: LineDetail[];
    try {
      const { lines: raw } = await complete<{ lines: (Omit<SeoLine, "label"> & { label: string | null })[] }>("lines");
      lines = raw.map(l => ({ ...l, label: l.label ?? "" }));
      ({ stops } = await complete<{ stops: StopEntry[] }>("stops"));
      details = await mapLimit(lines, 6, l => complete<LineDetail>("lines/" + encodeURIComponent(l.id)));
    } catch (err) {
      if (city === "athens") throw err;
      console.error(`seo: ${city} skipped: ${String(err)}`);
      cities.push({ id: city, stops: 0, lines: 0, skipped: String(err) });
      continue;
    }

    const hasStats = (o.extraPaths ?? []).includes(`/${city}/stats/`);
    await writePath(homePath(city), homePage(city, lines, o.shell, hasStats));
    await writePath(linesPath(city), linesPage(city, lines));
    await Promise.all([
      ...stops.map(s => writePath(stopPath(city, s[0]), stopPage(city, s, lines, o.shell))),
      ...details.map(d => writePath(linePath(city, d.line.id), linePage(city, d, o.shell))),
    ]);
    paths.push(homePath(city), linesPath(city), ...lines.map(l => linePath(city, l.id)), ...stops.map(s => stopPath(city, s[0])));
    cities.push({ id: city, stops: stops.length, lines: lines.length });

    // The old Athens pages (before web#47) become small forwarders. Thessaloniki never had any.
    if (o.legacy && city === "athens") {
      await Promise.all([
        ...stops.map(s => writeAt(`stop/${slug(s[0])}.html`, movedPage(stopPath("athens", s[0])))),
        ...lines.map(l => writeAt(`line/${slug(l.id)}.html`, movedPage(linePath("athens", l.id)))),
      ]);
      await writeAt("lines.html", movedPage(linesPath("athens")));
    }
  }

  await writeFile(join(outDir, "404.html"), o.shell);
  await writeFile(join(outDir, "sitemap.xml"), sitemap(paths));
  await writeFile(join(outDir, "robots.txt"), robots());
  return { cities };
}

// Bun only: `bun scripts/seo.ts dist` after the Vite build.
const isMain = (import.meta as ImportMeta & { main?: boolean }).main === true;
if (isMain) {
  const outDir = process.argv[2] ?? "dist";
  const shell = await readFile(join(outDir, "index.html"), "utf8");
  // Each city reads its own API: Athens the app's backend, Thessaloniki its own instance.
  const getJsonFor = (city: CityId): GetJson => {
    const base = basesFor(city, process.env).api;
    return async path => {
      const url = `${base}/v2/${path}`;
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`${res.status} ${url}`);
          return await res.json();
        } catch (err) {
          if (attempt >= 1) throw err;
        }
      }
    };
  };
  const legacy = process.env.SEO_LEGACY !== "0";
  // The stats pages (web#48) read the stats branch of athens-transit-rt on GitHub.
  const { buildStats } = await import("./stats-pages");
  const statsBase = (process.env.VITE_STATS_BASE || "https://raw.githubusercontent.com/angelospk/staseis-rt/stats/v1").replace(/\/+$/, "");
  const getText = async (url: string) => {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(url);
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`${res.status} ${url}`);
        return await res.text();
      } catch (err) {
        if (attempt >= 1) throw err;
      }
    }
  };
  try {
    const stats = await buildStats(outDir, getText, statsBase);
    const n = await build(outDir, getJsonFor, { shell, legacy, extraPaths: stats.paths });
    for (const c of n.cities) console.log(`seo: ${c.id} ${c.skipped ? `skipped: ${c.skipped}` : `${c.stops} stops, ${c.lines} lines`}`);
    console.log(`stats: ${stats.cities.map(c => `${c.id} ${c.days} days${c.bad ? ` (${c.bad} unreadable)` : ""}`).join(", ") || "none"}`);
  } catch (err) {
    console.error("seo:", err);
    process.exit(1);
  }
}
