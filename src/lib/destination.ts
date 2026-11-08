// Where a line's variant runs to, as a readable name. The map data says where it ends (the stops at the end
// of the variant); the headsign or the line's name gives the readable name of that end. Built into
// trips*.json (scripts/trips.ts, d.h), so the web and the app show «02Κ → ΚΤΕΛ-ΜΑΚΕΔΟΝΙΑ».
//
// A name joins its two ends with a dash, but a dash also joins the words of one place («ΙΚΕΑ-ΚΤΕΛ-ΜΑΚΕΔΟΝΙΑ»
// is ΙΚΕΑ and ΚΤΕΛ-ΜΑΚΕΔΟΝΙΑ) and a name can list places on the way («ΚΙΤΣΙ - ΒΟΥΛΙΑΓΜΕΝΗ - ΓΛΥΦΑΔΑ»). So
// the name is never split at every dash: its start (up to a dash) must name the place where the variant
// starts and its end (from a dash) the place where it ends, each the shortest that does. No such cut, or
// one each way: no name (null), and the card shows the headsign as before.

import { cleanTerminus, greek } from "./towards";
import { fold } from "./search";
import { distanceM } from "./glide";
import type { LineStatic } from "./types";

// Words that name no place on their own.
const STOP_RAW = ["αγ", "αγιοσ", "αγια", "αγιου", "αγιασ", "αγιοι", "αγιων", "νεα", "νεο", "νεοσ", "νεασ", "στ", "σμ", "μετρο",
  "οδοσ", "λεωφ", "λεωφοροσ", "και", "αφετηρια", "τερμα", "δια", "μεσω", "του", "τησ", "των", "προσ", "απο", "στη", "στο", "εωσ"];

// Words after a place that say when, not where: weekdays, night («ΚΤΕΛ-ΔΕΥΤΕΡΑ», «Κ.Τ.Ε.Λ. ΝΥΧΤΕΡΙΝΟ»).
const WHEN = ["δευτερα", "τριτη", "τεταρτη", "πεμπτη", "παρασκευη", "σαββατο", "κυριακη", "νυχτερινο", "νυχτερινη", "νυχτερινα"];
const DAYS = new Set(WHEN);

// One spelling of a folded Greek word: ει οι η υ are ι, ω is ο, αι is ε, a double letter one (ΛΥΣΙΜΑΧΕΙΑ and
// ΛΥΣΙΜΑΧΙΑ, ΦΛΕΒΑΡΙΩΤΗΣΣΑ and ΦΛΕΒΑΡΙΩΤΙΣΣΑ are one place).
const spell = (w: string) => w.replace(/ου/g, "\0").replace(/ει|οι|η|υ/g, "ι").replace(/ω/g, "ο").replace(/αι/g, "ε")
  .replace(/\0/g, "ου").replace(/(\p{L})\1/gu, "$1");

const STOP = new Set(STOP_RAW.map(spell));

// The words of a name, folded, for matching: «Κ.Τ.Ε.Λ» is «κτελ», «Α.Σ.ΙΚΕΑ» gives «ικεα»; Latin capitals in a
// Greek word are Greek («ΑΦEΤΗΡΙΑ»).
export function words(s: string): string[] {
  const out = new Set<string>();
  for (const w of fold(s.split(/\s+/).map(greek).join(" ")).split(/[^\p{L}\p{N}.]+/u).map(spell)) {
    const pieces = w.split(".").filter(Boolean);
    if (pieces.length > 1 && pieces.every(p => p.length === 1)) out.add(pieces.join(""));   // an abbreviation: Κ.Τ.Ε.Λ
    else for (const p of pieces) out.add(p);
  }
  return [...out].filter(w => w.length >= 3 && !STOP.has(w) && !/\d/.test(w));
}

