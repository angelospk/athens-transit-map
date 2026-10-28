// A line's timetable of today: GET /v1/lines/{line_id}/schedule. With `source: "oasa-daily"` the
// times are OASA's daily schedule, and `seen` (today only) tells whether a bus left the start for
// that run: true, false (missed), or missing while not known yet.

import { API_BASE } from "./config";
import { fold } from "./search";

export interface ScheduleDeparture { t: string; trip: string; seen?: boolean }
export interface ScheduleDirection { direction: number; headsign: string; departures: ScheduleDeparture[] }
export interface Schedule { line: string; date: string; expired: boolean; source?: string; directions: ScheduleDirection[] }

export const scheduleUrl = (line: string) => `${API_BASE}/v1/lines/${encodeURIComponent(line)}/schedule`;

// "ΠΕΙΡΑΙΑΣ - ΣΥΝΤΑΓΜΑ(ΠΡΟΣΩΡΙΝΗ ΛΟΓΩ ΕΡΓΩΝ)" → "συνταγμα": the part after the last dash, no brackets, accents or
// spaces (the two sources space "Ν. ΣΜΥΡΝΗ" differently).
const endOf = (headsign: string) => {
  const s = headsign.replace(/\([^)]*\)/g, "");
  return fold(s.slice(s.lastIndexOf("-") + 1)).replace(/\s+/g, "");   // "ΣΤ. ΑΤΤΙΚΗ-ΖΩΦΡΙΑ" too
};

// The timetable direction going where the variant goes: the same last place, else the one direction
// whose name contains it or is contained in it (the backend matches them alike). A timetable of one
// direction (a circular line, "Ν. ΚΥΨΕΛΗ (ΚΥΚΛΙΚΗ)") is the one of every variant.
export function matchDirection(dirs: ScheduleDirection[], variantHeadsign: string): ScheduleDirection | null {
  const a = endOf(variantHeadsign);
  const ends = dirs.map(d => endOf(d.headsign));
  const exact = a ? dirs.find((_, i) => ends[i] === a) : undefined;
  const part = a ? dirs.filter((_, i) => ends[i] !== "" && (a.includes(ends[i]) || ends[i].includes(a))) : [];
  return exact ?? (part.length === 1 ? part[0] : dirs.length === 1 ? dirs[0] : null);
}

// Minutes since Athens midnight of `day` (the timetable's YYYY-MM-DD): past midnight a timetable of the
// day before counts on, as "24:10" does, until it is asked again.
export function athensClock(ms: number, day: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(ms).map(x => [x.type, x.value]));
  const days = Math.round((Date.UTC(+p.year, +p.month - 1, +p.day) - Date.parse(day + "T00:00:00Z")) / 86_400_000);
  return (Number.isFinite(days) ? days : 0) * 1440 + +p.hour * 60 + +p.minute;
}

export type RunState = "gone" | "missed" | "next" | "later";
export interface TimetableView { items: { t: string; state: RunState }[]; seen: number; known: number }

// The runs of one direction at `nowMin` (athensClock): the next three marked, a missed one apart from
// the others gone. A run with a seen flag is gone whatever the clock says (the hour repeated when clocks
// go back). "24:10" (GTFS style, after midnight) shows as "00:10".
export function timetableView(dir: ScheduleDirection, nowMin: number, next = 3): TimetableView {
  let left = next;
  const items = dir.departures.map(d => {
    const [h, m] = d.t.split(":").map(Number);
    const min = h * 60 + m;
    const t = `${String(h % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    const state: RunState = min < nowMin || d.seen != null ? (d.seen === false ? "missed" : "gone") : left-- > 0 ? "next" : "later";
    return { t, state };
  });
  const known = dir.departures.filter(d => d.seen != null);
  return { items, seen: known.filter(d => d.seen).length, known: known.length };
}
