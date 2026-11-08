// The metro's street entrances drawn as 3D models (map/scene3d.ts, map/entrance/): stairwells and glass lifts,
// each one where it stands and the way it faces. public/entrances.json is what everyone sees; in the admin mode
// (AdminBar.svelte) they are moved, turned, added and removed on this device, then exported as a new
// entrances.json to commit.

import type { Direction } from "./map/entrance/metroEntrance";

export interface Entrance3D {
  id: string;
  kind?: "stairs" | "elevator";   // a stairwell with its sign pylon (the default), or a glass lift on its own
  name: string;              // the station's name on the signs, e.g. "Σύνταγμα"
  latin?: string;            // the Latin line under it, e.g. "Syntagma"
  // [lat, lon]: stairs, the top step's front edge at the middle of the stairs; a lift, the middle of its doors
  at: [number, number];
  heading: number;           // degrees clockwise from north: the way you face walking down the stairs, or into the lift
  elevation?: number;        // metres up (or down, negative) from the map's ground, where the street sits higher or lower
  signSide?: "left" | "right";   // stairs: the side of the opening the pylon stands on (default right)
  directions?: Direction[];  // stairs: the band over the portal; none: a blank band
  // Pictures: a file under public/, e.g. "ads/xoris-empodia-hd.jpg" or "icons/metro-roundel.png".
  adFront?: string;          // stairs: the ad in the pylon's lower case, front face (none: the street map)
  adBack?: string;           // stairs: the same case's back face (none: plain steel)
  adFit?: "cover" | "contain";   // cover fills the case, cropping the picture; contain shows all of it
  roundel?: string;          // the circle on the pylon, or on a lift's sign (none: blank)
}

/** This device's admin changes: a whole entrance (added or edited) by id, or null for one removed. */
export type EntranceEdits = Record<string, Entrance3D | null>;

export async function loadEntrances(base = import.meta.env?.BASE_URL ?? "/"): Promise<Entrance3D[]> {
  try {
    const r = await fetch(`${base}entrances.json`, { cache: "no-cache" });
    if (!r.ok) return [];
    const v: unknown = await r.json();
    return Array.isArray(v) ? v.filter(isEntrance) : [];
  } catch { return []; }
}

export const isEntrance = (v: unknown): v is Entrance3D => {
  const e = v as Entrance3D | null;
  return !!e && typeof e.id === "string" && typeof e.name === "string" && Array.isArray(e.at) && e.at.length === 2
    && e.at.every(Number.isFinite) && Number.isFinite(e.heading);
};

/** The published entrances with this device's edits laid over them (edits for ids not published are added). */
export function withEdits(pub: Entrance3D[], edits: EntranceEdits): Entrance3D[] {
  const out: Entrance3D[] = [];
  for (const e of pub) {
    if (!(e.id in edits)) { out.push(e); continue; }
    const ed = edits[e.id];
    if (ed) out.push(ed);
  }
  for (const [id, ed] of Object.entries(edits)) if (ed && !pub.some(e => e.id === id)) out.push(ed);
  return out;
}

/** A height to the centimetre, within ±20 m. */
export const normElevation = (m: number) => Math.max(-20, Math.min(20, Math.round(m * 100) / 100));

/** A heading kept within 0-359.9, to a tenth of a degree. */
export const normHeading = (deg: number) => +(((deg % 360) + 360) % 360).toFixed(1) % 360;

/** The compass bearing from `a` to `b` ([lat, lon] each), degrees clockwise from north (flat earth: a few metres). */
export function bearing(a: [number, number], b: [number, number]): number {
  const dy = b[0] - a[0], dx = (b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180);
  return normHeading((Math.atan2(dx, dy) * 180) / Math.PI);
}

/** The point `m` metres from `a` ([lat, lon]) towards `deg` (flat earth: a few metres). */
export function ahead(a: [number, number], deg: number, m: number): [number, number] {
  const r = (deg * Math.PI) / 180, k = 111320;
  return [a[0] + (Math.cos(r) * m) / k, a[1] + (Math.sin(r) * m) / (k * Math.cos((a[0] * Math.PI) / 180))];
}

/** An id for a new entrance: its station and a number not taken yet. */
export function newId(station: string, taken: Iterable<string>): string {
  const slug = station.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9α-ω]+/g, "-").replace(/^-|-$/g, "") || "entrance";
  const ids = new Set(taken);
  for (let n = 1; ; n++) if (!ids.has(`${slug}-${n}`)) return `${slug}-${n}`;
}
