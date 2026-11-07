// The weekly «Ακρίβεια» file for the ⓘ sheet (web#27): the last 7 complete days, termini left out.
//   bun lab/eta/publish.ts <data dir> <out.json>
// lab/eta/publish.sh runs it each week and pushes the file to the `eta` branch.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { passesFor, score, summary } from "./eta";
import { dates, load } from "./load";

// A parked bus drifts in and out of the 40 m circle at a terminus, so its passes are noise.
const TERMINI = new Set(["10183"]);   // ΠΕΙΡΑΙΑΣ

const [dir, out] = process.argv.slice(2);
if (!dir || !out) throw new Error("usage: bun lab/eta/publish.ts <data dir> <out.json>");

// Today in Athens is not complete yet; the day after `to` is read too, so a bus asked about
// late on the last day still finds its pass.
const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Athens" });
const days = dates(dir).filter(d => d < today).slice(-7);
if (days.length < 7) throw new Error(`need 7 complete days, have ${days.length}`);
const from = days[0], to = days[6];
const data = load(dir, from, today);
// Rows after `to` are read only so a run that crosses midnight keeps its end; they do not count.
const preds = data.preds.filter(p => !TERMINI.has(p.stop) && day(p.q) >= from);
const counted = (p: { q: number }) => day(p.q) <= to;
const res = score(preds, passesFor(preds, data.fixesByVehicle, data.stops), data.end, counted);
const pub = summary(res, { from, to, stops: new Set(preds.filter(counted).map(p => p.stop)).size });

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(pub, null, 1) + "\n");
console.log(JSON.stringify(pub));

function day(t: number): string {
  return new Date(t * 1000).toLocaleDateString("sv-SE", { timeZone: "Europe/Athens" });
}
