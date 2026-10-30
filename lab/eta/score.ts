// ETA lab scorer: read the sampler's JSONL and score every pred against the real passes.
//   bun lab/eta/score.ts <data dir> [from YYYY-MM-DD] [to YYYY-MM-DD]
// Writes <dir>/report.json next to the printed table.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { passesFor, score, type Fix, type Pred } from "./eta";

const [dir, fromArg, toArg] = process.argv.slice(2);
if (!dir) throw new Error("usage: bun lab/eta/score.ts <data dir> [from YYYY-MM-DD] [to YYYY-MM-DD]");

const files = readdirSync(dir).filter(f => /^(preds|fixes)-\d{4}-\d\d-\d\d\.jsonl$/.test(f));
const dates = files.map(f => f.slice(6, 16)).sort();
const from = fromArg || dates[0] || "", to = toArg || dates[dates.length - 1] || "";
const read = files.filter(f => f.slice(6, 16) >= from && f.slice(6, 16) <= to).sort();

const preds: Pred[] = [], fixesByVehicle: Record<string, Fix[]> = {};
for (const f of read) {
  for (const l of readFileSync(join(dir, f), "utf8").split("\n")) {
    if (!l.trim()) continue;
    const r = JSON.parse(l);
    if (f.startsWith("preds-")) preds.push({ q: r.q, stop: String(r.stop), vehicle: String(r.vehicle), at: r.at });
    else (fixesByVehicle[r.vehicle] ??= []).push({ t: r.t, lat: r.lat, lon: r.lon });
  }
}

let stops: Record<string, { lat: number; lon: number }> = {};
try { stops = JSON.parse(readFileSync(join(dir, "stops.json"), "utf8")); } catch { /* no stop list yet */ }

let end = 0;
for (const fx of Object.values(fixesByVehicle)) for (const f of fx) end = Math.max(end, f.t);

const res = score(preds, passesFor(preds, fixesByVehicle, stops), end);

const sec = (x: number | null) => (x === null ? "—" : String(Math.round(x)));
const pct = (x: number | null) => (x === null ? "—" : `${Math.round(100 * x)}%`);
console.log(`bucket       n  median    p90   mean    ≤1′    ≤2′`);
for (const b of [res.all, ...res.buckets]) {
  console.log([
    b.label.padEnd(8), String(b.n).padStart(4), sec(b.median_abs_s).padStart(6), sec(b.p90_abs_s).padStart(6),
    sec(b.mean_s).padStart(6), pct(b.within_60).padStart(5), pct(b.within_120).padStart(5),
  ].join(" "));
}
console.log(`matched ${res.matched}  phantom ${res.phantom}  unresolved ${res.unresolved}  (${from} → ${to})`);

const report = { ...res, from, to, stops: new Set(preds.map(p => p.stop)).size, preds: preds.length };
writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 1) + "\n");
console.log(`report: ${join(dir, "report.json")}`);
