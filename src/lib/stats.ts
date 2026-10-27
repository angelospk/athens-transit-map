// Daily network statistics from the backend (docs/API.md "Daily statistics" in athens-transit-rt),
// read from its `stats` branch on GitHub so the home server does not serve them.
import { STATS_BASE } from "./config";

export type HourStats = { h: number; fixes: number; vehicles: number; lines: number; dist_m: number; time_s: number };
export type LineStats = { line: string; fixes: number; vehicles: number; dist_m: number; time_s: number };
type TripCount = { planned: number; run: number; partial: number; missed: number; unmeasured: number };
export type TripLine = TripCount & { line: string; missed_trips: string[] | null };
export type TripStats = TripCount & { gtfs: string; gtfs_expired: boolean; min_coverage: number; by_line: TripLine[] };
export type DayStats = {
  version: number; date: string; tz: string; generated_at: number; first_fix: number; last_fix: number;
  files: number; fixes: number; vehicles: number; lines: number; hours: HourStats[]; by_line: LineStats[];
  trips?: TripStats; // missing on days before 2026-10-27 or without a static GTFS
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

export const MIN_LINE_TRIPS = 20; // measured trips before a line is ranked by missed trips

// Share of the measured scheduled trips that ran, and the n lines with the largest share never seen.
// A line with no trip seen at all is counted in `unseen`, not ranked: it may not have run at all,
// or its timetable changed (an expired GTFS still lists it).
export function tripShare(d: DayStats, n = 5) {
  const t = d.trips;
  const measured = t ? t.planned - t.unmeasured : 0;
  if (!t || measured <= 0) return null;
  const worst = t.by_line
    .filter(l => l.run + l.partial > 0)
    .map(l => ({ line: l.line, missed: l.missed, measured: l.planned - l.unmeasured }))
    .filter(l => l.missed > 0 && l.measured >= MIN_LINE_TRIPS)
    .sort((a, b) => b.missed / b.measured - a.missed / a.measured || a.line.localeCompare(b.line))
    .slice(0, n);
  const unseen = t.by_line.filter(l => l.planned > l.unmeasured && l.run + l.partial === 0).length;
  return { share: t.run / measured, run: t.run, measured, expired: t.gtfs_expired, gtfs: t.gtfs, worst, unseen };
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

// ---- Long-term: the stored days combined. Speeds are pooled (sum dist / sum time), never a mean of means.

export const LONG_DAYS = 28; // newest day files read for the long-term tab

// A day without gaps; partial days are left out of every long-term figure.
export const complete = (d: DayStats) => gaps(d).length === 0;

export const isWeekend = (date: string) => [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay());

export type HourBand = { h: number; kmh: number | null; min: number | null; max: number | null; n: number };

// Per local hour: pooled km/h over the days, the slowest and fastest day, and the days with a speed.
export function hourBand(days: DayStats[]): HourBand[] {
  return Array.from({ length: 24 }, (_, h) => {
    let dist = 0, time = 0, min: number | null = null, max: number | null = null, n = 0;
    for (const d of days) {
      const v = kmh(d.hours[h].dist_m, d.hours[h].time_s);
      if (v == null) continue;
      dist += d.hours[h].dist_m; time += d.hours[h].time_s; n++;
      min = min == null ? v : Math.min(min, v);
      max = max == null ? v : Math.max(max, v);
    }
    return { h, kmh: kmh(dist, time), min, max, n };
  });
}

export type TypeHour = { h: number; vehicles: number | null; kmh: number | null };
export type DayType = { days: number; hours: TypeHour[] };

// Weekdays and weekend apart: vehicles per hour as a plain mean of the days (a count), speed pooled.
export function byDayType(days: DayStats[]): { weekday: DayType; weekend: DayType } {
  const group = (ds: DayStats[]): DayType => ({
    days: ds.length,
    hours: Array.from({ length: 24 }, (_, h) => ({
      h,
      vehicles: ds.length ? ds.reduce((s, d) => s + d.hours[h].vehicles, 0) / ds.length : null,
      kmh: kmh(ds.reduce((s, d) => s + d.hours[h].dist_m, 0), ds.reduce((s, d) => s + d.hours[h].time_s, 0)),
    })),
  });
  return { weekday: group(days.filter(d => !isWeekend(d.date))), weekend: group(days.filter(d => isWeekend(d.date))) };
}

export type Trend = { line: string; kmh: number; base: number; change: number };

// The newest day's lines against the earlier days of the same type (weekday or weekend), pooled.
// Both sides need minHours of speed samples. null: fewer than 2 earlier days of that type.
export function lineTrends(days: DayStats[], n: number, minHours = MIN_LINE_HOURS) {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted.at(-1);
  if (!latest) return null;
  const weekend = isWeekend(latest.date);
  const base = sorted.slice(0, -1).filter(d => isWeekend(d.date) === weekend);
  if (base.length < 2) return null;
  const sums = new Map<string, { dist: number; time: number }>();
  for (const d of base) for (const l of d.by_line) {
    const s = sums.get(l.line) ?? { dist: 0, time: 0 };
    s.dist += l.dist_m; s.time += l.time_s;
    sums.set(l.line, s);
  }
  const all: Trend[] = [];
  for (const l of latest.by_line) {
    const s = sums.get(l.line);
    if (!s || l.time_s < minHours * 3600 || s.time < minHours * 3600 || s.dist <= 0) continue;
    const now = (l.dist_m / l.time_s) * 3.6, was = (s.dist / s.time) * 3.6;
    all.push({ line: l.line, kmh: now, base: was, change: now / was - 1 });
  }
  return {
    date: latest.date, weekend, baseDays: base.length, eligible: all.length,
    slower: all.filter(t => t.change < 0).sort((a, b) => a.change - b.change || a.line.localeCompare(b.line)).slice(0, n),
    faster: all.filter(t => t.change > 0).sort((a, b) => b.change - a.change || a.line.localeCompare(b.line)).slice(0, n),
  };
}

const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const zone = (tz: unknown) => {
  try {
    return typeof tz === "string" && !!new Intl.DateTimeFormat("en-GB", { timeZone: tz });
  } catch {
    return false; // gaps() would throw on it
  }
};

// A day file as docs/API.md describes it, and the day that was asked for.
export function validDay(d: unknown, date: string): d is DayStats {
  const x = d as DayStats | null;
  return !!x && x.version === 1 && x.date === date && zone(x.tz) && num(x.first_fix) && num(x.last_fix) && num(x.fixes)
    && Array.isArray(x.hours) && x.hours.length === 24
    && x.hours.every((h, i) => h?.h === i && [h.fixes, h.vehicles, h.dist_m, h.time_s].every(num))
    && Array.isArray(x.by_line) && x.by_line.every(l => typeof l?.line === "string" && [l.dist_m, l.time_s].every(num));
}

export type Stored = { days: DayStats[]; partial: number; bad: number };

const TIMEOUT = 15_000;
// null for 404. A body that is not JSON throws, or gives null when `lenient` (a day file: counted as bad).
const get = async (path: string, lenient = false) => {
  const r = await fetch(`${STATS_BASE}/${path}`, { signal: AbortSignal.timeout(TIMEOUT) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`stats: HTTP ${r.status}`);
  const text = await r.text();
  try {
    return JSON.parse(text) as unknown;
  } catch (e) {
    if (lenient) return null;
    throw e;
  }
};

// The newest LONG_DAYS complete days, oldest first; null before the first day exists. A fetch
// failure throws and is not cached; a missing or malformed file is skipped and counted in `bad`.
let stored: { at: number; load: Promise<Stored | null> } | null = null;
export function storedDays(now = Date.now()): Promise<Stored | null> {
  if (stored && now - stored.at < 3600_000) return stored.load;
  const load = (async () => {
    const index = (await get("index.json")) as { days?: unknown } | null;
    if (!index) return null;
    if (!Array.isArray(index.days)) throw new Error("stats: unknown index format");
    const dates = (index.days as unknown[]).filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort().slice(-LONG_DAYS);
    const files = await Promise.all(dates.map(d => get(`days/${d}.json`, true)));
    const ok = files.filter((f, i): f is DayStats => validDay(f, dates[i]));
    const days = ok.filter(complete);
    return { days, partial: ok.length - days.length, bad: files.length - ok.length };
  })();
  stored = { at: now, load };
  load.catch(() => { if (stored?.load === load) stored = null; });
  return load;
}
