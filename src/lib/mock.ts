// Fixture-backed fake backend for VITE_MOCK=1. Mimics a 30 s server cycle: each vehicle drives
// along its route shape at MOCK_SPEED (restarting at the end), its GPS fix a few seconds old.

import type { FetchResult } from "./poller";
import { pointAt, projectCandidates, shapeLength, stopOffsets } from "./predict";
import type { LineLive, LineStatic, LinesIndex, Status, Vehicle } from "./types";

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
    // Moved, so the fixture's bearing is wrong.
    return { ...v, lat, lon, bearing: null, position_at: at, next_stop_id: next };
  });
  return { status: 200, body: { line, updated_at: updated, next_update_at: updated + CYCLE_S, vehicles } };
}

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
