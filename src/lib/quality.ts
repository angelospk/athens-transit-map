// The line card's quality pill (staseis-rt docs/QUALITY.md, design v3, docs/mockups/quality-v3.html):
// one day's stats of the line on a 3-bar level meter. A frequent direction: the wait at the stop and how
// even its buses ran (cv_h of `headways`). A sparse citybus.gr line: its share of runs that left the
// origin on time (`origin_otp`, per line). The day is yesterday, or the day before while yesterday's file
// is not written yet. No data, no pill.
import { STATS_BASE } from "./config";
import { CITYBUS } from "./citybus";
import type { CityId } from "./cities";

export type Level = 1 | 2 | 3;   // lit bars: 3 normal (green), 2 yellow, 1 red

export type Headway = { line: string; dir: number; n: number; cv_h: number; wait_min: number; mean_headway_s: number; off_headway_share?: number };
export type LineOtp = { line: string; measured: number; on_time: number; early: number; late: number; share?: number };
// The parts of a day file (rt docs/API.md "Daily statistics") the pill reads.
export type QualityDay = {
  headways?: { from_h?: number; to_h?: number; by_line: Headway[] };
  origin_otp?: { by_line: LineOtp[]; early_s?: number; late_s?: number };   // rev 23: the on-time window
};

// `parts`: the text split so the number can carry the level's colour; parts.join("") === text.
export type Quality =
  | { kind: "wait"; level: Level; text: string; parts: [string, string, string]; h: Headway; from_h: number | null; to_h: number | null }
  | { kind: "otp"; level: Level; text: string; parts: [string, string, string]; o: LineOtp };

export const MIN_OTP_RUNS = 5;   // measured runs of a line before its on-time share is shown

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const list = <T>(v: { by_line?: unknown } | undefined) => (Array.isArray(v?.by_line) ? (v.by_line as T[]) : []);

// Minutes to the nearest half: «4½», «7», «½».
export function halfMin(m: number): string {
  const h = Math.round(m * 2) / 2, w = Math.floor(h);
  return h === w ? String(w) : w === 0 ? "½" : `${w}½`;
}

export const waitLevel = (cv_h: number): Level => (cv_h <= 0.39 ? 3 : cv_h <= 0.74 ? 2 : 1);
export const otpLevel = (share: number): Level => {
  const pct = Math.floor(share * 100 + 1e-9);   // whole percent rounded down, as the backend's band
  return pct >= 80 ? 3 : pct >= 70 ? 2 : 1;
};

// Minutes of a window: «5», or one decimal with a comma («1,5»).
const minutes = (s: number): string => {
  const m = Math.round(s / 6) / 10;   // one decimal of a minute
  return String(m).replace(".", ",");
};

// The on-time window of `origin_otp` (rt#178): a run is on time from early_s before to late_s after its
// scheduled time. An old day file has neither: from the scheduled time to 5 minutes after.
export function onTimeWindow(o: { early_s?: number; late_s?: number } | undefined): string {
  const late = num(o?.late_s) ? o!.late_s! : 300;
  const early = num(o?.early_s) ? o!.early_s! : 0;
  return early > 0
    ? `από ${minutes(early)}′ νωρίτερα έως ${minutes(late)}′ αργότερα`
    : `από την ώρα του έως ${minutes(late)}′ αργότερα`;
}

// dir: the stats direction of the shown direction (0 Go / 1 Come in Athens, GTFS direction_id in
// Thessaloniki), null when it is not known; the on-time share is per line and does not need it.
export function lineQuality(day: QualityDay | null, line: string, dir: number | null): Quality | null {
  if (!day) return null;
  const h = dir === null ? undefined : list<Headway>(day.headways).find(x => x?.line === line && x.dir === dir);
  if (h && num(h.cv_h) && num(h.wait_min) && num(h.mean_headway_s)) {
    const level = waitLevel(h.cv_h);
    const usual = level === 3 ? "" : ` (κανονικά ~${halfMin(h.mean_headway_s / 2 / 60)}′)`;
    const from = day.headways?.from_h, to = day.headways?.to_h;
    const min = `~${halfMin(h.wait_min)}′`;
    return { kind: "wait", level, text: `αναμονή ${min}${usual}`, parts: ["αναμονή ", min, usual], h,
      from_h: num(from) ? from : null, to_h: num(to) ? to : null };
  }
  const o = list<LineOtp>(day.origin_otp).find(x => x?.line === line);
  if (o && num(o.measured) && o.measured >= MIN_OTP_RUNS && num(o.share) && o.share <= 1) {
    const n = `${Math.round(o.share * 10)} στα 10`;
    return { kind: "otp", level: otpLevel(o.share), text: `${n} δρομολόγια στην ώρα`, parts: ["", n, " δρομολόγια στην ώρα"], o };
  }
  return null;
}