// Two words name the same place: equal, or the same word with another Greek case ending (ΠΕΙΡΑΙΑ, ΠΕΙΡΑΙΑΣ;
// ΔΙΚΕΛΛΑ, ΔΙΚΕΛΛΩΝ; ΚΟΜΠΟΤΙ, ΚΟΜΠΟΤΙΟΥ; ΝΕΑΠΟΛΗ, ΝΕΑΠΟΛΕΩΣ). Two words that only start alike are not (ΚΑΛΑΜΑΚΙ, ΚΑΛΑΜΑΤΑ).
const ENDINGS = ["ιου", "ιον", "ιασ", "ιεσ", "εοσ", "ου", "ον", "ασ", "εσ", "οσ", "ισ", "σ", "α", "ο", "ι", "ε"];   // spelled (spell)
const stems = (w: string) => [w, ...ENDINGS.filter(e => w.endsWith(e) && w.length - e.length >= 3).map(e => w.slice(0, -e.length))];
function same(a: string, b: string): boolean {
  if (a === b) return true;
  const x = stems(a);
  return stems(b).some(y => x.includes(y));
}

// How many words of a piece of a name one of the area's stop names has.
const score = (ws: string[], area: string[][]) => Math.max(0, ...area.map(names => ws.filter(w => names.some(x => same(w, x))).length));

// The pieces of a name between its dashes (- – —, with or without spaces; not inside brackets), as
// [from, to, spaced] (spaced: a space next to the dash before it); weekdays at the end («ΚΤΕΛ-ΔΕΥΤΕΡΑ»)
// are not a place.
type Piece = [number, number, boolean];
function pieces(name: string): Piece[] {
  const out: Piece[] = [];
  let depth = 0, from = 0, spaced = false;
  for (let i = 0; i < name.length; i++) {
    const c = name[i];
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (!depth && /[-–—]/.test(c)) {
      out.push([from, i, spaced]);
      spaced = /\s/.test(name[i - 1] ?? "") || /\s/.test(name[i + 1] ?? "");
      from = i + 1;
    }
  }
  out.push([from, name.length, spaced]);
  const named = out.filter(([a, b]) => /\p{L}/u.test(name.slice(a, b)));
  while (named.length > 1) {
    const [a, b] = named[named.length - 1];
    const ws = fold(name.slice(a, b)).split(/[^\p{L}]+/u).filter(Boolean);
    if (!ws.length || !ws.every(w => DAYS.has(w))) break;
    named.pop();
  }
  return named;
}

// A piece of a name without what follows ΜΕΣΩ/ΑΠΟ («ΙΚΕΑ ΑΠΟ ΛΑΚΩΜΑ»): a place on the way, not the end. A place
// in brackets refines the end («ΚΗΦΙΣΙΑ(ΠΛ.ΠΛΑΤΑΝΟΥ)», «ΠΕΡΙΣΤΕΡΙ (ΑΓ. ΙΕΡΟΘΕΟΣ)»): it matches, and is not shown.
const core = (s: string) => s.replace(/(\S)\s+(ΜΕΣΩ|ΑΠΟ|μέσω|από)\s.*$/u, "$1");

// A name as shown: no remark in brackets or after ΜΕΣΩ/ΑΠΟ («ΙΚΕΑ ΑΠΟ ΛΑΚΩΜΑ»), no Τ.Σ. or ΑΦΕΤΗΡΙΑ
// (cleanTerminus), in capitals.
const label = (s: string) => {
  const ws = cleanTerminus(core(s).replace(/\([^)]*\)?/g, " "))
    .replace(/^[-–—\s]+|[-–—\s]+$/gu, "").toLocaleUpperCase("el").split(" ");
  while (ws.length > 1 && DAYS.has(fold(ws[ws.length - 1]))) ws.pop();
  return ws.join(" ");
};

