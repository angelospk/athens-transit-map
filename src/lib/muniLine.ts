// One tile per «δημοτική» line: the OSM routes that serve it (both directions), the timetable lines that
// cover them, today's runs at a stop, and a rough position for the buses the timetable implies. There is no
// live data, so a position is a guess from the published time and an assumed speed, never a claim.
import { athensClock, activeServices } from "./muniTimes";
import type { Clock, MuniTimetable, MuniLine } from "./muniTimes";
import type { MunicipalData, MunicipalRoute, MunicipalStop } from "./municipal";
import { fold } from "./search";

const min = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// "Δημοτικό Λεωφορείο 010: Α → Β" names the service, not the road: a card shows what is left.
const PREFIX = /^(Δημοτικό Λεωφορείο|Γραμμή)[^:]*:\s*/;
const bare = (name: string) => name.replace(PREFIX, "").trim();
const afterArrow = (name: string) => {
  const i = name.lastIndexOf("→");
  return i < 0 ? name.trim() : name.slice(i + 1).trim();
};

export interface MuniCard {
  id: string; ref: string | null; name: string; municipality: string;
  routes: MunicipalRoute[]; table: MuniTimetable | null; lines: MuniLine[];
}

const byId = (a: MunicipalRoute, b: MunicipalRoute) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// The routes of one card: the two directions of a line, found by ref (inside one municipality), by the
// timetable line that lists them, and by the ref or group that two timetable lines share.
export function muniCards(d: MunicipalData, tables: MuniTimetable[]): MuniCard[] {
  const routes = d.routes;
  const parent = routes.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const join = (a: number, b: number) => {
    const ra = root(a), rb = root(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  const seen = new Map<string, number>();
  const at = (key: string, i: number) => {
    const j = seen.get(key);
    if (j === undefined) seen.set(key, i); else join(i, j);
  };

  routes.forEach((r, i) => {
    if (r.ref) at(`ref|${r.municipality}|${r.ref}`, i);
  });
  tables.forEach((table, ti) => {
    table.lines.forEach((line, li) => {
      line.routes.forEach(rid => {
        const i = routes.findIndex(r => r.id === rid);
        if (i >= 0) at(`line|${ti}|${li}`, i);   // every route of one line joins the others
      });
      const first = routes.findIndex(r => line.routes.includes(r.id));
      if (first < 0) return;
      if (line.ref) at(`tref|${ti}|${line.ref}`, first);
      if (line.group) at(`tgroup|${ti}|${line.group}`, first);
    });
  });

  const groups = new Map<number, MunicipalRoute[]>();
  routes.forEach((r, i) => {
    const k = root(i);
    const list = groups.get(k);
    if (list) list.push(r); else groups.set(k, [r]);
  });

  const out: MuniCard[] = [];
  for (const list of groups.values()) {
    const table = tables.find(t => t.lines.some(l => l.routes.some(rid => list.some(r => r.id === rid)))) ?? null;
    const ids = new Set(list.map(r => r.id));
    const lines = table ? table.lines.filter(l => l.routes.some(rid => ids.has(rid))) : [];

    const ordered: MunicipalRoute[] = [];
    for (const l of lines) for (const rid of l.routes) {
      const r = list.find(x => x.id === rid);
      if (r && !ordered.includes(r)) ordered.push(r);
    }
    const rest = list.filter(r => !ordered.includes(r)).sort(byId);
    const cardRoutes = [...ordered, ...rest];

    const ref = lines.find(l => l.ref)?.ref ?? cardRoutes.find(r => r.ref)?.ref ?? null;
    const smallest = cardRoutes.map(r => r.id).sort()[0].replace(/^osm:/, "");
    const group = lines.find(l => l.group)?.group ?? null;
    const name = group ?? (lines.length === 1 ? lines[0].name
      : lines.length ? lines[0].name.replace(/→/g, "↔") : bare(cardRoutes[0].name));

    out.push({
      id: `muni:${smallest}`, ref, name, municipality: cardRoutes[0].municipality,
      routes: cardRoutes, table, lines,
    });
  }
  return out;
}

// Where a direction goes: the end of the one timetable line that is only this route, else the end of its OSM
// name («Δημοτικό Λεωφορείο 010: ΗΣΑΠ → Φιλοθέη» goes to Φιλοθέη).
export function routeLabel(r: MunicipalRoute, lines: MuniLine[]): string {
  const mine = lines.filter(l => l.routes.includes(r.id));
  return afterArrow(mine.length === 1 && mine[0].routes.length === 1 ? mine[0].name : bare(r.name));
}

export interface TodayRun { time: string; at: string | null; approx: boolean; past: boolean }

// Every departure today of the lines that list this route, the frequencies spelled out, earliest first.
export function todayRuns(lines: MuniLine[], routeId: string, clock: Clock): TodayRun[] {
  const all: { min: number; at: string | null; time: string; approx: boolean }[] = [];
  for (const line of lines) {
    if (!line.routes.includes(routeId)) continue;
    for (const s of activeServices(line, clock)) {
      const at = s.at ?? null;
      if (s.times) {
        for (const t of s.times) all.push({ min: min(t), at, time: t, approx: false });
      } else if (s.every && s.first && s.last) {
        for (let m = min(s.first); m <= min(s.last); m += s.every) all.push({ min: m, at, time: hhmm(m), approx: true });
      }
    }
  }
  all.sort((a, b) => a.min - b.min);
  const out: TodayRun[] = [];
  for (const { min: m, at, time, approx } of all) {
    if (out.some(o => o.time === time && o.at === at)) continue;
    out.push({ time, at, approx, past: m < clock.minutes });
  }
  return out;
}

// The distance between two [lat, lon] points in km.
const R = 6371;
const rad = (x: number) => (x * Math.PI) / 180;
function km(a: [number, number], b: [number, number]): number {
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const gap = (a: [number, number], b: [number, number]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
const same = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

// OSM gives a route as unordered pieces: join them into one path, each time taking the piece that fits either
// end best (turning it round when its far end is the nearer one). Which way the path runs is left to the stops.
export function stitch(parts: [number, number][][]): [number, number][] {
  const pieces = parts.filter(p => p.length).map(p => p.slice());
  if (!pieces.length) return [];
  let path = pieces.shift()!;
  while (pieces.length) {
    const head = path[0], end = path[path.length - 1];
    let best = 0, bestGap = Infinity, atHead = false, reverse = false;
    pieces.forEach((p, i) => {
      const options: [number, boolean, boolean][] = [
        [gap(end, p[0]), false, false], [gap(end, p[p.length - 1]), false, true],
        [gap(head, p[p.length - 1]), true, false], [gap(head, p[0]), true, true],
      ];
      for (const [d, h, r] of options) if (d < bestGap) { bestGap = d; best = i; atHead = h; reverse = r; }
    });
    const piece = pieces.splice(best, 1)[0];
    if (reverse) piece.reverse();
    if (atHead) path = [...(same(piece[piece.length - 1], head) ? piece.slice(0, -1) : piece), ...path];
    else path.push(...(same(end, piece[0]) ? piece.slice(1) : piece));
  }
  return path;
}

export interface SimVehicle { id: string; lat: number; lon: number; bearing: number; dep: string; at: string | null }

type Geom = { points: [number, number][]; cum: number[]; seg: number[]; total: number };

function measure(points: [number, number][]): Geom {
  const seg: number[] = [], cum = [0];
  for (let i = 0; i < points.length - 1; i++) {
    seg.push(km(points[i], points[i + 1]));
    cum.push(cum[i] + seg[i]);
  }
  return { points, cum, seg, total: cum[cum.length - 1] };
}

// The compass bearing of a segment, 0 north, 90 east.
function bearing(a: [number, number], b: [number, number]): number {
  const p1 = rad(a[0]), p2 = rad(b[0]), dl = rad(b[1] - a[1]);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// The point at `d` km along the path, with the bearing of the segment it is on.
function pointAt(g: Geom, d: number): { lat: number; lon: number; bearing: number } {
  const at = Math.max(0, Math.min(d, g.total));
  for (let i = 0; i < g.seg.length; i++) {
    if (at <= g.cum[i + 1] || i === g.seg.length - 1) {
      const t = g.seg[i] > 0 ? (at - g.cum[i]) / g.seg[i] : 0;
      const a = g.points[i], b = g.points[i + 1];
      return { lat: a[0] + (b[0] - a[0]) * t, lon: a[1] + (b[1] - a[1]) * t, bearing: bearing(a, b) };
    }
  }
  const p = g.points[g.points.length - 1];
  return { lat: p[0], lon: p[1], bearing: 0 };
}

// How far along the path a point lies: the nearest point of every segment, in a local flat approximation.
function project(g: Geom, lat: number, lon: number): number {
  const K = 111.195, cos = Math.cos(rad(lat));
  let best = Infinity, along = 0;
  for (let i = 0; i < g.seg.length; i++) {
    const a = g.points[i], b = g.points[i + 1];
    const ax = (a[1] - lon) * cos * K, ay = (a[0] - lat) * K;
    const dx = (b[1] - lon) * cos * K - ax, dy = (b[0] - lat) * K - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d2 = (ax + t * dx) ** 2 + (ay + t * dy) ** 2;
    if (d2 < best) {
      best = d2;
      along = g.cum[i] + t * g.seg[i];
    }
  }
  return along;
}

// Where the buses the timetable implies should be now: from each departure today, at an assumed speed along
// the path, started at the stop its service is timed at. A guess, kept only while it is still on the route.
export function simulate(route: MunicipalRoute, stops: Record<string, MunicipalStop>, lines: MuniLine[],
  ms: number, kmh = 15): SimVehicle[] {
  let path = stitch(route.shape);
  if (path.length < 2) return [];
  let g = measure(path);
  const loop = km(path[0], path[path.length - 1]) <= 0.05;
  const clock = athensClock(ms);
  const now = clock.minutes + ((ms / 1000) % 60) / 60;
  // The route's stops are in the order the bus serves them: the path runs their way (OSM may draw it backwards).
  const known = route.stops.map(id => stops[id]).filter((s): s is MunicipalStop => !!s);
  const named = (at: string) => known.find(s => s.name && (fold(s.name).includes(fold(at)) || fold(at).includes(fold(s.name))));
  if (known.length >= 2) {
    const first = project(g, known[0].lat, known[0].lon), second = project(g, known[loop ? 1 : known.length - 1].lat, known[loop ? 1 : known.length - 1].lon);
    const ahead = loop ? (second - first + g.total) % g.total <= g.total / 2 : second >= first;
    if (!ahead) { path = [...path].reverse(); g = measure(path); }
  } else if (!loop) {
    // One stop or none: an open path runs away from the terminus its first service leaves from, if it is a stop.
    const at = lines.filter(l => l.routes.includes(route.id)).flatMap(l => activeServices(l, clock))[0]?.at;
    const from = at ? named(at) : undefined;
    if (from && project(g, from.lat, from.lon) > g.total / 2) { path = [...path].reverse(); g = measure(path); }
  }
  // Where a service starts: the stop named like its terminus. A terminus not found among the stops is the
  // route's first stop only when the line has no other; else it has no known place (null) and shows no bus,
  // rather than one in the wrong place. Without stops the way round is unknown too.
  const services = lines.filter(l => l.routes.includes(route.id)).flatMap(l => activeServices(l, clock));
  const termini = new Set(services.map(s => s.at ?? null));
  const offsets = new Map<string | null, number | null>();
  const offsetOf = (at: string | null): number | null => {
    if (offsets.has(at)) return offsets.get(at)!;
    const from = (at ? named(at) : undefined) ?? (termini.size === 1 && known.length >= 2 ? known[0] : undefined);
    const offset = from ? project(g, from.lat, from.lon) : null;
    offsets.set(at, offset);
    return offset;
  };

  const out: SimVehicle[] = [];
  for (const run of todayRuns(lines, route.id, clock)) {
    const travelled = ((now - min(run.time)) / 60) * kmh;
    const offset = offsetOf(run.at);
    if (travelled < 0 || offset === null) continue;
    if (loop ? travelled >= g.total : offset + travelled >= g.total) continue;
    const d = loop ? (offset + travelled) % g.total : offset + travelled;
    const p = pointAt(g, d);
    out.push({ id: `${route.id}|${run.at ?? ""}|${run.time}`, lat: p.lat, lon: p.lon, bearing: p.bearing, dep: run.time, at: run.at });
  }
  return out;
}

export interface StopRow {
  card: string; ref: string | null; dir: 0 | 1; to: string; at: string | null; approx: boolean; times: string[];
  timetable: boolean;   // false: the municipality gives no times for this line
}

// A municipal stop's card (MuniStopCard), shaped as a bus stop's: each line and direction through it, one row
// per terminus with its next departures from there (the timetables give no times at the other stops), the
// soonest first; the lines with no times left last.
export function stopRows(stopId: string, d: MunicipalData, cards: MuniCard[], clock: Clock, n = 3): StopRow[] {
  if (!d.stops[stopId]) return [];
  const out: StopRow[] = [];
  for (const c of cards) c.routes.forEach((r, i) => {
    if (i > 1 || !r.stops.includes(stopId)) return;
    const base = { card: c.id, ref: c.ref, dir: i as 0 | 1, to: routeLabel(r, c.lines), timetable: !!c.table };
    // Grouped by terminus over the whole day, so one with no more runs keeps its own (empty) row.
    const byAt = new Map<string | null, TodayRun[]>();
    for (const run of todayRuns(c.lines, r.id, clock)) byAt.set(run.at, [...(byAt.get(run.at) ?? []), run]);
    if (!byAt.size) out.push({ ...base, at: null, approx: false, times: [] });
    for (const [at, runs] of byAt) {
      const next = runs.filter(x => !x.past);
      out.push({ ...base, at, approx: next.some(x => x.approx), times: next.slice(0, n).map(x => x.time) });
    }
  });
  return out.sort((a, b) => (a.times[0] ?? "99") < (b.times[0] ?? "99") ? -1 : (a.times[0] ?? "99") > (b.times[0] ?? "99") ? 1 : 0);
}
