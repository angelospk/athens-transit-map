// ETA lab: how close the live arrival prediction is to when the bus really passes the stop.
// A fix is one vehicle position (Unix seconds); a pred is one arrival the API showed.
//   bunx vitest run tests/eta-lab.test.ts

export interface Fix { t: number; lat: number; lon: number }
// q: when we asked, at: the arrival it predicted (Unix seconds).
export interface Pred { q: number; stop: string; vehicle: string; at: number }

export interface Bucket {
  label: string;
  n: number;
  median_abs_s: number | null;
  p90_abs_s: number | null;
  mean_s: number | null;     // signed: negative = we said earlier than it came
  within_60: number | null;  // share with |error| <= 60 s
  within_120: number | null;
}

export interface Score {
  matched: number;
  phantom: number;
  unresolved: number;
  all: Bucket;
  buckets: Bucket[];         // always 0-5′, 5-10′, 10-20′, 20′+, in that order
}

const M_LAT = 111195;
const LABELS = ["0-5′", "5-10′", "10-20′", "20′+"];

// Equirectangular metres: fine at city scale, and the stop is never more than a few km away.
function metres(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dy = (bLat - aLat) * M_LAT;
  const dx = (bLon - aLon) * M_LAT * Math.cos(((aLat + bLat) / 2) * Math.PI / 180);
  return Math.hypot(dx, dy);
}

// When the vehicle passes the stop at or after `after`: a fix inside 40 m, else the crossing
// of the leg whose two ends add up to about its length (the stop lies on the segment).
export function passTime(fixes: Fix[], stop: { lat: number; lon: number }, after = -Infinity): number | null {
  const fx = [...fixes].sort((a, b) => a.t - b.t);
  for (let i = 0; i < fx.length; i++) {
    const b = fx[i];
    const dB = metres(b.lat, b.lon, stop.lat, stop.lon);
    if (b.t >= after && dB <= 40) {
      // A bus that waits here (a terminus, a layover) passes when it leaves: that is what
      // the prediction there means. A short stop stays the arrival. The wait runs over
      // every fix inside, also across a gap in the fixes and from before `after`, and ends
      // only at a fix outside.
      const inside = (k: number) => metres(fx[k].lat, fx[k].lon, stop.lat, stop.lon) <= 40;
      let first = i, last = i;
      while (first > 0 && inside(first - 1)) first--;
      while (last + 1 < fx.length && inside(last + 1)) last++;
      if (fx[last].t - fx[first].t < 120) return b.t;
      if (last + 1 >= fx.length) return null;   // still waiting when the data ends
      return fx[last].t;
    }
    const a = fx[i - 1];
    if (!a) continue;
    const dA = metres(a.lat, a.lon, stop.lat, stop.lon);
    const ab = metres(a.lat, a.lon, b.lat, b.lon);
    if (!(ab > 0) || dA + dB <= 0) continue;
    if (dA + dB > 1.3 * ab + 50) continue;   // a parallel street, not a pass
    const pass = a.t + (b.t - a.t) * dA / (dA + dB);
    if (pass >= after) return pass;
  }
  return null;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

function p90(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(0.9 * s.length) - 1))];
}

function bucket(label: string, errs: number[]): Bucket {
  const abs = errs.map(e => Math.abs(e)), n = errs.length;
  return {
    label,
    n,
    median_abs_s: median(abs),
    p90_abs_s: p90(abs),
    mean_s: n ? errs.reduce((a, e) => a + e, 0) / n : null,
    within_60: n ? abs.filter(e => e <= 60).length / n : null,
    within_120: n ? abs.filter(e => e <= 120).length / n : null,
  };
}

// One row per pred. A bus stays listed at the stop until it passes, so a trip is one run of
// preds for the same stop|vehicle with no gap over 15 min, and its pass must come between
// 60 s before the question and 5 min after the run's last listing. A pass later than that
// is the next lap. Without one, a run that ends within 15 min of the data's end is
// unresolved, not phantom: it may still go on.
// `keep` picks the rows that count; the others still extend the runs (a run across midnight).
export function score(preds: Pred[], passes: Record<string, number[]>, end: number, keep: (p: Pred) => boolean = () => true): Score {
  const errs: number[][] = LABELS.map(() => []);
  const all: number[] = [];
  let matched = 0, phantom = 0, unresolved = 0;
  const runEnd = new Map<Pred, number>(), byKey: Record<string, Pred[]> = {};
  for (const p of preds) (byKey[`${p.stop}|${p.vehicle}`] ??= []).push(p);
  for (const ps of Object.values(byKey)) {
    ps.sort((a, b) => a.q - b.q);
    for (let i = ps.length - 1, last = Infinity; i >= 0; i--) {
      if (i === ps.length - 1 || ps[i + 1].q - ps[i].q > 900) last = ps[i].q;
      runEnd.set(ps[i], last);
    }
  }
  for (const p of preds) {
    if (!keep(p)) continue;
    const until = runEnd.get(p)! + 300;
    const actual = (passes[`${p.stop}|${p.vehicle}`] ?? []).find(x => x >= p.q - 60 && x <= until);
    if (actual === undefined) {
      if (runEnd.get(p)! + 900 > end) unresolved++;   // the run may still go on
      else phantom++;
      continue;
    }
    matched++;
    const err = p.at - actual, horizon = Math.max(0, actual - p.q);
    errs[horizon < 300 ? 0 : horizon < 600 ? 1 : horizon < 1200 ? 2 : 3].push(err);
    all.push(err);
  }
  return { matched, phantom, unresolved, all: bucket("όλα", all), buckets: LABELS.map((l, i) => bucket(l, errs[i])) };
}

// Every pass of every stop|vehicle pair the preds mention (a bus can loop and pass twice).
export function passesFor(
  preds: Pred[],
  fixesByVehicle: Record<string, Fix[]>,
  stops: Record<string, { lat: number; lon: number }>,
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const p of preds) {
    const key = `${p.stop}|${p.vehicle}`;
    if (key in out) continue;
    const stop = stops[p.stop], fixes = fixesByVehicle[p.vehicle], times: number[] = [];
    if (stop && fixes?.length) {
      let after = -Infinity;
      for (;;) {
        const t = passTime(fixes, stop, after);
        if (t === null) break;
        times.push(t);
        after = t + 120;   // a later pass must be at least 2 min after the last one
      }
    }
    out[key] = times.sort((a, b) => a - b);
  }
  return out;
}

// What the ⓘ sheet shows (web#27): the three buckets under 20′ only, because past 20′ the bus
// is often still before its start and the time comes from the timetable. Read by
// src/lib/eta-accuracy.ts; bump `v` on any change of shape.
export interface Published {
  v: 1;
  from: string;
  to: string;
  stops: number;
  preds: number;             // matched + phantom
  buckets: { label: string; n: number; median_s: number; within_120: number }[];
  phantom_share: number;
}

export function summary(s: Score, at: { from: string; to: string; stops: number }): Published {
  const preds = s.matched + s.phantom;
  return {
    v: 1, ...at, preds,
    buckets: s.buckets.slice(0, 3).filter(b => b.n > 0).map(b => ({
      label: b.label, n: b.n, median_s: Math.round(b.median_abs_s!), within_120: Math.round(100 * b.within_120!) / 100,
    })),
    phantom_share: preds ? Math.round(100 * s.phantom / preds) / 100 : 0,
  };
}
