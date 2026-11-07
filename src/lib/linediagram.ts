// The line card's live diagram (LineCard): the stops of one direction in order, each with the next arrival there, and
// the vehicles placed between the stops they are driving between. Pure: built from /v2 data (a pattern, its stops,
// the direction's vehicles and their runs).

import type { V2Pattern, V2Run, V2Stop, V2Vehicle } from "./v2";

export type DiagramItem =
  | { kind: "stop"; id: string; name: string; at: number | null; live: boolean; here: boolean }
  | { kind: "vehicle"; id: string; label: string | null; delay_s: number | null; vehicle: V2Vehicle };

// The direction's main pattern: the one most vehicles run on, else the longest.
export function mainPattern(patterns: V2Pattern[], dir: 0 | 1, vehicles: V2Vehicle[] = [], runs: Record<string, V2Run> = {}): V2Pattern | null {
  const mine = patterns.filter(p => p.direction === dir);
  if (!mine.length) return null;
  const count = new Map<string, number>();
  for (const v of vehicles) {
    const p = v.run ? runs[v.run]?.pattern : null;
    if (p) count.set(p, (count.get(p) ?? 0) + 1);
  }
  return [...mine].sort((a, b) => (count.get(b.id) ?? 0) - (count.get(a.id) ?? 0) || b.stops.length - a.stops.length)[0];
}

// Where a vehicle is on the pattern: the index of the stop it drives to next (its next_stop, else the first stop its
// run has not passed), or null when neither is on this pattern.
export function nextIndex(v: V2Vehicle, stops: string[], run?: V2Run): number | null {
  if (v.next_stop) {
    const k = stops.indexOf(v.next_stop);
    if (k >= 0) return k;
  }
  const next = run?.stops.find(s => !s.passed)?.stop;
  const k = next ? stops.indexOf(next) : -1;
  return k >= 0 ? k : null;
}

// The diagram: every stop of the pattern with its next arrival (the soonest not-passed time over the runs, from a
// minute ago on), and each vehicle just before the stop it drives to. here: the stops to mark («εδώ»).
export function lineDiagram(pattern: V2Pattern, stops: Record<string, V2Stop>, vehicles: V2Vehicle[], runs: Record<string, V2Run>,
  nowS: number, here: Set<string> = new Set()): DiagramItem[] {
  const next = new Map<string, { at: number; live: boolean }>();
  for (const v of vehicles) {
    const run = v.run ? runs[v.run] : undefined;
    for (const s of run?.stops ?? []) {
      if (s.passed || s.at < nowS - 60) continue;
      const old = next.get(s.stop);
      if (!old || s.at < old.at) next.set(s.stop, { at: s.at, live: s.source === "live" });
    }
  }
  const before = new Map<number, V2Vehicle[]>();
  for (const v of vehicles) {
    const k = nextIndex(v, pattern.stops, v.run ? runs[v.run] : undefined);
    if (k == null) continue;
    before.set(k, [...(before.get(k) ?? []), v]);
  }
  const out: DiagramItem[] = [];
  pattern.stops.forEach((id, k) => {
    for (const v of before.get(k) ?? []) out.push({ kind: "vehicle", id: v.id, label: v.label, delay_s: v.delay_s, vehicle: v });
    const n = next.get(id);
    out.push({ kind: "stop", id, name: stops[id]?.name ?? id, at: n?.at ?? null, live: n?.live ?? false, here: here.has(id) });
  });
  return out;
}

