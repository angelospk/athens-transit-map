// Live quality levels of contract rev 23 (staseis-rt docs/QUALITY.md): the level of each vehicle of a
// detailed line, and the slow segments of its route. Athens and Thessaloniki only (OASA buses and
// trolleys); elsewhere the app keeps its delay dot. Pure: no DOM, no fetch.
import type { FeatureCollection, LineString } from "geojson";
import { cumulativeLL, project, subLine } from "./motion";
import type { DrawnLine } from "./map/layers";
import type { Stop, Variant } from "./types";
import { gapText } from "./stopStrip";

export type QualityLevel = "normal" | "worse" | "much_worse" | "unknown";

export interface VehicleQuality {
  level: QualityLevel;
  basis: "headway" | "schedule" | null;   // the measure behind the level
  gap_s: number | null;                  // headway basis: the gap to the bus ahead
  usual_headway_s: number | null;
  stop: string | null;
  bunched: boolean;                      // two buses together: the gap does not tell the wait
  early: boolean;
}

// One pair of stops of one pattern, as the backend measured it.
export interface Segment {
  pattern: string;
  from: string;
  to: string;
  level: QualityLevel;
  ratio: number | null;      // speed / usual speed
  speed: number;             // m/s
  usual_speed: number | null; // m/s
  n: number;                 // measured runs
}

export const hasLiveQuality = (city: string) => city === "athens" || city === "thessaloniki";

export function levelClass(l: unknown): "ontime" | "late1" | "late3" | "none" {
  return l === "normal" ? "ontime" : l === "worse" ? "late1" : l === "much_worse" ? "late3" : "none";
}

const DASH = "—";
const unknownText = (): { text: string; level: QualityLevel } => ({ text: DASH, level: "unknown" });
const liveLevel = (l: unknown): l is Exclude<QualityLevel, "unknown"> =>
  l === "normal" || l === "worse" || l === "much_worse";

// The vehicle row's words: the gap to the bus ahead, or the delay, in whole minutes. No quality object
// (an older backend, the metro, a citybus.gr city) is null, and the caller keeps the delay text.
export function vehiclePhrase(q: VehicleQuality | null | undefined, delay_s: number | null): { text: string; level: QualityLevel } | null {
  if (!q) return null;
  if (!liveLevel(q.level)) return unknownText();
  const level = q.level;
  if (q.basis === "headway") {
    if (typeof q.gap_s !== "number" || !Number.isFinite(q.gap_s)) return unknownText();
    if (q.bunched) return { text: "κολλητά", level };
    return { text: `${Math.max(1, Math.round(q.gap_s / 60))}′ μετά`, level };
  }
  if (q.basis === "schedule") {
    if (typeof delay_s !== "number" || !Number.isFinite(delay_s)) return unknownText();
    const m = Math.floor(Math.abs(delay_s) / 60);   // whole minutes; under one is still on time
    if (m === 0) return { text: "στην ώρα", level };
    return { text: q.early || delay_s < 0 ? `νωρίτερα ${m}′` : `+${m}′`, level };
  }
  return unknownText();
}

// The levels the map's vehicles ask for: key "line/native vehicle id", as the fleet keys them.
export function levelsByKey(line: string, vehicles: { id: string; quality?: VehicleQuality | null }[]): Map<string, QualityLevel> {
  const out = new Map<string, QualityLevel>();
  for (const v of vehicles) {
    const id = v.id.slice(v.id.indexOf(":") + 1);
    out.set(`${line}/${id}`, liveLevel(v.quality?.level) ? v.quality!.level : "unknown");
  }
  return out;
}

const stripNs = (id: string) => id.slice(id.indexOf(":") + 1);
const flip = ([lat, lon]: [number, number]): [number, number] => [lon, lat];

export interface HaloProperties {
  line: string;
  level: QualityLevel;
  from: string;
  to: string;
  speed: number;
  usual: number | null;
}

// A variant's shape and where each of its stops is along it, by the stop's place in the pattern (a loop passes
// a stop twice): each projected near the one before it, so a street passed twice takes the right pass. Worked
// out once per variant (a line is polled every 20 s; its static data does not change).
type Along = { geom: [number, number][]; cum: number[]; at: (number | null)[] };
const alongOf = new WeakMap<Variant, Along>();
function along(v: Variant, stops: Record<string, Stop>): Along {
  let r = alongOf.get(v);
  if (r) return r;
  const geom = v.shape.map(flip), cum = cumulativeLL(geom);
  let hint: number | undefined;
  const at = v.stops.map(id => {
    const st = stops[id];
    if (!st) { hint = undefined; return null; }
    hint = project(geom, cum, [st.lon, st.lat], hint).s;
    return hint;
  });
  alongOf.set(v, (r = { geom, cum, at }));
  return r;
}

// The slow segments of the drawn lines as a halo under the route: only worse and much_worse, cut from
// stop to stop. A segment of a pattern that is not drawn, or of stops that do not follow each other in
// it, gets none; the same stop pair of two patterns is drawn once.
export function haloFC(lines: DrawnLine[], segs: Map<string, Segment[]>): FeatureCollection<LineString> {
  const features: FeatureCollection<LineString>["features"] = [];
  for (const l of lines) {
    const list = segs.get(l.id);
    if (!list) continue;
    const seen = new Set<string>();
    for (const s of list) {
      if (s.level !== "worse" && s.level !== "much_worse") continue;
      const variant = stripNs(s.pattern);
      const v = l.data.variants[variant];
      if (!v || (l.visible && !l.visible.has(variant))) continue;
      const from = stripNs(s.from), to = stripNs(s.to);
      const pair = `${from}|${to}`;
      if (seen.has(pair)) continue;
      const i = v.stops.findIndex((x, k) => x === from && v.stops[k + 1] === to);
      if (i < 0) continue;
      const a = l.data.stops[from], b = l.data.stops[to];
      if (!a || !b) continue;
      const { geom, cum, at } = along(v, l.data.stops);
      const sFrom = at[i], sTo = at[i + 1];
      if (sFrom == null || sTo == null) continue;
      const coords = subLine(geom, cum, sFrom, sTo);
      if (coords.length < 2) continue;
      seen.add(pair);
      features.push({
        type: "Feature",
        properties: { line: l.id, level: s.level, from: a.name, to: b.name, speed: s.speed, usual: s.usual_speed },
        geometry: { type: "LineString", coordinates: coords },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

// The segment's words: the stops, how much slower than usual, and the two speeds in km/h.
export function segmentText(p: { level: string; from: string; to: string; speed: number; usual: number | null }): string {
  return `${p.from} → ${p.to} · ${gapText({ level: p.level, speed: p.speed, usual_speed: p.usual })}`;
}
