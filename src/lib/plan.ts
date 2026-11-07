// Trip planning (/v2/plan, CONTRACT §9): the response types and the pure helpers that turn an
// itinerary into a summary, map layers and stop pins. No fetch, no DOM.

import type { FeatureCollection, LineString } from "geojson";
import { clock, durText } from "./format";
import type { V2Line, V2Stop } from "./v2";

export interface PlanPoint {
  stop: string | null;
  lat: number;
  lon: number;
}

export interface PlanLeg {
  kind: "walk" | "ride";
  from: PlanPoint;
  to: PlanPoint;
  depart_at: number;
  arrive_at: number;
  shape: [number, number][];   // [lat, lon]
  distance_m?: number;
  line?: string;
  mode?: string;
  headsign?: string;
  run?: string;
  hops?: number;
  source?: string;
}

export interface Itinerary {
  depart_at: number;
  arrive_at: number;
  duration_s: number;
  transfers: number;
  walk_m: number;
  modes: string[];
  legs: PlanLeg[];
}

export interface PlanResponse {
  service_day: string;
  from: { lat: number; lon: number };
  to: { lat: number; lon: number };
  after: number;
  last: boolean;
  itineraries: Itinerary[];
  walk_only: { distance_m: number; duration_s: number } | null;
  lines: Record<string, V2Line>;
  stops: Record<string, V2Stop>;
  sources: { id: string; state: string; updated_at: number | null }[];
}

interface PlanRide {
  line: string;
  label: string;
  color: string;
  text: string;
  mode: string;
  headsign: string;
  from: string;
  to: string;
}

interface PlanSummary {
  depart: string;
  arrive: string;
  mins: number;
  leaveIn: number;
  transfers: number;
  walk_m: number;
  walk_min: number;   // all the walking of the trip, in minutes
  rides: PlanRide[];
}

interface PlanPin { at: [number, number]; name: string }

const COLOR = "#3b5bdb";
const TEXT = "#ffffff";

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const flip = ([lat, lon]: [number, number]): [number, number] => [lon, lat];
const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function planUrl(base: string, from: [number, number], to: [number, number], afterS?: number, n = 3): string {
  const point = ([lat, lon]: [number, number]) => `${String(r4(lat))},${String(r4(lon))}`;
  const after = afterS == null ? "" : `&after=${Math.floor(afterS / 60) * 60}`;
  return `${base}/v2/plan?from=${point(from)}&to=${point(to)}&n=${n}${after}`;
}

export function parsePlan(body: unknown): PlanResponse | null {
  if (!isRec(body) || !Array.isArray(body.itineraries) || !isRec(body.lines) || !isRec(body.stops)) return null;
  // An itinerary without legs or times would crash the planner's rows (or draw nothing): dropped, the others kept.
  const itineraries = body.itineraries.filter(it => isRec(it) && Array.isArray(it.legs) && it.legs.length > 0 && Number.isFinite(it.depart_at) && Number.isFinite(it.arrive_at));
  return { ...body, itineraries } as unknown as PlanResponse;
}

// A failed plan request is asked again (tries: retries so far) when offline, busy or a server error;
// a 4xx, or a 200 that did not parse, would only repeat itself.
export const PLAN_RETRY_MS = 30_000;
export const planRetry = (status: number, tries: number) =>
  tries < 3 && (status === 0 || status === 429 || status >= 500);

const hhmm = (t: number) => clock(t).slice(0, 5);

// A line without a label shows its id after the source prefix ("oasa:122" -> "122").
const idLabel = (id: string) => id.slice(id.indexOf(":") + 1);
// A rail line whose label is a long name («PIRAEUS-AIRPORT») is called by its kind on a badge: «Προαστιακός».
const RAIL_NAME: Record<string, string> = { suburban: "Προαστιακός", metro: "Μετρό", tram: "Τραμ" };
export function badgeLabel(label: string, mode: string): string {
  return label.length > 4 && RAIL_NAME[mode] ? RAIL_NAME[mode] : label;
}

