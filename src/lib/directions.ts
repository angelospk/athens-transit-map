// A line's directions: its variants grouped by last stop ("→ ΣΥΝΤΑΓΜΑ").
// The contract's `direction` field is 0 for every variant of some lines, so it is not used.

import type { LineStatic } from "./types";

export interface DirectionGroup { to: string; variants: string[] }

export function directionGroups(st: LineStatic): DirectionGroup[] {
  const groups = new Map<string, DirectionGroup & { headsign: string }>();
  for (const [id, v] of Object.entries(st.variants)) {
    const last = v.stops[v.stops.length - 1];
    if (!last) continue;
    const g = groups.get(last) ?? { to: st.stops[last]?.name ?? last, headsign: v.headsign, variants: [] };
    g.variants.push(id);
    groups.set(last, g);
  }
  const all = [...groups.values()];
  // Loops in both directions can end at stops with the same name: tell them apart.
  return all.map(({ to, headsign, variants }) => ({
    to: headsign && all.some(o => o.to === to && o.variants !== variants) ? `${to} (${headsign})` : to,
    variants,
  }));
}

// A vehicle is hidden when its line is focused on other variants. Vehicles with no variant, or one
// missing from the static data (`known`), stay visible.
export const isHidden = (variant: string | null, focus: Set<string> | undefined, known: Set<string>) =>
  !!focus && variant != null && known.has(variant) && !focus.has(variant);

// The direction group a variant belongs to, and the other one of a two-direction line.
export const groupOf = (groups: DirectionGroup[], variant: string | null | undefined) =>
  variant ? groups.find(g => g.variants.includes(variant)) : undefined;

export function otherDirection(groups: DirectionGroup[], focus: string[] | undefined): DirectionGroup | null {
  if (groups.length !== 2 || !focus) return null;
  const i = groups.findIndex(g => g.variants.join() === focus.join());
  return i < 0 ? null : groups[1 - i];
}
