// Bus and trolley stops on the map (from zoom STOPS_ZOOM), out of public/trips.json, and what a tapped
// stop's card shows: the lines that call there, the stop of the same name across the street, and the
// live arrivals (backend GET /v1/stops/{id}) grouped by line and headsign.

// No value import of trip.ts: it loads with the planner only.
import { distanceM } from "./glide";
import { bearingDeg } from "./heading";
import { fold } from "./search";
import type { TripIndex } from "./trip";

export const STOPS_ZOOM = 15;
export const TWIN_M = 200;   // the same name closer than this is the stop across the street
export const ACROSS_M = 100; // another name closer than this, where a shared line runs the other way, is too

export interface StopArrival {
  line: string; headsign: string; variant: string; vehicle: string;
  eta_s: number; at: number; delay_s: number; position_at: number;
  source?: "live" | "schedule";   // contract rev 8; "schedule": a trip with no bus yet
  // rev 8; null: unmatched (trip_id, scheduled) or unknown; missing: an older server
  trip_id?: string | null; scheduled?: number | null; stops_away?: number | null; distance_m?: number | null;
}
// Contract rev 18: how often a line usually passes at this hour of this kind of day, learnt from the past
// weeks; next_at only when the weeks agree and today's timetable has a run near it (the server decides).
export interface Usual {
  line: string; headsign: string; day_type: string; days: number;
  headway_min: number | null; next_hour_headway_min: number | null; next_at: number | null; spread_s: number | null;
}
export interface StopBoard {
  stop: { id: string; name: string; lat: number; lon: number; code?: string };   // code: rev 21, OASA only
  lines: string[];
  arrivals: StopArrival[];
  usual?: Usual[];   // rev 18; missing: an older server
  updated_at: number;
}

// An empty board can mean «not known yet», not «no bus»: after a restart the backend answers 200 with no
// arrivals until it has polled the stop's lines again (rt has no flag for it). So the card shows «Φόρτωση» and
// asks again, past every cache, up to EMPTY_RETRIES times EMPTY_RETRY_MS apart; then it shows the empty board.
// shown: the board on the card now (a live one there means the stop is known: an empty answer is then real).
export const EMPTY_RETRIES = 3, EMPTY_RETRY_MS = 3_000;
export const trustBoard = (b: StopBoard, shown: StopBoard | null, tries: number) =>
  b.arrivals.length > 0 || b.lines.length === 0 || shown != null || tries >= EMPTY_RETRIES;

export function busStopsFC(ix: TripIndex): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return { type: "FeatureCollection", features: ix.s.map(([name, lat, lon], i) =>
    ({ type: "Feature", id: i, geometry: { type: "Point", coordinates: [lon, lat] }, properties: { i, name } })) };
}

// The index of the stop with a GTFS id (a picked line's stops carry ids), or -1.
const byId = new WeakMap<TripIndex, Map<string, number>>();
export function stopIndex(ix: TripIndex, id: string): number {
  let m = byId.get(ix);
  if (!m) byId.set(ix, (m = new Map(ix.s.flatMap(([, , , sid], i) => (sid ? [[sid, i] as [string, number]] : [])))));
  return m.get(id) ?? -1;
}

const byLine = (a: string, b: string) => a.localeCompare(b, "el", { numeric: true });

// The lines that call at stop i, with their variants through it.
export function linesAt(ix: TripIndex, i: number): { line: string; variants: string[] }[] {
  const out: { line: string; variants: string[] }[] = [];
  for (const [line, vs] of Object.entries(ix.l)) {
    const variants = Object.keys(vs).filter(v => vs[v].includes(i));
    if (variants.length) out.push({ line, variants });
  }
  return out.sort((a, b) => byLine(a.line, b.line));
}

// The same from the board alone, until the stop index loads: its lines, with the variants of their arrivals.
export function boardLines(b: StopBoard): { line: string; variants: string[] }[] {
  return b.lines.map(line => ({ line, variants: [...new Set(b.arrivals.filter(a => a.line === line).map(a => a.variant))].sort() }))
    .sort((a, b) => byLine(a.line, b.line));
}

