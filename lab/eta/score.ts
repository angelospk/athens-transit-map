// ETA lab scorer: read the sampler's JSONL and score every pred against the real passes.
//   bun lab/eta/score.ts <data dir> [from YYYY-MM-DD] [to YYYY-MM-DD]
// Writes <dir>/report.json next to the printed table.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { passesFor, score } from "./eta";
import { dates, load } from "./load";

const [dir, fromArg, toArg] = process.argv.slice(2);
if (!dir) throw new Error("usage: bun lab/eta/score.ts <data dir> [from YYYY-MM-DD] [to YYYY-MM-DD]");

const all = dates(dir);
const from = fromArg || all[0] || "", to = toArg || all[all.length - 1] || "";
const { preds, fixesByVehicle, stops, end } = load(dir, from, to);

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
