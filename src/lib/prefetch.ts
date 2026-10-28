// What to load ahead while the map rests: the runs of the trains on screen and the boards of the
// stations on screen, nearest the centre first, so a tap shows them at once (api.ts railCache).

import type { MetroStation } from "./metro";
import { stationNames } from "./rail";

export type WantKind = "metro-run" | "suburban-run" | "stasy" | "suburban-station";
export interface Want { kind: WantKind; id: string }
// A rendered feature: its layer, its screen point and its properties.
export interface Seen { layer: string; px: [number, number]; props: Record<string, unknown> }

export const PREFETCH_ZOOM = 13;   // farther out, too much is on screen to be worth it

export function wanted(seen: Seen[], center: [number, number], stations: MetroStation[], max = 6): Want[] {
  const d = (s: Seen) => Math.hypot(s.px[0] - center[0], s.px[1] - center[1]);
  const out: Want[] = [], keys = new Set<string>();
  const add = (w: Want) => { const k = `${w.kind}|${w.id}`; if (!keys.has(k)) { keys.add(k); out.push(w); } };
  for (const s of [...seen].sort((a, b) => d(a) - d(b))) {
    const p = s.props;
    if (s.layer === "train-dot") add({ kind: p.kind === "metro" ? "metro-run" : "suburban-run", id: String(p.id) });
    else if (s.layer === "suburban-station") add({ kind: "suburban-station", id: String(p.id) });
    else if (s.layer === "metro-station") for (const n of stationNames(stations, String(p.name))) add({ kind: "stasy", id: n });
  }
  return out.slice(0, max);
}