export function planSummary(it: Itinerary, r: PlanResponse, nowS: number): PlanSummary {
  return {
    depart: hhmm(it.depart_at),
    arrive: hhmm(it.arrive_at),
    mins: Math.round(it.duration_s / 60),
    leaveIn: Math.max(0, Math.floor((it.depart_at - nowS) / 60)),
    transfers: it.transfers,
    walk_m: it.walk_m,
    walk_min: Math.round(it.legs.reduce((t, l) => t + (l.kind === "walk" ? l.arrive_at - l.depart_at : 0), 0) / 60),
    rides: it.legs.filter(l => l.kind === "ride").map(l => {
      const line = l.line ?? "";
      const known = r.lines[line];
      const from = l.from.stop ?? "";
      const to = l.to.stop ?? "";
      return {
        line,
        label: known?.label || idLabel(line),
        color: known?.color || COLOR,
        text: known?.text_color || TEXT,
        mode: l.mode ?? known?.mode ?? "",
        headsign: l.headsign ?? "",
        from: r.stops[from]?.name ?? from,
        to: r.stops[to]?.name ?? to,
      };
    }),
  };
}

// Every leg drawn, joined: a walk the plan gives no shape is the straight way between its ends, and where a leg
// ends away from where the next begins (a change across a square, a station's other exit) a walk joins them, so
// the way on the map never breaks off into a blank.
export function planFC(it: Itinerary, r: PlanResponse): FeatureCollection<LineString> {
  const walk = (a: [number, number], b: [number, number]) => ({
    type: "Feature" as const, properties: { kind: "walk", color: null, line: null }, geometry: { type: "LineString" as const, coordinates: [a, b] } });
  const features: FeatureCollection<LineString>["features"] = [];
  let end: [number, number] | null = null;
  for (const l of it.legs) {
    const coords = l.shape.length >= 2 ? l.shape.map(flip) : [[l.from.lon, l.from.lat], [l.to.lon, l.to.lat]] as [number, number][];
    if (end && Math.hypot(coords[0][0] - end[0], coords[0][1] - end[1]) > 0.0001) features.push(walk(end, coords[0]));
    end = coords[coords.length - 1];
    if (l.kind === "walk" && (l.distance_m === 0 || Math.hypot(coords[0][0] - end[0], coords[0][1] - end[1]) < 0.00002)) continue;
    features.push({
      type: "Feature" as const,
      properties: {
        kind: l.kind,
        color: l.kind === "ride" ? r.lines[l.line ?? ""]?.color || COLOR : null,
        line: l.kind === "ride" ? l.line ?? null : null,
      },
      geometry: { type: "LineString" as const, coordinates: coords },
    });
  }
  return { type: "FeatureCollection", features };
}

// The pins of a plan: get on, change, get off. A change at the same stop is one pin.
export function planStops(it: Itinerary, r: PlanResponse): PlanPin[] {
  const out: PlanPin[] = [];
  let prev: string | null = null;
  for (const l of it.legs) {
    if (l.kind !== "ride") continue;
    for (const p of [l.from, l.to]) {
      if (!p.stop || p.stop === prev) continue;
      out.push({ at: [p.lat, p.lon], name: r.stops[p.stop]?.name ?? p.stop });
      prev = p.stop;
    }
  }
  return out;
}

// The legs of an itinerary to draw to scale (TripPlanner's option cards): walks and rides in order, each with its
// minutes (a walk of under a minute is left out); a ride with its line's badge and how many stops it rides.
export interface ScaledLeg { walk: boolean; min: number; label: string; color: string; text: string; hops: number | null }
export function scaledLegs(it: Itinerary, r: PlanResponse): ScaledLeg[] {
  return it.legs.flatMap((l): ScaledLeg[] => {
    const min = Math.max(0, Math.round((l.arrive_at - l.depart_at) / 60));
    if (l.kind === "walk") return min >= 1 ? [{ walk: true, min, label: durText(min), color: "", text: "", hops: null }] : [];
    const known = r.lines[l.line ?? ""];
    return [{ walk: false, min: Math.max(1, min), label: badgeLabel(known?.label || idLabel(l.line ?? ""), l.mode ?? known?.mode ?? ""), color: known?.color || COLOR,
      text: known?.text_color || TEXT, hops: l.hops ?? null }];
  });
}

// Getting out of a metro station or down to its platform takes a while the plan's walk leaves out (stairs,
// escalators, gates): a change from or to the metro counts this many minutes on top of the walk.
export const METRO_GATE_MIN = 3;
const isMetro = (l: PlanLeg | undefined, r?: PlanResponse) => !!l && (l.mode ?? r?.lines[l.line ?? ""]?.mode) === "metro";
/** The minutes a change between these two rides takes on top of the walk (the metro's stations). */
export const gateMin = (a: PlanLeg | undefined, b: PlanLeg | undefined, r?: PlanResponse) => (isMetro(a, r) || isMetro(b, r) ? METRO_GATE_MIN : 0);

