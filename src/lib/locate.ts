// The user's location: adaptive polling with getCurrentPosition (design: 2026-10-06-natural-motion-locate).
// One request at a time; the next one is scheduled when it finishes. Faster while moving.

import { distanceM, type LngLat } from "./glide";
import { cumulativeLL, type Plan } from "./motion";

export interface Fix { pos: LngLat; acc: number; at: number; speed: number | null; heading: number | null }   // at: ms

export type LocState = "off" | "searching" | "on" | "denied" | "unavailable";

const POOR_M = 100;   // fixes less accurate than this tell nothing about movement

// Speed in m/s: the device's own when it is accurate enough, else from two fixes that moved
// further than their accuracy; null when unknown.
export function measuredSpeed(prev: Fix | null, cur: Fix): number | null {
  if (cur.acc > POOR_M) return null;
  if (cur.speed != null && Number.isFinite(cur.speed) && cur.speed >= 0) return cur.speed;
  if (!prev || prev.acc > POOR_M) return null;
  const dt = (cur.at - prev.at) / 1000;
  if (dt <= 0) return null;
  const d = distanceM(prev.pos, cur.pos);
  return d > Math.max(cur.acc, prev.acc, 10) ? d / dt : 0;
}

// Next poll: 5 s in a vehicle, 10 s walking, then 15, 20, 30 s while standing or unsure.
export function nextInterval(speed: number | null, still: number): { ms: number; still: number } {
  if (speed != null && speed >= 2) return { ms: 5000, still: 0 };
  if (speed != null && speed >= 0.6) return { ms: 10_000, still: 0 };
  return { ms: [15_000, 20_000, 30_000][Math.min(still, 2)], still: still + 1 };
}

// Where the dot heads between fixes: on along the heading for at most 5 s, only when the fix is
// good and the device says it moves. Otherwise it stays at the fix.
export const AHEAD_S = 5;
export function userPlan(f: Fix, speed: number | null): Plan {
  const moving = speed != null && speed >= 1 && f.heading != null && Number.isFinite(f.heading) && f.acc <= 30;
  if (!moving) return { geom: [f.pos], cum: [0], target: () => 0 };
  const d = speed * AHEAD_S, a = (f.heading! * Math.PI) / 180;
  const to: LngLat = [f.pos[0] + (Math.sin(a) * d) / (111_320 * Math.cos((f.pos[1] * Math.PI) / 180)), f.pos[1] + (Math.cos(a) * d) / 111_320];
  const geom = [f.pos, to];
  return { geom, cum: cumulativeLL(geom), target: t => Math.min(d, speed * Math.min(Math.max(t - f.at / 1000, 0), AHEAD_S)) };
}

interface GeoLike {
  getCurrentPosition(ok: (p: GeolocationPosition) => void, err: (e: GeolocationPositionError) => void, o?: PositionOptions): void;
}

export interface LocatorOptions {
  geo: GeoLike;
  onFix: (f: Fix, speed: number | null) => void;
  onState: (s: LocState) => void;
  isHidden?: () => boolean;
}

export class Locator {
  state: LocState = "off";
  private token = 0;            // callbacks of an older session are ignored
  private inFlight = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private last: Fix | null = null;
  private still = 0;
  private errors = 0;
  private interval = 5000;
  private dueAt = 0;            // Date.now() of the next poll

  constructor(private o: LocatorOptions) {}

  start() {
    if (this.state !== "off" && this.state !== "denied" && this.state !== "unavailable") return;
    this.token++;
    clearTimeout(this.timer);
    this.last = null;
    this.still = this.errors = 0;
    this.interval = 5000;
    this.set("searching");
    this.request();
  }

  stop() {
    this.token++;
    clearTimeout(this.timer);
    this.set("off");
  }

  // Paused while hidden; back in view, polls at once if it is due.
  visibilityChanged() {
    if (this.state === "off" || this.state === "denied") return;
    clearTimeout(this.timer);
    if (!this.hidden()) this.schedule(Math.max(0, this.dueAt - Date.now()));
  }

  private hidden() { return this.o.isHidden?.() ?? (typeof document !== "undefined" && document.hidden); }

  private set(s: LocState) {
    if (this.state === s) return;
    this.state = s;
    this.o.onState(s);
  }

  private schedule(ms: number) {
    clearTimeout(this.timer);
    this.dueAt = Date.now() + ms;
    if (this.hidden()) return;   // visibilityChanged() resumes
    this.timer = setTimeout(() => this.request(), ms);
  }

  // A request from an older session finished: the current one (if any) asks again.
  private restart() {
    if (this.state === "searching") this.request();
  }

  private request() {
    if (this.inFlight) return;
    this.inFlight = true;
    const tok = this.token;
    this.o.geo.getCurrentPosition(
      p => {
        this.inFlight = false;
        if (tok !== this.token) return this.restart();
        this.errors = 0;
        const c = p.coords;
        const f: Fix = { pos: [c.longitude, c.latitude], acc: c.accuracy, at: p.timestamp,
          speed: c.speed ?? null, heading: c.heading ?? null };
        if (!this.last || f.at > this.last.at) {
          const v = measuredSpeed(this.last, f);
          const n = nextInterval(v, this.still);
          this.interval = n.ms;
          this.still = n.still;
          this.last = f;
          this.set("on");
          this.o.onFix(f, v);
        }
        this.schedule(this.interval);
      },
      e => {
        this.inFlight = false;
        if (tok !== this.token) return this.restart();
        if (e.code === 1) {   // PERMISSION_DENIED
          this.token++;
          clearTimeout(this.timer);
          this.set("denied");
          return;
        }
        this.errors++;
        if (!this.last) this.set("unavailable");
        this.schedule(Math.min(120_000, 30_000 * 2 ** (this.errors - 1)));
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: Math.min(this.interval / 2, 5000) },
    );
  }
}
