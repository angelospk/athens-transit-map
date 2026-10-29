// The bridge between the card stack (/v2 ids, cards.ts) and the cards of today, which still read /v1
// data: the card for what the map taps, and the /v1 thing a card shows. It goes with the /v2 cards (web#11).

import type { Card } from "./cards";
import { fold } from "./search";
import type { TrainSel } from "./trains";

export type RailLine = { kind: "metro" | "suburban"; id: string };

const native = (id: string) => id.slice(id.indexOf(":") + 1);

export const busVehicleCard = (line: string, id: string): Card =>
  ({ kind: "vehicle", id: `oasa:${id}`, line: `oasa:${line}`, title: `${line} · ${id}` });
export const routeCard = (line: string, variant: string): Card =>
  ({ kind: "line", id: `oasa:${line}`, pattern: `oasa:${variant}`, title: line });
export const busStopCard = (code: string, name: string): Card => ({ kind: "stop", id: `oasa:${code}`, title: name });
// A STASY stop id is its folded name and its mode (the backend's rail.Fold: lower case, no accents).
export const stationCard = (name: string, lines: string[]): Card => ({
  kind: "stop", ref: name, title: name,
  id: `stasy:${fold(name).replace(/\s+/g, " ").trim()}-${lines.some(l => l.startsWith("M")) ? "metro" : "tram"}`,
});
export const railStationCard = (id: string, name: string): Card => ({ kind: "stop", id: `proastiakos:${id}`, title: name });
// A metro train's Vehicle id is its Run id (the /v2 rail feed gives it; without it, the trip alone).
export const trainCard = (sel: TrainSel, line: string, title: string, runId?: string): Card => sel.kind === "metro"
  ? { kind: "vehicle", id: runId ?? `stasy:run:${sel.id}`, line: `stasy:${line}`, ref: sel.id, title }
  : { kind: "vehicle", id: `proastiakos:${sel.id}`, line: `proastiakos:${line}`, title };
export const railLineCard = (l: RailLine, title = l.id): Card =>
  ({ kind: "line", id: `${l.kind === "metro" ? "stasy" : "proastiakos"}:${l.id}`, title });

export type Legacy =
  | { kind: "bus-vehicle"; line: string; id: string }
  | { kind: "route"; line: string; variant?: string; dir?: 0 | 1 }
  | { kind: "bus-stop"; code: string }
  | { kind: "station"; name?: string; folded: string }
  | { kind: "rail-station"; id: string }
  | { kind: "train"; sel: TrainSel }
  | { kind: "rail-line"; line: RailLine };

// What today's cards show for a card; null for an id of no known source.
export function legacyOf(c: Card): Legacy | null {
  const ns = c.id.slice(0, c.id.indexOf(":"));
  if (c.kind === "vehicle") {
    if (ns === "oasa") return { kind: "bus-vehicle", line: native(c.line), id: native(c.id) };
    if (ns === "stasy") return { kind: "train", sel: { kind: "metro", id: c.ref ?? c.id.split(":")[2] ?? "" } };
    if (ns === "proastiakos") return { kind: "train", sel: { kind: "suburban", id: native(c.id) } };
  } else if (c.kind === "stop") {
    if (ns === "oasa") return { kind: "bus-stop", code: native(c.id) };
    if (ns === "stasy") return { kind: "station", name: c.ref, folded: native(c.id).replace(/-(metro|tram)$/, "") };
    if (ns === "proastiakos") return { kind: "rail-station", id: native(c.id) };
  } else {
    if (ns === "oasa") return { kind: "route", line: native(c.id), ...(c.pattern ? { variant: native(c.pattern) } : {}),
      ...(c.dir !== undefined ? { dir: c.dir } : {}) };
    if (ns === "stasy") return { kind: "rail-line", line: { kind: "metro", id: native(c.id) } };
    if (ns === "proastiakos") return { kind: "rail-line", line: { kind: "suburban", id: native(c.id) } };
  }
  return null;
}

// The generic title of a card that came without one (a deep link).
export const cardTitle = (c: Card) =>
  c.title ?? (c.kind === "vehicle" ? "Όχημα" : c.kind === "stop" ? "Στάση" : native(c.id));
