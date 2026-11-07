// «Είμαι μέσα» on a metro train: the ride followed on this phone while the page is open (metroRide.ts does the
// working out). Nothing leaves the phone. It lasts while the page is open; a closed card does not end it.
import { MotionStops, nearestStationM, rideByClock, rideGo, rideOver, rideStart, rideStop, type Ride, type RideStop } from "./metroRide";

export type RideTrust = "checking" | "ok" | "clock" | "still" | "far";

class MetroRide {
  card = $state<string | null>(null);        // the train's card id (stasy:…)
  label = $state("");
  ride = $state.raw<Ride | null>(null);
  motion = $state<"asking" | "on" | "off">("off");
  trust = $state<RideTrust>("checking");
  off = $state<number | null>(null);          // the station the rider gets off at (an index into ride.stops)
  private det: MotionStops | null = null;
  private onMotion: ((e: DeviceMotionEvent) => void) | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastT = 0;
  private boardedAt = 0;
  private told = -1;
  private now: () => number = () => Date.now() / 1000;
  private pos: () => [number, number] | null = () => null;
  private notify: (text: string) => void = () => {};

  /** From the tap on «Είμαι μέσα» (iOS asks for the motion sensors only from a tap). */
  async start(o: { card: string; label: string; stops: RideStop[]; now: () => number; pos: () => [number, number] | null; notify: (t: string) => void }) {
    this.end();
    this.card = o.card; this.label = o.label; this.now = o.now; this.pos = o.pos; this.notify = o.notify;
    const t = o.now();
    this.ride = rideStart(o.stops, t);
    this.boardedAt = t;
    this.trust = "checking";
    this.timer = setInterval(() => this.tick(), 5000);
    const DM = (globalThis as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
    let ok = !!DM;
    if (DM?.requestPermission) {
      this.motion = "asking";
      try { ok = (await DM.requestPermission()) === "granted"; } catch { ok = false; }
    }
    if (this.card !== o.card) return;   // ended meanwhile
    if (!ok) { this.motion = "off"; this.trust = "clock"; this.tick(); return; }
    this.motion = "on";
    this.det = new MotionStops((kind, at) => this.event(kind, at));
    this.onMotion = e => {
      const a = e.acceleration?.x != null ? e.acceleration : e.accelerationIncludingGravity;
      if (!a || a.x == null || a.y == null || a.z == null) return;
      const t = this.now();
      if (t - this.lastT < 0.1) return;   // 10 samples a second are enough
      this.lastT = t;
      this.det?.push(t, Math.hypot(a.x, a.y, a.z));
    };
    addEventListener("devicemotion", this.onMotion);
    this.tick();
  }

  end() {
    if (this.onMotion) removeEventListener("devicemotion", this.onMotion);
    clearInterval(this.timer);
    this.onMotion = null; this.det = null;
    this.card = null; this.ride = null; this.off = null; this.told = -1;
    this.motion = "off";
  }

  setOff(i: number | null) { this.off = i; this.told = -1; this.tell(); }

  private event(kind: "stop" | "go", at: number) {
    const r = this.ride;
    if (!r) return;
    this.ride = kind === "stop" ? rideStop(r, at) : rideGo(r);
    this.judge();
    this.tell();
  }

  private tick() {
    const r = this.ride;
    if (!r) return;
    const t = this.now();
    // Without motion the clock leads; with it, the clock only catches up stops missed (two or more behind).
    const c = rideByClock(r, t);
    if (this.motion !== "on" || c.i >= r.i + 2) this.ride = c;
    this.judge();
    this.tell();
    if (rideOver(this.ride!, t) && t - (this.ride!.stops.at(-1)!.at + this.ride!.offset) > 60) this.end();
  }

  // Whether the rider seems to be on the train: far from every station of it (when the place is known), or no train
  // motion after 6 minutes, says not; a stop seen near its time in the timetable says yes.
  private judge() {
    const r = this.ride;
    if (!r) return;
    const p = this.pos();
    if (p && nearestStationM(r, p) > 1500 && !(this.det?.trainLike)) { this.trust = "far"; return; }
    if (this.motion !== "on") { this.trust = "clock"; return; }
    if (r.matched > 0 && this.det?.trainLike) { this.trust = "ok"; return; }
    this.trust = this.now() - this.boardedAt > 360 && !this.det?.trainLike ? "still" : "checking";
  }

  // Getting off: a word one station before, and at it.
  private tell() {
    const r = this.ride, off = this.off;
    if (!r || off == null) return;
    const name = r.stops[off]?.name ?? "";
    if (r.i === off && r.at && this.told !== 2) { this.told = 2; this.buzz(`Κατέβα τώρα: ${name}`); }
    else if (r.i === off && !r.at && this.told < 1) { this.told = 1; this.buzz(`Κατεβαίνεις στην επόμενη: ${name}`); }
  }
  private buzz(text: string) {
    try { navigator.vibrate?.([200, 100, 200]); } catch { /* no vibration here (iOS) */ }
    this.notify(text);
  }
}

export const metroRide = new MetroRide();
