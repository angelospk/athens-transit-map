// When the server's planner (/v2/plan) gives no route, the app finds some itself (mockup of «Πού πας;» never empty
// while a bus runs): the lines of the stop index that go from near the start to near the end, straight or with one
// change (trip.ts), timed by the live arrivals at the stop to board (/v2/stops) and by the usual speed on the bus.
// The answer has the plan's own shape (PlanResponse), marked `estimate`, so every screen shows it as it shows a plan.

import { fetchV2Stop } from "./api";
import { distM, findTransfers, findTrips, type TripIndex } from "./trip";
import type { Itinerary, PlanLeg, PlanResponse } from "./plan";
import type { V2Arrival, V2Line, V2Stop } from "./v2";

type Pt = [number, number];
const WALK_MPS = 1.25, DETOUR = 1.3, RIDE_MPS = 250 / 60, XFER_S = 60, RADIUS = 700;
const LATER_S = 2 * 3600;   // a ride whose next bus is not on the board: not offered

export interface LineLook { label: string; color: string; text: string; mode: "bus" | "trolley" }

/** Options from the stop index, timed from the live boards; null when there are none. */
export async function fallbackPlan(ix: TripIndex, from: Pt, to: Pt, nowS: number, look: (line: string) => LineLook,
  signal?: AbortSignal): Promise<PlanResponse | null> {
  const direct = findTrips(ix, [from], [to], RADIUS).slice(0, 4);
  const xfers = direct.length >= 3 ? [] : findTransfers(ix, [from], [to], RADIUS, undefined, 3);
  type Ride = { line: string; variant: string; i: number; j: number };
  const options: Ride[][] = [
    ...direct.map(t => [{ line: t.line, variant: t.variants[0].id, i: t.variants[0].i, j: t.variants[0].j }]),
    ...xfers.map(x => x.legs.map(l => ({ line: l.line, variant: l.id, i: l.i, j: l.j }))),
  ];
  if (!options.length) return null;

  const boards = new Map<string, Promise<V2Arrival[]>>();
  const board = (id: string) => {
    let p = boards.get(id);
    if (!p) boards.set(id, (p = fetchV2Stop(`oasa:${id}`).then(r => (r.body as { arrivals?: V2Arrival[] } | null)?.arrivals ?? [], () => [])));
    return p;
  };
  const pt = (k: number): Pt => [ix.s[k][1], ix.s[k][2]];
  const stopId = (k: number) => ix.s[k][3] ?? `ix${k}`;
  const lines: Record<string, V2Line> = {}, stops: Record<string, V2Stop> = {};
  const addStop = (k: number) => {
    const id = `oasa:${stopId(k)}`;
    stops[id] ??= { id, name: ix.s[k][0], name_en: null, lat: ix.s[k][1], lon: ix.s[k][2], modes: ["bus"], lines: [], source: "oasa" };
    return id;
  };
  const walkLeg = (a: Pt, b: Pt, at: number, toStop: string | null, fromStop: string | null): PlanLeg => {
    const s = (distM(a, b) * DETOUR) / WALK_MPS;
    return { kind: "walk", from: { stop: fromStop, lat: a[0], lon: a[1] }, to: { stop: toStop, lat: b[0], lon: b[1] },
      depart_at: at, arrive_at: at + s, shape: [a, b], distance_m: Math.round(distM(a, b) * DETOUR) };
  };

  const its: Itinerary[] = [];
  for (const opt of options) {
    if (signal?.aborted) return null;
    const legs: PlanLeg[] = [];
    let at = nowS, here: Pt = from, hereStop: string | null = null, ok = true;
    for (const r of opt) {
      const seq = ix.l[r.line]?.[r.variant];
      if (!seq) { ok = false; break; }
      const kb = seq[r.i], ka = seq[r.j], bId = addStop(kb), aId = addStop(ka);
      const walk = walkLeg(here, pt(kb), at, bId, hereStop);
      if (walk.distance_m! >= 20) legs.push(walk);
      const ready = walk.distance_m! >= 20 ? walk.arrive_at + (hereStop ? XFER_S : 0) : at;
      const arr = (await board(stopId(kb))).filter(a => a.line === `oasa:${r.line}` && a.at >= ready - 30).sort((x, y) => x.at - y.at);
      const next = arr[0];
      if (!next || next.at - nowS > LATER_S) { ok = false; break; }
      let ride = 0;
      for (let k = r.i + 1; k <= r.j; k++) ride += distM(pt(seq[k - 1]), pt(seq[k]));
      const lk = look(r.line), id = `oasa:${r.line}`;
      lines[id] ??= { id, mode: lk.mode, label: lk.label, name: "", name_en: null, color: lk.color, text_color: lk.text, source: "oasa" };
      legs.push({ kind: "ride", from: { stop: bId, lat: pt(kb)[0], lon: pt(kb)[1] }, to: { stop: aId, lat: pt(ka)[0], lon: pt(ka)[1] },
        depart_at: next.at, arrive_at: next.at + ride / RIDE_MPS, shape: seq.slice(r.i, r.j + 1).map(pt), distance_m: Math.round(ride),
        line: id, mode: lk.mode, headsign: next.headsign || ix.s[seq[seq.length - 1]][0], hops: r.j - r.i, source: next.source });
      at = next.at + ride / RIDE_MPS;
      here = pt(ka);
      hereStop = aId;
    }
    if (!ok) continue;
    const last = walkLeg(here, to, at, null, hereStop);
    if (last.distance_m! >= 20) legs.push(last);
    const end = legs[legs.length - 1].arrive_at;
    // Leave as late as the first bus allows: the walk to it ends when it comes.
    if (legs[0].kind === "walk" && legs[1]?.kind === "ride") { const w = legs[0].arrive_at - legs[0].depart_at; legs[0] = { ...legs[0], depart_at: legs[1].depart_at - w, arrive_at: legs[1].depart_at }; }
    its.push({ depart_at: legs[0].depart_at, arrive_at: end, duration_s: end - legs[0].depart_at, transfers: opt.length - 1,
      walk_m: legs.filter(l => l.kind === "walk").reduce((t, l) => t + (l.distance_m ?? 0), 0), modes: [...new Set(opt.map(r => look(r.line).mode))], legs });
  }
  if (!its.length) return null;
  its.sort((a, b) => a.arrive_at - b.arrive_at);
  return { service_day: "", from: { lat: from[0], lon: from[1] }, to: { lat: to[0], lon: to[1] }, after: nowS, last: true, itineraries: its,
    walk_only: null, lines, stops, sources: [], estimate: true };
}
