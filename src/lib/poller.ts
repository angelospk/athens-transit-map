// Polls one line per docs/CONTRACT.md. Pure timing rules live in schedule.ts.

import { ClockOffset, gapFloor, outcomeDelay, type Outcome } from "./schedule";
import type { LineLive } from "./types";

export type PollState = "loading" | "ok" | "warming" | "backoff" | "unknown";
export interface FetchResult { status: number; body: unknown; date?: number }   // date: server ms

export interface PollerOptions {
  line: string;
  fetchLine: (line: string, signal: AbortSignal) => Promise<FetchResult>;
  onData: (d: LineLive) => void;
  onState: (s: PollState) => void;
  clock?: ClockOffset;            // shared by all lines: one server
  wall?: () => number;            // Date.now
  mono?: () => number;            // performance.now
  rand?: () => number;
  isHidden?: () => boolean;
  timeoutMs?: number;
}

export function isLineLive(b: unknown): b is LineLive {
  const d = b as LineLive;
  return !!d && typeof d === "object" && typeof d.line === "string" && Number.isFinite(d.updated_at)
    && Number.isFinite(d.next_update_at) && Array.isArray(d.vehicles);
}

export class LinePoller {
  readonly line: string;
  private o: Required<Omit<PollerOptions, "line">>;
  private running = false;
  private dead = false;               // 404: never poll again
  private gen = 0;                    // drops results of requests from before a stop()
  private inFlight: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  // Kept across stop()/start() so quick deselect/reselect cannot bypass pacing.
  private lastStart = -Infinity;
  private baseDeadline = -Infinity;
  private errors = 0;

  constructor(opts: PollerOptions) {
    this.line = opts.line;
    this.o = {
      clock: new ClockOffset(),
      wall: () => Date.now(),
      mono: () => performance.now(),
      rand: Math.random,
      isHidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
      timeoutMs: 15_000,
      ...opts,
    };
  }

  get unknown() { return this.dead; }

  start() {
    if (this.running || this.dead) return;
    this.running = true;
    this.arm();
  }

  stop() {
    this.running = false;
    this.gen++;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.inFlight?.abort();
    this.inFlight = null;
  }

  // Re-clamp the armed timer; never bypasses backoff or the server deadline.
  visibilityChanged() {
    if (this.running && !this.inFlight) this.arm();
  }

  private due() {
    return Math.max(this.baseDeadline, this.lastStart + gapFloor(this.o.isHidden()));
  }

  private arm() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fire(), Math.max(0, this.due() - this.o.mono()));
  }

  private fire() {
    this.timer = undefined;
    if (!this.running || this.inFlight) return;
    if (this.o.mono() < this.due()) return this.arm();   // e.g. the tab got hidden
    void this.run();
  }

  private async run() {
    const gen = this.gen;
    const ctrl = new AbortController();
    this.inFlight = ctrl;
    this.lastStart = this.o.mono();
    const timeout = setTimeout(() => ctrl.abort(), this.o.timeoutMs);
    const failed: FetchResult = { status: 0, body: null };
    // Settles on abort even if fetchLine ignores the signal.
    const aborted = new Promise<FetchResult>(r => ctrl.signal.addEventListener("abort", () => r(failed), { once: true }));
    const res = await Promise.race([this.o.fetchLine(this.line, ctrl.signal).catch(() => failed), aborted]);
    clearTimeout(timeout);
    if (gen !== this.gen) return;
    this.inFlight = null;
    const outcome = this.handle(res);
    if (!outcome) return;
    this.baseDeadline = this.o.mono() + outcomeDelay({
      outcome, wallNow: this.o.wall(), offsetMs: this.o.clock.ms, jitter: this.o.rand(),
    });
    this.arm();
  }

  private handle({ status, body, date }: FetchResult): Outcome | null {
    if (status === 200 && isLineLive(body)) {
      this.errors = 0;
      this.o.clock.observe(body.next_update_at, body.updated_at, this.o.wall(), this.o.mono(), date);
      this.o.onData(body);
      this.o.onState("ok");
      return { kind: "ok", nextUpdateAt: body.next_update_at, updatedAt: body.updated_at };
    }
    if (status === 404) {
      this.dead = true;
      this.running = false;
      this.o.onState("unknown");
      return null;
    }
    if (status === 503 && (body as { error?: string } | null)?.error === "warming_up") {
      this.o.onState("warming");
      return { kind: "warming" };
    }
    this.errors++;
    this.o.onState("backoff");
    return { kind: "error", errors: this.errors };
  }
}