// The lines with a bus on its way, soonest first: their files are loaded ahead, so a tapped bus shows its stops at once.
export function linesToWarm(arrivals: StopArrival[], max = 4): string[] {
  const out: string[] = [];
  for (const a of [...arrivals].sort((x, y) => x.eta_s - y.eta_s)) {
    if (a.source !== "schedule" && !out.includes(a.line)) out.push(a.line);
  }
  return out.slice(0, max);
}

// The stops across the street from stop i, nearest first; m in metres. Either the same name within TWIN_M,
// or (a loop line's «1η/2η ΚΟΜΒΟΣ») another name within ACROSS_M where a line of both runs the other way.
export function twins(ix: TripIndex, i: number): { i: number; m: number }[] {
  const [name, lat, lon] = ix.s[i], key = fold(name);
  const out: { i: number; m: number }[] = [];
  let mine: Map<string, number[]> | undefined;
  ix.s.forEach(([n, la, lo], j) => {
    if (j === i) return;
    const m = distanceM([lon, lat], [lo, la]);
    if (m <= TWIN_M && fold(n) === key) out.push({ i: j, m: Math.round(m) });
    else if (m <= ACROSS_M && !adjacent(ix, i, j)) {
      mine ??= headings(ix, i);
      const theirs = headings(ix, j);
      const opposite = [...mine].some(([line, hs]) => theirs.get(line)?.some(b => hs.some(a => angleDiff(a, b) > 120)));
      if (opposite) out.push({ i: j, m: Math.round(m) });
    }
  });
  return out.sort((a, b) => a.m - b.m);
}

const angleDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

// One stop right after the other on some variant: the next stop the same way, never the one across.
const adjacent = (ix: TripIndex, a: number, b: number) =>
  Object.values(ix.l).some(vs => Object.values(vs).some(seq => seq.some((x, p) => p > 0 && ((x === a && seq[p - 1] === b) || (x === b && seq[p - 1] === a)))));

// Which way each line runs at stop k: per line, the bearing from the stop before to the stop after, per pass.
function headings(ix: TripIndex, k: number): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const at = (x: number): [number, number] => [ix.s[x][2], ix.s[x][1]];
  for (const [line, vs] of Object.entries(ix.l)) {
    for (const seq of Object.values(vs)) {
      seq.forEach((x, p) => {
        if (x !== k || seq.length < 2) return;
        const a = seq[Math.max(0, p - 1)], b = seq[Math.min(seq.length - 1, p + 1)];
        if (a === b) return;
        const list = out.get(line) ?? [];
        list.push(bearingDeg(at(a), at(b)));
        out.set(line, list);
      });
    }
  }
  return out;
}

// Where a bus runs to: OASA headsigns name the route end to end ("ΠΕΙΡΑΙΑΣ - ΣΥΝΤΑΓΜΑ"), the last is the end.
// The places of a headsign: split at " - ", but not inside brackets ("ΛΑΓΚΑΔΑΣ - ΘΕΣ/ΝΙΚΗ (ΛΑΓΚΑΔΑΣ - ΛΑΓΥΝΑ - ΘΕΣ/ΝΙΚΗ)").
function places(headsign: string): string[] {
  const out: string[] = [];
  let depth = 0, from = 0;
  for (let i = 0; i < headsign.length; i++) {
    const c = headsign[i];
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (!depth && headsign.startsWith(" - ", i)) { out.push(headsign.slice(from, i)); from = i + 3; i += 2; }
  }
  out.push(headsign.slice(from));
  return out;
}
export const toward = (headsign: string) => places(headsign).pop()!.trim() || headsign;

// Where a bus of `line`/`variant` at stop k runs to. On a loop the headsign names the turn (OASA: "ΣΤ. ΚΟΡΩΠΙ -
// ... - ΑΥΛΑΚΙ"), the same on both sides of a road; after the turn the bus runs back to the start: back, and to
// is the headsign's first place (or the first stop). The turn: the stop named as the headsign's end, else the
// stop farthest from the start. Anything unknown: the headsign's end.
export function headTo(ix: TripIndex, line: string, variant: string, k: number, headsign: string): { to: string; back: boolean } {
  const end = toward(headsign), plain = { to: destinationOf(ix, line, variant) ?? end, back: false };
  const seq = ix.l[line]?.[variant];
  const p = seq ? seq.indexOf(k) : -1;
  if (!seq || p < 0 || seq.length < 3) return plain;
  const pt = (x: number): [number, number] => [ix.s[x][2], ix.s[x][1]];
  const first = seq[0], last = seq[seq.length - 1];
  if (first !== last) return plain;   // a loop starts and ends at one stop
  const key = fold(end);
  let turn = seq.findIndex(x => fold(ix.s[x][0]) === key);
  if (turn < 0) {
    let far = -1;
    seq.forEach((x, q) => { const d = distanceM(pt(first), pt(x)); if (d > far) { far = d; turn = q; } });
  }
  if (p <= turn) return plain;
  const parts = places(headsign);
  return { to: parts.length > 1 ? parts[0].trim() : ix.s[first][0], back: true };
}

