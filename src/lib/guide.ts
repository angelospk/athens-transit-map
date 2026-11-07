// «Ξεκίνα»: a trip followed step by step, as a phone's navigation does. A guide is a list of legs (walk, ride, walk…)
// built from a timed plan (/v2/plan) or from a line of the stop index; the screen (NavGuide) follows the location
// through them. Here: building a guide, the walking route and its spoken instructions (a public OSRM foot router),
// and where on a leg the user is. No DOM, no state.

import { planSteps, type Itinerary, type PlanResponse, type PlanStep } from "./plan";
import type { V2Run, V2Stop } from "./v2";
import type { TripIndex, TripLeg, TripVariant } from "./trip";
import { titleCase } from "./nearby";
import { placeNote, toward } from "./stops";

export type Pt = [number, number];   // [lat, lon]

export interface GStop { id: string | null; name: string; at: Pt; t?: number }   // t: its time in the timetable (s), a train's stations
export interface GuideWalk { kind: "walk"; from: Pt; to: Pt; toName: string; final: boolean }
export interface GuideRide {
  kind: "ride"; line: string; variant: string | null; headsign: string;
  board: GStop; alight: GStop;
  seq: GStop[];           // the stops ridden, board first and alight last
  before: GStop[];        // up to 4 stops before the board stop (where the bus comes from)
  shape?: Pt[];           // the plan's own way for the ride ([lat, lon]), drawn when the line's is not known
  dep?: number; arr?: number;   // a timed plan: when it leaves the board stop and reaches the alight stop
  run?: string; lineId?: string; // a train's run and line ids (/v2), for its stations and their times
}
export type ChangeStep = Extract<PlanStep, { kind: "change" }>;
export type GuideLeg = GuideWalk | GuideRide;
export interface Guide { key: string; legs: GuideLeg[]; dest: string; arrive: number | null;
  changes?: (ChangeStep | null)[] }   // a timed plan: the change before each ride (by its order, the first null)

