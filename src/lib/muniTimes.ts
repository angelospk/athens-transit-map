// «Δημοτικά» times: the departures a municipality publishes for its own bus lines, kept as one small
// JSON file per municipality. There is no live data, so the app only repeats what the source says, and
// a wrong time must never show: `parseTimetable` rejects the whole file on any fault.

export type Season = { from: string; to: string };   // "MM-DD", inclusive; from > to wraps the new year
export type Service = {
  days: number[];              // ISO weekday, 1 = Monday … 7 = Sunday
  season?: Season;
  label?: string;
  at?: string;                 // the stop the times are timed at
  times?: string[];            // exact departures, "HH:MM", strictly ascending
  every?: number;              // or a frequency: every N minutes from first to last
  first?: string;
  last?: string;
};
export type MuniLine = { routes: string[]; ref: string | null; name: string; services: Service[]; note?: string };
export type Watch = { url: string; kind: "file" | "times"; sha256: string };
export type MuniTimetable = {
  municipality: string; checked: string; valid: string | null; source: string; watch: Watch[]; lines: MuniLine[];
};
export type Clock = { date: string; md: string; weekday: number; minutes: number };
export type Departure = { time: string; at: string | null; approx: boolean };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const min = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// A real "MM-DD": 02-30 is a typo, not a season start (2000 is a leap year, so 02-29 is fine).
const isMD = (v: string) => {
  if (!MD.test(v)) return false;
  const [m, d] = v.split("-").map(Number);
  return new Date(Date.UTC(2000, m - 1, d)).getUTCDate() === d;
};

const isDate = (v: unknown): v is string => {
  if (typeof v !== "string" || !YMD.test(v)) return false;
  const d = new Date(v + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

const readSeason = (v: unknown): Season | null =>
  isObj(v) && typeof v.from === "string" && typeof v.to === "string" && isMD(v.from) && isMD(v.to) ? { from: v.from, to: v.to } : null;

function readService(v: unknown): Service | null {
  if (!isObj(v) || !Array.isArray(v.days) || !v.days.length) return null;
  const days: number[] = [];
  for (const d of v.days) {
    if (typeof d !== "number" || !Number.isInteger(d) || d < 1 || d > 7 || days.includes(d)) return null;
    days.push(d);
  }
  const s: Service = { days };
  if (v.season !== undefined) {
    const season = readSeason(v.season);
    if (!season) return null;
    s.season = season;
  }
  if (v.label !== undefined) {
    if (!isText(v.label)) return null;
    s.label = v.label;
  }
  if (v.at !== undefined) {
    if (!isText(v.at)) return null;
    s.at = v.at;
  }
  if ((v.times !== undefined) === (v.every !== undefined)) return null;   // exactly one of the two
  if (v.times !== undefined) {
    if (v.first !== undefined || v.last !== undefined) return null;
    if (!Array.isArray(v.times) || !v.times.length) return null;
    const times: string[] = [];
    for (const t of v.times) {
      if (typeof t !== "string" || !HHMM.test(t)) return null;
      if (times.length && min(t) <= min(times[times.length - 1])) return null;   // strictly ascending
      times.push(t);
    }
    s.times = times;
  } else {
    if (typeof v.every !== "number" || !Number.isInteger(v.every) || v.every <= 0) return null;
    if (typeof v.first !== "string" || !HHMM.test(v.first) || typeof v.last !== "string" || !HHMM.test(v.last)) return null;
    if (min(v.first) > min(v.last)) return null;
    s.every = v.every;
    s.first = v.first;
    s.last = v.last;
  }
  return s;
}

function readLine(v: unknown): MuniLine | null {
  if (!isObj(v) || !isText(v.name) || !Array.isArray(v.routes) || !v.routes.length) return null;
  const routes: string[] = [];
  for (const r of v.routes) {
    if (!isText(r)) return null;
    routes.push(r);
  }
  if (v.ref !== undefined && v.ref !== null && !isText(v.ref)) return null;
  if (!Array.isArray(v.services) || !v.services.length) return null;
  const services: Service[] = [];
  for (const raw of v.services) {
    const s = readService(raw);
    if (!s) return null;
    services.push(s);
  }
  const line: MuniLine = { routes, ref: isText(v.ref) ? v.ref : null, name: v.name, services };
  if (v.note !== undefined) {
    if (!isText(v.note)) return null;
    line.note = v.note;
  }
  return line;
}

function readWatch(v: unknown): Watch | null {
  if (!isObj(v) || !isText(v.url) || !isText(v.sha256)) return null;
  if (v.kind !== "file" && v.kind !== "times") return null;
  return { url: v.url, kind: v.kind, sha256: v.sha256 };
}

// The file when every field is right, null for anything else: a typo must never show a wrong time.
export function parseTimetable(x: unknown): MuniTimetable | null {
  if (!isObj(x) || !isText(x.municipality) || !isDate(x.checked) || !isText(x.source)) return null;
  if (x.valid !== undefined && x.valid !== null && !isText(x.valid)) return null;
  if (!Array.isArray(x.watch)) return null;
  const watch: Watch[] = [];
  for (const raw of x.watch) {
    const w = readWatch(raw);
    if (!w) return null;
    watch.push(w);
  }
  if (!Array.isArray(x.lines) || !x.lines.length) return null;
  const lines: MuniLine[] = [];
  for (const raw of x.lines) {
    const line = readLine(raw);
    if (!line) return null;
    lines.push(line);
  }
  return {
    municipality: x.municipality, checked: x.checked, valid: isText(x.valid) ? x.valid : null,
    source: x.source, watch, lines,
  };
}

const WEEKDAYS: Record<string, number> = { Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6, Sunday: 7 };
const athensFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit",
  day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "long" });

