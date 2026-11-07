// Where the bus of a planned ride is now: the arrival at its board stop that matches the ride's time, and, when that
// arrival comes from a vehicle, how many stops before the board stop the vehicle is. For the route cards of «Πού πας;»
// (a line on the card) and «Θύμισέ μου» (when to leave). The metro and the tram have no live positions: their rides
// keep the timetable's time.

import { fetchV2LineVehicles, fetchV2Stop } from "./api";
import { metres, type Guide, type GuideRide } from "./guide";
import { fold } from "./search";
import { placeNote, toward } from "./stops";
import { stopRows, type V2Arrival, type V2Vehicle } from "./v2";

export interface BusNow {
  at: number;              // when it reaches the board stop (s)
  live: boolean;           // from a vehicle, not the timetable
  away: number | null;     // stops before the board stop (0: at it); null: further than the stops known, or unknown
  before: number;          // how many stops before the board stop are known (the line's dots)
  vehicle: string | null;
  next: number | null;     // the one after it at the board stop (s)
}

// «Θύμισέ μου» (RemindSheet sets it, LeaveReminder follows it): a planned trip whose first ride is watched, to say
// when to leave: the bus's time at its stop, less the walk there, less the minutes the user wants to get ready.
export interface LeaveRemind {
  key: string;
  to: string;                 // where the trip goes, for the words
  line: string;               // the first ride's line, as its badge says
  mode: string;
  board: string;              // the stop to board at
  ride: GuideRide | null;     // the first ride, when it has live positions (a bus, a trolley)
  plannedAt: number;          // the first ride's time at its stop (s)
  walkS: number;              // the walk to that stop
  prepMin: number;            // the minutes to get ready
  leaveAt: number;            // when to leave, as last worked out (s)
  said: number;               // the leave time the user was last told
  away: number | null;        // the bus's stops before the board stop, last seen
  live: boolean;
  next: number | null;        // the next bus after it at the stop (for «Το επόμενο»)
  fired: boolean;
  guide: Guide;               // «Ξεκίνα» from the notice
}

// The rides that have live positions: buses and trolleys (OASA).
export const isLiveMode = (mode: string) => mode !== "metro" && mode !== "tram" && mode !== "rail" && mode !== "suburban";

/** The ride's bus now: the arrival nearest its planned time (within 20 min), and where its vehicle is. */
export async function busNow(ride: GuideRide, plannedAt: number, nowS: number): Promise<BusNow | null> {
  if (!ride.board.id) return null;
  const res = await fetchV2Stop(`oasa:${ride.board.id}`);
  const arr = (res.body as { arrivals?: V2Arrival[] } | null)?.arrivals ?? [];
  const rows = stopRows(arr, nowS).filter(x => x.line.replace(/^oasa:/, "") === ride.line);
  const same = rows.filter(x => fold(placeNote(toward(x.headsign)).place) === fold(ride.headsign));
  const times = (same.length ? same : rows).flatMap(r => r.times);
  let t = times[0], gap = Infinity;
  for (const x of times) { const d = Math.abs(x.at - plannedAt); if (d < gap) { gap = d; t = x; } }
  if (!t || gap > 20 * 60) return null;
  const later = times.filter(x => x.at > t.at + 30).sort((a, b) => a.at - b.at)[0];
  const out: BusNow = { at: t.at, live: t.live, away: null, before: ride.before.length, vehicle: t.vehicle, next: later?.at ?? null };
  if (!t.vehicle) return out;
  const vr = await fetchV2LineVehicles(`oasa:${ride.line}`);
  const v = ((vr.body as { vehicles?: V2Vehicle[] } | null)?.vehicles ?? []).find(x => x.id === t.vehicle);
  if (!v) return out;
  const at: [number, number] = [v.position.lat, v.position.lon];
  let k = -1, best = Infinity;
  ride.before.forEach((s, i) => { const d = metres(s.at, at); if (d < best) { best = d; k = i; } });
  const toBoard = metres(at, ride.board.at);
  out.away = toBoard < best ? 0 : k >= 0 && best < 400 ? ride.before.length - k : null;
  return out;
}