const R = 6371000, rad = Math.PI / 180;
export function metres(a: Pt, b: Pt): number {
  const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const native = (id: string) => id.slice(id.indexOf(":") + 1);
const stopOf = (ix: TripIndex, k: number): GStop => ({ id: ix.s[k][3] ?? null, name: titleCase(ix.s[k][0]), at: [ix.s[k][1], ix.s[k][2]] });
const headOf = (ix: TripIndex, line: string, variant: string) => {
  const k = ix.l[line]?.[variant]?.at(-1);
  return k == null ? "" : titleCase(placeNote(ix.s[k][0]).place);
};

// The ride of a line's variant from position i to position j of its stops.
function rideOf(ix: TripIndex, line: string, variant: string, i: number, j: number): GuideRide {
  const seq = ix.l[line][variant];
  return {
    kind: "ride", line, variant, headsign: headOf(ix, line, variant),
    board: stopOf(ix, seq[i]), alight: stopOf(ix, seq[j]),
    seq: seq.slice(i, j + 1).map(k => stopOf(ix, k)),
    before: seq.slice(Math.max(0, i - 4), i).map(k => stopOf(ix, k)),
  };
}

// The metro (M1–M3) and the tram (T6, T7) board at a station, under or beside the street: «ως τον σταθμό», and
// down to the platform.
export const isRail = (line: string) => /^[MΜTΤ]\d/.test(line);
/** «τη στάση Χ» or «τον σταθμό Χ», for a walk's end. */
export const toThe = (name: string) => (name.startsWith("σταθμό") ? `τον ${name}` : name.startsWith("στάση") ? `τη ${name}` : name);

// Walks round the rides: from the start to the first stop, between the rides when their stops differ, and from the
// last stop to the end. A walk of under 20 m is left out.
function withWalks(rides: GuideRide[], from: Pt, to: Pt, dest: string): GuideLeg[] {
  const legs: GuideLeg[] = [];
  let at = from;
  for (const r of rides) {
    if (metres(at, r.board.at) >= 20) legs.push({ kind: "walk", from: at, to: r.board.at, toName: `${isRail(r.line) ? "σταθμό" : "στάση"} ${r.board.name}`, final: false });
    legs.push(r);
    at = r.alight.at;
  }
  if (metres(at, to) >= 20) legs.push({ kind: "walk", from: at, to, toName: dest, final: true });
  return legs;
}

/** A line of the stop index, ridden on its variant `v` (TripPlanner's lines with no change). */
export function guideFromTrip(ix: TripIndex, line: string, v: TripVariant, from: Pt, to: Pt, dest: string): Guide {
  return { key: `t:${line}:${v.id}:${v.i}:${v.j}`, legs: withWalks([rideOf(ix, line, v.id, v.i, v.j)], from, to, dest), dest, arrive: null };
}

/** Two lines with a change (TripPlanner's «Με μία αλλαγή»). */
export function guideFromXfer(ix: TripIndex, legs: [TripLeg, TripLeg], from: Pt, to: Pt, dest: string): Guide {
  const rides = legs.map(l => rideOf(ix, l.line, l.id, l.i, l.j));
  return { key: `x:${legs.map(l => `${l.line}:${l.id}`).join(">")}`, legs: withWalks(rides, from, to, dest), dest, arrive: null };
}

/** A timed plan (/v2/plan). Each ride is matched to a variant of the stop index that has both its stops in order;
 *  one it can't match rides its two stops only. */
export function guideFromPlan(it: Itinerary, r: PlanResponse, ix: TripIndex | null, dest: string): Guide {
  const byId = new Map<string, number>();
  ix?.s.forEach((s, k) => { if (s[3]) byId.set(s[3], k); });
  const rides: GuideRide[] = [];
  for (const l of it.legs) {
    if (l.kind !== "ride") continue;
    const line = native(l.line ?? ""), a = l.from.stop ? native(l.from.stop) : null, b = l.to.stop ? native(l.to.stop) : null;
    const ka = a != null ? byId.get(a) : undefined, kb = b != null ? byId.get(b) : undefined;
    let ride: GuideRide | null = null;
    if (ix && ka != null && kb != null) {
      for (const [vid, seq] of Object.entries(ix.l[line] ?? {})) {
        const i = seq.indexOf(ka), j = i < 0 ? -1 : seq.indexOf(kb, i + 1);
        if (i >= 0 && j > i) { ride = rideOf(ix, line, vid, i, j); break; }
      }
    }
    const name = (id: string | null) => titleCase(id ? r.stops[id]?.name ?? id : "") || "στάση";
    ride ??= {
      kind: "ride", line, variant: null, headsign: titleCase(placeNote(toward(l.headsign ?? "")).place),
      board: { id: a, name: name(l.from.stop), at: [l.from.lat, l.from.lon] },
      alight: { id: b, name: name(l.to.stop), at: [l.to.lat, l.to.lon] },
      seq: [], before: [],
    };
    if (!ride.seq.length) ride.seq = [ride.board, ride.alight];
    if (l.headsign) ride.headsign = titleCase(placeNote(toward(l.headsign)).place);
    if (l.shape?.length > 1) ride.shape = l.shape;
    ride.dep = l.depart_at; ride.arr = l.arrive_at;
    if (l.run) ride.run = l.run;
    if (l.line) ride.lineId = l.line;
    rides.push(ride);
  }
  const from: Pt = [r.from.lat, r.from.lon], to: Pt = [r.to.lat, r.to.lon];
  const changes: (ChangeStep | null)[] = [null, ...planSteps(it, r).filter((x): x is ChangeStep => x.kind === "change")];
  return { key: `p:${it.depart_at}:${it.arrive_at}`, legs: withWalks(rides, from, to, dest), dest, arrive: it.arrive_at, changes };
}

/** A train's stations from the board one to the alight one, with their times, from its run (/v2/runs) and its line's
 *  stops (/v2/lines); null when either end is not in the run. */
export function railSeq(run: V2Run, stops: Record<string, V2Stop>, board: string | null, alight: string | null): GStop[] | null {
  const own = (id: string) => id.slice(id.indexOf(":") + 1);
  const i = run.stops.findIndex(s => own(s.stop) === board), j = i < 0 ? -1 : run.stops.findIndex((s, k) => k > i && own(s.stop) === alight);
  if (i < 0 || j < 0) return null;
  return run.stops.slice(i, j + 1).map(s => {
    const st = stops[s.stop] ?? stops[own(s.stop)];
    return { id: own(s.stop), name: titleCase(st?.name ?? own(s.stop)), at: [st?.lat ?? 0, st?.lon ?? 0] as Pt, t: s.at };
  });
}

/** A metro line (M1–M3): a ride followed without GPS, by the train's stops and the timetable (metroRide). */
export const isMetro = (line: string) => /^[MΜ]\d/.test(line);

// ---- Where on a line of points the user is.

/** The point's place along a polyline: metres from its start, and how far off it the point is. */
export function along(line: Pt[], p: Pt): { s: number; off: number } {
  if (line.length < 2) return { s: 0, off: line.length ? metres(line[0], p) : Infinity };
  const k = 111320 * Math.cos(p[0] * rad);   // metres per degree of longitude here
  const xy = (q: Pt) => [(q[1] - p[1]) * k, (q[0] - p[0]) * 110540];
  let best = { s: 0, off: Infinity }, acc = 0;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = xy(line[i - 1]), [bx, by] = xy(line[i]);
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (len * len))) : 0;
    const off = Math.hypot(ax + t * dx, ay + t * dy);
    if (off < best.off) best = { s: acc + t * len, off };
    acc += len;
  }
  return best;
}

export function lengthOf(line: Pt[]): number {
  let s = 0;
  for (let i = 1; i < line.length; i++) s += metres(line[i - 1], line[i]);
  return s;
}

/** On a ride: how many of its stops are passed (0 = only the board stop), from where the user is. A stop counts as
 *  passed 15 m before it, so the next one is announced in time. */
export function ridePassed(ride: GuideRide, p: Pt): number {
  const pts = ride.seq.map(s => s.at);
  const { s } = along(pts, p);
  let acc = 0, passed = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += metres(pts[i - 1], pts[i]);
    if (s >= acc - 15) passed = i;
  }
  return passed;
}

