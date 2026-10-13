// Each line drawn in detail gets its own colour while it stays on the map: route, vehicles, card and chip.
// Okabe-Ito, a categorical palette that colourblind readers can tell apart; fg keeps the number readable.

export interface LineColor { bg: string; fg: string }

export const PALETTE: readonly LineColor[] = [
  { bg: "#0072B2", fg: "#ffffff" },   // blue
  { bg: "#E69F00", fg: "#000000" },   // orange
  { bg: "#009E73", fg: "#000000" },   // bluish green
  { bg: "#CC79A7", fg: "#000000" },   // reddish purple
  { bg: "#56B4E9", fg: "#000000" },   // sky blue
  { bg: "#D55E00", fg: "#000000" },   // vermillion
];

// A line keeps its slot while it stays; a new line takes the first free slot (wrapping past the palette).
export function assignSlots(lines: readonly string[], prev: ReadonlyMap<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const id of lines) if (prev.has(id)) out.set(id, prev.get(id)!);
  const used = new Set(out.values());
  for (const id of lines) {
    if (out.has(id)) continue;
    let s = 0;
    while (used.has(s)) s++;
    out.set(id, s % PALETTE.length);
    used.add(s);
  }
  return new Map(lines.map(id => [id, out.get(id)!]));
}

export const colorOf = (slots: ReadonlyMap<string, number>, id: string): LineColor | undefined => {
  const s = slots.get(id);
  return s == null ? undefined : PALETTE[s];
};
