// The line card's stop strip: every stop of the shown direction, its vehicles between the stops, its slow
// gaps (docs/mockups/line-strip-v1.html). Pure: no DOM, no fetch.
import { cumulativeLL, project } from "./motion";
import type { QualityLevel, Segment } from "./liveQuality";
import { vehicleDir, type V2Pattern, type V2Vehicle } from "./v2";

// The gap's words: how much slower than usual, and the two speeds in km/h.
export function gapText(s: { level: string; speed: number; usual_speed: number | null }): string {
  const how = s.level === "much_worse" ? "πολύ πιο αργό" : "πιο αργό";
  const usual = typeof s.usual_speed === "number" && Number.isFinite(s.usual_speed)
    ? `, συνήθως ${Math.round(s.usual_speed * 3.6)}` : "";
  return `${how}: ${Math.round(s.speed * 3.6)} km/h${usual}`;
}

// Vehicles too close on the strip to tap apart become one icon («2 κολλητά»), drawn from its first item's y and
// `step` pixels taller per further item: in y order, an item joins the cluster before it when it is less than
// `near` pixels below that cluster's last item or its drawn bottom, whichever is lower.
export function clusters<T>(items: T[], y: (t: T) => number, near = 22, step = 0): T[][] {
  const out: T[][] = [];
  let last = -Infinity;
  for (const t of [...items].sort((p, q) => y(p) - y(q))) {
    const c = out.at(-1);
    if (c && y(t) - last < near) c.push(t); else out.push([t]);
    const g = out.at(-1)!;
    last = Math.max(y(t), y(g[0]) + (g.length - 1) * step);
  }
  return out;
}

// The worst level of a cluster, for its one ring.
const RANK: Record<QualityLevel, number> = { unknown: 0, normal: 1, worse: 2, much_worse: 3 };
export function worst(levels: (QualityLevel | undefined)[]): QualityLevel | undefined {
  let w: QualityLevel | undefined;
  for (const l of levels) if (l && (!w || RANK[l] > RANK[w])) w = l;
  return w;
}

export interface Strip {
  pattern: V2Pattern;
  stops: string[];
  gaps: ({ level: "worse" | "much_worse"; text: string } | null)[];
  vehicles: { v: V2Vehicle; at: number }[];
  elsewhere: V2Vehicle[];
}

// A pattern's shape [lon, lat] and where each of its stops is along it, by the stop's place in the pattern:
// each projected on the shape after the stop before it, so a street passed twice (out and back, a loop)
// keeps the stops in order. Worked out once per pattern (a line card rebuilds on every poll; its static data
// does not change).
type Along = { geom: [number, number][]; cum: number[]; at: (number | null)[] };
const alongOf = new WeakMap<V2Pattern, Along>();
function along(p: V2Pattern, stops: Record<string, { lat: number; lon: number }>): Along {
  let r = alongOf.get(p);
  if (r) return r;
  const geom = p.shape.map(([lat, lon]): [number, number] => [lon, lat]), cum = cumulativeLL(geom);
  r = { geom, cum, at: [] };
  let lo = 0;
  for (const id of p.stops) {
    const st = stops[id];
    if (!st) { r.at.push(null); continue; }
    lo = within(r, [st.lon, st.lat], lo, Infinity).s;
    r.at.push(lo);
  }
  alongOf.set(p, r);
  return r;
}

// The nearest point of the shape between lo and hi metres along it (each leg cut to that range before the
// projection); of points within 20 m of as near, the first.
function within(a: Pick<Along, "geom" | "cum">, pt: [number, number], lo: number, hi: number): { s: number; off: number } {
  const { geom, cum } = a, kx = Math.cos(pt[1] * Math.PI / 180);
  const hits: { s: number; off: number }[] = [];
  for (let i = 1; i < geom.length; i++) {
    const c0 = cum[i - 1], c1 = cum[i];
    if (c1 < lo || c0 > hi) continue;
    const g = geom[i - 1], h = geom[i], L = c1 - c0;
    const ax = (g[0] - pt[0]) * kx, ay = g[1] - pt[1], dx = (h[0] - g[0]) * kx, dy = h[1] - g[1], len = dx * dx + dy * dy;
    const t0 = L > 0 ? Math.max(0, (lo - c0) / L) : 0, t1 = L > 0 ? Math.min(1, (hi - c0) / L) : 0;
    const t = len ? Math.max(t0, Math.min(t1, -(ax * dx + ay * dy) / len)) : t0;
    hits.push({ s: c0 + t * L, off: Math.hypot(ax + t * dx, ay + t * dy) * 111_320 });
  }
  if (!hits.length) return { s: lo, off: Infinity };
  const best = Math.min(...hits.map(x => x.off));
  return hits.find(x => x.off <= best + 20)!;
}

// Where a vehicle is between the strip's stops: the index of the stop it has passed, plus its share of the
// way to the next stop that has a place. A vehicle with a next stop is first looked for on the piece of shape
// up to that stop (the right pass of a street passed twice). Too far off the shape: null.
function place(v: V2Vehicle, a: Along, list: string[]): number | null {
  const pt: [number, number] = [v.position.lon, v.position.lat], off = a.at;
  let p: { s: number; off: number } | null = null;
  // Every place of the next stop in the pattern (a loop passes its first stop again at the end): the nearest fit.
  list.forEach((id, n) => {
    if (id !== v.next_stop) return;
    let b = n - 1;
    while (b >= 0 && off[b] == null) b--;
    const q = within(a, pt, b >= 0 ? off[b]! : 0, off[n] ?? Infinity);
    if (q.off <= 150 && (!p || q.off < p.off)) p = q;
  });
  p ??= project(a.geom, a.cum, pt);
  if (p.off > 150) return null;
  let k = -1;
  for (let i = 0; i < off.length; i++) { const x = off[i]; if (x != null && x <= p.s) k = i; }
  if (k < 0) return 0;                             // before the first stop
  let j = k + 1;
  while (j < off.length && off[j] == null) j++;
  if (j >= off.length) return k;                   // at or past the last
  const d = off[j]! - off[k]!;
  const at = k + (d > 0 ? (j - k) * (p.s - off[k]!) / d : 0);
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
    let at = place(v, a, list);
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
