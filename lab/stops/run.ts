// Stop audit over the backend's fix history (`--history`, hourly CSV): per stop, where buses halt
// compared with the GTFS position. Method and traps: lab/stops/README.md.
//
//   bun lab/stops/run.ts <history dir> [static cache dir]
//   → lab/stops/measured.csv (every measured stop), lab/stops/suspect-stops.csv, numbers on stdout
//
// Static data (lines, variants, shapes, stops) comes from the backend's static files (as scripts/trips.ts);
// the history must be of the same GTFS version (checked).

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { LatLon } from "../../src/lib/stopfix";
import { distM } from "../../src/lib/stopfix";
import { cumulative, dayOf, measure, projectOn, projectStops, type Fix, type Measure, type Sample } from "./audit";

const [histDir, cacheArg] = process.argv.slice(2);
if (!histDir) throw new Error("usage: bun lab/stops/run.ts <history dir> [static cache dir]");
const cache = cacheArg ?? join(histDir, "..", "static");
const BASE = (process.env.VITE_STATIC_BASE || "https://angelospk.github.io/athens-transit-rt/static/v1").replace(/\/+$/, "");
const OUT = new URL(".", import.meta.url).pathname;

// Thresholds of the report (README): a stop is suspect when the measurement is sure (high), its peak
// is inside the window (a peak at the end is a queue or a light beyond it), buses halt at least
// SUSPECT_ALONG_M from the GTFS stop after the fleet-wide bias, and hardly at the GTFS stop itself.
const SUSPECT_ALONG_M = 20, MAX_AT_STOP = 0.35, MAX_WIN_M = 80, MIN_WIN_M = 20, OFF_SHAPE_M = 30, OSM_AGREE_M = 12;

interface Variant { headsign: string; direction: number; shape: [number, number][]; stops: string[] }
interface Line { id: string; variants: Record<string, Variant>; stops: Record<string, { name: string; lat: number; lon: number }> }

async function cached<T>(name: string, url: string): Promise<T> {
  const f = join(cache, name);
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  const text = await r.text();
  mkdirSync(cache, { recursive: true });
  writeFileSync(f, text);
  return JSON.parse(text);
}

const index = await cached<{ gtfs_version: string; lines: { id: string }[] }>("lines.json", `${BASE}/lines.json`);
const lines: Line[] = [];
for (let i = 0; i < index.lines.length; i += 8)
  lines.push(...await Promise.all(index.lines.slice(i, i + 8).map(l =>
    cached<Line>(`line-${encodeURIComponent(l.id)}.json`, `${BASE}/lines/${encodeURIComponent(l.id)}.json`))));

// Per shape (= variant id): geometry and its stops in order, each with its window [s - back, s + ahead].
interface StopOn { id: string; s: number; back: number; ahead: number }
interface ShapeInfo { pts: LatLon[]; cum: number[]; stops: StopOn[] }
const shapes = new Map<string, ShapeInfo>();
const homeOf = new Map<string, { shape: string; s: number }>();
// Each stop's narrowest window over its variants: the measurement (and its "peak at the end" test) stays
// inside every variant's window.
const win = new Map<string, { back: number; ahead: number }>();   // a variant and place of each stop, for OSM
const stopInfo = new Map<string, { name: string; lat: number; lon: number; lines: Set<string>; road: number }>();
for (const l of lines) for (const [vid, v] of Object.entries(l.variants)) {
  if (!v.shape?.length || v.stops.length < 3) continue;
  const pts = v.shape as LatLon[], cum = cumulative(pts);
  const at = v.stops.map(id => l.stops[id]);
  const s = projectStops(pts, cum, at.map(p => [p.lat, p.lon] as LatLon));
  const stops: StopOn[] = [];
  v.stops.forEach((id, k) => {
    const info = stopInfo.get(id) ?? { name: at[k].name.trim(), lat: at[k].lat, lon: at[k].lon, lines: new Set<string>(), road: Infinity };
    info.lines.add(l.id);
    info.road = Math.min(info.road, projectOn(pts, cum, [at[k].lat, at[k].lon]).d);
    stopInfo.set(id, info);
    // First and last stops: layovers look like halts. A stop the route order could not place (before the
    // stop behind it or after the one ahead): skip.
    if (k === 0 || k === v.stops.length - 1 || !Number.isFinite(s[k]) || s[k] < s[k - 1] || s[k] > s[k + 1]) return;
    const clamp = (x: number) => Math.max(MIN_WIN_M, Math.min(MAX_WIN_M, x / 2));
    const w = { back: clamp(s[k] - s[k - 1]), ahead: clamp(s[k + 1] - s[k]) };
    stops.push({ id, s: s[k], ...w });
    const was = win.get(id);
    win.set(id, was ? { back: Math.min(was.back, w.back), ahead: Math.min(was.ahead, w.ahead) } : w);
    if (!homeOf.has(id)) homeOf.set(id, { shape: vid, s: s[k] });
  });
  shapes.set(vid, { pts, cum, stops: stops.sort((a, b) => a.s - b.s) });
}

