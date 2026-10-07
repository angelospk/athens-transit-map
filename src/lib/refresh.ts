// The refresh ring round the panel: it fills over the cycle of the feed updated last, from its
// update to the next one the server promises (`next_update_at`). Times are server seconds.

export interface Cycle { from: number; to: number }

export function refreshCycle(feeds: { updated_at: number; next_update_at: number }[]): Cycle | null {
  let best: Cycle | null = null;
  for (const f of feeds)
    if (Number.isFinite(f.updated_at) && Number.isFinite(f.next_update_at) && f.next_update_at > f.updated_at
      && (!best || f.updated_at > best.from)) best = { from: f.updated_at, to: f.next_update_at };
  return best;
}

// Length of the cycle and the time gone of it, held within the cycle: a late update leaves the
// ring full, a clock behind the data leaves it empty.
export function ringAt(c: Cycle, nowS: number) {
  const dur = c.to - c.from;
  return { dur, elapsed: Math.min(dur, Math.max(0, nowS - c.from)) };
}
