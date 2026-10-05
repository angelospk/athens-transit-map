// Fixture-backed fake backend for VITE_MOCK=1. Mimics a 30 s server cycle: each vehicle drives
// along its route shape at MOCK_SPEED (restarting at the end), its GPS fix a few seconds old.

import type { FetchResult } from "./poller";
import { pointAt, projectCandidates, shapeLength, stopOffsets } from "./predict";
import type { CityLive, CityVehicle, LineLive, LineStatic, LinesIndex, Status, Vehicle } from "./types";

const files = import.meta.glob<{ default: unknown }>("../fixtures/*.json", { eager: true });
const fixture = <T>(name: string) => files[`../fixtures/${name}.json`]?.default as T | undefined;

export const CYCLE_S = 30;
export const MOCK_SPEED = 7;   // m/s, about 25 km/h

export function mockLineAt(line: string, nowSec: number): FetchResult {
  const live = fixture<LineLive>(`line-${line}`);
  const st = fixture<LineStatic>(`lines-${line}`);
  const cycle = Math.floor(nowSec / CYCLE_S);
  const updated = cycle * CYCLE_S;
  if (!live) {
    const known = fixture<LinesIndex>("lines")?.lines.some(l => l.id === line);
    return known
      ? { status: 200, body: { line, updated_at: updated, next_update_at: updated + CYCLE_S, vehicles: [] } }
      : { status: 404, body: { error: "unknown_line" } };
  }
  const vehicles = live.vehicles.map((v, i) => {
    const at = updated - 3 - (i % 20);
    const variant = v.variant ? st?.variants[v.variant] : undefined;
    if (!variant || variant.shape.length < 2) return { ...v, position_at: at };
    const len = shapeLength(variant.shape);
    const s0 = projectCandidates(variant.shape, [v.lon, v.lat])[0]?.s ?? 0;
    const s = (s0 + MOCK_SPEED * at) % len;
    const [lon, lat] = pointAt(variant.shape, s);
    const known = variant.stops.filter(id => st!.stops[id]);
    const stopS = stopOffsets(variant.shape, known.map(id => [st!.stops[id].lon, st!.stops[id].lat] as [number, number]));
    const next = known.find((_, k) => stopS[k] > s) ?? null;
    const nextS = stopS[known.indexOf(next ?? "")] ?? len;
    // Moved, so the fixture's bearing is wrong.
    return { ...v, lat, lon, bearing: null, position_at: at, next_stop_id: next,
      speed: MOCK_SPEED, path: pathAhead(variant.shape, s, Math.min(nextS, s + 1500)) };
  });
  return { status: 200, body: { line, updated_at: updated, next_update_at: updated + CYCLE_S, vehicles } };
}

// Shape points from s to end (metres along it), as [lat, lon], like the backend's `path`.
function pathAhead(shape: [number, number][], s: number, end: number): [number, number][] {
  const at = (m: number): [number, number] => { const [lon, lat] = pointAt(shape, m); return [lat, lon]; };
  const out = [at(s)];
  let walked = 0;
  for (let i = 1; i < shape.length && walked < end; i++) {
    walked += shapeLength([shape[i - 1], shape[i]]);
    if (walked > s && walked < end) out.push(shape[i]);
  }
  out.push(at(end));
  return out;
}

// Synthetic city: the fixture lines plus SYNTHETIC vehicles, each driving round its own square
// (600 m sides) somewhere in Athens, labelled with real line ids.
export const SYNTHETIC = 1500;
const rnd = (i: number, k: number) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };

export function mockCityAt(nowSec: number): FetchResult {
  const updated = Math.floor(nowSec / CYCLE_S) * CYCLE_S;
  const ids = (fixture<LinesIndex>("lines")?.lines ?? []).map(l => l.id);
  const vehicles: CityVehicle[] = [];
  for (const line of ["040", "550", "2", "Α1"]) {
    const b = mockLineAt(line, nowSec).body as LineLive;
    for (const v of b.vehicles) vehicles.push({ line, id: v.id, lat: v.lat, lon: v.lon, bearing: v.bearing,
      position_at: v.position_at, variant: v.variant, delay_s: v.delay_s, speed: v.speed ?? null, path: v.path ?? null });
  }
  const side = 600 / 111_320;
  for (let i = 0; i < SYNTHETIC; i++) {
    const lat0 = 37.92 + rnd(i, 1) * 0.15, lon0 = 23.62 + rnd(i, 2) * 0.24, dlon = side / Math.cos(lat0 * Math.PI / 180);
    const sq: [number, number][] = [[lat0, lon0], [lat0, lon0 + dlon], [lat0 + side, lon0 + dlon], [lat0 + side, lon0], [lat0, lon0]];
    const loop = [...sq, ...sq.slice(1)];   // twice round, so a path can wrap
    const at = updated - 3 - (i % 40), speed = 3 + rnd(i, 3) * 8;
    const s = (rnd(i, 4) * 2400 + speed * at) % 2400;
    const [lon, lat] = pointAt(loop, s);
    const d = rnd(i, 5);
    vehicles.push({ line: ids[i % Math.max(1, ids.length)] ?? "040", id: `S${i}`, lat, lon, bearing: null, position_at: at,
      variant: null, delay_s: d < 0.1 ? null : Math.round(d * 900 - 60), speed: i % 10 ? speed : null,
      path: pathAhead(loop, s, s + 800) });
  }
  return { status: 200, body: { updated_at: updated, next_update_at: updated + CYCLE_S, vehicles } satisfies CityLive };
}

export const mockCity = async () => mockCityAt(Date.now() / 1000);

export const mockLine = async (line: string) => mockLineAt(line, Date.now() / 1000);

export async function mockStatus(): Promise<Status> {
  return { ...fixture<Status>("status")!, updated_at: Math.floor(Date.now() / 1000) };
}

export async function mockLines(): Promise<LinesIndex> {
  return fixture<LinesIndex>("lines")!;
}

export async function mockLineStatic(line: string): Promise<LineStatic> {
  const st = fixture<LineStatic>(`lines-${line}`);
  if (!st) throw new Error("no fixture for line " + line);
  return st;
}
