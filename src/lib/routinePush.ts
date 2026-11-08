// «Κάθε μέρα» with the page closed: each routine is a recurring alert at the push bot (bot/bot.ts, a "2" link), so the
// phone gets a notification in its window. Without push (no permission, an old browser, the bot refusing), the
// routine still works while the page is open (NowPanel).

import { encodeAlert, MAX_N } from "./tglink";
import { alertLinesAt, stopIndex } from "./stops";
import { canPush, startPush, stopPush } from "./push";
import { routineRep, routineStops, type Routine } from "./routines";
import type { TripIndex } from "./trip";
import { PAGE_CITY } from "./config";

const native = (id: string) => id.slice(id.indexOf(":") + 1);

// The bot's payload for a routine, or null (no such stop or line in the index, or «only if something changes»).
export function routinePayload(ix: TripIndex, r: Routine, walkMin: number): string | null {
  const n = routineStops(r.when, walkMin, MAX_N);
  const k = stopIndex(ix, native(r.stop.id));
  if (n == null || k < 0 || !r.days.some(Boolean)) return null;
  const lines = alertLinesAt(ix, k, [native(r.line)]).map(l => ({ line: l.line, variants: l.variants.map(v => ({ id: v.id, i: v.i })) }));
  return lines.length ? encodeAlert(ix, n, lines, routineRep(r)) : null;
}

// Registers the routine at the bot (stopping its old alert first); its new push id, or undefined when it reminds only
// with the page open.
export async function syncRoutine(ix: TripIndex | null, r: Routine, walkMin: number): Promise<string | undefined> {
  if (r.push) void stopPush(r.push);
  if (!r.on || !ix || !canPush()) return undefined;
  const p = routinePayload(ix, r, walkMin);
  if (!p) return undefined;
  const reg = await navigator.serviceWorker?.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => null);
  const ready = reg && (await Promise.race([navigator.serviceWorker.ready, new Promise<null>(res => setTimeout(res, 5000, null))]));
  const made = ready ? await startPush(ready, p, PAGE_CITY) : null;
  return made?.id;
}

export const dropRoutine = (r: Routine) => { if (r.push) void stopPush(r.push); };
