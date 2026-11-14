// Service disruptions from /v2/alerts (staseis-rt docs/CONTRACT.md, rev 13): OASA notices and strikes.
// Pure: which alert applies to a line, a stop or the map today. (Not alerts.ts: those are the user's arrival alerts.)

import { fold } from "./search";

export interface Disruption {
  id: string; source: string; title: string; url: string; published: number;
  from: string | null; until: string | null; modes: string[]; lines: string[]; stops: string[]; urgent: boolean;
}

const NO_DATES_S = 3 * 86_400;   // an alert with no dates shows this long after it was published (contract)

const day = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit" });
// The calendar day in Athens, YYYY-MM-DD: the dates of an alert are Athens days. Built from the parts: the
// shape of format() is not fixed.
export function athensDay(ms: number): string {
  const p = Object.fromEntries(day.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

const isDay = (v: unknown): v is string | null => v === null || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v));
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === "string");

// The well-formed alerts of a /v2/alerts body. The link must be http(s): it goes into an href.
export function parseAlerts(body: unknown): Disruption[] {
  const list = (body as { alerts?: unknown } | null)?.alerts;
  if (!Array.isArray(list)) return [];
  return list.filter((a): a is Disruption => {
    const x = a as Record<string, unknown> | null;
    return !!x && typeof x.id === "string" && typeof x.title === "string" && typeof x.url === "string" && /^https?:\/\//.test(x.url)
      && typeof x.published === "number" && isDay(x.from) && isDay(x.until) && strings(x.lines) && strings(x.stops)
      && strings(x.modes) && typeof x.urgent === "boolean";
  });
}

// Shown from `from` to `until` (Athens days, both included; a missing one leaves that end open); with no dates,
// for 3 days after `published`.
export function isActive(a: Disruption, nowMs: number): boolean {
  if (!a.from && !a.until) return nowMs / 1000 - a.published <= NO_DATES_S;
  const today = athensDay(nowMs);
  return (!a.from || a.from <= today) && (!a.until || today <= a.until);
}

export const forLine = (alerts: Disruption[], line: string, nowMs: number) =>
  alerts.filter(a => a.lines.includes(line) && isActive(a, nowMs));

// A stop's alerts: those that name it or one of its lines.
export const forStop = (alerts: Disruption[], stop: string, lines: string[], nowMs: number) =>
  alerts.filter(a => (a.stops.includes(stop) || a.lines.some(l => lines.includes(l))) && isActive(a, nowMs));

// The strikes of today the user has not closed: the strip over the map.
export const strikes = (alerts: Disruption[], nowMs: number, closed: string[]) =>
  alerts.filter(a => a.urgent && !closed.includes(a.id) && isActive(a, nowMs));

const dm = (d: string) => `${+d.slice(8, 10)}/${+d.slice(5, 7)}`;
// «31/10–1/11», «4/11», or "" with no dates.
export function dateRange(a: Disruption): string {
  const from = a.from ?? a.until, until = a.until ?? a.from;
  if (!from || !until) return "";
  return from === until ? dm(from) : `${dm(from)}–${dm(until)}`;
}

// One word for the common notices; any other title as it is (the row cuts it).
export function shortTitle(a: Disruption): string {
  const t = fold(a.title);
  if (t.includes("απεργ")) return "Απεργία";
  if (/σταση εργασιασ|στασεισ εργασιασ/.test(t)) return "Στάση εργασίας";
  if (t.includes("τροποποιησ") || t.includes("εκτροπ")) return "Εκτροπή";
  return a.title;
}