// Place a point on its shape near the backend's metres along (the backend's shape may differ a little:
// |difference| p90 ~20 m); the narrow window keeps a loop's other pass out.
function place(sh: ShapeInfo, p: LatLon, hint: number) {
  const near = projectOn(sh.pts, sh.cum, p, hint - 150, hint + 150);
  return near.d <= OFF_SHAPE_M ? near : projectOn(sh.pts, sh.cum, p);
}
// The stops whose window holds s (stops sorted by s; windows are short).
function stopsAround(sh: ShapeInfo, s: number): StopOn[] {
  let lo = 0, hi = sh.stops.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sh.stops[m].s + sh.stops[m].ahead < s) lo = m + 1; else hi = m; }
  const out: StopOn[] = [];
  for (let i = lo; i < sh.stops.length && sh.stops[i].s - sh.stops[i].back <= s; i++)
    if (s >= sh.stops[i].s - sh.stops[i].back && s <= sh.stops[i].s + sh.stops[i].ahead) out.push(sh.stops[i]);
  return out;
}

// Every fix near a stop is a sample: a bus spends its dwell at the stop, so fixes pile up there (a
// fix every 30-90 s rarely catches two in one dwell). At most PER_TRIP fixes per trip and stop: a bus
// standing for an hour must not outweigh a hundred passes.
const PER_TRIP = 3;
const samples = new Map<string, Sample[]>();
const perTrip = new Map<string, number>();
const runs = new Map<string, { shape: string; first: Fix; last: Fix }>();   // per vehicle+trip: a pass covers [first, last]
const shift: number[] = [];   // |our s - backend s|, a check of the two shapes
let rows = 0, wrongVersion = 0, offShape = 0, unknownShape = 0, capped = 0;
const files = readdirSync(histDir).filter(f => /^\d{4}-\d\d-\d\dT\d\d\.csv(\.gz)?$/.test(f)).sort();
for (const f of files) {
  const raw = readFileSync(join(histDir, f));
  const text = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  for (const l of text.split("\n").slice(1)) {
    const c = l.split(",");
    if (c.length < 11 || c[8] === "" || c[9] === "" || +c[9] < 0) continue;   // not on a shape
    if (c[6] !== index.gtfs_version) { wrongVersion++; continue; }
    const x: Fix = { t: +c[0], veh: c[3], trip: c[7], shape: c[8], lat: +c[4] / 1e6, lon: +c[5] / 1e6, s: +c[9] };
    rows++;
    const k = `${x.veh}|${x.trip}|${x.shape}`, r = runs.get(k);
    if (!r) runs.set(k, { shape: x.shape, first: x, last: x });
    else if (x.t > r.last.t) r.last = x;
    else if (x.t < r.first.t) r.first = x;
    const sh = shapes.get(x.shape);
    if (!sh) { unknownShape++; continue; }
    const p = place(sh, [x.lat, x.lon], x.s);
    if (p.d > OFF_SHAPE_M) { offShape++; continue; }
    if (shift.length < 20000) shift.push(Math.abs(p.s - x.s));
    for (const st of stopsAround(sh, p.s)) {
      const key = `${k}|${st.id}`, n = perTrip.get(key) ?? 0;
      if (n >= PER_TRIP) { capped++; continue; }
      perTrip.set(key, n + 1);
      const v = samples.get(st.id) ?? [];
      v.push({ a: p.s - st.s, lat: x.lat, lon: x.lon, day: dayOf(x.t) });
      samples.set(st.id, v);
    }
  }
}
const passes = new Map<string, number>();
for (const r of runs.values()) {
  const sh = shapes.get(r.shape);
  if (!sh || r.last.t - r.first.t < 60) continue;
  const a = place(sh, [r.first.lat, r.first.lon], r.first.s).s, b = place(sh, [r.last.lat, r.last.lon], r.last.s).s;
  for (const st of sh.stops) if (st.s - st.back > a && st.s + st.ahead < b) passes.set(st.id, (passes.get(st.id) ?? 0) + 1);
}

