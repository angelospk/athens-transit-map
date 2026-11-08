// Every bus and trolley stop and the stop order of each line's variants, for the trip planner, from
// the backend's static data (STATIC_BASE): no file there lists all stops at once.
//
//   bun scripts/trips.ts   → public/trips.json   (again when OASA publishes a new GTFS)
//   VITE_STATIC_BASE=<instance>/static/v1 TRIPS_OUT=public/trips-thessaloniki.json bun scripts/trips.ts
//     → another city's index (no stop corrections: they are Athens stop ids)
//
// The index carries the GTFS version (v) of the line list; a city whose GTFS has no feed_info (Thessaloniki's
// OSETH slices) has none there, so v is the version /v1/status names (the slice's first day). No version: no file.
// .github/workflows/thess-stops.yml rebuilds Thessaloniki's index every day.
//
// Stop positions found wrong (scripts/stop-corrections.json, proposed by scripts/stopfix.ts and committed
// by hand) replace the GTFS ones.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { TripIndex } from "../src/lib/trip";
import { stopDirections } from "../src/lib/towards";
import { lineDestinations, variantEnds, withDestinations } from "../src/lib/destination";
import { applyCorrections, type Correction } from "../src/lib/stopfix";
import type { LineStatic, LinesIndex } from "../src/lib/types";

const BASE = (process.env.VITE_STATIC_BASE || "https://angelospk.github.io/staseis-rt/static/v1").replace(/\/+$/, "");

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return r.json() as Promise<T>;
}

const ix = await get<LinesIndex>(`${BASE}/lines.json`);
const files: LineStatic[] = [];
for (let i = 0; i < ix.lines.length; i += 8)   // 8 at a time: a polite load on GitHub Pages
  files.push(...await Promise.all(ix.lines.slice(i, i + 8).map(l => get<LineStatic>(`${BASE}/lines/${encodeURIComponent(l.id)}.json`))));

const OUT = process.env.TRIPS_OUT || "public/trips.json";
const fixes: Record<string, Correction> = OUT === "public/trips.json" ? JSON.parse(readFileSync("scripts/stop-corrections.json", "utf8")) : {};
const v = ix.gtfs_version || (await get<{ gtfs_version: string }>(BASE.replace(/\/static\/v1$/, "/v1/status"))).gtfs_version;
if (!v) throw new Error("no GTFS version in lines.json or /v1/status");
const data: TripIndex = { v, s: [], l: {} };
const at = new Map<string, number>();
for (const f of files) {
  const variants: Record<string, number[]> = {};
  for (const [vid, v] of Object.entries(f.variants))
    variants[vid] = v.stops.map(sid => {
      const s = f.stops[sid];
      // A half-written index would plan wrong trips: stop instead.
      if (!s || !Number.isFinite(s.lat) || !Number.isFinite(s.lon)) throw new Error(`line ${f.id} variant ${vid}: bad stop ${sid}`);
      let k = at.get(sid);
      if (k == null) {
        at.set(sid, (k = data.s.length));
        const [lat, lon] = applyCorrections(sid, s.lat, s.lon, fixes);
        data.s.push([s.name.trim(), +lat.toFixed(5), +lon.toFixed(5), sid]);
      }
      return k;
    });
  data.l[f.id] = variants;
}
// An instance that lost most of its lines (a half-loaded feed) would empty the map: keep the old file.
const old: TripIndex | null = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null;
if (old && data.s.length < old.s.length / 2) throw new Error(`${data.s.length} stops, was ${old.s.length}: not written`);
// Each variant's end, as a readable name, by line (src/lib/destination.ts): from the variant's last stops, named
// from its headsign or the line's name. Loops and names with no clear cut have none.
const lineName = new Map(ix.lines.map(l => [l.id, l.name]));
data.d = withDestinations(stopDirections(data), Object.fromEntries(files.map(f => [f.id, lineDestinations(lineName.get(f.id) ?? "", variantEnds(f))])));
writeFileSync(OUT, JSON.stringify(data));
const ends = Object.values(data.d.h ?? {}).reduce((n, v) => n + Object.keys(v).length, 0);
console.log(`${files.length} lines, ${data.s.length} stops, ${Object.values(data.l).reduce((n, v) => n + Object.keys(v).length, 0)} variants, ${ends} with an end`);
