// Greek text helpers, ported from the upstream viewer (oasa_rt/viewer.html).

export type DelayClass = "ontime" | "late1" | "late2" | "late3" | "none";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// 144 -> "2 λεπτά και 24 δευτερόλεπτα"
export function duration(sec: number): string {
  sec = Math.round(Math.abs(sec));
  const m = Math.floor(sec / 60), s = sec % 60, parts: string[] = [];
  if (m) parts.push(plural(m, "λεπτό", "λεπτά"));
  if (s || !m) parts.push(plural(s, "δευτερόλεπτο", "δευτερόλεπτα"));
  return parts.join(" και ");
}

export const fmtDelay = (s: number) => (s === 0 ? "καμία" : s > 0 ? duration(s) : duration(s) + " νωρίτερα");

export const fmtMinutes = (s: number) => (s >= 0 ? "+" : "−") + Math.abs(s / 60).toFixed(1).replace(".", ",");

export const delayClass = (d: number | null): DelayClass =>
  d == null ? "none" : d <= 120 ? "ontime" : d <= 300 ? "late1" : d <= 600 ? "late2" : "late3";

export const clock = (t: number) =>
  new Date(t * 1000).toLocaleTimeString("el-GR", { timeZone: "Europe/Athens", hourCycle: "h23" });

// "πριν 24 δευτερόλεπτα"; unixSec is server time, nowMs the client clock.
export const ago = (unixSec: number, nowMs: number) => "πριν " + duration(Math.max(0, nowMs / 1000 - unixSec));