// The end of a variant named by `name`, or null when no cut of the name is clear. first/last: the stop names
// where the variant starts and where it ends (each a rider would call the same place, the last stops of the
// line's other variants that end there too); elsewhere: where the line's other variants end, away from this
// end: a place there after the matched one is past this end («ΠΕΤΡΑΛΩΝΑ - ΤΑΥΡΟΣ» on a bus that stops at
// ΠΕΤΡΑΛΩΝΑ). one: only one end of the cut matched (below).
export function endOf(name: string, first: string[], last: string[], elsewhere: string[] = []): { name: string; one: boolean } | null {
  const from = first.map(words), to = last.map(words), away = elsewhere.map(words);
  const ps = pieces(name), n = ps.length;
  if (n < 2) return null;
  const text = (i: number, j: number) => name.slice(ps[i][0], ps[j][1]).trim();
  const named = (t: string, area: string[][]) => score(words(t), area) > 0;
  // A piece of the name names one area and not the other, by the words it shows (not its remarks).
  const clear = (t: string, own: string[][], other: string[][]) => {
    const ws = words(core(t)), s = score(ws, own);
    return s > 0 && s > score(ws, other);
  };
  // The place around the matched piece m: the pieces joined to it with no space and named nowhere else on
  // the line, toward its start down to lo and toward its end up to hi (a place's words read left to right:
  // «ΚΤΕΛ-ΜΑΚΕΔΟΝΙΑ»).
  const place = (m: number, lo: number, hi: number) => {
    const joined = (q: number, joint: boolean) => !joint && !named(text(q, q), away);
    let a = m, b = m;
    while (a - 1 >= lo && joined(a - 1, ps[a][2])) a--;
    while (b + 1 <= hi && joined(b + 1, ps[b + 1][2])) b++;
    return text(a, b);
  };
  // The name read in one order: its start names area a, its end area b. [the end's name, one end only].
  // One end only (Harold, 2026-11-08): the start stop often has no place name (ΑΦΕΤΗΡΙΑ, ΣΤΑΘΜΟΣ
  // ΥΠΕΡΑΣΤΙΚΩΝ, Τ.Σ. ΣΙΝΤΡΙΒΑΝΙ), so a cut whose end matches where the variant ends counts when that end
  // names nothing where it starts (where the opposite variants end) and the rest of the name names nothing
  // where it ends.
  const cut = (a: string[][], b: string[][], endFirst: boolean): [string, boolean] | null => {
    let e = -1, s = -1;
    for (let i = n - 1; i >= 1 && e < 0; i--) if (clear(text(i, n - 1), b, a)) e = i;
    for (let j = 0; j < (e < 0 ? n - 1 : e) && s < 0; j++) if (clear(text(0, j), a, b)) s = j;
    // The end of the name (read ahead): from its matched piece to the name's end. Its start (read the other way
    // round): from the name's start through its matched piece and, when the other end matched too, on up to it.
    const end = () => place(e, e, n - 1), start = (hi: number) => place(s, 0, hi);
    if (e >= 0 && s >= 0) return [endFirst ? start(e - 1) : end(), false];
    if (!endFirst && e >= 0 && !named(text(e, n - 1), a) && !named(text(0, e - 1), b)) return [end(), true];
    if (endFirst && s >= 0 && !named(text(0, s), b) && !named(text(s + 1, n - 1), a)) return [start(s), true];
    return null;
  };
  // The name in the variant's order (its end is where the variant ends), or the other way round: the one that
  // fits, both ends matched first. Both orders fit as well: not clear.
  const ahead = cut(from, to, false), back = cut(to, from, true);
  for (const one of [false, true]) {
    const a = ahead?.[1] === one ? ahead : null, b = back?.[1] === one ? back : null;
    if (a && b) return null;
    const got = a ?? b;
    if (got) return label(got[0]) ? { name: label(got[0]), one } : null;
  }
  return null;
}

export const destination = (name: string, first: string[], last: string[], elsewhere: string[] = []) =>
  endOf(name, first, last, elsewhere)?.name ?? null;