// Per stop: one measurement over all its variants' halts (each already placed on its own variant).
const measured = new Map<string, Measure>();
for (const [id, v] of samples) { const w = win.get(id)!; measured.set(id, measure(v, w.back, w.ahead)); }
// DUMP=<id,id,…>: the samples of those stops, for a look by hand (samples.json next to the history dir).
if (process.env.DUMP) writeFileSync(join(histDir, "..", "samples.json"), JSON.stringify(Object.fromEntries(process.env.DUMP.split(",").map(id => [id, samples.get(id) ?? []]))));
const median = (v: number[]) => { const s = [...v].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const high = [...measured.values()].filter(m => m.confidence === "high");
const bias = median(high.map(m => m.along));

// OSM=<overpass json of bus stops>: each OSM stop whose ref is the GTFS id, as metres along the route
// from the GTFS stop (OSM positions are mapped by hand, independent of the GTFS: a check, not a truth).
const osmAlong = new Map<string, number>();
const osmAt = new Map<string, LatLon>();
if (process.env.OSM) {
  for (const e of JSON.parse(readFileSync(process.env.OSM, "utf8")).elements as { lat: number; lon: number; tags?: Record<string, string> }[]) {
    const id = e.tags?.ref, h = id ? homeOf.get(id) : undefined;
    if (!id || !h) continue;
    const sh = shapes.get(h.shape)!, p = projectOn(sh.pts, sh.cum, [e.lat, e.lon], h.s - 150, h.s + 150);
    if (p.d <= 40 && (!osmAlong.has(id) || Math.abs(p.s - h.s) < Math.abs(osmAlong.get(id)!))) { osmAlong.set(id, p.s - h.s); osmAt.set(id, [e.lat, e.lon]); }
  }
}

interface Row { id: string; m: Measure; off: number; dAlong: number; suspect: boolean; osm: string }
// What OSM says about a suspect: agrees (the OSM stop within OSM_AGREE_M of the GPS halt point), gtfs
// (within 10 m of the GTFS position: be careful), other (elsewhere), none (no OSM stop with this ref).
const osmVerdict = (id: string, m: Measure) => {
  const o = osmAt.get(id), s = stopInfo.get(id)!;
  return !o ? "none" : distM(o, [m.lat, m.lon]) <= OSM_AGREE_M ? "agrees" : distM(o, [s.lat, s.lon]) < 10 ? "gtfs" : "other";
};
const table: Row[] = [];
for (const [id, m] of measured) {
  const s = stopInfo.get(id)!;
  const off = m.halts ? distM([s.lat, s.lon], [m.lat, m.lon]) : NaN;
  const dAlong = m.along - bias;
  const suspect = m.confidence === "high" && !m.edge && Math.abs(dAlong) >= SUSPECT_ALONG_M && m.atStop < MAX_AT_STOP;
  table.push({ id, m, off, dAlong, suspect, osm: suspect ? osmVerdict(id, m) : "" });
}
table.sort((a, b) => Math.abs(b.dAlong || 0) - Math.abs(a.dAlong || 0));

const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : "");
const f6 = (x: number) => (Number.isFinite(x) ? x.toFixed(6) : "");
const csvName = (s: string) => `"${s.replace(/"/g, '""')}"`;
const HEAD = "stop_id,name,gtfs_lat,gtfs_lon,halt_lat,halt_lon,along_m,along_vs_bias_m,offset_m,road_m,halts,window,passes,second_peak,at_stop,edge,confidence,suspect,osm_along_m,osm_check,lines";
const line = (r: Row) => {
  const s = stopInfo.get(r.id)!;
  return [r.id, csvName(s.name), s.lat, s.lon, f6(r.m.lat), f6(r.m.lon), f1(r.m.along), f1(r.dAlong), f1(r.off), f1(s.road),
    r.m.halts, r.m.window, passes.get(r.id) ?? 0, r.m.second.toFixed(2), r.m.atStop.toFixed(2), r.m.edge ? 1 : 0, r.m.confidence, r.suspect ? 1 : 0, f1(osmAlong.get(r.id) ?? NaN), r.osm, csvName([...s.lines].sort().join(" "))].join(",");
};
const byId = (a: Row, b: Row) => a.id.localeCompare(b.id, "en", { numeric: true });
writeFileSync(join(OUT, "measured.csv"), [HEAD, ...[...table].sort(byId).map(line)].join("\n") + "\n");
// Suspects: the ones OSM confirms first (the list worth sending on), then GPS only, then OSM against.
const TIER = ["agrees", "other", "none", "gtfs"];
const suspects = table.filter(r => r.suspect).sort((a, b) => TIER.indexOf(a.osm) - TIER.indexOf(b.osm) || Math.abs(b.dAlong) - Math.abs(a.dAlong));
writeFileSync(join(OUT, "suspect-stops.csv"), [HEAD, ...suspects.map(line)].join("\n") + "\n");

