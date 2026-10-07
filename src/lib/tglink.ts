// The Telegram bot's start link (https://t.me/<bot>?start=<payload>): which lines, variants and boarding
// stops to watch, in at most 64 characters of [A-Za-z0-9_-]. Indexes refer to the trip index
// (public/trips.json), whose version the payload carries: the bot refuses a link made from other data.
//
//   "1" · version (3, base36 days since 2020-01-01) · n (1) · entries of 5:
//   line (2, index in the sorted line ids) · variant (1, index in the line's sorted variant ids) · i (2)

import type { TripIndex } from "./trip";

export const MAX_PAYLOAD = 64;
const EPOCH = Date.UTC(2020, 0, 1);
const b36 = (n: number, w: number) => (n >= 0 && n < 36 ** w ? n.toString(36).padStart(w, "0") : null);
const un36 = (s: string) => (/^[0-9a-z]+$/.test(s) ? parseInt(s, 36) : NaN);
const ver = (v: string) => b36(Math.round((Date.parse(`${v}T00:00:00Z`) - EPOCH) / 86_400_000), 3);
const lineIds = (ix: TripIndex) => Object.keys(ix.l).sort();
const variantIds = (ix: TripIndex, line: string) => Object.keys(ix.l[line]).sort();

export interface AlertLines { line: string; variants: { id: string; i: number }[] }

export function encodeAlert(ix: TripIndex, n: number, lines: AlertLines[]): string | null {
  const v = ver(ix.v);
  if (!v || !Number.isInteger(n) || n < 1 || n > 5) return null;
  const ids = lineIds(ix);
  let out = `1${v}${n}`, entries = 0;
  for (const l of lines) {
    const li = b36(ids.indexOf(l.line), 2);
    if (!li) continue;
    const vids = variantIds(ix, l.line);
    for (const x of l.variants) {
      const vi = b36(vids.indexOf(x.id), 1), seq = ix.l[l.line][x.id];
      const i = seq && x.i < seq.length ? b36(x.i, 2) : null;
      if (!vi || !i || out.length + 5 > MAX_PAYLOAD) continue;
      out += li + vi + i;
      entries++;
    }
  }
  return entries ? out : null;
}

export type Decoded = { ok: true; n: number; lines: AlertLines[] } | { ok: false; why: "bad" | "old" };

export function decodeAlert(ix: TripIndex, p: string): Decoded {
  if (p.length > MAX_PAYLOAD || p.length < 10 || (p.length - 5) % 5 || p[0] !== "1" || !/^[0-9a-z]+$/.test(p)) return { ok: false, why: "bad" };
  if (p.slice(1, 4) !== ver(ix.v)) return { ok: false, why: "old" };
  const n = un36(p[4]);
  if (!(n >= 1 && n <= 5)) return { ok: false, why: "bad" };
  const ids = lineIds(ix), lines: AlertLines[] = [];
  for (let k = 5; k < p.length; k += 5) {
    const line = ids[un36(p.slice(k, k + 2))];
    const id = line ? variantIds(ix, line)[un36(p[k + 2])] : undefined;
    const i = un36(p.slice(k + 3, k + 5));
    if (!line || !id || !(i < ix.l[line][id].length)) return { ok: false, why: "bad" };
    const at = lines.find(l => l.line === line);
    if (at) at.variants.push({ id, i });
    else lines.push({ line, variants: [{ id, i }] });
  }
  return { ok: true, n, lines };
}