export interface VariantEnds {
  id: string;
  headsign: string;
  first: string[]; last: string[];                  // stop names near the start; near the end, the end first
  start: [number, number]; end: [number, number];   // [lon, lat]
  loop: boolean;                                    // back at its start
  names: string[];                                  // every stop name, in order
}

const AREA_M = 400, NEAR_M = 300, LOOP_M = 50, AREA_STOPS = 4;

// The ends of each variant of a line's static file (variants of fewer than 2 stops left out).
export function variantEnds(st: LineStatic): VariantEnds[] {
  const out: VariantEnds[] = [];
  for (const [id, v] of Object.entries(st.variants)) {
    const s = v.stops.map(x => st.stops[x]).filter(Boolean);
    if (s.length < 2) continue;
    const pt = (x: { lat: number; lon: number }): [number, number] => [x.lon, x.lat];
    const start = pt(s[0]), end = pt(s[s.length - 1]);
    const near = (list: typeof s, p: [number, number]) => {
      const names: string[] = [];
      for (const x of list) {
        if (names.length >= AREA_STOPS || distanceM(pt(x), p) >= AREA_M) break;
        names.push(x.name);
      }
      return names;
    };
    out.push({ id, headsign: v.headsign, start, end, first: near(s, start), last: near([...s].reverse(), end),
      loop: v.stops[0] === v.stops[v.stops.length - 1] || distanceM(start, end) < LOOP_M, names: s.map(x => x.name) });
  }
  return out;
}

// The readable end of every variant of a line that the data can tell, by variant id; a loop has none.
// The area at each end of a variant also holds the last stops of the line's other variants that end
// there. Places away from the end are where other variants end and the variant's stops on the way
// («ΠΑΛΟΥΚΙΑ-ΛΙΜΝΙΩΝΑ-ΓΥΑΛΑ-ΚΑΚΗ ΒΙΓΛΑ» ends at ΛΙΜΝΙΩΝΑ and stops at ΓΥΑΛΑ). A variant whose names give no clear cut takes the end of the variants that end where it ends,
// when they agree on one.
// one: the ids named from one end only (for a spot check).
export function lineDestinations(lineName: string, vs: VariantEnds[], one?: Set<string>): Record<string, string> {
  const runs = vs.filter(v => !v.loop);
  const endingAt = (p: [number, number], not: string) => runs.filter(o => o.id !== not && distanceM(o.end, p) < NEAR_M);
  const out: Record<string, string> = {};
  for (const v of runs) {
    const first = [...v.first, ...endingAt(v.start, v.id).flatMap(o => o.last)];
    const last = [...v.last, ...endingAt(v.end, v.id).flatMap(o => o.last)];
    const elsewhere = [...runs.filter(o => distanceM(o.end, v.end) >= NEAR_M).map(o => o.last[0]),
      ...v.names.filter(x => !v.last.includes(x))];
    const d = endOf(v.headsign, first, last, elsewhere) ?? endOf(lineName, first, last, elsewhere);
    if (d) out[v.id] = d.name;
    if (d?.one) one?.add(v.id);
  }
  const own = { ...out };
  for (const v of runs) {
    if (own[v.id]) continue;
    const names = new Set(endingAt(v.end, v.id).map(o => own[o.id]).filter(Boolean));
    if (names.size === 1) out[v.id] = [...names][0];
  }
  return out;
}

// The ends into the stop index's directions: the names join d.n, d.h holds line → variant → index into d.n.
export function withDestinations<D extends { n: string[] }>(d: D, ends: Record<string, Record<string, string>>): D & { h: Record<string, Record<string, number>> } {
  const n = [...d.n], at = new Map(n.map((x, i) => [x, i]));
  const h: Record<string, Record<string, number>> = {};
  for (const [line, vs] of Object.entries(ends)) for (const [v, name] of Object.entries(vs)) {
    let k = at.get(name);
    if (k == null) { at.set(name, (k = n.length)); n.push(name); }
    (h[line] ??= {})[v] = k;
  }
  return { ...d, n, h };
}
