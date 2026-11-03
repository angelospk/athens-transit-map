// Proposes stop corrections for a human to commit; it changes nothing itself.
//
//   bun scripts/stopfix.ts [feedback.csv]
//
// Reads the GPS audit (lab/stops/measured.csv), the «Λάθος θέση;» reports in a CSV export of the feedback
// Sheet (any cell with a #stopfix line), the stop positions (public/trips.json) and the corrections
// already made (scripts/stop-corrections.json). For each stop with a report or a GPS suspect it runs
// decideCorrection (src/lib/stopfix.ts) and prints the corrections it would make, as JSON entries to
// paste into scripts/stop-corrections.json, then `bun scripts/trips.ts`. Refusals go to stderr.

import { readFileSync } from "node:fs";
import type { TripIndex } from "../src/lib/trip";
import { decideCorrection, gpsFromAudit, parseCsv, parseStopReports, type Correction, type GpsMeasure } from "../src/lib/stopfix";

const [feedbackCsv] = process.argv.slice(2);
const ix: TripIndex = JSON.parse(readFileSync("public/trips.json", "utf8"));
const done: Record<string, Correction> = JSON.parse(readFileSync("scripts/stop-corrections.json", "utf8"));

const [head, ...rows] = parseCsv(readFileSync("lab/stops/measured.csv", "utf8"));
const gps = new Map<string, GpsMeasure>();
const suspects = new Set<string>();
for (const r of rows) {
  const o = Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""]));
  const g = gpsFromAudit(o as Parameters<typeof gpsFromAudit>[0]);
  if (!g) continue;
  gps.set(o.stop_id, g);
  if (g.suspect) suspects.add(o.stop_id);
}

// Sheet rows are in send order: the row number is the report's time.
const reports = feedbackCsv
  ? parseStopReports(parseCsv(readFileSync(feedbackCsv, "utf8")).flatMap((r, at) => r.filter(c => c.includes("#stopfix")).map(text => ({ text, at }))))
  : [];

const byId = new Map(ix.s.map(s => [s[3], s] as const));
const ids = [...new Set([...reports.map(r => r.stop), ...suspects])].filter(id => !done[id]).sort();
const out: Record<string, Correction> = {};
const day = new Date().toISOString().slice(0, 10);
for (const id of ids) {
  const s = byId.get(id);
  if (!s) { console.error(`${id}: not in trips.json`); continue; }
  const d = decideCorrection({ id, lat: s[1], lon: s[2] }, gps.get(id) ?? null, reports);
  if (!d.apply) { if (d.reports) console.error(`${id} ${s[0]}: no (${d.reason})`); continue; }
  out[id] = { lat: +d.lat.toFixed(6), lon: +d.lon.toFixed(6), basis: d.basis,
    // Device ids come from the page: reports alone can be one person; a human checks those on the satellite map.
    note: `${d.basis === "reports" ? "CHECK BY HAND (reports only) " : ""}${s[0]}: ${Math.round(d.moved)} m, ${d.reports} reports, proposed ${day}` };
}
console.error(`${reports.length} reports, ${suspects.size} GPS suspects confirmed by OSM, ${Object.keys(out).length} proposals`);
console.log(JSON.stringify(out, null, 1));
