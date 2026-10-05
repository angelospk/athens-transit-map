// The chosen lines, as kept in the URL: ?l=040,Α1 (order kept, max 5).

export const MAX_LINES = 5;

// Latin capitals that look like Greek ones. The backend accepts both; we keep Greek.
const LOOKALIKE: Record<string, string> = {
  A: "Α", B: "Β", E: "Ε", Z: "Ζ", H: "Η", I: "Ι", K: "Κ", M: "Μ", N: "Ν", O: "Ο", P: "Ρ", T: "Τ", Y: "Υ", X: "Χ",
};

export const normalizeLineId = (id: string) =>
  [...id.trim().toLocaleUpperCase("el")].map(c => LOOKALIKE[c] ?? c).join("");

// Every id in the link, deduped; parseSelection() keeps the first MAX_LINES.
export function selectionIds(search: string): string[] {
  const raw = new URLSearchParams(search).get("l") ?? "";
  const out = new Set<string>();
  for (const part of raw.split(",")) {
    const id = normalizeLineId(part);
    if (id) out.add(id);
  }
  return [...out];
}

export const parseSelection = (search: string) => selectionIds(search).slice(0, MAX_LINES);

export function splitKnown(ids: string[], known: Set<string>) {
  return { kept: ids.filter(id => known.has(id)), dropped: ids.filter(id => !known.has(id)) };
}

export function serializeSelection(lines: string[]): string {
  if (!lines.length) return "";
  // Commas stay readable; each id is percent-encoded on its own.
  return "?l=" + lines.map(encodeURIComponent).join(",");
}

// Returns the same array when the cap blocks the change, so callers can detect it.
export function toggle(lines: string[], id: string): string[] {
  if (lines.includes(id)) return lines.filter(l => l !== id);
  if (lines.length >= MAX_LINES) return lines;
  return [...lines, id];
}
