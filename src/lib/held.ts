// A refresh that fails never empties a good list. While the backend restarts or is overloaded (5xx, a timeout,
// a citybus city that says `warming_up`), the last good vehicles stay, marked, for up to HELD_MAX_MS.
// A good answer replaces them, also an empty one (night): "good" is decided by status and shape, not by size.

import type { FetchResult } from "./poller";

export const HELD_MAX_MS = 600_000;   // as GONE_POS_S (format.ts): a position this old is not drawn either

export interface Held<T> {
  value: T;
  at: number;        // client ms of the last good answer
  failed: boolean;   // the latest refresh did not give a good one
}

// A /v2 body of a source that is still loading: `{"sources":[{"state":"warming_up"}],"lines":[],...}`.
export function isWarmingBody(b: unknown): boolean {
  const s = (b as { sources?: unknown } | null | undefined)?.sources;
  return Array.isArray(s) && s.some(x => (x as { state?: unknown } | null)?.state === "warming_up");
}

// parse: the body as the list we hold, or null when it is not of the expected shape.
export function refreshHeld<T>(held: Held<T> | null, r: FetchResult, parse: (b: unknown) => T | null, nowMs: number): Held<T> | null {
  const value = r.status === 200 && !isWarmingBody(r.body) ? parse(r.body) : null;
  if (value !== null) return { value, at: nowMs, failed: false };
  return held && nowMs - held.at < HELD_MAX_MS ? { ...held, failed: true } : null;
}

// One short neutral line while a held list is not fresh; no second person.
export function heldNote(held: Held<unknown> | null, nowMs: number): string | null {
  if (!held?.failed) return null;
  const s = Math.max(0, Math.floor((nowMs - held.at) / 1000));
  return `Ενημέρωση σε εξέλιξη · τελευταία θέση πριν από ${s < 60 ? `${s}″` : `${Math.floor(s / 60)}′`}`;
}
