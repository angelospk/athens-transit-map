// Whether a line runs right now: how many vehicles it has on the road, asked quietly for the lines a search shows
// (a few at a time, each answer kept a minute), so a result says «Ζωντανά» only when something is running, and
// «Δεν κυκλοφορεί τώρα» when nothing is. Unknown (not asked yet, or the answer failed): nothing is said.
import { fetchV2LineVehicles } from "./api";

const TTL_MS = 60_000;
const known = new Map<string, { at: number; n: number }>();
const asking = new Set<string>();

/** The vehicles on the line now, or null while not known. */
export function liveCount(id: string, now = Date.now()): number | null {
  const k = known.get(id);
  return k && now - k.at < TTL_MS ? k.n : null;
}

/** Ask for the lines not known yet (at most `max` of them, in order); `done` hears each answer. */
export function checkLive(ids: string[], done: () => void, max = 6): void {
  const now = Date.now();
  for (const id of ids.slice(0, max)) {
    if (asking.has(id) || liveCount(id, now) !== null) continue;
    asking.add(id);
    fetchV2LineVehicles(id).then(r => {
      const v = r.status === 200 ? (r.body as { vehicles?: unknown[] } | null)?.vehicles : undefined;
      if (Array.isArray(v)) { known.set(id, { at: Date.now(), n: v.length }); done(); }
    }, () => {}).finally(() => asking.delete(id));
  }
}
