// Without a connection: the timetables kept for it. The service worker (public/sw.js) keeps every timetable and
// line file the app asks for; «Κατέβασέ τα» asks for the rider's own lines ahead of time, so they are there before
// the first time they are needed: the favourite lines, and the lines that stop near the favourite stops and near
// home and work. (The metro and the tram have no timetable file here: their times come with the live data.)
import { lineStaticUrl } from "./api";
import { scheduleUrl } from "./timetable";
import { distM, type TripIndex } from "./trip";

type Pt = [number, number];   // [lat, lon]

/** The bus and trolley lines (native ids) with a stop within `m` metres of a point. */
export function linesNear(ix: TripIndex, at: Pt, m: number): string[] {
  const near = new Set<number>();
  ix.s.forEach((s, i) => { if (distM([s[1], s[2]], at) <= m) near.add(i); });
  if (!near.size) return [];
  return Object.entries(ix.l).filter(([, vs]) => Object.values(vs).some(v => v.some(i => near.has(i)))).map(([l]) => l);
}

/** The rider's own lines: favourite bus lines ("oasa:040" → "040"), and the lines near favourite stops (200 m) and
 *  near home and work (500 m). Each once. */
export function ownLines(ix: TripIndex, favLines: string[], favStops: Pt[], places: Pt[]): string[] {
  const out = new Set<string>();
  for (const id of favLines) if (id.startsWith("oasa:") && ix.l[id.slice(5)]) out.add(id.slice(5));
  for (const p of favStops) for (const l of linesNear(ix, p, 200)) out.add(l);
  for (const p of places) for (const l of linesNear(ix, p, 500)) out.add(l);
  return Object.keys(ix.l).filter(l => out.has(l));
}

/** Asks for each line's timetable and line file (the service worker keeps them); how many lines came whole. */
export async function saveLines(lines: string[], step: (done: number, total: number) => void, signal?: AbortSignal): Promise<number> {
  let ok = 0, done = 0;
  step(0, lines.length);
  const one = async (l: string) => {
    const got = await Promise.all([scheduleUrl(l), lineStaticUrl(l)].map(u =>
      fetch(u, { signal }).then(r => r.ok, () => false)));
    if (got.every(Boolean)) ok++;
    step(++done, lines.length);
  };
  // A few at a time: kind to the server, and quick enough.
  for (let i = 0; i < lines.length; i += 4) {
    if (signal?.aborted) break;
    await Promise.all(lines.slice(i, i + 4).map(one));
  }
  return ok;
}

const KEY = "offline.saved";
export interface Saved { at: number; lines: number }
export function lastSaved(): Saved | null {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "null"); return v && typeof v.at === "number" ? v : null; } catch { return null; }
}
export function markSaved(s: Saved) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: it still worked */ } }
