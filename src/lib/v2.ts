// Types and pure helpers for the unified /v2 API (athens-transit-rt docs/CONTRACT.md, "Unified API /v2"):
// headsign names, directions, stop-card rows, vehicle-card stops and position freshness.

import { ageLabel } from "./format";
import { fold } from "./search";

export interface V2Line {
  id: string; mode: string; label: string | null; name: string; name_en: string | null;
  color: string; text_color: string; source: string;
}

export interface V2Stop {
  id: string; name: string; name_en: string | null; lat: number; lon: number;
  modes: string[]; lines: string[]; source: string;
}

export interface V2Pattern {
  id: string; headsign: string; direction: 0 | 1; stops: string[]; shape: [number, number][];
}

export interface V2Arrival {
  line: string; stop: string; headsign: string; at: number; scheduled_at: number | null; delay_s: number | null;
  source: "live" | "timetable"; run: string | null; vehicle: string | null; vehicle_label: string | null;
  platform: string | null; status: string;
}

export interface V2Vehicle {
  id: string; line: string; run: string | null; mode: string; headsign: string; label: string | null;
  position: { kind: "gps" | "estimate"; lat: number; lon: number; bearing: number | null; at: number };
  delay_s: number | null; next_stop: string | null; motion: unknown; source: string;
  direction?: 0 | 1 | null;
}

export interface V2RunStop {
  stop: string; scheduled_at: number | null; at: number; delay_s: number | null;
  source: "live" | "timetable"; platform: string | null; passed: boolean;
}

export interface V2Run {
  id: string; line: string; headsign: string; pattern: string | null; vehicle: string | null;
  vehicle_label: string | null; status: string; stops: V2RunStop[];
}

export interface LineDetail {
  line: V2Line; patterns: V2Pattern[]; stops: Record<string, V2Stop>;
}

type Stops = Record<string, V2Stop> | V2Stop[];

const key = (s: string) => fold(s).replace(/\s+/g, " ").trim();

// An all-caps headsign that names a stop takes that stop's name (and case). One that abbreviates a stop's words
// («Δ. ΠΛΑΚΕΝΤΙΑΣ» for Δουκίσσης Πλακεντίας) takes the case of each word: «Δ. Πλακεντίας».
export function headsignName(h: string, stops?: Stops): string {
  if (!stops || h !== h.toLocaleUpperCase("el")) return h;
  const k = key(h);
  const all = Object.values(stops);
  const exact = all.find(s => key(s.name) === k);
  if (exact) return exact.name;
  const hw = h.trim().split(/\s+/);
  const fits = (sw: string[]) => sw.length === hw.length && hw.every((w, i) =>
    w.endsWith(".") ? key(sw[i]).startsWith(key(w.slice(0, -1))) : key(sw[i]) === key(w));
  const sw = all.map(s => s.name.trim().split(/\s+/)).find(fits);
  if (!sw) return h;
  const abbr = (w: string) => w[0] + w.slice(1).toLocaleLowerCase("el");
  return hw.map((w, i) => (w.endsWith(".") ? abbr(w) : sw[i])).join(" ");
}

export function dirOf(patterns: V2Pattern[], headsign: string): 0 | 1 | null {
  const k = key(headsign);
  return patterns.find(p => key(p.headsign) === k)?.direction ?? null;
}

export function vehicleDir(v: V2Vehicle, patterns: V2Pattern[]): 0 | 1 | null {
  return v.direction === 0 || v.direction === 1 ? v.direction : dirOf(patterns, v.headsign);
}

// Per direction: the headsign with the most patterns (tie: the longer pattern).
export function dirLabels(patterns: V2Pattern[], stops?: Stops): [string | null, string | null] {
  const label = (d: 0 | 1) => {
    const groups = new Map<string, { headsign: string; n: number; stops: number }>();
    for (const p of patterns) {
      if (p.direction !== d) continue;
      const g = groups.get(key(p.headsign)) ?? { headsign: p.headsign, n: 0, stops: 0 };
      g.n += 1;
      g.stops = Math.max(g.stops, p.stops.length);
      groups.set(key(p.headsign), g);
    }
    const best = [...groups.values()].sort((a, b) => b.n - a.n || b.stops - a.stops)[0];
    return best ? headsignName(best.headsign, stops) : null;
  };
  return [label(0), label(1)];
}

