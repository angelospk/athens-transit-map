// The line card's «Χθες» quality pill (staseis-rt docs/QUALITY.md, roadmap step 2): yesterday's daily
// stats of the line on one scale of three levels. A frequent direction: how even its buses ran (cv_h of
// `headways`). A sparse citybus.gr line: its share of runs that left on time (`origin_otp`, per line).
// No data, no pill.
import { STATS_BASE } from "./config";
import { CITYBUS } from "./citybus";
import type { CityId } from "./cities";

export type Level = "ok" | "warn" | "bad";
export type Quality = { level: Level; title: string; text: string };

type Headway = { line: string; dir: number; cv_h: number; wait_min: number; mean_headway_s: number };
type LineOtp = { line: string; measured: number; share?: number };
// The parts of a day file (rt docs/API.md "Daily statistics") the pill reads.
export type QualityDay = { headways?: { by_line: Headway[] }; origin_otp?: { by_line: LineOtp[] } };

export const MIN_OTP_RUNS = 5;   // measured runs of a line before its on-time share is shown

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const list = <T>(v: { by_line?: unknown } | undefined) => (Array.isArray(v?.by_line) ? (v.by_line as T[]) : []);

// dir: the stats direction of the shown direction (0 Go / 1 Come in Athens, GTFS direction_id in
// Thessaloniki), null when it is not known; the on-time share is per line and does not need it.
export function lineQuality(day: QualityDay | null, line: string, dir: number | null): Quality | null {
  if (!day) return null;
  const h = dir === null ? undefined : list<Headway>(day.headways).find(x => x?.line === line && x.dir === dir);
  if (h && num(h.cv_h) && num(h.wait_min) && num(h.mean_headway_s)) {
    const level: Level = h.cv_h <= 0.39 ? "ok" : h.cv_h <= 0.74 ? "warn" : "bad";
    const title = { ok: "Κανονικά χθες", warn: "Αραιά χθες", bad: "Πολύ αραιά χθες" }[level];
    const usual = level === "ok" ? "" : ` (κανονικά ~${Math.round(h.mean_headway_s / 2 / 60)}′)`;
    return { level, title, text: `περίμενες ~${Math.round(h.wait_min)}′${usual}` };
  }
  const o = list<LineOtp>(day.origin_otp).find(x => x?.line === line);
  if (o && num(o.measured) && o.measured >= MIN_OTP_RUNS && num(o.share) && o.share <= 1) {
    const pct = Math.floor(o.share * 100 + 1e-9);   // whole percent rounded down, as the backend's band
    const level: Level = pct >= 80 ? "ok" : pct >= 70 ? "warn" : "bad";
    const title = { ok: "Συνήθως στην ώρα του", warn: "Αργεί συχνά", bad: "Αργεί πολύ" }[level];
    return { level, title, text: `χθες ${Math.round(o.share * 10)} στα 10 δρομολόγια στην ώρα τους` };
  }
  return null;
}

// The line id in the stats: the native id ("040") in Athens and Thessaloniki, the card's namespaced id
// ("pat:601") in a citybus.gr city.
export const statsLineId = (city: CityId, cardId: string) =>
  CITYBUS.some(c => c.slug === city) ? cardId : cardId.slice(cardId.indexOf(":") + 1);

// Yesterday's date (YYYY-MM-DD) in Athens time; every city of the app is in that zone.
export function yesterday(now: number): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

// Yesterday's day file of this page's city, fetched once and shared by every card; a day file never
// changes once written. It is written some hours after midnight: a missing one is asked again after an
// hour; a failed fetch on the next call.
let cache: { date: string; at: number; found: boolean; load: Promise<QualityDay | null> } | null = null;
export function yesterdayDay(now = Date.now()): Promise<QualityDay | null> {
  const date = yesterday(now);
  if (cache && cache.date === date && (cache.found || now - cache.at < 3600_000)) return cache.load;
  const load = (async () => {
    const r = await fetch(`${STATS_BASE}/days/${date}.json`, { signal: AbortSignal.timeout(15_000) });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`stats: HTTP ${r.status}`);
    const d = (await r.json()) as { version?: unknown; date?: unknown } | null;
    return d && d.version === 1 && d.date === date ? (d as QualityDay) : null;
  })();
  const entry = {
    date, at: now, found: false,
    load: load.then(d => { entry.found = !!d; return d; }, () => {
      if (cache === entry) cache = null;
      return null;
    }),
  };
  cache = entry;
  return entry.load;
}