// The tightest change of an itinerary: the minutes between arriving on one ride (walking on, and through a metro
// station) and the next ride leaving; null without a change.
export function tightestChange(it: Itinerary, r?: PlanResponse): number | null {
  let best: number | null = null;
  let arrived: number | null = null;
  let prev: PlanLeg | undefined;
  for (const l of it.legs) {
    if (l.kind === "walk") { if (arrived != null) arrived = l.arrive_at; continue; }
    if (arrived != null) {
      const spare = (l.depart_at - arrived) / 60 - gateMin(prev, l, r);
      best = best == null ? spare : Math.min(best, spare);
    }
    arrived = l.arrive_at;
    prev = l;
  }
  return best;
}

// Under this many minutes to spare, a change is often missed: the option says so.
export const RISK_MIN = 2;

// An option, step by step (the picked option's list): the rides, the changes between them as steps of their own
// (the walk, the minutes to spare, and if the next ride is missed, the one after it from the other options), the walks
// at either end, and the arrival. Names from the plan's stops; [lat, lon] for the walk's length when the leg has none.
export type PlanStep =
  | { kind: "walk"; at: number; m: number; min: number; to: string }
  | { kind: "ride"; at: number; leg: number; from: string; to: string; line: string; label: string; color: string; text: string; headsign: string; hops: number | null; min: number }
  | { kind: "change"; at: number; stop: string; m: number; min: number; gate: number; spare: number; label: string; headsign: string; missed: { in_min: number; arrive_at: number } | null;
      next: string; mode: string; color: string; text: string; prev: { label: string; color: string; mode: string } }
  | { kind: "end"; at: number; name: string };
export function planSteps(it: Itinerary, r: PlanResponse, others: Itinerary[] = []): PlanStep[] {
  const name = (p: PlanPoint, fallback: string) => (p.stop ? r.stops[p.stop]?.name ?? fallback : fallback);
  const legM = (l: PlanLeg) => l.distance_m ?? Math.round(Math.hypot((l.to.lat - l.from.lat) * 110_540,
    (l.to.lon - l.from.lon) * 111_320 * Math.cos((l.from.lat * Math.PI) / 180)) * 1.3);
  const out: PlanStep[] = [];
  const legs = it.legs;
  for (let k = 0; k < legs.length; k++) {
    const l = legs[k];
    if (l.kind === "walk") {
      const prev = legs[k - 1], next = legs[k + 1];
      if (prev?.kind === "ride" && next?.kind === "ride") continue;   // a change: told with the ride after it
      const m = legM(l);
      if (m < 30) continue;
      out.push({ kind: "walk", at: l.depart_at, m, min: Math.max(1, Math.round((l.arrive_at - l.depart_at) / 60)), to: next ? name(next.from, "στη στάση") : "στον προορισμό" });
      continue;
    }
    const known = r.lines[l.line ?? ""], label = known?.label || (l.line ?? "").slice((l.line ?? "").indexOf(":") + 1);
    const prevRide = [...legs.slice(0, k)].reverse().find(x => x.kind === "ride");
    if (prevRide) {
      const walk = legs[k - 1]?.kind === "walk" ? legs[k - 1] : null;
      const ready = walk ? walk.arrive_at : prevRide.arrive_at;
      // Missed: the same line from the same stop, later, in another option.
      let missed: { in_min: number; arrive_at: number } | null = null;
      for (const o of others) for (const x of o.legs) {
        if (x.kind !== "ride" || x.line !== l.line || x.from.stop !== l.from.stop || x.depart_at <= l.depart_at) continue;
        if (!missed || x.depart_at - l.depart_at < missed.in_min * 60) missed = { in_min: Math.max(1, Math.round((x.depart_at - l.depart_at) / 60)), arrive_at: o.arrive_at };
      }
      const pk = r.lines[prevRide.line ?? ""], gate = gateMin(prevRide, l, r);
      out.push({ kind: "change", at: prevRide.arrive_at, stop: name(prevRide.to, "τη στάση"), m: walk ? legM(walk) : 0,
        min: (walk ? Math.max(1, Math.round((walk.arrive_at - walk.depart_at) / 60)) : 0) + gate, gate, spare: Math.round((l.depart_at - ready) / 60) - gate,
        label, headsign: l.headsign ?? "", missed, next: name(l.from, ""), mode: l.mode ?? known?.mode ?? "bus", color: known?.color || COLOR, text: known?.text_color || TEXT,
        prev: { label: pk?.label || (prevRide.line ?? "").slice((prevRide.line ?? "").indexOf(":") + 1), color: pk?.color || COLOR, mode: prevRide.mode ?? pk?.mode ?? "bus" } });
    }
    out.push({ kind: "ride", at: l.depart_at, leg: k, from: name(l.from, ""), to: name(l.to, ""), line: l.line ?? "", label, color: known?.color || COLOR,
      text: known?.text_color || TEXT, headsign: l.headsign ?? "", hops: l.hops ?? null, min: Math.max(1, Math.round((l.arrive_at - l.depart_at) / 60)) });
  }
  out.push({ kind: "end", at: it.arrive_at, name: "Προορισμός" });
  return out;
}

