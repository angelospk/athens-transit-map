// Prerendered SEO pages for the map: one page per stop and per line, plus sitemap.xml and
// robots.txt. The app is a single page, so search engines and link previews see nothing
// without these. Run by `bun scripts/seo.ts dist` after `vite build`.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
// so the page reads /stop/stasy-αγια-βαρβαρα-metro.html.
export const slug = (id: string) => id.replaceAll(":", "-");
export const stopPath = (id: string) => `/stop/${slug(id)}.html`;
export const linePath = (id: string) => `/line/${slug(id)}.html`;

const mapStopHref = (id: string) => `/?stop=${encodeURIComponent(id)}`;
const mapLineHref = (id: string) => `/?line=${encodeURIComponent(id)}`;

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
<footer>${o.footer ?? `<a href="/">Στάσεις</a> · ζωντανός χάρτης λεωφορείων, τρόλεϊ, μετρό και τραμ στην Αθήνα · <a href="/lines.html">Όλες οι γραμμές</a>`}</footer>
</body>
</html>
`;
}

// Only the lines the stop names and the caller knows: a line missing from the /v2/lines list
// has no page to link to.
const stopLines = (stop: StopEntry, lines: SeoLine[]) => {
  const byId = new Map(lines.map(l => [l.id, l]));
  return stop[5].map(id => byId.get(id)).filter((l): l is SeoLine => !!l);
};

export function stopPage(stop: StopEntry, lines: SeoLine[]): string {
  const [id, name, lat, lon, modes] = stop;
  const known = stopLines(stop, lines);
  const labels = known.map(labelOf);
  const canonical = SITE + encodeURI(stopPath(id));
  const title = [`Στάση ${name}`, labels.length ? labels.join(", ") : "", "Στάσεις"].filter(Boolean).join(" · ");
  const description = `Στάση ${name}: γραμμές ${labels.join(", ") || "—"}. Δες ζωντανά στον χάρτη πού είναι το όχημα και πότε φτάνει.`;
  const rows = known.map(
    l => `<li><a class="badge" href="${escape(encodeURI(linePath(l.id)))}" style="background:${escape(l.color)};color:${escape(l.text_color)}">${escape(l.label || MODE_WORD[l.mode] || l.name)}</a> <a class="ln" href="${escape(encodeURI(linePath(l.id)))}">${escape(l.name)}</a></li>`,
  );
  const body = `<p class="kicker">Στάση</p>
<h1>${escape(name)}</h1>
<p class="lead">${known.length ? `Γραμμές: ${escape(labels.join(", "))}` : "Καμία γραμμή σε κυκλοφορία"}</p>
<a class="cta" href="${escape(mapStopHref(id))}">Δες ζωντανά στον χάρτη ›</a>
${rows.length ? `<ul class="lines">\n${rows.join("\n")}\n</ul>` : ""}`;
  return layout({
    title,
    description,
    canonical,
    body,
    ld: {
      "@context": "https://schema.org",
      "@type": PLACE_TYPE[modes[0]] ?? "BusStop",
      name,
      url: canonical,
      geo: { "@type": "GeoCoordinates", latitude: lat, longitude: lon },
    },
  });
}

export const LINES_PATH = "/lines.html";
const MODE_GROUP: Record<string, string> = { bus: "Λεωφορεία", trolley: "Τρόλεϊ", metro: "Μετρό", tram: "Τραμ", suburban: "Προαστιακός" };

// Every line page from one place: the map itself (a script) links none, so search engines
// reach the line pages, and through them the stops, from here and the footer.
export function linesPage(lines: SeoLine[]): string {
  const order = Object.keys(MODE_WORD);
  const modes = [...new Set(lines.map(l => l.mode))].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  const sections = modes.map(mode => {
    const rows = lines.filter(l => l.mode === mode)
      .sort((a, b) => labelOf(a).localeCompare(labelOf(b), "el", { numeric: true }))
      .map(l => `<li><a class="badge" href="${escape(encodeURI(linePath(l.id)))}" style="background:${escape(l.color)};color:${escape(l.text_color)}">${escape(labelOf(l))}</a> <a class="ln" href="${escape(encodeURI(linePath(l.id)))}">${escape(l.name)}</a></li>`);
    return `<h2>${escape(MODE_GROUP[mode] ?? mode)}</h2>\n<ul class="lines">\n${rows.join("\n")}\n</ul>`;
  });
  return layout({
    title: "Όλες οι γραμμές · λεωφορεία, τρόλεϊ, μετρό, τραμ, προαστιακός · Στάσεις",
    description: `Οι ${lines.length} γραμμές της Αθήνας: λεωφορεία, τρόλεϊ, μετρό, τραμ και προαστιακός, με στάσεις και ζωντανή θέση οχημάτων.`,
    canonical: SITE + LINES_PATH,
    body: `<p class="kicker">Στάσεις</p>\n<h1>Όλες οι γραμμές</h1>\n<a class="cta" href="/">Άνοιξε τον ζωντανό χάρτη ›</a>\n${sections.join("\n")}`,
  });
}

export function linePage(detail: LineDetail): string {
  const { line, patterns, stops } = detail;
  const canonical = SITE + encodeURI(linePath(line.id));
  const mode = MODE_WORD[line.mode] ?? line.mode;
  const ids = new Set(patterns.flatMap(p => p.stops));
  const title = `${head(mode, line.label, line.name)} · στάσεις και ζωντανή θέση · Στάσεις`;
  const description = `${head(mode, line.label, line.name)}: ${ids.size} στάσεις, ζωντανή θέση οχημάτων και χάρτης στο Στάσεις.`;
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
      .map(s => `<li><a href="${escape(encodeURI(stopPath(s.id)))}">${escape(s.name)}</a></li>`);
    return `<section>\n<h2>${escape(p.headsign)}</h2>\n<ol>\n${items.join("\n")}\n</ol>\n</section>`;
  });
  const body = `<p class="kicker">${escape(mode)}</p>
