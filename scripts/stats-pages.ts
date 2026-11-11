// Static network statistics pages, one per city: /{city}/stats/ with the newest day, the last
// weeks compared, and every day as CSV (the full JSON stays on the stats branch of
// athens-transit-rt). Plain HTML and a schema.org Dataset, so other sites and search engines
// read the figures without running the app. Run from scripts/seo.ts after `vite build` (web#48).

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CITIES, STATS_DIRS, type CityId } from "../src/lib/cities";
import {
  byDayType, CITYBUS_PLAN_NOTE, complete, gaps, hasDelays, hourBand, hourly, kmh, lineTrends, LONG_DAYS, MIN_DELAY_RUNS, MIN_LINE_HOURS,
  ranking, slowLines, tripShare, validDay, type DayStats,
} from "../src/lib/stats";
import { escape, layout, mapLimit, SITE } from "./seo";

export const LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/";
// The public stats branch: the links on the pages point here, whatever the build read from.
export const RAW_BASE = "https://raw.githubusercontent.com/angelospk/staseis-rt/stats/v1";
const BRANCH_URL = "https://github.com/angelospk/athens-transit-rt/tree/stats/v1";
const METHOD_URL = "https://github.com/angelospk/athens-transit-rt/blob/main/docs/API.md";

export interface StatsCity {
  id: CityId;
  name: string;
  agency: string;
  center: [number, number]; // [lng, lat]
  dir: string; // the city's folder under v1/ on the stats branch; "" = v1 itself
}

const DIRS = STATS_DIRS;

export const STATS_CITIES: StatsCity[] = Object.values(CITIES).flatMap(c =>
  c.id in DIRS ? [{ id: c.id, name: c.name, agency: c.agency, center: c.center, dir: DIRS[c.id]! }] : []);

const sub = (c: StatsCity) => (c.dir ? `/${c.dir}` : "");
export const statsPath = (c: StatsCity) => `/${c.id}/stats/`;
export const csvPath = (c: StatsCity, date: string, kind: "hours" | "lines") => `${statsPath(c)}data/${date}-${kind}.csv`;
export const rawDayUrl = (c: StatsCity, date: string) => `${RAW_BASE}${sub(c)}/days/${date}.json`;
const mapHref = (c: StatsCity) => `/${c.id}/`;

// ---- CSV: one row per hour and one per line, numbers as the day file has them, km/h with a dot.

const cell = (v: string | number | null | undefined) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
const csv = (rows: (string | number | null | undefined)[][]) => rows.map(r => r.map(cell).join(",")).join("\n") + "\n";
const kmh1 = (dist: number, time: number) => {
  const v = kmh(dist, time);
  return v == null ? "" : v.toFixed(1);
};

export function hoursCsv(d: DayStats): string {
  return csv([
    ["hour", "fixes", "vehicles", "lines", "dist_m", "time_s", "kmh"],
    ...d.hours.map(h => [h.h, h.fixes, h.vehicles, h.lines, h.dist_m, h.time_s, kmh1(h.dist_m, h.time_s)]),
  ]);
}

// Every line the day names (speed, trip counts or start delays), once, sorted by id.
export function linesCsv(d: DayStats): string {
  const speed = new Map(d.by_line.map(l => [l.line, l]));
  const trips = new Map((d.trips?.by_line ?? []).map(l => [l.line, l]));
  const delay = new Map((d.start_delay?.by_line ?? []).map(l => [l.line, l]));
  const ids = [...new Set([...speed.keys(), ...trips.keys(), ...delay.keys()])].sort();
  return csv([
    ["line", "fixes", "vehicles", "dist_m", "time_s", "kmh", "trips_planned", "trips_run", "trips_partial", "trips_missed",
      "trips_unmeasured", "start_runs", "start_mean_s", "start_p90_s"],
    ...ids.map(id => {
      const s = speed.get(id), t = trips.get(id), x = delay.get(id);
      return [id, s?.fixes, s?.vehicles, s?.dist_m, s?.time_s, s ? kmh1(s.dist_m, s.time_s) : "",
        t?.planned, t?.run, t?.partial, t?.missed, t?.unmeasured, x?.runs, x?.mean_s, x?.p90_s];
    }),
  ]);
}

// ---- The page.

