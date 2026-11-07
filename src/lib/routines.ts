// «Κάθε μέρα»: trips the user takes on given days (AlertsPanel), and which notices they want about their lines.
// Pure, so the rules are tested: when a routine is in force, and what it asks for.

export type RoutineWhen = "leave" | "before" | "change";
export interface Routine {
  id: string; label: string; on: boolean;
  stop: { id: string; name: string; lat: number; lon: number };
  line: string;                 // as the stop's rows name it («oasa:224»)
  days: boolean[];              // Monday first, 7 of them
  hour: number;                 // from this hour (Athens), for WINDOW_H hours
  when: RoutineWhen;
  push?: string;                // the push bot's id for it: it reminds with the page closed too (routinePush.ts)
}
export interface NotifyPrefs { strikes: boolean; changes: boolean; delay: boolean }

export const WINDOW_H = 3;
export const BEFORE_MIN = 5;          // «Λίγα λεπτά πριν φτάσει»
export const LATE_S = 600;            // «Καθυστέρηση πάνω από 10′»
export const DAY_LETTERS = ["Δ", "Τ", "Τ", "Π", "Π", "Σ", "Κ"];
export const DAY_NAMES = ["Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο", "Κυριακή"];
export const WHEN: { value: RoutineWhen; label: string; hint: string }[] = [
  { value: "leave", label: "Όταν πρέπει να φύγω", hint: "Μετράει τον δρόμο ως τη στάση" },
  { value: "before", label: "Λίγα λεπτά πριν φτάσει", hint: `${BEFORE_MIN}′ πριν έρθει στη στάση` },
  { value: "change", label: "Μόνο αν αλλάξει κάτι", hint: "Καθυστέρηση πάνω από 10′, ανακοίνωση, απεργία" },
];

const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", weekday: "short", hour: "2-digit", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" });
const WD: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
// The Athens weekday (Monday 0), hour and day (YYYY-MM-DD) of a moment.
export function athensNow(ms: number): { wd: number; hour: number; day: string } {
  const p = Object.fromEntries(parts.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { wd: WD[p.weekday] ?? 0, hour: +p.hour, day: `${p.year}-${p.month}-${p.day}` };
}

// The routine in force now: on, today one of its days, within its window; the first such.
export function activeRoutine(rs: Routine[], ms: number): Routine | null {
  const { wd, hour } = athensNow(ms);
  return rs.find(r => r.on && r.days[wd] && hour >= r.hour && hour < r.hour + WINDOW_H) ?? null;
}

// The bot's recurring alert for a routine (src/lib/tglink.ts Rep): the days as bits (Monday the lowest), from its hour
// for WINDOW_H hours.
export const routineRep = (r: Routine) => ({ days: r.days.reduce((b, on, k) => (on ? b | (1 << k) : b), 0), start: r.hour * 60, len: WINDOW_H * 60 });

// How many stops before the boarding stop the bot writes (it counts stops, not minutes; a stop is about 1.5′ in Athens):
// for «leave», the walk; for «before», BEFORE_MIN. null for «only if something changes» (not a bot alert).
export function routineStops(when: RoutineWhen, walkMin: number, max: number): number | null {
  if (when === "change") return null;
  const min = when === "leave" ? walkMin + 1 : BEFORE_MIN;
  return Math.min(max, Math.max(1, Math.round(min / 1.5)));
}

// When to remind (seconds from now), for a bus at the stop in inMin minutes with walk minutes to the stop; null for
// «Μόνο αν αλλάξει κάτι», which has no reminder of its own.
export function remindIn(when: RoutineWhen, inMin: number, walk: number): number | null {
  if (when === "leave") return Math.max(0, inMin - walk) * 60;
  if (when === "before") return Math.max(0, inMin - BEFORE_MIN) * 60;
  return null;
}

export const partOfDay = (h: number) => (h < 5 ? "Νύχτα" : h < 12 ? "Πρωί" : h < 17 ? "Μεσημέρι" : h < 21 ? "Απόγευμα" : "Βράδυ");
export const hourText = (h: number) => `${String(h).padStart(2, "0")}:00`;

export const isRoutines = (v: unknown): boolean => Array.isArray(v) && v.every(r => {
  const x = r as Routine;
  return !!x && typeof x.id === "string" && typeof x.line === "string" && typeof x.label === "string" && typeof x.on === "boolean"
    && Array.isArray(x.days) && x.days.length === 7 && typeof x.hour === "number" && ["leave", "before", "change"].includes(x.when)
    && !!x.stop && typeof x.stop.id === "string" && typeof x.stop.lat === "number" && typeof x.stop.lon === "number"
    && (x.push === undefined || typeof x.push === "string");
});
export const isNotifyPrefs = (v: unknown): boolean => {
  const x = v as NotifyPrefs | null;
  return !!x && typeof x.strikes === "boolean" && typeof x.changes === "boolean" && typeof x.delay === "boolean";
};
