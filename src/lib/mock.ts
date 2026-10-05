// Fixture-backed fake backend for VITE_MOCK=1. Mimics a 30 s server cycle:
// every cycle each vehicle moves one point along its route shape (wrapping at the end).

import type { FetchResult } from "./poller";
import type { LineLive, LineStatic, LinesIndex, Status, Vehicle } from "./types";

const files = import.meta.glob<{ default: unknown }>("../fixtures/*.json", { eager: true });
const fixture = <T>(name: string) => files[`../fixtures/${name}.json`]?.default as T | undefined;

export const CYCLE_S = 30;

function nearest(shape: [number, number][], v: Vehicle) {
  let best = 0, bestD = Infinity;
  shape.forEach(([lat, lon], i) => {
    const d = (lat - v.lat) ** 2 + (lon - v.lon) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

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
    const shape = (v.variant && st?.variants[v.variant]?.shape) || [];
    if (!shape.length) return { ...v, position_at: updated - 3 - (i % 20) };
    const at = (nearest(shape, v) + cycle) % shape.length;
    const [lat, lon] = shape[at];
    return { ...v, lat, lon, position_at: updated - 3 - (i % 20) };
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