// The line's numbers at a glance: vehicles running, their average delay (whole minutes, of those with one), and how
// often a bus passes now (the median gap between the next arrivals at the stop most of them still pass).
export function glance(vehicles: V2Vehicle[], runs: Record<string, V2Run>, nowS: number): { count: number; delayMin: number | null; everyMin: number | null } {
  const delays = vehicles.map(v => v.delay_s).filter((d): d is number => d != null);
  const delayMin = delays.length ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length / 60) : null;
  // The stop ahead of the most runs: their times there, in order, give the gaps.
  const at = new Map<string, number[]>();
  for (const v of vehicles) {
    for (const s of (v.run ? runs[v.run]?.stops : undefined) ?? []) {
      if (s.passed || s.at < nowS) continue;
      at.set(s.stop, [...(at.get(s.stop) ?? []), s.at]);
    }
  }
  const best = [...at.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  const times = [...best].sort((a, b) => a - b);
  const gaps = times.slice(1).map((t, k) => (t - times[k]) / 60).sort((a, b) => a - b);
  const mid = gaps.length >> 1;
  const median = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  const everyMin = gaps.length ? Math.max(1, Math.round(median)) : null;
  return { count: vehicles.length, delayMin, everyMin };
}

// The line's speed now (km/h): along the pattern, stop to stop in straight lines, over each run's time from its first
// to its last stop; the median of the runs. null without a run that covers at least 1 km and 3 minutes.
export function lineSpeed(pattern: V2Pattern, stops: Record<string, V2Stop>, vehicles: V2Vehicle[], runs: Record<string, V2Run>): number | null {
  const rad = Math.PI / 180;
  const m = (a: V2Stop, b: V2Stop) => {
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
  };
  const speeds: number[] = [];
  for (const v of vehicles) {
    const run = v.run ? runs[v.run] : undefined;
    if (!run || run.pattern !== pattern.id || run.stops.length < 2) continue;
    const first = run.stops[0], last = run.stops[run.stops.length - 1];
    const i = pattern.stops.indexOf(first.stop), j = pattern.stops.lastIndexOf(last.stop);
    if (i < 0 || j <= i) continue;
    let dist = 0;
    for (let k = i; k < j; k++) {
      const a = stops[pattern.stops[k]], b = stops[pattern.stops[k + 1]];
      if (a && b) dist += m(a, b);
    }
    const secs = last.at - first.at;
    if (dist >= 1000 && secs >= 180) speeds.push(dist / secs * 3.6);
  }
  if (!speeds.length) return null;
  speeds.sort((a, b) => a - b);
  const mid = speeds.length >> 1;
  return Math.round(speeds.length % 2 ? speeds[mid] : (speeds[mid - 1] + speeds[mid]) / 2);
}

// How the vehicles are spread along the direction (LineCard's strip): each vehicle's place from the first stop (0) to
// the last (1), between the stops it drives between; two or more within one stop of each other are bunched (they
// will arrive together and leave a long gap behind them). The first bunch is named by the stop it comes to next.
export interface Spread { dots: { id: string; x: number; bunched: boolean }[]; bunch: { n: number; before: string } | null }
export function spread(items: DiagramItem[]): Spread {
  const total = items.filter(i => i.kind === "stop").length;
  if (total < 2) return { dots: [], bunch: null };
  let seen = 0;
  const at: { id: string; s: number; next: string }[] = [];
  items.forEach((it, k) => {
    if (it.kind === "stop") { seen++; return; }
    const next = items.slice(k + 1).find(i => i.kind === "stop") as { name: string } | undefined;
    at.push({ id: it.id, s: Math.max(0, seen - 0.5), next: next?.name ?? "" });
  });
  const near = (a: number, b: number) => Math.abs(a - b) <= 1;
  const bunched = at.map((v, k) => (k > 0 && near(v.s, at[k - 1].s)) || (k < at.length - 1 && near(v.s, at[k + 1].s)));
  let bunch: Spread["bunch"] = null;
  for (let k = 0; k < at.length && !bunch; k++) {
    if (!bunched[k]) continue;
    let n = 1;
    while (k + n < at.length && bunched[k + n] && near(at[k + n].s, at[k + n - 1].s)) n++;
    bunch = { n, before: at[k + n - 1].next };
  }
  return { dots: at.map((v, k) => ({ id: v.id, x: Math.min(1, v.s / (total - 1)), bunched: bunched[k] })), bunch };
}
