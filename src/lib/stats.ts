// Daily network statistics from the backend (docs/API.md "Daily statistics" in athens-transit-rt),
// read from its `stats` branch on GitHub so the home server does not serve them.
import { STATS_BASE } from "./config";

export type HourStats = { h: number; fixes: number; vehicles: number; lines: number; dist_m: number; time_s: number };
export type LineStats = { line: string; fixes: number; vehicles: number; dist_m: number; time_s: number };
export type DayStats = {
  version: number; date: string; tz: string; generated_at: number; first_fix: number; last_fix: number;
  files: number; fixes: number; vehicles: number; lines: number; hours: HourStats[]; by_line: LineStats[];
};
export type Ranked = { line: string; kmh: number; km: number; hours: number };

export const MIN_LINE_HOURS = 15; // vehicle-hours of speed samples before a line is ranked
export const DATA_URL = "https://github.com/angelospk/athens-transit-rt/tree/stats/v1";

export const kmh = (dist_m: number, time_s: number): number | null => (time_s > 0 ? (dist_m / time_s) * 3.6 : null);

export const hourly = (d: DayStats) =>
  d.hours.map(h => ({ h: h.h, vehicles: h.vehicles, kmh: kmh(h.dist_m, h.time_s) }));

// The n slowest and n fastest lines with enough samples; a line is never in both lists.
export function ranking(d: DayStats, n: number, minHours = MIN_LINE_HOURS) {
  const all: Ranked[] = d.by_line
    .filter(l => l.time_s >= minHours * 3600)
    .map(l => ({ line: l.line, kmh: (l.dist_m / l.time_s) * 3.6, km: Math.round(l.dist_m / 1000), hours: Math.round(l.time_s / 3600) }))
    .sort((a, b) => a.kmh - b.kmh || a.line.localeCompare(b.line));
  const k = Math.min(n, Math.floor(all.length / 2));
  return { slow: all.slice(0, k), fast: all.slice(Math.max(all.length - n, k)).reverse(), eligible: all.length };
}

// Hours the day is partial in: before its first fix or after its last (history started late,
// or the day's end is missing), and service hours (05:00-24:00) without a single fix (an outage).
export function gaps(d: DayStats): number[] {
  if (!d.fixes) return d.hours.map(h => h.h);
  const hour = (t: number) => +new Intl.DateTimeFormat("en-GB", { timeZone: d.tz, hour: "numeric", hourCycle: "h23" }).format(t * 1000);
  const first = hour(d.first_fix), last = hour(d.last_fix);
  return d.hours.filter(h => h.h < first || h.h > last || (h.h >= 5 && h.fixes === 0)).map(h => h.h);
}

// The newest day, fetched again on a later call if the last try failed or is over an hour old.
let cache: { at: number; day: DayStats | null } | null = null;
export async function latestDay(now = Date.now()): Promise<DayStats | null> {
  if (cache && now - cache.at < 3600_000) return cache.day;
  const r = await fetch(`${STATS_BASE}/latest.json`);
  if (r.status === 404) {
    cache = { at: now, day: null };
    return null;
  }
  if (!r.ok) throw new Error(`stats: HTTP ${r.status}`);
  const day = (await r.json()) as DayStats;
  if (day.version !== 1 || day.hours?.length !== 24) throw new Error("stats: unknown format");
  cache = { at: now, day };
  return day;
}
