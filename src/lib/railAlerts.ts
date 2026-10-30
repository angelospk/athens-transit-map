// Rail alerts (metro, tram, suburban): an arrival of the line and direction within n minutes at one stop, from a
// /v2 stop's board. Pure, so the bot (bot/bot.ts) and the page use the same rule.

import { fold } from "./search";
import type { V2Arrival, V2Pattern } from "./v2";

// until: Unix s. heads: the direction's raw /v2 headsigns. run: only this train, when the page knows it.
export interface RailSpec {
  stop: string; name: string; line: string; label: string; toward: string; heads: string[]; min: number; until: number;
  run?: string;
}
export interface RailHit { at: number; live: boolean; run: string | null }

const KEEP_S = 7200;   // a fired arrival is not fired again for this long
const GRACE_S = 30;    // an arrival this late still counts: the board lags
const NOW_S = 30;      // this close, say "now"

const key = (s: string) => fold(s.trim());

// Each arrival once per alert: fired (its key → when, s) comes in and goes out changed.
export function railCheck(spec: RailSpec, arrivals: V2Arrival[], nowS: number, fired: Map<string, number>): { hits: RailHit[]; none: boolean } {
  for (const [k, at] of fired) if (nowS - at > KEEP_S) fired.delete(k);
  const heads = new Set(spec.heads.map(key));
  const mine = arrivals.filter(a => a.stop === spec.stop && a.line === spec.line &&
    (spec.run ? a.run === spec.run : heads.has(key(a.headsign))));
  const hits: RailHit[] = [];
  for (const a of mine) {
    if (a.at < nowS - GRACE_S || a.at - nowS > spec.min * 60) continue;
    // The run, else the timetable time; an estimate alone changes on every board, so it has no key.
    const k = a.run ?? (a.scheduled_at != null ? `${a.line}|${a.scheduled_at}` : null);
    if (k == null || fired.has(k)) continue;
    fired.set(k, nowS);
    hits.push({ at: a.at, live: a.source === "live", run: a.run });
  }
  // With a run, none says nothing: the train may be late, or the board may not show it yet.
  return { hits, none: spec.run ? false : !mine.some(a => a.at >= nowS - GRACE_S) };
}

// The direction's headsigns in pattern order, the headsign given last if it is not among them.
export function railHeads(patterns: V2Pattern[], dir: 0 | 1 | null, headsign: string): string[] {
  if (dir == null) return [headsign];
  const out = new Map<string, string>();
  for (const p of patterns) if (p.direction === dir && !out.has(key(p.headsign))) out.set(key(p.headsign), p.headsign);
  if (!out.has(key(headsign))) out.set(key(headsign), headsign);
  return [...out.values()];
}

export function railHitText(spec: RailSpec, hit: RailHit, nowS: number): string {
  const s = hit.at - nowS;
  const when = s <= NOW_S ? `φτάνει τώρα στο ${spec.name}` : `στο ${spec.name} σε ${Math.max(1, Math.round(s / 60))}′`;
  return `${spec.label} προς ${spec.toward}: ${when}${hit.live ? "" : " (κατά το πρόγραμμα)"}.`;
}

// A strike or the end of service must not look like silence.
export function railNoneText(spec: RailSpec): string {
  return `${spec.label} προς ${spec.toward}: κανένα δρομολόγιο στο ${spec.name} τώρα. Ίσως απεργία ή τέλος δρομολογίων.`;
}
