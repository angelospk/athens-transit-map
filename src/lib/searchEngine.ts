// Our own search: lines and stops from the /v2 indexes, matched word by word in any order, by the start of a word
// (so «Αγ.», «Λεωφ.», «Πλ.» find «Αγίου», «Λεωφόρος», «Πλατεία»), with a typing slip forgiven, in Greek or
// Greeklish; names people use for lines («κόκκινη γραμμή», «ΗΣΑΠ») and places («αεροδρόμιο», «λιμάνι»); and two
// asks in one line: «040 Σύνταγμα» (a line at a stop) and «από Σύνταγμα προς Κηφισιά» (a trip). Ranked by how well
// the name matches, then what the user keeps (favourites, recent picks), what runs now and how near it is.
// Pure, no Svelte; finder.ts keeps the older, simpler calls.
import { chipOf, type Chip, type StopEntry } from "./finder";
import { fold, greeklish, greeklishKeys, hasLatin } from "./search";
import { normalizeLineId } from "./selection";
import type { V2Line } from "./v2";

export interface Ctx {
  at?: [number, number] | null;                 // [lat, lon]: the user, or the map's centre
  favLines?: Set<string>; favStops?: Set<string>; recent?: Set<string>;   // ids
  live?: (id: string) => number | null;         // vehicles on the line now (liveLines.ts)
}
export interface Scored<T> { item: T; score: number; typo: boolean }

