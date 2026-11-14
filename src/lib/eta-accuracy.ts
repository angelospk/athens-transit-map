// «Ακρίβεια» in the ⓘ sheet (web#27): how close our arrival times came to the real passes last
// week. lab/eta/publish.sh writes the file each week to the `eta` branch of this repo.

export const ETA_ACCURACY_URL = "https://raw.githubusercontent.com/angelospk/staseis-map/eta/v1/latest.json";

// Fewer predictions than this in a bucket say nothing a user can rely on.
const MIN_N = 500;

export interface EtaAccuracy {
  v: 1;
  from: string;
  to: string;
  stops: number;
  preds: number;
  buckets: { label: string; n: number; median_s: number; within_120: number }[];
  phantom_share: number;
}

const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const date = (x: unknown): x is string => typeof x === "string" && /^\d{4}-\d\d-\d\d$/.test(x);

export function parseAccuracy(x: unknown): EtaAccuracy | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (o.v !== 1 || !date(o.from) || !date(o.to) || !num(o.stops) || !num(o.preds) || !num(o.phantom_share)) return null;
  if (!Array.isArray(o.buckets)) return null;
  const buckets: EtaAccuracy["buckets"] = [];
  for (const b of o.buckets as Record<string, unknown>[]) {
    if (!b || typeof b.label !== "string" || !num(b.n) || !num(b.median_s) || !num(b.within_120)) return null;
    if (b.n >= MIN_N) buckets.push({ label: b.label, n: b.n, median_s: b.median_s, within_120: b.within_120 });
  }
  if (!buckets.length) return null;
  return { v: 1, from: o.from, to: o.to, stops: o.stops, preds: o.preds, buckets, phantom_share: o.phantom_share };
}

// The percentages are over the predictions whose pass we saw; the rest are shown as their own share.
export function accuracyCounts(a: EtaAccuracy): { measured: number; unseen_pct: number } {
  return { measured: a.buckets.reduce((s, b) => s + b.n, 0), unseen_pct: Math.round(100 * a.phantom_share) };
}

// 37 → "37″", 103 → "1,7′".
export function fmtErr(s: number): string {
  const r = Math.round(s);
  return r < 90 ? `${r}″` : `${(s / 60).toLocaleString("el-GR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}′`;
}

export async function loadAccuracy(): Promise<EtaAccuracy | null> {
  try {
    const r = await fetch(ETA_ACCURACY_URL, { signal: AbortSignal.timeout(10_000) });
    return r.ok ? parseAccuracy(await r.json()) : null;
  } catch {
    return null;
  }
}