<h1>${escape(head(line.label, line.name))}</h1>
<p class="lead">${ids.size} στάσεις</p>
<a class="cta" href="${escape(mapLineHref(line.id))}">Δες ζωντανά στον χάρτη ›</a>
${sections.join("\n")}`;
  return layout({ title, description, canonical, body });
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

// Writes every page and both index files. Any API error rejects: a deploy must not publish a
// site whose pages are missing.
// extraPaths: pages written by other scripts (the stats pages), listed in the same sitemap.
export async function build(outDir: string, getJson: GetJson, extraPaths: string[] = []): Promise<{ stops: number; lines: number }> {
  // A Source loading or down can answer with empty lists (CONTRACT.md /v2): its pages would vanish.
  const complete = async <T>(path: string) => {
    const body = (await getJson(path)) as T & { sources?: { id: string; state: string }[] };
    const bad = body.sources?.find(s => s.state === "warming_up" || s.state === "down");
    if (bad) throw new Error(`${path}: ${bad.id} ${bad.state}`);
    return body;
  };
  const { lines: raw } = await complete<{ lines: (Omit<SeoLine, "label"> & { label: string | null })[] }>("lines");
  const lines: SeoLine[] = raw.map(l => ({ ...l, label: l.label ?? "" }));
  const { stops } = await complete<{ stops: StopEntry[] }>("stops");
  const details = await mapLimit(lines, 6, l => complete<LineDetail>("lines/" + encodeURIComponent(l.id)));

  await mkdir(join(outDir, "stop"), { recursive: true });
  await mkdir(join(outDir, "line"), { recursive: true });
  await Promise.all([
    ...stops.map(s => writeFile(join(outDir, stopPath(s[0])), stopPage(s, lines))),
    ...details.map(d => writeFile(join(outDir, linePath(d.line.id)), linePage(d))),
  ]);

  await writeFile(join(outDir, LINES_PATH.slice(1)), linesPage(lines));
  const paths = ["/", LINES_PATH, ...extraPaths, ...lines.map(l => linePath(l.id)), ...stops.map(s => stopPath(s[0]))];
  await writeFile(join(outDir, "sitemap.xml"), sitemap(paths));
  await writeFile(join(outDir, "robots.txt"), robots());
  return { stops: stops.length, lines: lines.length };
}

// Bun only: `bun scripts/seo.ts dist` after the Vite build.
const isMain = (import.meta as ImportMeta & { main?: boolean }).main === true;
if (isMain) {
  const outDir = process.argv[2] ?? "dist";
  const base = (process.env.VITE_API_BASE || "https://transit.haroldpoi.dev").replace(/\/+$/, "");
  const getJson: GetJson = async path => {
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
  // The stats pages (web#48) read the stats branch of athens-transit-rt on GitHub.
  const { buildStats } = await import("./stats-pages");
  const statsBase = (process.env.VITE_STATS_BASE || "https://raw.githubusercontent.com/angelospk/athens-transit-rt/stats/v1").replace(/\/+$/, "");
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
    const n = await build(outDir, getJson, stats.paths);
    console.log(`seo: ${n.stops} stops, ${n.lines} lines -> ${outDir}`);
    console.log(`stats: ${stats.cities.map(c => `${c.id} ${c.days} days${c.bad ? ` (${c.bad} unreadable)` : ""}`).join(", ") || "none"}`);
  } catch (err) {
    console.error("seo:", err);
    process.exit(1);
  }
}
