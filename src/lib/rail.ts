// Metro and tram departures from the STASY timetable (not live): GET /v1/rail/stasy/departures.

import { API_BASE } from "./config";
import { distanceM } from "./glide";
import { TRANSFER_M, type MetroStation } from "./metro";
import { fold } from "./search";

export interface StasyDeparture { line: string; route_color: string; headsign: string; t: string; in_s: number }
export interface StasyBoard { stop: string; indicative: boolean; departures: StasyDeparture[] }
export interface BoardRow { line: string; color: string; headsign: string; mins: number[]; times: string[] }

// The same query as the Android app (n=4), so both share one Cloudflare cache entry.
export const stasyUrl = (name: string) => `${API_BASE}/v1/rail/stasy/departures?stop=${encodeURIComponent(name)}&n=4`;

// The feed names an interchange differently per line (ΣΥΝΤΑΓΜΑ / Σύνταγμα (Κέντρο)): ask every name this close.
export function stationNames(stations: MetroStation[], name: string): string[] {
  const s = stations.find(x => x.name === name);
  if (!s) return [name];
  return [name, ...stations.filter(o => o !== s && o.name !== name && distanceM([s.lon, s.lat], [o.lon, o.lat]) <= TRANSFER_M).map(o => o.name)];
}

// One row per line and headsign, the soonest first. `elapsedS`: seconds since the boards were fetched.
// Only the next hour: left out are a train that ends at the station, one gone more than 30 s ago and
// one further than HORIZON_S (rare runs, such as the last to a depot, otherwise get a row of their own).
export const HORIZON_S = 3600;
export function boardRows(boards: StasyBoard[], elapsedS: number, max = 3): BoardRow[] {
  const all = boards.flatMap(b => b.departures.filter(d => fold(d.headsign) !== fold(b.stop)))
    .map(d => ({ d, left: d.in_s - elapsedS })).filter(x => x.left >= -30 && x.left <= HORIZON_S).sort((x, y) => x.left - y.left);
  const rows = new Map<string, BoardRow>();
  const seen = new Set<string>();
  for (const { d, left } of all) {
    const id = `${d.line}|${d.headsign}|${d.t}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const key = `${d.line}|${d.headsign}`;
    const r = rows.get(key) ?? { line: d.line, color: d.route_color, headsign: d.headsign, mins: [], times: [] };
    rows.set(key, r);
    if (r.times.length >= max) continue;
    r.mins.push(Math.max(0, Math.floor(left / 60)));
    r.times.push(d.t);
  }
  return [...rows.values()];   // in the order of their first train
}

// The card's boards after a round of requests (one per name). It counts only when every name answered
// (404: a name the server's feed lacks, so no trains): a missing name would hide its lines. A failed
// round drops the boards, so old rows never turn into "no trains".
export interface Boards { boards: StasyBoard[] | null; at: number; failed: "" | "warming" | "error" }
// A cached answer (`at`: client ms when it came) has its trains counted down by its own age, so
// boards of different ages merge at nowMs.
export function nextBoards(rs: { status: number; body: unknown; at?: number }[], nowMs: number): Boards {
  const ok = rs.filter(r => r.status === 200 && r.body);
  const aged = (r: (typeof rs)[number]) => {
    const b = r.body as StasyBoard, age = r.at == null ? 0 : Math.max(0, (nowMs - r.at) / 1000);
    return age ? { ...b, departures: b.departures.map(d => ({ ...d, in_s: d.in_s - age })) } : b;
  };
  if (ok.length && rs.every(r => (r.status === 200 && r.body) || r.status === 404))
    return { boards: ok.map(aged), at: nowMs, failed: "" };
  return { boards: null, at: nowMs, failed: rs.some(r => r.status === 503) ? "warming" : "error" };
}