// ---- Words.
/** The query's words: folded, the dots of short forms dropped («Λεωφ.» = «λεωφ»), empty ones gone. */
export function tokens(q: string): string[] {
  return fold(q).replace(/[.'΄`’]/g, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}
const wordCache = new Map<string, string[]>();
function wordsOf(name: string, latin: boolean): string[] {
  const k = (latin ? "L" : "G") + name;
  let w = wordCache.get(k);
  if (!w) {
    w = fold(name).replace(/[.'΄`’]/g, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (latin) w = w.map(greeklish);
    if (wordCache.size > 60_000) wordCache.clear();
    wordCache.set(k, w);
  }
  return w;
}

/** Optimal string alignment distance, stopping early above `max`. */
export function slips(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let low = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      low = Math.min(low, d[i][j]);
    }
    if (low > max) return max + 1;
  }
  return d[a.length][b.length];
}
const allowed = (n: number) => (n >= 7 ? 2 : n >= 4 ? 1 : 0);

/** How well one query word meets a name's words: 0 a whole word, 1 a word's start, 3 inside a word, 5 a slip; -1 none. */
function wordScore(tok: string, words: string[], last: boolean): { s: number; typo: boolean } {
  let best = -1, typo = false;
  for (const w of words) {
    let s = -1, t = false;
    if (w === tok) s = 0;
    else if (w.startsWith(tok)) s = last ? 1 : 1.5;   // the word being typed is a start by nature
    else if (tok.length >= 3 && w.includes(tok)) s = 3;
    else {
      const max = allowed(tok.length);
      if (max && (slips(tok, w.slice(0, tok.length), max) <= max || slips(tok, w, max) <= max)) { s = 5; t = true; }
    }
    if (s >= 0 && (best < 0 || s < best)) { best = s; typo = t; }
    if (best === 0) break;
  }
  return { s: best, typo };
}

/** A name against the query's words, every word somewhere in it, in any order; -1 when one is missing. */
export function nameScore(toks: string[], name: string, latin = false): { s: number; typo: boolean } {
  if (!toks.length) return { s: -1, typo: false };
  const words = wordsOf(name, latin);
  if (!words.length) return { s: -1, typo: false };
  let sum = 0, typo = false;
  for (let i = 0; i < toks.length; i++) {
    const keys = latin ? (i === toks.length - 1 ? greeklishKeys(toks[i]) : [greeklish(toks[i])]) : [toks[i]];
    let best = -1, bt = false;
    for (const k of keys) { const r = wordScore(k, words, i === toks.length - 1); if (r.s >= 0 && (best < 0 || r.s < best)) { best = r.s; bt = r.typo; } }
    if (best < 0) return { s: -1, typo: false };
    sum += best; typo ||= bt;
  }
  const first = latin ? greeklish(toks[0]) : toks[0];
  if (!words[0].startsWith(first)) sum += 0.5 * toks.length;   // a name that begins with what was typed first goes first
  return { s: sum / toks.length + Math.max(0, words.length - toks.length) * 0.05, typo };
}

// ---- What people call things.
/** Names for lines: the metro by colour or old name. Matched on the whole query (folded, Greeklish as well). */
const LINE_ALIASES: [RegExp, string[]][] = [
  [/^(πρασινη( γραμμη)?|ησαπ|ηλεκτρικοσ|green( line)?|isap|ilektrikos)$/, ["Μ1"]],
  [/^(κοκκινη( γραμμη)?|red( line)?|kokkini)$/, ["Μ2"]],
  [/^(μπλε( γραμμη)?|blue( line)?|ble)$/, ["Μ3"]],
];
/** Places by a common name: the query's word(s) also looked for as these. */
const PLACE_ALIASES: [RegExp, string][] = [
  [/^(αεροδρομιο|αεροδρομιου|airport|aerodromio|ελ βενιζελοσ|ελευθεριοσ βενιζελοσ)$/, "αεροδρομιο"],
  [/^(λιμανι|λιμανι πειραια|port|limani|piraeus port)$/, "πειραιασ"],
  [/^(σταθμοσ λαρισησ|larisis|larissa station)$/, "σταθμοσ λαρισησ"],
];
/** The means named in a query («μετρό», «τραμ»…): the lines and stops of that means. */
const MODE_WORDS: [RegExp, string[]][] = [
  [/^(μετρο|metro)$/, ["metro"]], [/^(τραμ|tram)$/, ["tram"]], [/^(τρολει|τρολλει|trolley|troley)$/, ["trolley"]],
  [/^(προαστιακοσ|proastiakos|suburban)$/, ["suburban"]], [/^(λεωφορειο|λεωφορεια|bus|leoforeio)$/, ["bus"]],
];
const whole = (q: string) => tokens(q).join(" ");
export function lineAlias(q: string): string[] | null {
  const w = whole(q);
  return LINE_ALIASES.find(([re]) => re.test(w))?.[1] ?? null;
}
export function modeWord(q: string): string[] | null {
  const w = whole(q);
  return MODE_WORDS.find(([re]) => re.test(w))?.[1] ?? null;
}
export function placeAlias(q: string): string | null {
  const w = whole(q);
  return PLACE_ALIASES.find(([re]) => re.test(w))?.[1] ?? null;
}

// ---- Ranking.
const noZeros = (s: string) => s.replace(/^0+(?=.)/, "");
const labelKey = (s: string) => noZeros(fold(normalizeLineId(s)));
export function km(a: [number, number], b: [number, number]): number {
  const kx = 111.32 * Math.cos((a[0] * Math.PI) / 180);
  return Math.hypot((a[1] - b[1]) * kx, (a[0] - b[0]) * 110.54);
}
const sorted = <T>(xs: Scored<T>[]) => xs.sort((a, b) => a.score - b.score);
const modesOk = (modes: string[], chips: Chip[]) => !chips.length || modes.some(m => { const c = chipOf(m); return !!c && chips.includes(c); });

/** Lines for a query: by number first (exact, then its start), then by name; aliases and means words too. */
export function searchLines(lines: V2Line[], q: string, chips: Chip[] = [], ctx: Ctx = {}): Scored<V2Line>[] {
  const shown = lines.filter(l => modesOk([l.mode], chips));
  const alias = lineAlias(q);
  if (alias) { const keys = alias.map(labelKey); return shown.filter(l => l.label && keys.includes(labelKey(l.label))).map(item => ({ item, score: 0, typo: false })); }
  const mode = modeWord(q);
  if (mode) return sorted(shown.filter(l => mode.includes(l.mode)).map(item => ({ item, score: boost(item.id, 1, ctx), typo: false })));
  const toks = tokens(q);
  if (!toks.length) return [];
  const key = labelKey(q.trim()), latin = hasLatin(q);
  const out: Scored<V2Line>[] = [];
  for (const l of shown) {
    let s = -1, typo = false;
    if (l.label) {
      const lk = labelKey(l.label);
      if (lk === key) s = 0;
      else if (key && lk.startsWith(key)) s = 1;
    }
    if (s < 0) {
      const r = nameScore(toks, l.label ? `${l.label} ${l.name}` : l.name, latin), e = l.name_en ? nameScore(toks, l.name_en, false) : { s: -1, typo: false };
      const b = r.s >= 0 && (e.s < 0 || r.s <= e.s) ? r : e;
      if (b.s >= 0) { s = 4 + b.s; typo = b.typo; }
    }
    if (s >= 0) out.push({ item: l, score: boost(l.id, s, ctx), typo });
  }
  return sorted(out);
}
function boost(id: string, s: number, ctx: Ctx): number {
  if (ctx.favLines?.has(id) || ctx.favStops?.has(id)) s -= 0.6;
  if (ctx.recent?.has(id)) s -= 0.3;
  const n = ctx.live?.(id);
  if (n === 0) s += 0.4;
  return s;
}

/** Stops for a query (or, with no query, every stop the filter keeps), ranked by the match, then nearness. */
export function searchStops(stops: StopEntry[], q: string, chips: Chip[] = [], ctx: Ctx = {}, keep?: (s: StopEntry) => boolean): Scored<StopEntry>[] {
  const alias = placeAlias(q), mode = modeWord(q);
  const toks = tokens(alias ?? (mode ? "" : q)), latin = !alias && hasLatin(q);
  if (!toks.length && !mode && !keep) return [];
  if (toks.length === 1 && toks[0].length < 2 && !keep) return [];
  const out: Scored<StopEntry>[] = [];
  for (const s of stops) {
    if (!modesOk(s[4], chips) || (mode && !s[4].some(m => mode.includes(m))) || (keep && !keep(s))) continue;
    let base = 0, typo = false;
    if (toks.length) {
      const r = nameScore(toks, s[1], latin);
      if (r.s < 0) continue;
      base = r.s; typo = r.typo;
    }
    let score = base + (s[4].every(m => m === "bus" || m === "trolley") ? 0.4 : 0);   // a station before a bus pole
    if (ctx.at) score += Math.min(2, km(ctx.at, [s[2], s[3]]) / 4);
    out.push({ item: s, score: boost(s[0], score, ctx), typo });
  }
  return sorted(out);
}

/** Any named things (the planner's places: stops by name, stations, areas) by the same rules; `extra` adds to the
 *  score (lower first), e.g. a station before a pole. */
export function searchNamed<T>(items: T[], q: string, name: (t: T) => string, extra: (t: T) => number = () => 0): Scored<T>[] {
  const alias = placeAlias(q), toks = tokens(alias ?? q), latin = !alias && hasLatin(q);
  if (!toks.length || (toks.length === 1 && toks[0].length < 2)) return [];
  const out: Scored<T>[] = [];
  for (const it of items) {
    const r = nameScore(toks, name(it), latin);
    if (r.s >= 0) out.push({ item: it, score: r.s + extra(it), typo: r.typo });
  }
  return sorted(out);
}

// ---- Two asks in one.
export type Intent =
  | { kind: "lineAt"; line: V2Line; stop: StopEntry }
  | { kind: "trip"; from: StopEntry; to: StopEntry };
// Folded: a final ς is a σ («προς» → «προσ»). Without «από» only the words that can only join two places count
// («προς», «για», «ως», «μέχρι», «→»); after «από», «στο/στη/στον» too.
const TRIP_STRONG = /^(.+?)\s+(?:προσ|για|ωσ|μεχρι|to|→)\s+(.+)$/;
const TRIP_ANY = /^(.+?)\s+(?:προσ|για|ωσ|μεχρι|στο|στη|στην|στον|to|→)\s+(.+)$/;
/** «από Α προς Β», «Α προς Β», «Α → Β», «Α για Β»: the two ends as typed (folded); null when it is not a trip. */
export function parseTrip(q: string): { from: string; to: string } | null {
  const f = fold(q).replace(/\s*(?:->|→)\s*/g, " → ").trim();
  const from = /^απο\s+/.test(f);
  const m = (from ? TRIP_ANY : TRIP_STRONG).exec(f.replace(/^απο\s+/, ""));
  return m && m[1].trim() && m[2].trim() ? { from: m[1].trim(), to: m[2].trim() } : null;
}
/** The user's own words for an end: their home, their work, where they are. */
export function ownEnd(t: string): "home" | "work" | "me" | null {
  const w = tokens(t).join(" ");
  if (/^(σπιτι|το σπιτι|σπιτι μου|home|spiti)$/.test(w)) return "home";
  if (/^(δουλεια|τη δουλεια|δουλεια μου|γραφειο|work|douleia|doulia)$/.test(w)) return "work";
  if (/^(εδω|η θεση μου|θεση μου|απο εδω|εμενα|me|here|edo)$/.test(w)) return "me";
  return null;
}

/** «040 Σύνταγμα» / «Σύνταγμα 040»: the line at that stop (one it serves). «από Α προς Β», «Α → Β»: a trip. */
export function intents(lines: V2Line[], stops: StopEntry[], q: string, ctx: Ctx = {}): Intent[] {
  const out: Intent[] = [];
  const trip = parseTrip(q);
  if (trip) {
    const a = searchStops(stops, trip.from, [], ctx)[0], b = searchStops(stops, trip.to, [], ctx)[0];
    if (a && b && fold(a.item[1]) !== fold(b.item[1])) out.push({ kind: "trip", from: a.item, to: b.item });
    return out;
  }
  const toks = q.trim().split(/\s+/);
  if (toks.length < 2) return out;
  for (const [lineTok, rest] of [[toks[0], toks.slice(1)], [toks[toks.length - 1], toks.slice(0, -1)]] as const) {
    const key = labelKey(lineTok);
    const line = lines.find(l => l.label && labelKey(l.label) === key);
    if (!line) continue;
    const at = searchStops(stops.filter(s => s[5].includes(line.id)), rest.join(" "), [], ctx)[0];
    if (at) { out.push({ kind: "lineAt", line, stop: at.item }); break; }
  }
  return out;
}
