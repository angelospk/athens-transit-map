// Every bus and trolley stop and the stop order of each line's variants, for the trip planner, from
// the backend's static data (STATIC_BASE): no file there lists all stops at once.
//
//   bun scripts/trips.ts   → public/trips.json   (again when OASA publishes a new GTFS)

import { writeFileSync } from "node:fs";
import type { TripIndex } from "../src/lib/trip";
import type { LineStatic, LinesIndex } from "../src/lib/types";

const BASE = (process.env.VITE_STATIC_BASE || "https://angelospk.github.io/athens-transit-rt/static/v1").replace(/\/+$/, "");

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return r.json() as Promise<T>;
}

const ix = await get<LinesIndex>(`${BASE}/lines.json`);
const files: LineStatic[] = [];
for (let i = 0; i < ix.lines.length; i += 8)   // 8 at a time: a polite load on GitHub Pages
  files.push(...await Promise.all(ix.lines.slice(i, i + 8).map(l => get<LineStatic>(`${BASE}/lines/${encodeURIComponent(l.id)}.json`))));

const data: TripIndex = { v: ix.gtfs_version, s: [], l: {} };
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
        data.s.push([s.name.trim(), +s.lat.toFixed(5), +s.lon.toFixed(5)]);
      }
      return k;
    });
  data.l[f.id] = variants;
}
writeFileSync("public/trips.json", JSON.stringify(data));
console.log(`${files.length} lines, ${data.s.length} stops, ${Object.values(data.l).reduce((n, v) => n + Object.keys(v).length, 0)} variants`);
