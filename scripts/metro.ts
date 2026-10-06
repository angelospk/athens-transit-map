// Metro, ISAP and tram lines and stations for the map, from the STASY GTFS on data.gov.gr
// ("Δρομολόγια Σταθερών Συγκοινωνιών (ΜΕΤΡΟ, ΗΣΑΠ, ΤΡΑΜ)"). The feed has no shapes and no colours:
// a line is drawn station to station along the longest trip of each direction (one-way loops),
// in the colours below.
//
//   bun scripts/metro.ts <dir with the unzipped GTFS .txt files>   → public/metro.json

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { linkTransfers, type MetroData, type MetroLine, type MetroStation } from "../src/lib/metro";

const COLORS: Record<string, string> = { M1: "#00a651", M2: "#e30613", M3: "#0072bc", T6: "#f39200", T7: "#f39200" };
const MERGE_M = 500;   // platforms (one per direction) and interchanges of the same name within this

const dir = process.argv[2];
if (!dir) throw new Error("usage: bun scripts/metro.ts <gtfs dir>");

function* rows(file: string): Generator<Record<string, string>> {
  const lines = readFileSync(join(dir, file), "utf8").replace(/^﻿/, "").split(/\r?\n/);
  const head = lines[0].split(",").map(h => h.replace(/"/g, ""));
  for (const l of lines.slice(1)) {
    if (!l) continue;
    const cells = l.split(",").map(c => c.replace(/^"|"$/g, ""));
    // No CSV parser: STASY quotes no field. A comma inside one would shift the columns.
    if (cells.length !== head.length) throw new Error(`${file}: ${cells.length} cells, ${head.length} columns: ${l}`);
    yield Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ""]));
  }
}

const stops = new Map([...rows("stops.txt")].map(r => [r.stop_id, { name: r.stop_name.trim(), lat: +r.stop_lat, lon: +r.stop_lon }]));
const routes = [...rows("routes.txt")];
const trips = [...rows("trips.txt")];
const tripRoute = new Map(trips.map(r => [r.trip_id, r.route_id]));
const tripDir = new Map(trips.map(r => [r.trip_id, `${r.route_id}/${r.direction_id}`]));

// Longest stop sequence of each route and direction.
const seqs = new Map<string, [number, string][]>();
for (const r of rows("stop_times.txt")) {
  let s = seqs.get(r.trip_id);
  if (!s) seqs.set(r.trip_id, (s = []));
  s.push([+r.stop_sequence, r.stop_id]);
}
const longest = new Map<string, string[]>();
for (const [trip, s] of seqs) {
  const k = tripDir.get(trip)!;
  if (s.length > (longest.get(k)?.length ?? 0)) longest.set(k, s.sort((a, b) => a[0] - b[0]).map(x => x[1]));
}

const distM = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  Math.hypot((a.lon - b.lon) * Math.cos((a.lat * Math.PI) / 180), a.lat - b.lat) * 111_320;
const key = (name: string) => name.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();

const lines: MetroLine[] = [];
const stations: (MetroStation & { n: number })[] = [];
for (const r of routes) {
  const id = r.route_short_name;
  const paths = [...longest].filter(([k]) => k.startsWith(`${r.route_id}/`)).map(([, seq]) =>
    seq.map((s): [number, number] => { const p = stops.get(s)!; return [+p.lon.toFixed(6), +p.lat.toFixed(6)]; }));
  if (!paths.length) continue;
  lines.push({ id, name: r.route_long_name, color: COLORS[id] ?? "#666666", paths });
  // Every stop of the route (both directions' platforms), merged into stations by name and distance.
  const all = new Set([...seqs].filter(([t]) => tripRoute.get(t) === r.route_id).flatMap(([, s]) => s.map(x => x[1])));
  for (const sid of all) {
    const p = stops.get(sid)!;
    const st = stations.find(x => key(x.name) === key(p.name) && distM(x, p) <= MERGE_M);
    if (!st) stations.push({ name: p.name, lat: p.lat, lon: p.lon, lines: [id], n: 1 });
    else {
      st.lat = (st.lat * st.n + p.lat) / (st.n + 1);
      st.lon = (st.lon * st.n + p.lon) / (st.n + 1);
      st.n++;
      if (!st.lines.includes(id)) st.lines.push(id);
    }
  }
}

const data: MetroData = {
  source: "STASY GTFS, data.gov.gr",
  lines: lines.sort((a, b) => a.id.localeCompare(b.id)),
  stations: linkTransfers(stations.map(({ n: _, ...s }) => ({ ...s, lat: +s.lat.toFixed(6), lon: +s.lon.toFixed(6) }))),
};
writeFileSync("public/metro.json", JSON.stringify(data));
console.log(`${data.lines.length} lines, ${data.stations.length} stations`,
  data.stations.filter(s => s.lines.length > 1).map(s => `${s.name} ${s.lines.join("/")}`));
