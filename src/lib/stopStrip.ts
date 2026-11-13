// The line card's stop strip: every stop of the shown direction, its vehicles between the stops, its slow
// gaps (docs/mockups/line-strip-v1.html). Pure: no DOM, no fetch.
import { cumulativeLL, project } from "./motion";
import type { Segment } from "./liveQuality";
import { vehicleDir, type V2Pattern, type V2Vehicle } from "./v2";

// The gap's words: how much slower than usual, and the two speeds in km/h.
export function gapText(s: { level: string; speed: number; usual_speed: number | null }): string {
  const how = s.level === "much_worse" ? "πολύ πιο αργό" : "πιο αργό";
  const usual = typeof s.usual_speed === "number" && Number.isFinite(s.usual_speed)
    ? `, συνήθως ${Math.round(s.usual_speed * 3.6)}` : "";
  return `${how}: ${Math.round(s.speed * 3.6)} km/h${usual}`;
}

export interface Strip {
  pattern: V2Pattern;
  stops: string[];
  gaps: ({ level: "worse" | "much_worse"; text: string } | null)[];
  vehicles: { v: V2Vehicle; at: number }[];
  elsewhere: V2Vehicle[];
}

// A pattern's shape [lon, lat] and where each of its stops is along it, by the stop's place in the pattern:
// each projected near the one before it, so a street passed twice takes the right pass. Worked out once
// per pattern (a line card rebuilds on every poll; its static data does not change).
type Along = { geom: [number, number][]; cum: number[]; at: (number | null)[] };
const alongOf = new WeakMap<V2Pattern, Along>();
function along(p: V2Pattern, stops: Record<string, { lat: number; lon: number }>): Along {
  let r = alongOf.get(p);
  if (r) return r;
  const geom = p.shape.map(([lat, lon]): [number, number] => [lon, lat]), cum = cumulativeLL(geom);
  let hint: number | undefined;
  const at = p.stops.map(id => {
    const st = stops[id];
    if (!st) { hint = undefined; return null; }
    hint = project(geom, cum, [st.lon, st.lat], hint).s;
    return hint;
  });
  alongOf.set(p, (r = { geom, cum, at }));
  return r;
}

// Where a vehicle is between the strip's stops: the index of the stop it has passed, plus its share of the
// way to the next one. A vehicle too far off the shape is placed by its next stop, half a stop before it.
function place(v: V2Vehicle, a: Along): number | null {
  const p = project(a.geom, a.cum, [v.position.lon, v.position.lat]);
  if (p.off > 150) return null;
  const off = a.at;
  let k = -1;
  for (let i = 0; i < off.length; i++) { const x = off[i]; if (x != null && x <= p.s) k = i; }
  if (k < 0) return 0;                             // before the first stop
  if (k === off.length - 1) return k;              // at or past the last
  let j = k + 1;
  while (j < off.length && off[j] == null) j++;
  if (j >= off.length) return k;
  const d = off[j]! - off[k]!;
  const at = k + (d > 0 ? (p.s - off[k]!) / d : 0);
  return Math.max(k, Math.min(j, at));
}

export function stopStrip(
  patterns: V2Pattern[], stops: Record<string, { lat: number; lon: number }>,
  vehicles: V2Vehicle[], segments: Segment[], dir: 0 | 1,
): Strip | null {
  const mine = patterns.filter(p => p.direction === dir);
  const pattern = mine.reduce<V2Pattern | null>((best, p) => !best || p.stops.length > best.stops.length ? p : best, null);
  if (!pattern) return null;
  const list = pattern.stops;
  const gaps = list.slice(0, -1).map((from, i) => {
    const to = list[i + 1];
    const s = segments.find(x => x.from === from && x.to === to && (x.level === "worse" || x.level === "much_worse"));
    return s ? { level: s.level as "worse" | "much_worse", text: gapText(s) } : null;
  });
  const a = along(pattern, stops);
  const keep = vehicles.filter(v => { const d = vehicleDir(v, patterns); return d === null || d === dir; });
  const shown: { v: V2Vehicle; at: number }[] = [], elsewhere: V2Vehicle[] = [];
  for (const v of keep) {
    let at = place(v, a);
    if (at == null) {
      const k = v.next_stop ? list.indexOf(v.next_stop) : -1;
      if (k < 0) { elsewhere.push(v); continue; }
      at = Math.max(0, k - 0.5);
    }
    shown.push({ v, at });
  }
  shown.sort((x, y) => x.at - y.at);
  return { pattern, stops: list, gaps, vehicles: shown, elsewhere };
}
