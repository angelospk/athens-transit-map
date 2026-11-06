// Trip planning (/v2/plan, CONTRACT §9): the response types and the pure helpers that turn an
// itinerary into a summary, map layers and stop pins. No fetch, no DOM.

import type { FeatureCollection, LineString } from "geojson";
import { clock } from "./format";
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
  rides: PlanRide[];
}

interface PlanPin { at: [number, number]; name: string }

const COLOR = "#3b5bdb";
const TEXT = "#ffffff";

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const flip = ([lat, lon]: [number, number]): [number, number] => [lon, lat];
const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function planUrl(base: string, from: [number, number], to: [number, number], afterS?: number): string {
  const point = ([lat, lon]: [number, number]) => `${String(r4(lat))},${String(r4(lon))}`;
  const after = afterS == null ? "" : `&after=${Math.floor(afterS / 60) * 60}`;
  return `${base}/v2/plan?from=${point(from)}&to=${point(to)}&n=3${after}`;
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

export function planSummary(it: Itinerary, r: PlanResponse, nowS: number): PlanSummary {
  return {
    depart: hhmm(it.depart_at),
    arrive: hhmm(it.arrive_at),
    mins: Math.round(it.duration_s / 60),
    leaveIn: Math.max(0, Math.floor((it.depart_at - nowS) / 60)),
    transfers: it.transfers,
    walk_m: it.walk_m,
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

export function planFC(it: Itinerary, r: PlanResponse): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: it.legs
      .filter(l => !(l.kind === "walk" && l.distance_m === 0))
      .map(l => ({
        type: "Feature" as const,
        properties: {
          kind: l.kind,
          color: l.kind === "ride" ? r.lines[l.line ?? ""]?.color || COLOR : null,
        },
        geometry: { type: "LineString" as const, coordinates: l.shape.map(flip) },
      })),
  };
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
