// Greek text helpers, ported from the upstream viewer (oasa_rt/viewer.html).

export type DelayClass = "ontime" | "late1" | "late2" | "late3" | "none";

// Short times: 144 -> "2′24″", 45 -> "45″".
export function duration(sec: number): string {
  const t = Math.round(Math.abs(sec));
  if (t < 60) return `${t}″`;
  return `${Math.floor(t / 60)}′${String(t % 60).padStart(2, "0")}″`;
}

// Delay with sign: "+45″", "−2′"; under 30″ it is on time.
export function fmtDelay(s: number): string {
  const a = Math.abs(s);
  if (a < 30) return "στην ώρα του";
  const sign = s > 0 ? "+" : "−";
  return a < 60 ? `${sign}${Math.round(a)}″` : `${sign}${Math.round(a / 60)}′`;
}

export const delayText = (s: number | null) => (s == null ? "χωρίς δρομολόγιο" : fmtDelay(s));

// Age of a vehicle position on its marker: "24″", then "2′".
export const STALE_POS_S = 90;
export const isStalePos = (sec: number) => sec > STALE_POS_S;
export const ageLabel = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return s < 60 ? `${s}″` : `${Math.floor(s / 60)}′`;
};

// Map filters (layers popover): only positions not drawn as stale; only vehicles at most 5′ late.
export interface Only { fresh: boolean; onTime: boolean }
export const passes = (f: Only, cls: DelayClass, ageSec: number) =>
  (!f.fresh || !isStalePos(ageSec)) && (!f.onTime || cls === "ontime" || cls === "late1");

export const fmtMinutes = (s: number) => (s >= 0 ? "+" : "−") + Math.abs(s / 60).toFixed(1).replace(".", ",");

export const delayClass = (d: number | null): DelayClass =>
  d == null ? "none" : d <= 120 ? "ontime" : d <= 300 ? "late1" : d <= 600 ? "late2" : "late3";

export const clock = (t: number) =>
  new Date(t * 1000).toLocaleTimeString("el-GR", { timeZone: "Europe/Athens", hourCycle: "h23" });

// "πριν 24 δευτερόλεπτα"; unixSec is server time, nowMs the client clock.
export const ago = (unixSec: number, nowMs: number) => "πριν " + duration(Math.max(0, nowMs / 1000 - unixSec));

// The day (YYYY-MM-DD) the OASA timetable ended, when it is past (Athens time; the end day counts).
export const gtfsEnded = (expires: string | undefined, now = new Date()) =>
  expires && expires < now.toLocaleDateString("sv-SE", { timeZone: "Europe/Athens" }) ? expires : null;
// "2026-10-06" -> "6/10"
export const dayMonth = (d: string) => d.slice(5).split("-").reverse().map(Number).join("/");
