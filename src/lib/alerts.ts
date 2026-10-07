// Stop alerts: a bus that makes the trip comes within n stops of the boarding stop. Pure, so a
// server (the Telegram bot) can use the same rule. Design: docs/superpowers/specs/2026-10-07-stop-alerts-design.md.

import type { LineLive, LineStatic, Vehicle } from "./types";

export const MAX_FIX_AGE_S = 120;   // an older position says nothing about where the bus is now
const KEEP_S = 2 * 3600;            // a fired trip is not fired again for this long

// Stops left to the boarding stop stops[i], itself included (1 = the bus's next stop is yours), or
// null: passed, unknown next stop, or an old fix. A next stop the variant passes twice (loops) says
// nothing about which pass it is: null until the bus reaches another stop.
export function approaching(stops: string[], i: number, v: Vehicle, nowS: number): number | null {
  if (!v.next_stop_id || !(nowS - v.position_at <= MAX_FIX_AGE_S) || i < 0 || i >= stops.length) return null;
  const k = stops.indexOf(v.next_stop_id);
  if (k < 0 || k > i || stops.indexOf(v.next_stop_id, k + 1) >= 0) return null;
  return i - k + 1;
}

// until: Unix s. name: the boarding stop's name in the planner's index; a static file with another
// name there is from other GTFS data, so its stop positions do not match.
export interface AlertSpec { n: number; until: number; lines: { line: string; variants: { id: string; i: number; name?: string }[] }[] }
export interface AlertHit { line: string; vehicle: string; left: number; stop: string; delay_s: number | null }

// Fires each trip once per alert; an alert with another end time is a new alert.
export class AlertWatch {
  private fired = new Map<string, number>();   // trip key → when fired (s)
  private until = NaN;

  check(spec: AlertSpec, live: Record<string, LineLive>, statics: Record<string, LineStatic>, nowS: number): AlertHit[] {
    if (spec.until !== this.until) { this.fired.clear(); this.until = spec.until; }
    for (const [k, at] of this.fired) if (nowS - at > KEEP_S) this.fired.delete(k);
    const hits: AlertHit[] = [];
    if (nowS > spec.until) return hits;
    for (const { line, variants } of spec.lines) {
      const st = statics[line];
      if (!st) continue;
      for (const v of live[line]?.vehicles ?? []) {
        const at = variants.find(x => x.id === v.variant);
        const stops = at && st.variants[at.id]?.stops;
        if (!at || !stops || (at.name != null && st.stops[stops[at.i]]?.name.trim() !== at.name)) continue;
        const left = approaching(stops, at.i, v, nowS);
        if (left == null || left < 1 || left > spec.n) continue;
        const key = `${line}|${v.trip_id ?? `${v.id}|${v.variant}`}|${at.i}`;
        if (this.fired.has(key)) continue;
        this.fired.set(key, nowS);
        hits.push({ line, vehicle: v.id, left, stop: stops[at.i], delay_s: v.delay_s });
      }
    }
    return hits;
  }
}
