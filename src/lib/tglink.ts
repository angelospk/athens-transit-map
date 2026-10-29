// The Telegram bot's start link (https://t.me/<bot>?start=<payload>): which lines, variants and boarding
// stops to watch, in at most 64 characters of [A-Za-z0-9_-]. Indexes refer to the trip index
// (public/trips.json), whose version the payload carries: the bot refuses a link made from other data.
//
//   "1" · version (3, base36 days since 2020-01-01) · n (1) · entries of 5:
//   line (2, index in the sorted line ids) · variant (1, index in the line's sorted variant ids) · i (2)
//
// A recurring alert (Telegram only) starts with "2" instead and has a schedule before the entries:
//   "2" · version (3) · n (1) · days (2, bit 0 = Monday … bit 6 = Sunday) · start/5 (2, minutes after midnight,
//   Athens) · len/15 (1, minutes) · entries of 5, as above

import type { TripIndex } from "./trip";

export const MAX_PAYLOAD = 64;
// How many stops ahead an alert may fire (one base-36 digit holds up to 35).
export const MAX_N = 7;
const EPOCH = Date.UTC(2020, 0, 1);
const b36 = (n: number, w: number) => (n >= 0 && n < 36 ** w ? n.toString(36).padStart(w, "0") : null);
const un36 = (s: string) => (/^[0-9a-z]+$/.test(s) ? parseInt(s, 36) : NaN);
const ver = (v: string) => b36(Math.round((Date.parse(`${v}T00:00:00Z`) - EPOCH) / 86_400_000), 3);
const lineIds = (ix: TripIndex) => Object.keys(ix.l).sort();
const variantIds = (ix: TripIndex, line: string) => Object.keys(ix.l[line]).sort();

export interface AlertLines { line: string; variants: { id: string; i: number }[] }

// When a recurring alert watches: on the days of the bit set, from start for len minutes.
export interface Rep { days: number; start: number; len: number }

const validRep = (r: Rep) => Number.isInteger(r.days) && r.days >= 1 && r.days <= 127 && Number.isInteger(r.start) && r.start >= 0 && r.start % 5 === 0 &&
  Number.isInteger(r.len) && r.len >= 15 && r.len <= 240 && r.len % 15 === 0 && r.start + r.len <= 1440;

export function encodeAlert(ix: TripIndex, n: number, lines: AlertLines[], rep?: Rep): string | null {
  const v = ver(ix.v);
  if (!v || !Number.isInteger(n) || n < 1 || n > MAX_N) return null;
  let head = `1${v}${n}`;
  if (rep) {
    if (!validRep(rep)) return null;
    head = `2${v}${n}${b36(rep.days, 2)}${b36(rep.start / 5, 2)}${b36(rep.len / 15, 1)}`;
  }
  const ids = lineIds(ix);
  let out = head, entries = 0;
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

export type Decoded = { ok: true; n: number; lines: AlertLines[]; rep?: Rep } | { ok: false; why: "bad" | "old" };

export function decodeAlert(ix: TripIndex, p: string): Decoded {
  const head = p[0] === "1" ? 5 : p[0] === "2" ? 10 : 0;
  if (!head || p.length > MAX_PAYLOAD || p.length < head + 5 || (p.length - head) % 5 || !/^[0-9a-z]+$/.test(p)) return { ok: false, why: "bad" };
  if (p.slice(1, 4) !== ver(ix.v)) return { ok: false, why: "old" };
  const n = un36(p[4]);
  if (!(n >= 1 && n <= MAX_N)) return { ok: false, why: "bad" };
  let rep: Rep | undefined;
  if (head === 10) {
    rep = { days: un36(p.slice(5, 7)), start: un36(p.slice(7, 9)) * 5, len: un36(p[9]) * 15 };
    if (!validRep(rep)) return { ok: false, why: "bad" };
  }
  const ids = lineIds(ix), lines: AlertLines[] = [];
  for (let k = head; k < p.length; k += 5) {
    const line = ids[un36(p.slice(k, k + 2))];
    const id = line ? variantIds(ix, line)[un36(p[k + 2])] : undefined;
    const i = un36(p.slice(k + 3, k + 5));
    if (!line || !id || !(i < ix.l[line][id].length)) return { ok: false, why: "bad" };
    const at = lines.find(l => l.line === line);
    if (at) at.variants.push({ id, i });
    else lines.push({ line, variants: [{ id, i }] });
  }
  return rep ? { ok: true, n, lines, rep } : { ok: true, n, lines };
}