// How a change is made, in a few words: the walk from one stop to the other (metres and minutes, the metro
// station's minutes in them, said so), or the same stop.
export function changeWay(st: { m: number; min: number; gate: number }): string {
  if (st.m < 20) return st.gate ? `Ίδιος σταθμός · ${st.min}′` : "Ίδια στάση";
  const m = st.m < 1000 ? `${Math.max(10, Math.round(st.m / 10) * 10)} μ` : `${(st.m / 1000).toFixed(1).replace(".", ",")} χλμ`;
  return `${m}${st.gate ? " + σταθμός" : ""} · ${st.min}′`;
}

// The picked option's words on the map ([lon, lat]): where to get on (and when), each change (and the minutes to
// spare), the arrival, and on each ride its line and minutes, at the middle of its shape.
export type PlanLabel =
  | { kind: "leg"; at: [number, number]; label: string; color: string; text: string; min: number }
  | { kind: "board" | "change" | "end"; at: [number, number]; name: string; sub: string; ok?: boolean;
      lines?: { label: string; color: string; text: string; mode: string }[] };
export function planLabels(it: Itinerary, r: PlanResponse, endName: string): PlanLabel[] {
  const out: PlanLabel[] = [];
  const steps = planSteps(it, r);
  const rides = it.legs.filter(l => l.kind === "ride");
  for (const l of rides) {
    const known = r.lines[l.line ?? ""], mid = l.shape[Math.floor(l.shape.length / 2)] ?? [l.from.lat, l.from.lon];
    out.push({ kind: "leg", at: flip(mid), label: badgeLabel(known?.label || idLabel(l.line ?? ""), l.mode ?? known?.mode ?? ""), color: known?.color || COLOR, text: known?.text_color || TEXT,
      min: Math.max(1, Math.round((l.arrive_at - l.depart_at) / 60)) });
  }
  const first = rides[0];
  if (first) out.push({ kind: "board", at: [first.from.lon, first.from.lat], name: r.stops[first.from.stop ?? ""]?.name ?? "", sub: `Ανέβα ${hhmm(first.depart_at)}` });
  let k = 0;
  for (const st of steps) {
    if (st.kind !== "change") continue;
    const prev = rides[k++], next = rides[k];
    const badge = (l: PlanLeg) => { const kn = r.lines[l.line ?? ""], mode = l.mode ?? kn?.mode ?? "";
      return { label: badgeLabel(kn?.label || idLabel(l.line ?? ""), mode), color: kn?.color || COLOR, text: kn?.text_color || TEXT, mode }; };
    if (prev) out.push({ kind: "change", at: [prev.to.lon, prev.to.lat], name: `Αλλαγή · ${st.stop}`, sub: `${changeWay(st)} · Περιθώριο ${Math.max(0, st.spare)}′`, ok: st.spare >= 3,
      lines: next ? [badge(prev), badge(next)] : [badge(prev)] });
  }
  const last = it.legs[it.legs.length - 1];
  if (last) out.push({ kind: "end", at: [last.to.lon, last.to.lat], name: endName, sub: `Φτάνεις ${hhmm(it.arrive_at)}` });
  return out;
}