// The variant's end as the stop index has it (destination.ts, built into trips*.json), or null.
export function destinationOf(ix: TripIndex, line: string, variant: string): string | null {
  const k = ix.d?.h?.[line]?.[variant];
  return k == null || ix.d!.n[k] == null ? null : ix.d!.n[k].toLocaleUpperCase("el");
}

// The end of a line at stop k: the end of its variants that pass there (not those that end there), when they
// all have one and it is the same; else null. For a row with no variant, and the lines with no bus near.
export function lineTowardAt(ix: TripIndex, line: string, k: number): string | null {
  const names = new Set<string | null>();
  for (const [v, seq] of Object.entries(ix.l[line] ?? {})) {
    const p = seq.indexOf(k);
    if (p >= 0 && p < seq.length - 1) names.add(destinationOf(ix, line, v));
  }
  return names.size === 1 ? [...names][0] : null;
}

const GONE_MS = 60_000;

// here: at the stop (it is the bus's next one, at most HERE_M away); away: stops to go, from 2;
// est: no trip, a time from speed only. Each is left out when not so or not known.
export interface ArrivalTime { min: number; vehicle: string; late: number; here?: true; away?: number; est?: true }
export interface ArrivalGroup { line: string; headsign: string; variant: string; times: ArrivalTime[] }
export const HERE_M = 50;

export const timeText = (t: ArrivalTime) =>
  t.here ? "στη στάση" : `${t.est ? "~" : ""}${t.min === 0 ? "τώρα" : `${t.min}′`}`;