// The line id in the stats: the native id ("040") in Athens and Thessaloniki, the card's namespaced id
// ("pat:601") in a citybus.gr city.
export const statsLineId = (city: CityId, cardId: string) =>
  CITYBUS.some(c => c.slug === city) ? cardId : cardId.slice(cardId.indexOf(":") + 1);

// The date (YYYY-MM-DD) `back` days before today in Athens time; every city of the app is in that zone.
export function daysAgo(now: number, back: number): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new Date(Date.parse(`${today}T12:00:00Z`) - back * 86_400_000).toISOString().slice(0, 10);
}
export const yesterday = (now: number) => daysAgo(now, 1);

// The `n` dates that end at `end` (YYYY-MM-DD), oldest first.
export function lastDates(end: string, n: number): string[] {
  const t = Date.parse(`${end}T12:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(t - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

export type DayWord = "Χθες" | "Προχθές";
// Yesterday's file once it is written (some hours after midnight, about 13:00 at the latest); until then
// the day before. A day file that is written is the day shown, even when this line has no data in it.
export function pickDay(y: QualityDay | null, before: QualityDay | null): { day: QualityDay; word: DayWord; back: 1 | 2 } | null {
  return y ? { day: y, word: "Χθες", back: 1 } : before ? { day: before, word: "Προχθές", back: 2 } : null;
}

// A day file of this page's city, fetched once per session and shared by every card; a written day file
// never changes. A missing one is asked again after an hour; a failed fetch on the next call.
type Entry = { at: number; found: boolean; load: Promise<QualityDay | null> };
const cache = new Map<string, Entry>();
export function dayFile(date: string, now = Date.now()): Promise<QualityDay | null> {
  const url = `${STATS_BASE}/days/${date}.json`;
  const hit = cache.get(url);
  if (hit && (hit.found || now - hit.at < 3600_000)) return hit.load;
  const load = (async () => {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`stats: HTTP ${r.status}`);
    const d = (await r.json()) as { version?: unknown; date?: unknown } | null;
    return d && d.version === 1 && d.date === date ? (d as QualityDay) : null;
  })();
  const entry: Entry = {
    at: now, found: false,
    load: load.then(d => { entry.found = !!d; return d; }, () => {
      if (cache.get(url) === entry) cache.delete(url);
      return null;
    }),
  };
  cache.set(url, entry);
  return entry.load;
}

// The day the pill shows: yesterday's file, else (only then fetched) the day before's.
export async function shownDay(now = Date.now()): Promise<{ day: QualityDay; word: DayWord; date: string } | null> {
  const y = await dayFile(daysAgo(now, 1), now);
  const p = pickDay(y, y ? null : await dayFile(daysAgo(now, 2), now));
  return p && { day: p.day, word: p.word, date: daysAgo(now, p.back) };
}

// One bar of the 7-day chart: the day's wait (minutes) or on-time share (0..1) of the same kind as the
// pill, with its level; null for a day without data.
export type DayBar = { date: string; value: number; level: Level } | null;
export function dayBars(days: { date: string; day: QualityDay | null }[], kind: Quality["kind"], line: string, dir: number | null): DayBar[] {
  return days.map(({ date, day }) => {
    const q = lineQuality(day, line, dir);
    if (!q || q.kind !== kind) return null;
    return q.kind === "wait" ? { date, value: q.h.wait_min, level: q.level } : { date, value: q.o.share!, level: q.level };
  });
}
