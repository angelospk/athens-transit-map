// Replaces the straight station-to-station lines of public/metro.json (from scripts/metro.ts) with
// the real track shapes from OpenStreetMap. Run it after scripts/metro.ts.
//
//   bun scripts/metro-osm.ts [overpass interpreter URL | saved Overpass JSON answer]

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { MetroData } from "../src/lib/metro";
import { osmPaths } from "./osm";

// overpass-api.de refuses some clients; this mirror answers.
const url = process.argv[2] ?? "https://maps.mail.ru/osm/tools/overpass/api/interpreter";
const query = `[out:json][timeout:120];
rel(37.8,23.5,38.2,24.1)["type"="route"]["route"~"^(subway|tram)$"]->.r;
.r out body;
(way(r.r:"");way(r.r:"forward");way(r.r:"backward"););
out geom;`;

async function overpass() {
  if (existsSync(url)) return JSON.parse(readFileSync(url, "utf8"));
  const r = await fetch(url, { method: "POST", body: new URLSearchParams({ data: query }),
    headers: { "User-Agent": "athens-transit-map (github.com/angelospk/athens-transit-map)", Accept: "application/json" } });
  if (!r.ok) throw new Error(`Overpass: HTTP ${r.status} (busy mirrors often answer on a second try)`);
  return r.json();
}
const paths = osmPaths((await overpass()).elements);

const data: MetroData = JSON.parse(readFileSync("public/metro.json", "utf8"));
for (const l of data.lines) {
  const p = paths.get(l.id);
  if (!p?.length) throw new Error(`no OSM track for ${l.id}`);
  l.paths = p;
}
data.source = "STASY GTFS, data.gov.gr; γραμμές © OpenStreetMap contributors (ODbL)";
writeFileSync("public/metro.json", JSON.stringify(data));
console.log(data.lines.map(l => `${l.id}: ${l.paths.length} paths, ${l.paths.flat().length} points`).join("\n"));
