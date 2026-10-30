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
    if (b.t >= after && dB <= 40) return b.t;
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

// One row per pred. The actual pass is the first one from 60 s before the question to 90 min
// after it; without one, a pred still inside the last 20 min of data is unresolved, not phantom.
export function score(preds: Pred[], passes: Record<string, number[]>, end: number): Score {
  const errs: number[][] = LABELS.map(() => []);
  const all: number[] = [];
  let matched = 0, phantom = 0, unresolved = 0;
  for (const p of preds) {
    const actual = (passes[`${p.stop}|${p.vehicle}`] ?? []).find(x => x >= p.q - 60 && x <= p.q + 5400);
    if (actual === undefined) {
      if (p.at + 1200 > end) unresolved++;
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