// Arrivals by line and headsign, soonest first, each with up to 3 times in minutes from `at` (so an
// answer cached a while still counts down); late: the delay in whole minutes. A bus more than GONE_MS past its
// time is left out.
export function arrivalGroups(arrivals: StopArrival[], nowMs: number): ArrivalGroup[] {
  const groups = new Map<string, ArrivalGroup>();
  for (const a of [...arrivals].sort((x, y) => x.at - y.at)) {
    if (a.at * 1000 < nowMs - GONE_MS) continue;   // an old answer kept through failed refreshes
    if (a.source === "schedule") continue;          // the card lists buses only
    const key = `${a.line}|${a.headsign}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { line: a.line, headsign: a.headsign, variant: a.variant, times: [] }));
    if (g.times.length >= 3) continue;
    const t: ArrivalTime = { min: Math.max(0, Math.round((a.at * 1000 - nowMs) / 60_000)), vehicle: a.vehicle, late: Math.round(a.delay_s / 60) };
    if (a.stops_away === 1 && a.distance_m != null && a.distance_m <= HERE_M) t.here = true;
    if (a.stops_away != null && a.stops_away >= 2) t.away = a.stops_away;
    if (a.trip_id === null) { t.est = true; t.late = 0; }
    g.times.push(t);
  }
  return [...groups.values()];
}

// What an alert at stop k watches, per line (AlertForm): each variant through the stop, boarded there.
// i: the stop's place in the variant (near `hint` when it passes twice: a loop), from: k itself.
export function alertLinesAt(ix: TripIndex, k: number, lines?: string[], hint?: Record<string, number>): { line: string; variants: { id: string; i: number; from: number }[] }[] {
  return linesAt(ix, k).filter(l => !lines || lines.includes(l.line)).map(l => ({
    line: l.line,
    variants: l.variants.map(id => {
      const seq = ix.l[l.line][id], h = hint?.[id];
      return { id, i: h != null && seq[h] === k ? h : seq.indexOf(k), from: k };
    }),
  }));
}

// The line under an arrival's headsign: where the bus is (stops to go) and how it runs. est: no trip,
// so no delay to tell; late of 2 minutes or more is late (an early bus is on time). tripless: the city's
// buses never carry a trip (citybus.gr), so one with no trip is a live GPS bus, not an estimate (rt#124).
export function arrivalNote(t: ArrivalTime, tripless = false): { text: string; tone: "ok" | "late" | "muted" } {
  if (t.here) return { text: "στη στάση", tone: "ok" };
  const where = t.away ? [`${t.away} στάσεις πριν`] : [];
  if (t.est && tripless) return { text: [...where, "ζωντανά"].join(" · "), tone: "ok" };
  if (t.est) return { text: [...where, "εκτίμηση"].join(" · "), tone: "muted" };
  if (t.late >= 2) return { text: [...where, `αργεί ${t.late}′`].join(" · "), tone: "late" };
  return { text: [...where, "στην ώρα του"].join(" · "), tone: "ok" };
}

// The name of the stop n stops before place i of a line's variant (where the bus is when an alert
// n stops before fires), or null.
export function stopBack(ix: TripIndex, line: string, variant: string, i: number, n: number): string | null {
  const seq = ix.l[line]?.[variant], k = i - n;
  return seq && k >= 0 && k < seq.length ? ix.s[seq[k]]?.[0] ?? null : null;
}

// A stop's arrival groups split into the user's lines (favourites and lines on the map) and the others.
export function mineFirst<G extends { line: string }>(groups: G[], mine: string[]): { mine: G[]; also: G[] } {
  return { mine: groups.filter(g => mine.includes(g.line)), also: groups.filter(g => !mine.includes(g.line)) };
}

const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

// The usual service of the lines with no bus on its way (groups: the live ones), one row per line and headsign
// (map#24, wording 2): the server's usual time while it is ahead, else the usual gap at this hour; rows with
// neither are left out. Nothing from a server before rev 18.
export function usualRows(usual: Usual[] | undefined, groups: ArrivalGroup[], nowMs: number): { line: string; headsign: string; text: string }[] {
  const out: { line: string; headsign: string; text: string }[] = [];
  for (const u of usual ?? []) {
    if (groups.some(g => g.line === u.line)) continue;
    const text = u.next_at != null && u.next_at * 1000 > nowMs
      ? `Συνήθως περνά ~${clock.format(new Date(u.next_at * 1000))} (από τις προηγούμενες εβδομάδες)`
      : u.headway_min != null ? `Συνήθως περνά κάθε ~${u.headway_min}′ τέτοια ώρα` : null;
    if (text) out.push({ line: u.line, headsign: u.headsign, text });
  }
  return out;
}

// The timetable runs of the lines with no bus on its way (groups: the live ones), one row per line and
// headsign with its next two times and its first variant (for headTo on a loop): citybus.gr cities, where no "usual" comes from the server and a
// board row with no GPS is a timetable run (rt#124). A time already past is left out.
export function scheduleRows(arrivals: StopArrival[], groups: ArrivalGroup[], nowMs: number): { line: string; headsign: string; variant: string; text: string }[] {
  const rows = new Map<string, { line: string; headsign: string; variant: string; times: number[] }>();
  for (const a of [...arrivals].sort((x, y) => x.at - y.at)) {
    if (a.source !== "schedule" || a.at * 1000 < nowMs || groups.some(g => g.line === a.line)) continue;
    const key = `${a.line}|${a.headsign}`;
    let r = rows.get(key);
    if (!r) rows.set(key, (r = { line: a.line, headsign: a.headsign, variant: a.variant, times: [] }));
    if (r.times.length < 2 && !r.times.includes(a.at)) r.times.push(a.at);   // one run on two variants: once
  }
  return [...rows.values()].map(r => ({ line: r.line, headsign: r.headsign, variant: r.variant,
    text: `Κατά πρόγραμμα ${r.times.map(t => clock.format(new Date(t * 1000))).join(", ")} · όχι live` }));
}

// The code on the stop sign, so a rider can find the stop: OASA's stop_code from the server (rev 21;
// it differs from the stop id for a third of the stops, «040054» for 40054), elsewhere the stop id.
export function signCode(code: string | undefined, id: string | null | undefined, athens: boolean): string | null {
  if (code) return code;
  return athens ? null : id || null;
}
