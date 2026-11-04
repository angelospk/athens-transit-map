// Case-, accent- and final-sigma-insensitive Greek matching.
export const fold = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("el").replace(/ς/g, "σ");

// Greeklish: a Greek name and a Latin query fold to one rough Latin key, so «syntagma», «sintagma» and
// «Σύνταγμα» are one. Sounds written in more than one way fold to one letter (η ι υ ει οι → i, ω → o,
// αι → e, θ th → q (not 8: «8η» is a number), χ ch h x ξ ks → x, β b μπ mp → v, ντ nt δ → d, γγ γκ ng → g); double letters are one.
// Rough on purpose: a few more names match, never fewer.
const GREEK: Record<string, string> = {
  α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th", ι: "i", κ: "k", λ: "l", μ: "m", ν: "n", ξ: "ks",
  ο: "o", π: "p", ρ: "r", σ: "s", τ: "t", υ: "y", φ: "f", χ: "ch", ψ: "ps", ω: "o",
};
const LATIN: Record<string, string> = {
  th: "q", ch: "x", kh: "x", ks: "x", ph: "f", gh: "g", dh: "d", ou: "u", au: "av", eu: "ev", ai: "e", ei: "i", oi: "i",
  mp: "v", mb: "v", nt: "d", gg: "g", gk: "g", ng: "g", b: "v", c: "k", h: "x", w: "o", y: "i",
};
const LATIN_RE = new RegExp(Object.keys(LATIN).sort((a, b) => b.length - a.length).join("|"), "g");
const keys = new Map<string, string>();
export function greeklish(s: string): string {
  let k = keys.get(s);
  if (k != null) return k;
  k = fold(s)
    .replace(/[αε]υ|ου/g, d => GREEK[d[0]] + "u")            // the υ of αυ ευ ου is not an i
    .replace(/[α-ω]/g, c => GREEK[c] ?? c)
    .replace(/ph/g, "f")
    .replace(/([ae])f(?=[^aeiouy\s])/g, "$1v")                // «efkarpia» = «eukarpia»
    .replace(LATIN_RE, d => LATIN[d])
    .replace(/(\p{L})\1+/gu, "$1");
  if (keys.size > 50_000) keys.clear();
  keys.set(s, k);
  return k;
}

// A query with a Latin letter is matched by its Greeklish key.
export const hasLatin = (q: string) => /[a-z]/i.test(q);

// What a last typed letter may still become with the next one («syn» may be «synt», ΣΥΝΤ = sid).
const PAIR_START: Record<string, string[]> = {
  n: ["d", "g"], m: ["v"], o: ["u", "i"], a: ["e"], e: ["i"], t: ["q"], c: ["x"], k: ["x"], p: ["f", "v"], f: ["v"],
};
// The keys of a query being typed: its own, and those its last letter may still turn into.
export function greeklishKeys(query: string): string[] {
  const q = fold(query.trim()), full = greeklish(q), next = PAIR_START[q.slice(-1)];
  // «aph» may go on as «aphr» (ΑΦΡ = avr) or «aphi» (ΑΦΙ = afi).
  const out = /[ae]f$/.test(full) ? [full, full.slice(0, -1) + "v"] : [full];
  if (!next) return out;
  const head = greeklish(q.slice(0, -1));
  return [...new Set([...out, head + greeklish(q.slice(-1)), ...next.map(c => head + c)])];
}