const count = (c: string) => table.filter(r => r.m.confidence === c).length;
const q = (v: number[], p: number) => { const s = [...v].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const absHigh = high.map(m => Math.abs(m.along - bias));
const hours = files.length, first = files[0]?.slice(0, 13), last = files.at(-1)?.slice(0, 13);
console.log(JSON.stringify({
  history: { hours, from: first, to: last, fixes: rows, wrongVersion, unknownShape, offShape, capped, shapeShiftP50: f1(q(shift, 0.5)), shapeShiftP90: f1(q(shift, 0.9)) },
  gtfs: index.gtfs_version, stops: stopInfo.size, measured: table.length,
  confidence: { high: count("high"), medium: count("medium"), low: count("low") },
  biasAlongM: f1(bias),
  highAbsAlongVsBias: { p50: f1(q(absHigh, 0.5)), p90: f1(q(absHigh, 0.9)), over10: absHigh.filter(x => x >= 10).length, over20: absHigh.filter(x => x >= 20).length, over30: absHigh.filter(x => x >= 30).length },
  suspect: table.filter(r => r.suspect).length,
  suspectByOsm: Object.fromEntries(["agrees", "gtfs", "other", "none"].map(k => [k, table.filter(r => r.suspect && r.osm === k).length])),
  ...osmCheck(),
}, null, 1));

// How the GPS peak and the GTFS position each compare with OSM, over high-confidence stops with an OSM stop.
function osmCheck() {
  const h = table.filter(r => r.m.confidence === "high" && !r.m.edge && osmAlong.has(r.id));
  if (!h.length) return {};
  const gps = h.map(r => Math.abs(r.dAlong - osmAlong.get(r.id)!)), gtfs = h.map(r => Math.abs(osmAlong.get(r.id)!));
  return { osmCheck: { stops: h.length, gpsToOsmP50: f1(q(gps, 0.5)), gtfsToOsmP50: f1(q(gtfs, 0.5)),
    gpsCloserToOsm: h.filter((_, i) => gps[i] + 5 < gtfs[i]).length, gtfsCloserToOsm: h.filter((_, i) => gtfs[i] + 5 < gps[i]).length } };
}
