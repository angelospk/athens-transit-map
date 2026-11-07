// A metro option the planner server leaves out. /v2/plan returns its five best by arrival, and from a suburb by an
// Express line (Γλυκά Νερά, Παλλήνη → Σύνταγμα) these are all the same bus at five times, with the metro, a station
// a bus ride away, never among them. So when no option rides the metro, the app asks for one in two parts with the
// same /v2/plan: to a metro station near the start (by bus or on foot), then from it on by metro; the two make one
// option, added when it arrives within METRO_SLACK of the best.
import { loadMetro, type MetroStation } from "./metro";
import type { Itinerary, PlanLeg, PlanResponse } from "./plan";

type Pt = [number, number];   // [lat, lon]
export type Ask = (from: Pt, to: Pt, afterS?: number) => Promise<PlanResponse | null>;

const METRO_SLACK = 20 * 60;   // s: a metro option this much later than the best is still worth showing
const END_KM = 1.2;            // the metro station at the end: this close to it
const MIN_TRIP_KM = 3;         // shorter trips: the bus or the feet, no detour by metro
const CHANGE_S = 120;          // from the bus or the street to the platform
const NEAR_KM = 4.5;           // a station to get on at: a short bus ride or a walk from the start

let stationsP: Promise<MetroStation[]> | null = null;
const stations = () => (stationsP ??= loadMetro().then(d => d.stations.filter(s => s.lines.some(l => /^M/.test(l))), () => { stationsP = null; return []; }));

export function km(a: Pt, b: Pt): number {
  const kx = 111.32 * Math.cos((a[0] * Math.PI) / 180);
  return Math.hypot((a[1] - b[1]) * kx, (a[0] - b[0]) * 110.54);
}
export const ridesMetro = (it: Itinerary, r: PlanResponse) =>
  it.legs.some(l => l.kind === "ride" && (l.mode === "metro" || r.lines[l.line ?? ""]?.mode === "metro" || /^stasy:/.test(l.line ?? "")));

/** Where to get on and off: the station nearest the end, and up to two nearest the start. */
export function bridgeStations(all: MetroStation[], from: Pt, to: Pt): { on: MetroStation[]; off: MetroStation } | null {
  if (km(from, to) < MIN_TRIP_KM) return null;
  const at = (s: MetroStation): Pt => [s.lat, s.lon];
  const off = [...all].sort((a, b) => km(at(a), to) - km(at(b), to))[0];
  if (!off || km(at(off), to) > END_KM) return null;
  // Near the start: within NEAR_KM, and nearer it than the end is (the line may well go round, away from the end).
  const reach = Math.min(NEAR_KM, km(from, to) * 0.5);
  const on = all.filter(s => s.name !== off.name && km(from, at(s)) < reach)
    .sort((a, b) => km(from, at(a)) - km(from, at(b))).slice(0, 2);
  return on.length ? { on, off } : null;
}

/** Two options as one: the first part's legs, then the second's, with the change between them counted. */
export function join(a: Itinerary, b: Itinerary): Itinerary {
  const ridesA = a.legs.some(l => l.kind === "ride");
  return {
    depart_at: a.depart_at, arrive_at: b.arrive_at, duration_s: b.arrive_at - a.depart_at,
    transfers: a.transfers + b.transfers + (ridesA ? 1 : 0), walk_m: a.walk_m + b.walk_m,
    modes: [...new Set([...a.modes, ...b.modes])], legs: [...a.legs, ...b.legs],
  };
}
/** The way to the station on foot, as an option, when the server gives only a walk. */
function walkTo(from: Pt, to: Pt, r: PlanResponse, at: number): Itinerary | null {
  const w = r.walk_only;
  if (!w) return null;
  const leg: PlanLeg = { kind: "walk", from: { stop: null, lat: from[0], lon: from[1] }, to: { stop: null, lat: to[0], lon: to[1] },
    depart_at: at, arrive_at: at + w.duration_s, shape: [], distance_m: w.distance_m };
  return { depart_at: at, arrive_at: at + w.duration_s, duration_s: w.duration_s, transfers: 0, walk_m: w.distance_m, modes: ["walk"], legs: [leg] };
}

/** The plan with a metro option added when it had none and one is close to the best; else the plan as it was. */
export async function withMetro(r: PlanResponse, from: Pt, to: Pt, afterS: number | undefined, nowS: number, ask: Ask): Promise<PlanResponse> {
  if (!r.itineraries.length || r.itineraries.some(it => ridesMetro(it, r))) return r;
  const pick = bridgeStations(await stations(), from, to);
  if (!pick) return r;
  const start = afterS ?? nowS;
  const tries = await Promise.all(pick.on.map(async s => {
    const st: Pt = [s.lat, s.lon];
    const a = await ask(from, st, afterS);
    if (!a) return null;
    const first = [...a.itineraries].sort((x, y) => x.arrive_at - y.arrive_at)[0] ?? walkTo(from, st, a, start);
    if (!first) return null;
    const b = await ask(st, to, first.arrive_at + CHANGE_S);
    const second = b?.itineraries.filter(it => ridesMetro(it, b)).sort((x, y) => x.arrive_at - y.arrive_at)[0];
    return b && second ? { it: join(first, second), lines: { ...a.lines, ...b.lines }, stops: { ...a.stops, ...b.stops } } : null;
  }));
  const found = tries.filter((t): t is NonNullable<typeof t> => !!t).sort((x, y) => x.it.arrive_at - y.it.arrive_at)[0];
  const bestArrive = Math.min(...r.itineraries.map(it => it.arrive_at));
  if (!found || found.it.arrive_at > bestArrive + METRO_SLACK) return r;
  const its = [...r.itineraries, found.it].sort((x, y) => x.arrive_at - y.arrive_at);
  return { ...r, itineraries: its, lines: { ...found.lines, ...r.lines }, stops: { ...found.stops, ...r.stops } };
}
