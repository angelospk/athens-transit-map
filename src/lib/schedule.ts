// When to fetch a line again (docs/CONTRACT.md, "GET /v1/lines/{line_id}").

export const MIN_GAP_MS = 5_000;        // never faster than every 5 s
export const HIDDEN_GAP_MS = 60_000;    // at most every 60 s while the tab is hidden
export const MAX_INTERVAL_S = 300;      // matches the max Cache-Control max-age
export const BACKOFF_MS = 10_000;       // 429 / 5xx / network: at least 10 s
export const MAX_BACKOFF_MS = 120_000;
const SLACK_MS = 2_000;                 // network and cache latency

export type Outcome =
  | { kind: "ok"; nextUpdateAt: number; updatedAt: number }   // unix seconds, server clock
  | { kind: "warming" }                                       // 503 warming_up
  | { kind: "error"; errors: number };                        // consecutive failures, >= 1

const validInterval = (next: number, updated: number) => {
  const i = next - updated;
  return Number.isFinite(i) && i > 0 && i <= MAX_INTERVAL_S ? i : null;
};

// Delay (ms) after an attempt finished, before the floors below are applied.
export function outcomeDelay(o: { outcome: Outcome; wallNow: number; offsetMs: number; jitter: number }): number {
  const jitter = o.jitter * 2000;
  switch (o.outcome.kind) {
    case "ok": {
      const { nextUpdateAt, updatedAt } = o.outcome;
      const span = (validInterval(nextUpdateAt, updatedAt) ?? MAX_INTERVAL_S) * 1000;
      const untilNext = nextUpdateAt * 1000 - (o.wallNow + o.offsetMs);
      return Math.round(Math.min(Math.max(untilNext, 0), span) + 1000 + jitter);
    }
    case "warming":
      return Math.round(BACKOFF_MS + jitter);
    case "error":
      return Math.round(Math.min(BACKOFF_MS * 2 ** (Math.max(1, o.outcome.errors) - 1), MAX_BACKOFF_MS) + jitter);
  }
}

// Minimum time between two request starts.
export const gapFloor = (hidden: boolean) => (hidden ? HIDDEN_GAP_MS : MIN_GAP_MS);

// Estimates serverNow - clientNow without a server clock in the contract.
// For a 200 received at client time recv: updated_at <= serverNow, and a cached copy is
// only served until next_update_at, so next - serverNow is in [-slack, next - updated].
// A fresh response tightens the lower bound, a nearly expired cached one the upper bound.
export class ClockOffset {
  private lo = -Infinity;
  private hi = Infinity;

  observe(nextUpdateAt: number, updatedAt: number, recvWallMs: number) {
    const interval = validInterval(nextUpdateAt, updatedAt);
    if (interval == null) return;
    const base = nextUpdateAt * 1000 - recvWallMs;
    const lo = base - interval * 1000, hi = base + SLACK_MS;
    if (Math.max(lo, this.lo) > Math.min(hi, this.hi)) {
      this.lo = lo; this.hi = hi;
    } else {
      this.lo = Math.max(lo, this.lo); this.hi = Math.min(hi, this.hi);
    }
  }

  // Trust the client clock (usually NTP-synced) unless the bounds rule it out.
  get ms(): number {
    return Math.round(Math.min(Math.max(0, this.lo), this.hi));
  }
}