export interface StopRow {
  line: string;
  dir: 0 | 1 | null;
  headsign: string;
  times: { at: number; live: boolean; delay_s: number | null; run: string | null; vehicle: string | null; platform: string | null }[];
  vehicle: string | null;
}

// Arrivals of a stop as rows: one per line and direction, the next 3 times each.
export function stopRows(
  arrivals: V2Arrival[], nowS: number, patternsByLine: Record<string, V2Pattern[]> = {}, stops?: Stops,
): StopRow[] {
  const sorted = arrivals.filter(a => a.at >= nowS - 60).sort((a, b) => a.at - b.at);
  const groups = new Map<string, { dir: 0 | 1 | null; list: V2Arrival[] }>();
  for (const a of sorted) {
    const dir = dirOf(patternsByLine[a.line] ?? [], a.headsign);
    const k = `${a.line}|${dir ?? "h:" + key(a.headsign)}`;
    const g = groups.get(k) ?? { dir, list: [] };
    g.list.push(a);
    groups.set(k, g);
  }
  return [...groups.values()]
    .map(({ dir, list }) => ({
      line: list[0].line,
      dir,
      headsign: headsignName(list[0].headsign, stops),
      times: list.slice(0, 3).map(a => ({
        at: a.at, live: a.source === "live", delay_s: a.delay_s, run: a.run, vehicle: a.vehicle, platform: a.platform,
      })),
      vehicle: list.find(a => a.vehicle)?.vehicle ?? null,
    }))
    .sort((a, b) => a.times[0].at - b.times[0].at);
}

// The stops a run has still ahead.
export function nextStops(run: V2Run, max = 8) {
  return run.stops
    .filter(s => !s.passed)
    .slice(0, max)
    .map(s => ({ stop: s.stop, at: s.at, live: s.source === "live", platform: s.platform }));
}

// Age of a GPS fix (red over 90″); an estimate comes from the timetable.
export function freshness(v: V2Vehicle, nowS: number): { text: string; warn: boolean } {
  if (v.position.kind === "estimate") return { text: "πρόγραμμα", warn: false };
  const age = nowS - v.position.at;
  return { text: ageLabel(age), warn: age > 90 };
}

export interface VehicleRow { id: string; label: string | null; next: string | null; delay_s: number | null; vehicle: V2Vehicle }

// A line card's vehicles of one direction, from the start of the line to its end (by the place of their next
// stop on the direction's longest pattern that has it; none last). A vehicle of no known direction shows in both.
export function lineVehicleRows(vehicles: V2Vehicle[], patterns: V2Pattern[], stops: Record<string, V2Stop>, dir: 0 | 1): VehicleRow[] {
  const mine = patterns.filter(p => p.direction === dir).sort((a, b) => b.stops.length - a.stops.length);
  const place = (s: string | null) => {
    const p = s ? mine.find(x => x.stops.includes(s)) : undefined;
    return p ? p.stops.indexOf(s!) : Infinity;
  };
  return vehicles
    .filter(v => { const d = vehicleDir(v, patterns); return d === null || d === dir; })
    .map(v => ({ v, k: place(v.next_stop) }))
    .sort((a, b) => (a.k === b.k ? 0 : a.k - b.k))
    .map(({ v }) => ({
      id: v.id, label: v.label, next: v.next_stop ? stops[v.next_stop]?.name ?? null : null, delay_s: v.delay_s, vehicle: v,
    }));
}

// /v2 gives every OASA pattern direction 0 (2026-10-30). Then the line's two direction groups (directions.ts,
// from /v1) set each pattern's direction, by its variant (pattern id "oasa:<variant>"). Real directions stay.
export function withDirections(patterns: V2Pattern[], groups: { variants: string[] }[]): V2Pattern[] {
  if (groups.length !== 2 || new Set(patterns.map(p => p.direction)).size !== 1) return patterns;
  return patterns.map(p => {
    const v = p.id.slice(p.id.indexOf(":") + 1);
    const d = groups.findIndex(g => g.variants.includes(v));
    return d < 0 ? p : { ...p, direction: d as 0 | 1 };
  });
}

// The note over a card's times: live times are bold, timetable times italic (RailStopCard, VehicleCard).
export function timesNote(times: { live: boolean }[]): string | null {
  if (!times.length) return null;
  const live = times.some(t => t.live), sched = times.some(t => !t.live);
  return live && sched ? "έντονα: ζωντανά · πλάγια: πρόγραμμα" : live ? "ζωντανά" : "πρόγραμμα";
}
