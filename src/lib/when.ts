// «Πότε» of a trip (mockup 46 Γ): now, leaving at a time, or arriving by one («περίπου»: there on time, or some
// minutes before). Times are Athens wall-clock times, whatever the phone's own zone.
export type When = { kind: "now" } | { kind: "leave"; at: number } | { kind: "arrive"; at: number; early: number };

const ZONE = "Europe/Athens";
const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const DAYS = ["Κυρ", "Δευ", "Τρι", "Τετ", "Πεμ", "Παρ", "Σαβ"];

/** The Athens calendar day and clock of a time (seconds). */
export function wall(tS: number): { y: number; m: number; d: number; min: number; wd: number } {
  const p: Record<string, string> = {};
  for (const x of fmt.formatToParts(new Date(tS * 1000))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, min: +p.hour * 60 + +p.minute, wd: WD[p.weekday] ?? 0 };
}

/** The time (seconds) of `min` minutes after midnight in Athens, `day` days after the day of `nowS`. */
export function athensAt(nowS: number, day: number, min: number): number {
  const w = wall(nowS);
  const guess = Date.UTC(w.y, w.m - 1, w.d + day, 0, min) / 1000;
  // Athens is ahead of UTC: the same wall time is earlier by the zone's offset at that moment (twice, for the DST days).
  let t = guess;
  for (let k = 0; k < 2; k++) {
    const v = wall(t);
    const asUtc = Date.UTC(v.y, v.m - 1, v.d, 0, v.min) / 1000;
    t = guess - (asUtc - t);
  }
  return t;
}

/** How many days after the day of `nowS` a time falls (0 today, 1 tomorrow …). */
export function dayOf(nowS: number, tS: number): number {
  const a = wall(nowS), b = wall(tS);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

export const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** «Σήμερα», «Αύριο», then the weekday and date: «Δευ 9». */
export function dayLabel(nowS: number, day: number): string {
  if (day === 0) return "Σήμερα";
  if (day === 1) return "Αύριο";
  const w = wall(athensAt(nowS, day, 12 * 60));
  return `${DAYS[w.wd]} ${w.d}`;
}

/** The chip's words for a choice: «Τώρα», «Φεύγω 18:30», «Φτάνω αύριο ως 09:00». */
export function whenLabel(w: When, nowS: number): string {
  if (w.kind === "now") return "Τώρα";
  const d = dayOf(nowS, w.at), t = hhmm(wall(w.at).min);
  const day = d === 0 ? "" : d === 1 ? "αύριο " : `${dayLabel(nowS, d)} `;
  return w.kind === "leave" ? `Φεύγω ${day}${t}` : `Φτάνω ${day}ως ${t}`;
}

// The planner (/v2/plan) holds one service day, 03:00 to 03:00 Athens time: it plans from now until then, not for
// tomorrow morning. The times offered are those, as minutes after the midnight that began today (past 24:00 for the
// hours after midnight).
const DAY_END = 3 * 60;
/** The times to pick, every 5 minutes: from the next 5 minutes to the service day's end (03:00). */
export function slots(nowS: number): number[] {
  const now = wall(nowS).min, end = now < DAY_END ? DAY_END : 24 * 60 + DAY_END;
  const out: number[] = [];
  for (let m = Math.ceil((now + 1) / 5) * 5; m < end; m += 5) out.push(m);
  return out;
}

/** A few round times to pick with one tap: the next half hours that are still in the service day. */
export function quick(nowS: number): number[] {
  const s = slots(nowS), first = Math.ceil((wall(nowS).min + 10) / 30) * 30;
  return [0, 30, 60, 90].map(k => first + k).filter(m => s.includes(m));
}

export interface Fit<T> { it: T; margin: number; tone: "ok" | "tight" | "late" }
/** Arriving by `at` (`early` minutes before, if asked): the one that lets the rider leave latest and still be there
 *  first, then the others that make it (the latest to leave first), then the late ones (the soonest there first).
 *  Those there more than 90 minutes early are left out. `margin`: minutes before `at` (negative: after). */
export function arriveOrder<T extends { depart_at: number; arrive_at: number }>(its: T[], at: number, early: number): Fit<T>[] {
  const fits = its.map(it => {
    const margin = Math.floor((at - it.arrive_at) / 60);
    return { it, margin, tone: (margin < 0 ? "late" : margin < early ? "tight" : "ok") as Fit<T>["tone"] };
  }).filter(f => f.margin <= 90);
  const made = fits.filter(f => f.tone !== "late").sort((a, b) => b.it.depart_at - a.it.depart_at);
  const late = fits.filter(f => f.tone === "late").sort((a, b) => a.it.arrive_at - b.it.arrive_at);
  const best = made.find(f => f.tone === "ok");
  return [...(best ? [best] : []), ...made.filter(f => f !== best), ...late];
}