// The wall clock of Athens at `ms`: its date, the "MM-DD" to compare a season with, the ISO weekday and the
// minute of the day.
export function athensClock(ms: number): Clock {
  const p: Record<string, string> = {};
  for (const x of athensFmt.formatToParts(ms)) p[x.type] = x.value;
  const date = `${p.year}-${p.month}-${p.day}`;
  const hour = Number(p.hour) % 24;   // some engines say "24" at midnight
  const weekday = WEEKDAYS[p.weekday] ?? ((new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7) + 1;
  return { date, md: date.slice(5), weekday, minutes: hour * 60 + Number(p.minute) };
}

const inSeason = (s: Season, md: string) => (s.from <= s.to ? s.from <= md && md <= s.to : md >= s.from || md <= s.to);

// The services of that weekday, when their season (if any) holds on that "MM-DD".
export function activeServices(line: MuniLine, clock: Clock): Service[] {
  return line.services.filter(s => s.days.includes(clock.weekday) && (!s.season || inSeason(s.season, clock.md)));
}

// The next `n` departures from now, earliest first, one entry per time and stop. A frequency is spelled
// out as approximate times, so a person reads what the app says without trusting it as exact.
export function nextDepartures(line: MuniLine, clock: Clock, n = 3): Departure[] {
  const all: { min: number; d: Departure }[] = [];
  for (const s of activeServices(line, clock)) {
    const at = s.at ?? null;
    if (s.times) {
      for (const t of s.times) {
        const m = min(t);
        if (m >= clock.minutes) all.push({ min: m, d: { time: t, at, approx: false } });
      }
    } else if (s.every && s.first && s.last) {
      for (let m = min(s.first); m <= min(s.last); m += s.every) {
        if (m >= clock.minutes) all.push({ min: m, d: { time: hhmm(m), at, approx: true } });
      }
    }
  }
  all.sort((a, b) => a.min - b.min);
  const out: Departure[] = [];
  for (const { d } of all) {
    if (out.some(o => o.time === d.time && o.at === d.at)) continue;
    out.push(d);
    if (out.length === n) break;
  }
  return out;
}

// The next departures per stop they are timed at (a line may list one terminus per direction), in the order
// the services give them: a time is never shown as leaving from another stop.
export interface StopDepartures { at: string | null; approx: boolean; times: string[] }
export function nextByStop(line: MuniLine, clock: Clock, n = 3): StopDepartures[] {
  const stops = [...new Set(activeServices(line, clock).map(s => s.at ?? null))];
  return stops.map(at => {
    const next = nextDepartures({ ...line, services: line.services.filter(s => (s.at ?? null) === at) }, clock, n);
    return { at, approx: next.some(d => d.approx), times: next.map(d => d.time) };
  }).filter(g => g.times.length);
}

// The timetable line of an OSM route id, in the order the files are given.
export function lineFor(tables: MuniTimetable[], routeId: string): { table: MuniTimetable; line: MuniLine } | null {
  for (const table of tables) for (const line of table.lines) if (line.routes.includes(routeId)) return { table, line };
  return null;
}

export type Report = {
  table: MuniTimetable; line: MuniLine; stop: string | null; shown: string[]; clock: Clock; kind: string; text: string;
};

// What a person needs to check the report against the municipality's page: which line and stop, the times
// the app showed, when, and which timetable they came from.
export function reportText(o: Report): string {
  return [
    `[Δημοτικά] ${o.table.municipality} · γραμμή ${o.line.ref ?? o.line.name}`,
    ...(o.stop ? [`Στάση: ${o.stop}`] : []),
    `Ώρες που έδειξε: ${o.shown.length ? o.shown.join(", ") : "—"}`,
    `Πότε: ${o.clock.date} ${hhmm(o.clock.minutes)}`,
    `Ωράριο: ${o.table.valid ?? "χωρίς ημερομηνία"}, ελέγχθηκε ${o.table.checked}, πηγή ${o.table.source}`,
    `Πρόβλημα: ${o.kind}`,
    o.text,
  ].join("\n");
}

// A time of the day on a page, H:MM, HH:MM, H.MM or HH.MM, not part of a longer number or a date.
const TIME_IN_TEXT = /(?<![\d.:/])(\d{1,2})[.:](\d{2})(?![\d.:/])/g;

// Only the times of a page, normalised and in page order: a new notice does not count as a timetable change,
// a changed departure does. "5/11/2026", a phone number or "99:99" are no times of day.
export function timesSignature(text: string): string {
  const out: string[] = [];
  for (const m of text.matchAll(TIME_IN_TEXT)) {
    const h = Number(m[1]), mi = Number(m[2]);
    if (h > 23 || mi > 59) continue;
    out.push(hhmm(h * 60 + mi));
  }
  return out.join(",");
}
