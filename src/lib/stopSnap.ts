// A bus stop where the bus stops: OASA puts some stops a few metres off their road, nearer a narrow lane or a
// service road beside it (3η Αγίας Τριάδος sits 16 m from Αγίας Τριάδος and 3 m from a lane), so the trip's walk
// went down that lane and its ride started there. Here a stop is moved to the kerb of the nearest real street
// (carriageway STREET_MIN wide or more) within SNAP_MAX of it, on its own side; a stop already on its street stays.
// The streets come from the 3D map's own tiles (public/roads, scripts/roads.py). [lat, lon] in and out.
import { points, type RoadsFile } from "./athensRoads";

export type Pt = [number, number];
type LngLat = [number, number];
export interface Street { pts: LngLat[]; half: number }

const SNAP_MAX = 30, STREET_MIN = 5, ON_PAVEMENT = 1;   // metres
const KY = 110_540, kxOf = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

/** The stop at the kerb of its street, on the pavement's edge; null when it is on one already, or none is near. Pure. */
export function kerbPoint(streets: Street[], p: Pt, max = SNAP_MAX): Pt | null {
  const [lat, lon] = p, kx = kxOf(lat);
  let best: { d: number; x: number; y: number; half: number } | null = null;
  for (const s of streets) {
    if (2 * s.half < STREET_MIN) continue;
    for (let i = 1; i < s.pts.length; i++) {
      const ax = (s.pts[i - 1][0] - lon) * kx, ay = (s.pts[i - 1][1] - lat) * KY, bx = (s.pts[i][0] - lon) * kx, by = (s.pts[i][1] - lat) * KY;
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
      const x = ax + t * dx, y = ay + t * dy, d = Math.hypot(x, y);
      if (d <= max && (!best || d < best.d)) best = { d, x, y, half: s.half };
    }
  }
  if (!best) return null;
  const edge = best.half + ON_PAVEMENT;
  if (best.d <= edge + 0.1) return null;   // on its street already
  // From the street's centre towards the stop, as far as the pavement's edge.
  const k = edge / best.d, x = best.x * (1 - k), y = best.y * (1 - k);
  return [lat + y / KY, lon + x / kx];
}

// The tiles, as the 3D map has them (one index, each tile once).
type Index = { tile: number; built: number; tiles: Record<string, number> };
let indexP: Promise<Index | null> | null = null;
const tiles = new Map<string, Promise<Street[]>>();
const base = () => import.meta.env?.BASE_URL ?? "/";

function index(): Promise<Index | null> {
  return (indexP ??= fetch(`${base()}roads/index.json`).then(r => (r.ok ? (r.json() as Promise<Index>) : null)).catch(() => { indexP = null; return null; }));
}
function streets(ix: Index, key: string): Promise<Street[]> {
  let p = tiles.get(key);
  if (!p) {
    p = fetch(`${base()}roads/${key}.json?b=${ix.built}`).then(async r => {
      if (!r.ok) return [];
      const f = (await r.json()) as RoadsFile;
      return [...f.r, ...(f.c ?? [])].map(w => ({ pts: points(f.origin, f.unit, w[5]), half: w[1] / 20 }));
    }).catch(() => { tiles.delete(key); return []; });
    tiles.set(key, p);
  }
  return p;
}

/** Where the stop is on its street (see above); the stop itself when that cannot be told. */
export async function snapStop(p: Pt): Promise<Pt> {
  const ix = await index();
  if (!ix) return p;
  const key = `${Math.floor(p[1] / ix.tile)}_${Math.floor(p[0] / ix.tile)}`;
  if (!(key in ix.tiles)) return p;
  return kerbPoint(await streets(ix, key), p) ?? p;
}