// ---- The walking route and its instructions.

export interface WalkStep { at: Pt; s: number; type: string; modifier: string; name: string; exit: number | null }
export interface WalkRoute { line: Pt[]; steps: WalkStep[]; length: number; duration: number }

const FOOT_URL = import.meta.env.VITE_FOOT_URL || "https://routing.openstreetmap.de/routed-foot/route/v1/foot";

interface OsrmStep { maneuver: { location: [number, number]; type: string; modifier?: string; exit?: number }; name?: string; distance: number }
export function parseFoot(body: unknown): WalkRoute | null {
  const route = (body as { routes?: { geometry?: { coordinates?: [number, number][] }; legs?: { steps?: OsrmStep[] }[]; distance?: number; duration?: number }[] } | null)?.routes?.[0];
  const coords = route?.geometry?.coordinates;
  if (!route || !coords?.length) return null;
  const line = coords.map(([lon, lat]) => [lat, lon] as Pt);
  let s = 0;
  const steps = (route.legs?.[0]?.steps ?? []).map(st => {
    const step: WalkStep = { at: [st.maneuver.location[1], st.maneuver.location[0]], s, type: st.maneuver.type, modifier: st.maneuver.modifier ?? "",
      name: st.name ?? "", exit: st.maneuver.exit ?? null };
    s += st.distance;
    return step;
  });
  return { line, steps, length: route.distance ?? lengthOf(line), duration: route.duration ?? 0 };
}

export async function fetchFoot(from: Pt, to: Pt, signal?: AbortSignal): Promise<WalkRoute | null> {
  const u = `${FOOT_URL}/${from[1].toFixed(6)},${from[0].toFixed(6)};${to[1].toFixed(6)},${to[0].toFixed(6)}?steps=true&overview=full&geometries=geojson`;
  const r = await fetch(u, { signal });
  if (!r.ok) return null;
  return parseFoot(await r.json());
}

const TURN: Record<string, string> = {
  right: "Στρίψε δεξιά", left: "Στρίψε αριστερά", "slight right": "Πήγαινε λίγο δεξιά", "slight left": "Πήγαινε λίγο αριστερά",
  "sharp right": "Στρίψε απότομα δεξιά", "sharp left": "Στρίψε απότομα αριστερά", straight: "Συνέχισε ευθεία", uturn: "Γύρνα πίσω",
};
// "Ερμού" → "στην Ερμού"; a name the router does not know: no street at all.
const onto = (name: string) => (name ? ` στην ${name}` : "");

/** One step said as a sentence. `end`: where the walk goes ("στάση Σύνταγμα", or the place). */
export function stepText(st: WalkStep, end: string): string {
  if (st.type === "arrive") return end.startsWith("στάση") ? `Φτάνεις στη ${end}` : end.startsWith("σταθμό") ? `Φτάνεις στον ${end}: κατέβα στο μετρό` : `Φτάνεις: ${end}`;
  if (st.type === "depart") return `Ξεκίνα${onto(st.name)}`;
  if (st.type === "roundabout" || st.type === "rotary") return `Στον κόμβο, πάρε την ${st.exit ?? 1}η έξοδο${onto(st.name)}`;
  if (st.type === "continue" || st.type === "new name") return `Συνέχισε${onto(st.name)}`;
  return `${TURN[st.modifier] ?? "Συνέχισε"}${onto(st.name)}`;
}

/** The arrow for a step: one of the Icon names drawn in NavGuide. */
export function stepArrow(st: WalkStep): "left" | "right" | "slight-left" | "slight-right" | "straight" | "uturn" | "arrive" {
  if (st.type === "arrive") return "arrive";
  const m = st.modifier;
  return m === "left" || m === "sharp left" ? "left" : m === "right" || m === "sharp right" ? "right" : m === "slight left" ? "slight-left"
    : m === "slight right" ? "slight-right" : m === "uturn" ? "uturn" : "straight";
}

/** Where the user is on a walking route: the next step to do, the one after it, and the metres to each. */
export function walkNow(route: WalkRoute, p: Pt): { next: WalkStep | null; then: WalkStep | null; toNext: number; left: number; off: number } {
  const { s, off } = along(route.line, p);
  const ahead = route.steps.filter(st => st.s > s + 8 && st.type !== "depart");
  const next = ahead[0] ?? null;
  return { next, then: ahead[1] ?? null, toNext: next ? Math.max(0, next.s - s) : 0, left: Math.max(0, route.length - s), off };
}

/** Distance said the way a person says it: "120 μ.", "1,2 χλμ.". */
export function distSaid(m: number): string {
  if (m >= 1000) return `${(Math.round(m / 100) / 10).toLocaleString("el-GR")} χλμ.`;
  return `${m >= 100 ? Math.round(m / 10) * 10 : Math.max(5, Math.round(m / 5) * 5)} μ.`;
}

/** Walking speed for estimates, metres a second (a little under 5 km/h). */
export const WALK_MPS = 1.3;
