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
// For a 200 received at client time recv: updated_at <= serverNow always (lower bound).
// The first time a snapshot is seen it is assumed current (the cache serves it only until
// next_update_at), so serverNow <= next + slack (upper bound). A snapshot seen again may
// be stale, so it only gives a lower bound; seen again after its own next_update_at (by
// our estimate), it proves the feed is stuck, and the assumed upper bounds are dropped.
// The HTTP Date header, when exposed, is another lower bound (cached copies keep it).
export class ClockOffset {
  private lo = -Infinity;
  private hi = Infinity;
  private preferred = 0;                // the client clock, corrected for jumps we measured
  private skew: number | null = null;   // wall - mono at the last observation
  private seen = new Set<string>();

  observe(nextUpdateAt: number, updatedAt: number, recvWallMs: number, recvMonoMs: number, dateMs?: number) {
    const interval = validInterval(nextUpdateAt, updatedAt);
    if (interval == null) return;
    const skew = recvWallMs - recvMonoMs;
    if (this.skew != null) {   // the client clock may have jumped: shift everything with it
      const jump = skew - this.skew;
      this.lo -= jump; this.hi -= jump; this.preferred -= jump;
    }
    this.skew = skew;
    this.lo = Math.max(updatedAt * 1000 - recvWallMs, this.lo);
    // A cached response keeps its old Date, so Date is only a lower bound, like updated_at.
    // It still shows a stuck feed at once: a fresh Date far past next_update_at.
    if (dateMs != null && Number.isFinite(dateMs)) this.lo = Math.max(dateMs - recvWallMs, this.lo);
    const snap = `${updatedAt}/${nextUpdateAt}`;
    if (!this.seen.has(snap)) {
      if (this.seen.size > 200) this.seen.clear();
      this.seen.add(snap);
      this.hi = Math.min(nextUpdateAt * 1000 + SLACK_MS - recvWallMs, this.hi);
    } else if (recvWallMs + this.ms > nextUpdateAt * 1000 + SLACK_MS) {
      this.hi = Infinity;   // stuck feed: the assumed upper bounds were wrong
    }
    if (this.hi < this.lo) this.hi = Infinity;
  }

  // Trust the client clock (usually NTP-synced) unless the bounds rule it out. Otherwise
  // take the lower bound: it can only make polls late, never early, and ages too small.
  get ms(): number {
    if (this.lo === -Infinity) return Math.round(this.preferred);
    return Math.round(this.lo <= this.preferred && this.preferred <= this.hi ? this.preferred : this.lo);
  }
}
