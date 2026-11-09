// Weekly check of the municipal timetable sources (data/municipal/*.json, "watch"): a file whose bytes changed,
// or a page whose times changed, means the municipality may have a new timetable, and a person must look.
// `bun scripts/municipal-watch.ts`        prints a Markdown report of the changes (empty when none), exit 0
// `bun scripts/municipal-watch.ts --fill` writes the current hashes into the files (after a transcription)
// `--misses <file>`: the URLs the previous run could not reach (read), then the ones this run could not (written)
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { timesSignature } from "../src/lib/muniTimes";

type Kind = "file" | "times";
interface Watched { file: string; municipality: string; source?: string; watch: { url: string; kind: Kind; sha256: string }[] }
export interface Finding { file: string; municipality: string; url: string; status: "changed" | "unreachable" | "unlinked"; now: string | null }

const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

// The text a reader sees: no comments (cache stamps like "@ 3:54 PM"), head, scripts, styles, SVG paths or
// attributes, whose numbers look like times and change on every load (issue #68).
const visibleText = (html: string) => html
  .replace(/<!--[\s\S]*?-->/g, " ")
  .replace(/<(head|script|style|svg)\b[\s\S]*?<\/\1\s*>/gi, " ")
  .replace(/<[^>]*>/g, " ");

// A page is compared by its visible times only (timesSignature): its notices and banners change every week.
export const sourceHash = (kind: Kind, body: Uint8Array) =>
  kind === "file" ? sha(body) : sha(timesSignature(visibleText(new TextDecoder().decode(body))));

// One failed fetch is often the site or the runner's network, not a removed timetable: an unreachable source is
// reported only when the previous run could not reach it either.
export const confirmUnreachable = (found: Finding[], missedBefore: Set<string>) =>
  found.filter(f => f.status !== "unreachable" || missedBefore.has(f.url));

// The page's links, %XX decoded, so a file name matches however the page spells it.
const decoded = (html: string) => html.replace(/(%[0-9A-F]{2})+/gi, s => { try { return decodeURIComponent(s); } catch { return s; } });

export async function checkSources(tables: Watched[], get: (url: string) => Promise<Uint8Array | null>): Promise<Finding[]> {
  const out: Finding[] = [];
  for (const t of tables) for (const w of t.watch) {
    const body = await get(w.url);
    const now = body ? sourceHash(w.kind, body) : null;
    if (now === w.sha256) continue;
    out.push({ file: t.file, municipality: t.municipality, url: w.url, status: now ? "changed" : "unreachable", now });
  }
  // A file the municipality's page no longer links to: the same bytes stay online, a new timetable may sit at a
  // new address.
  for (const t of tables) {
    const files = t.watch.filter(w => w.kind === "file" && w.url !== t.source);
    const page = t.source && files.length ? await get(t.source) : null;
    if (!page) continue;
    const html = decoded(new TextDecoder().decode(page));
    for (const w of files) if (!html.includes(`/${decodeURI(w.url).split("/").pop()}`))
      out.push({ file: t.file, municipality: t.municipality, url: w.url, status: "unlinked", now: null });
  }
  return out;
}

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  try {
    const r = await fetch(encodeURI(decodeURI(url)), { signal: AbortSignal.timeout(30_000),
      headers: { "user-agent": "Mozilla/5.0 (staseis.gr timetable check; +https://staseis.gr)" } });
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  } catch { return null; }
}

if ((import.meta as ImportMeta & { main?: boolean }).main === true) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "municipal");
  const files = readdirSync(dir).filter(f => f.endsWith(".json"));
  const tables = files.map(f => ({ file: f, ...JSON.parse(readFileSync(join(dir, f), "utf8")) }) as Watched & Record<string, unknown>);
  const found = await checkSources(tables, fetchBytes);
  if (process.argv.includes("--fill")) {
    for (const t of tables) {
      const { file, ...data } = t;
      for (const w of data.watch) { const f = found.find(x => x.file === file && x.url === w.url); if (f?.now) w.sha256 = f.now; }
      writeFileSync(join(dir, file), JSON.stringify(data, null, 2) + "\n");
    }
    for (const f of found.filter(x => !x.now)) console.error(`${f.status}: ${f.url}`);
  } else {
    const at = process.argv.indexOf("--misses"), missesFile = at > 0 ? process.argv[at + 1] : null;
    let report = found;
    if (missesFile) {
      const before = existsSync(missesFile) ? readFileSync(missesFile, "utf8").split("\n").filter(Boolean) : [];
      report = confirmUnreachable(found, new Set(before));
      writeFileSync(missesFile, found.filter(f => f.status === "unreachable").map(f => f.url + "\n").join(""));
    }
    if (!report.length) process.exit(0);
    console.log("Ένας δήμος ίσως άλλαξε το ωράριο της δημοτικής συγκοινωνίας. Έλεγξε την πηγή και το `data/municipal/<file>`, ξαναπέρασε τις ώρες αν άλλαξαν, και τρέξε `bun scripts/municipal-watch.ts --fill`.\n");
    for (const f of report) console.log(`- ${{ changed: "Άλλαξε", unreachable: "Δεν απαντά", unlinked: "Δεν υπάρχει πια στη σελίδα" }[f.status]}: ${f.municipality} · \`${f.file}\` · ${f.url}`);
  }
}