const nf = new Intl.NumberFormat("el-GR");
const df = new Intl.NumberFormat("el-GR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const n = (v: number | null | undefined) => (v == null ? "—" : nf.format(Math.round(v)));
const dec = (v: number | null | undefined) => (v == null ? "—" : df.format(v));
const pct = (v: number) => `${Math.round(v * 100)}%`;
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
const dateEl = (date: string) =>
  new Intl.DateTimeFormat("el-GR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00Z`));

const table = (id: string, head: string[], rows: string[][]) =>
  `<div class="scroll"><table id="${id}">\n<tr>${head.map(h => `<th>${h}</th>`).join("")}</tr>\n${
    rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("\n")}\n</table></div>`;

// 24 bars, one per hour; the table under it holds the numbers, so the chart is hidden from readers.
function bars(values: (number | null)[], label: string): string {
  const max = Math.max(...values.map(v => v ?? 0));
  if (!(max > 0)) return "";
  const W = 10, H = 60;
  const rects = values.map((v, i) => {
    const h = v ? Math.max(1, Math.round((v / max) * (H - 2))) : 0;
    return h ? `<rect x="${i * W + 1}" y="${H - h}" width="${W - 2}" height="${h}"/>` : "";
  }).join("");
  return `<svg class="bars" viewBox="0 0 ${24 * W} ${H + 12}" role="img" aria-label="${escape(label)}">${rects}`
    + [0, 6, 12, 18].map(h => `<text x="${h * W + 1}" y="${H + 11}">${hh(h)}</text>`).join("") + `</svg>`;
}

const STYLE = `<style>
main{max-width:46rem}
.scroll{overflow-x:auto;margin:.5rem 0}
table{border-collapse:collapse;width:100%;font-size:.9rem;font-variant-numeric:tabular-nums}
th,td{padding:.3rem .45rem;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}
th:first-child,td:first-child{text-align:left}
th{color:var(--dim);font-weight:600;font-size:.75rem;white-space:normal;vertical-align:bottom}
h3{margin:1rem 0 .25rem;font-size:.9rem;color:var(--dim)}
.facts{display:grid;grid-template-columns:repeat(2,1fr);gap:.5rem;margin:.75rem 0;padding:0;list-style:none}
.facts li{padding:.6rem .75rem;border-radius:.6rem;background:var(--card);border:1px solid var(--line)}
.facts b{display:block;font-size:1.25rem}
.facts span{color:var(--dim);font-size:.8rem}
#days td:last-child,#days th:last-child{white-space:normal;text-align:left}
small{color:var(--dim)}
.note{color:var(--dim);font-size:.85rem;margin:.4rem 0}
.warn{color:#b35c00}
.two{display:grid;grid-template-columns:1fr 1fr;gap:0 1rem}
@media (max-width:30rem){.two{grid-template-columns:1fr}}
svg.bars{display:block;width:100%;height:auto;margin:.5rem 0;color:var(--fg)}
svg.bars rect{fill:currentColor;opacity:.6}
svg.bars text{fill:var(--dim);font-size:7px}
section{margin-top:1.5rem}
</style>
`;

function dataset(c: StatsCity, days: DayStats[], latest: DayStats) {
  const url = SITE + statsPath(c);
  const modified = new Date(latest.generated_at * 1000); // invalid when missing or out of range
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `Στατιστικά δικτύου λεωφορείων ${c.agency} · ${c.name}`,
    description: `Ημερήσια στατιστικά των λεωφορείων ${c.agency} στην πόλη ${c.name}, από τις θέσεις GPS των οχημάτων: `
      + "οχήματα και μέση ταχύτητα ανά ώρα, ταχύτητα ανά γραμμή, δρομολόγια που έγιναν και καθυστέρηση εκκίνησης.",
    url,
    inLanguage: "el",
    isAccessibleForFree: true,
    license: LICENSE_URL,
    creator: { "@type": "Organization", name: "Στάσεις", url: SITE },
    isBasedOn: "https://github.com/angelospk/athens-transit-rt",
    keywords: ["συγκοινωνίες", "λεωφορεία", c.agency, c.name, "GPS", "ταχύτητα", "public transport"],
    temporalCoverage: `${days[0].date}/${latest.date}`,
    ...(Number.isNaN(modified.getTime()) ? {} : { dateModified: modified.toISOString() }),
    spatialCoverage: { "@type": "Place", name: c.name, geo: { "@type": "GeoCoordinates", latitude: c.center[1], longitude: c.center[0] } },
    variableMeasured: ["οχήματα ανά ώρα", "μέση ταχύτητα (km/h)", "ταχύτητα ανά γραμμή", "δρομολόγια που έγιναν", "καθυστέρηση εκκίνησης"],
    distribution: [
      { "@type": "DataDownload", name: `Ανά ώρα, ${latest.date}`, encodingFormat: "text/csv", contentUrl: SITE + csvPath(c, latest.date, "hours") },
      { "@type": "DataDownload", name: `Ανά γραμμή, ${latest.date}`, encodingFormat: "text/csv", contentUrl: SITE + csvPath(c, latest.date, "lines") },
      { "@type": "DataDownload", name: `Όλη η μέρα, ${latest.date}`, encodingFormat: "application/json", contentUrl: rawDayUrl(c, latest.date) },
      { "@type": "DataDownload", name: "Κατάλογος ημερών", encodingFormat: "application/json", contentUrl: `${RAW_BASE}${sub(c)}/index.json` },
    ],
  };
}

function newestDay(c: StatsCity, d: DayStats): string {
  const missing = gaps(d);
  const all = d.hours.reduce((a, h) => ({ dist: a.dist + h.dist_m, time: a.time + h.time_s }), { dist: 0, time: 0 });
  const trips = tripShare(d);
  const rank = ranking(d, 10);
  const rows = hourly(d);
  const facts = [
    [n(d.vehicles), "οχήματα"], [n(d.lines), "γραμμές"], [dec(kmh(all.dist, all.time)), "km/h μέση ταχύτητα"],
    trips ? [pct(trips.share), `δρομολόγια έγιναν (${n(trips.run)} από ${n(trips.measured)})`] : [n(d.fixes), "θέσεις GPS"],
  ];
  const rankTable = (id: string, list: typeof rank.slow) =>
    table(id, ["Γραμμή", "km/h", "km", "ώρες"], list.map(r => [escape(r.line), dec(r.kmh), n(r.km), n(r.hours)]));
  return `<section>
<h2>${escape(dateEl(d.date))}</h2>
${missing.length ? `<p class="note warn">Η μέρα είναι μερική: δεν υπάρχουν θέσεις για τις ώρες ${missing.map(hh).join(", ")}.</p>\n` : ""}<ul class="facts">
${facts.map(([v, t]) => `<li><b>${v}</b><span>${t}</span></li>`).join("\n")}
</ul>
${trips ? planNote(trips) : ""}</section>
<section>
<h2>Ανά ώρα</h2>
${bars(rows.map(r => r.vehicles), "Οχήματα ανά ώρα")}
${table("hours", ["Ώρα", "Οχήματα", "km/h"], rows.map(r => [hh(r.h), n(r.vehicles), dec(r.kmh)]))}
<p class="note">km/h μαζί με στάσεις και φανάρια, από διαδοχικές θέσεις GPS κάθε οχήματος.</p>
</section>
${rank.eligible ? `<section>
<h2>Οι πιο αργές και οι πιο γρήγορες γραμμές</h2>
<div class="two"><div><h3>Πιο αργές</h3>
${rankTable("slow", rank.slow)}</div><div><h3>Πιο γρήγορες</h3>
${rankTable("fast", rank.fast)}</div></div>
<p class="note">Μέση ταχύτητα όλης της μέρας. Μόνο γραμμές με τουλάχιστον ${MIN_LINE_HOURS} ώρες κίνησης οχημάτων (${rank.eligible} γραμμές).</p>
</section>\n` : ""}${trips?.worst.length ? `<section>
<h2>Γραμμές με τα περισσότερα χαμένα δρομολόγια</h2>
${table("missed", ["Γραμμή", "Χάθηκαν", "Μετρήθηκαν", "%"], trips.worst.map(l => [escape(l.line), n(l.missed), n(l.measured), pct(l.missed / l.measured)]))}
${trips.unseen ? `<p class="note">Άλλες ${n(trips.unseen)} γραμμές του προγράμματος δεν φάνηκαν καθόλου.</p>` : ""}
</section>\n` : ""}`;
}

function compared(all: DayStats[]): string {
  const days = all.filter(complete).slice(-LONG_DAYS);
  const recent = all.slice(-LONG_DAYS);
  const delays = hasDelays(recent) ? slowLines(recent, 7, 10) : null;
  const delayHtml = delays?.rows.length ? `<section>
<h2>Καθυστέρηση εκκίνησης, 7 μέρες</h2>
${table("delay", ["Γραμμή", "Μέση", "9 στις 10 κάτω από", "Δρομολόγια"],
    delays.rows.map(r => [escape(r.line), `${dec(r.mean_s / 60)}′`, `${n(r.p90_min)}′`, n(r.runs)]))}
<p class="note">Πόσο αργά ξεκίνησαν από την αφετηρία τα δρομολόγια του προγράμματος. Μόνο γραμμές με τουλάχιστον ${MIN_DELAY_RUNS} δρομολόγια.</p>
</section>\n` : "";
  if (days.length < 2) return delayHtml;
  const band = hourBand(days);
  const types = byDayType(days);
  const trends = lineTrends(days, 8);
  const trendRows = (list: NonNullable<typeof trends>["slower"]) =>
    list.map(t => [escape(t.line), dec(t.base), dec(t.kmh), `${t.change > 0 ? "+" : ""}${Math.round(t.change * 100)}%`]);
  return `<section>
<h2>${n(days.length)} πλήρεις μέρες (${days[0].date} έως ${days.at(-1)!.date})</h2>
<h3>Ταχύτητα ανά ώρα</h3>
${table("band", ["Ώρα", "km/h", "Πιο αργή μέρα", "Πιο γρήγορη"], band.map(b => [hh(b.h), dec(b.kmh), dec(b.min), dec(b.max)]))}
<h3>Καθημερινές (${n(types.weekday.days)}) και Σαββατοκύριακα (${n(types.weekend.days)})</h3>
${table("daytype", ["Ώρα", "Οχήματα καθ.", "Οχήματα Σ/Κ", "km/h καθ.", "km/h Σ/Κ"],
    types.weekday.hours.map((w, h) => { const e = types.weekend.hours[h]; return [hh(h), n(w.vehicles), n(e.vehicles), dec(w.kmh), dec(e.kmh)]; }))}
</section>
${trends && (trends.slower.length || trends.faster.length) ? `<section>
<h2>Γραμμές που άλλαξαν στις ${trends.date}</h2>
<p class="note">Ταχύτητα της μέρας απέναντι σε ${n(trends.baseDays)} προηγούμενες ${trends.weekend ? "μέρες Σαββατοκύριακου" : "καθημερινές"}.</p>
<div class="two"><div><h3>Πιο αργές</h3>
${table("slower", ["Γραμμή", "Πριν", "Τώρα", "Αλλαγή"], trendRows(trends.slower))}</div><div><h3>Πιο γρήγορες</h3>
${table("faster", ["Γραμμή", "Πριν", "Τώρα", "Αλλαγή"], trendRows(trends.faster))}</div></div>
</section>\n` : ""}${delayHtml}`;
}

// days: the city's readable days, oldest first; at least one. cities: the cities with a stats page.
// The plan the day's trips count against (rt#99): OASA's daily schedule, and the expired GTFS only
// for the lines left on it (a day before rt#99 is all GTFS).
function planNote(t: NonNullable<ReturnType<typeof tripShare>>): string {
  if (t.source === "citybus_timetable") return `<p class="note">${CITYBUS_PLAN_NOTE}</p>\n`;
  const daily = t.source !== "gtfs" ? "Τα δρομολόγια μετρούν με το ημερήσιο πρόγραμμα του ΟΑΣΑ." : "";
  const old = !t.expired ? "" : t.source === "mixed"
    ? `${t.gtfsLines === 1 ? "Για 1 γραμμή" : `Για ${n(t.gtfsLines)} γραμμές`} χωρίς ημερήσιο πρόγραμμα μετρούν με το ληγμένο GTFS ${escape(t.gtfs)}.`
    : `Το πρόγραμμα δρομολογίων (GTFS ${escape(t.gtfs)}) έχει λήξει· τα δρομολόγια μετρούν με το παλιό πρόγραμμα.`;
  const text = [daily, old].filter(Boolean).join(" ");
  return text ? `<p class="note">${text}</p>\n` : "";
}

export function cityStatsPage(c: StatsCity, days: DayStats[], cities: StatsCity[] = [c]): string {
  const latest = days.at(-1)!;
  const canonical = SITE + statsPath(c);
  const archive = [...days].reverse().map(d => {
    const all = d.hours.reduce((a, h) => ({ dist: a.dist + h.dist_m, time: a.time + h.time_s }), { dist: 0, time: 0 });
    return [d.date + (complete(d) ? "" : "<br><small>μερική</small>"), n(d.vehicles), dec(kmh(all.dist, all.time)),
      `<a href="${escape(csvPath(c, d.date, "hours"))}">ώρες</a> · <a href="${escape(csvPath(c, d.date, "lines"))}">γραμμές</a> · <a href="${escape(rawDayUrl(c, d.date))}">JSON</a>`];
  });
  const body = `<p class="kicker">Στατιστικά δικτύου</p>
<h1>Λεωφορεία ${escape(c.agency)} · ${escape(c.name)}</h1>
<p class="lead">Τι έκαναν τα λεωφορεία της πόλης κάθε μέρα, από τις θέσεις GPS των οχημάτων. Τελευταία μέρα: ${latest.date}.</p>
<a class="cta" href="${escape(mapHref(c))}">Δες ζωντανά στον χάρτη ›</a>
${newestDay(c, latest)}${compared(days)}<section>
<h2>Όλες οι μέρες</h2>
${table("days", ["Μέρα", "Οχήματα", "km/h", "Αρχεία"], archive)}
<p class="note">Ελεύθερη χρήση με αναφορά στο «Στάσεις» (<a href="${LICENSE_URL}">CC BY 4.0</a>). Δεδομένα: θέσεις GPS ${escape(c.agency)}, με δικούς μας υπολογισμούς (<a href="${METHOD_URL}">μέθοδος</a>, <a href="${BRANCH_URL}">όλα τα αρχεία</a>).</p>
</section>`;
  return layout({
    title: `Στατιστικά δικτύου · ${c.name} · λεωφορεία ${c.agency} · Στάσεις`,
    description: `Ημερήσια στατιστικά των λεωφορείων ${c.agency} (${c.name}): οχήματα και ταχύτητα ανά ώρα, πιο αργές γραμμές, δρομολόγια. Ανοιχτά δεδομένα σε CSV και JSON.`,
    canonical,
    body,
    ld: dataset(c, days, latest),
    style: STYLE,
    footer: `<a href="/${c.id}/">Στάσεις</a> · ζωντανός χάρτης · ${cities.map(o => `<a href="${statsPath(o)}">Στατιστικά ${escape(o.name)}</a>`).join(" · ")}`,
  });
}

// ---- Build.

// The text at a URL; null for a 404. Any other failure throws.
export type GetText = (url: string) => Promise<string | null>;

const parse = (text: string | null): unknown => {
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

// A day file this page can render: validDay checks what the app reads; the trip counts are read
// here too (the start delays are checked line by line in stats.ts).
const usable = (d: unknown, date: string): d is DayStats => {
  if (!validDay(d, date)) return false;
  const t = d.trips;
  return t == null || (Array.isArray(t.by_line) && t.by_line.every(l => typeof l?.line === "string"));
};

// Writes the page and the CSV files of every city whose index lists a readable day. base: the
// v1 folder of the stats branch. A fetch failure rejects: the deploy then keeps the old site.
export async function buildStats(outDir: string, get: GetText, base = RAW_BASE) {
  const built: { c: StatsCity; days: DayStats[]; bad: number }[] = [];
  for (const c of STATS_CITIES) {
    const text = await get(`${base}${sub(c)}/index.json`);
    if (text == null) continue; // no stats for this city yet
    const index = parse(text) as { days?: unknown } | null;
    if (!index || !Array.isArray(index.days)) throw new Error(`stats ${c.id}: unknown index format`);
    const dates = index.days.filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    const files = await mapLimit(dates, 6, d => get(`${base}${sub(c)}/days/${d}.json`).then(parse));
    const days = files.filter((f, i): f is DayStats => usable(f, dates[i]));
    if (days.length) built.push({ c, days, bad: files.length - days.length });
  }
  // Pages last: each links the stats pages of the other cities that have one.
  for (const { c, days } of built) {
    const dir = join(outDir, statsPath(c));
    await mkdir(join(dir, "data"), { recursive: true });
    await Promise.all([
      writeFile(join(dir, "index.html"), cityStatsPage(c, days, built.map(b => b.c))),
      ...days.flatMap(d => [
        writeFile(join(outDir, csvPath(c, d.date, "hours")), hoursCsv(d)),
        writeFile(join(outDir, csvPath(c, d.date, "lines")), linesCsv(d)),
      ]),
    ]);
  }
  return {
    paths: built.map(b => statsPath(b.c)),
    cities: built.map(b => ({ id: b.c.id, days: b.days.length, bad: b.bad })),
  };
}
