// The hills in relief (canvas mockup Μ5): Υμηττός, Πεντέλη, Πάρνηθα and the rest shaded from the north-west, softly,
// under the streets and the buildings: on a computer in 2D and 3D, on a phone in 3D (MapView). In 2D it is
// gone by street level, where it would only dirty the streets; in 3D it stays, for the hills in the distance. The
// heights: Mapzen's Terrarium tiles on AWS (open data, no key).

import { addProtocol } from "maplibre-gl";

export const RELIEF_LAYER = "base-relief";
const SOURCE = "base-dem";
const TERRAIN = "base-terrain";
const TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

interface ReliefMap {
  getStyle(): { layers: { id: string; type?: string; "source-layer"?: string }[] };
  getSource(id: string): unknown;
  setTerrain?(t: { source: string; exaggeration?: number } | null): unknown;
  getTerrain?(): unknown;
  getLayer(id: string): unknown;
  addSource(id: string, source: object): unknown;
  addLayer(layer: object, before?: string): unknown;
}

/** How strong the shading is by zoom. In 2D it is gone by street level; in 3D it stays (softer up close), so the hills
 *  far off in the tilted view keep their relief at any zoom. */
export function reliefStrength(dark: boolean, threeD = false): unknown[] {
  return threeD
    ? ["interpolate", ["linear"], ["zoom"], 8, dark ? 0.42 : 0.5, 13, dark ? 0.36 : 0.42, 16, dark ? 0.26 : 0.3, 19, dark ? 0.2 : 0.24]
    : ["interpolate", ["linear"], ["zoom"], 8, dark ? 0.38 : 0.45, 12, dark ? 0.3 : 0.36, 14, dark ? 0.16 : 0.2, 15.5, 0];
}

/** The shading's colours and strength for a theme (pure, for the tests). */
export function reliefPaint(dark: boolean, threeD = false): Record<string, unknown> {
  return {
    "hillshade-shadow-color": dark ? "#05070b" : "#4b5566",
    "hillshade-highlight-color": dark ? "#3a4152" : "#ffffff",
    "hillshade-accent-color": dark ? "#0d1016" : "#7d8796",
    "hillshade-illumination-direction": 315,
    "hillshade-exaggeration": reliefStrength(dark, threeD),
  };
}

/** Adds the relief under the base map's buildings and roads (call on `style.load`, after the base is painted). */
export function addRelief(m: ReliefMap, dark: boolean, visible: boolean, threeD = false) {
  if (m.getLayer(RELIEF_LAYER)) return;
  if (!m.getSource(SOURCE)) {
    m.addSource(SOURCE, { type: "raster-dem", tiles: [TILES], tileSize: 256, encoding: "terrarium", maxzoom: 14,
      attribution: '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Mapzen Terrain</a>' });
  }
  const layers = m.getStyle().layers;
  const before = layers.find(l => l.id === "building")?.id
    ?? layers.find(l => l["source-layer"] === "transportation" && l.type === "line")?.id;
  m.addLayer({ id: RELIEF_LAYER, type: "hillshade", source: SOURCE,
    layout: { visibility: visible ? "visible" : "none" }, paint: reliefPaint(dark, threeD) }, before);
}

// ---- The mountains in 3D (canvas mockup Μ6) ----------------------------------------------------------------------
// MapLibre's terrain raises the ground to its height; our 3D models (buildings, buses, trees, the metro's entrances)
// stand on 0. So the terrain is the same heights flattened below FLAT_M: the basin and the city (Λυκαβηττός, the
// Acropolis) stay at 0 where the models are, and the mountains round it (Υμηττός, Πεντέλη, Πάρνηθα, Αιγάλεω) rise from
// there, with the sky's haze over them toward the horizon. Done on each height tile as it loads (a protocol).

export const FLAT_M = 300;

/** A height above the flat floor: 0 at or under FLAT_M, the rest above it (pure, for the tests). */
export function flatten(h: number): number {
  return h > FLAT_M ? h - FLAT_M : 0;
}

/** Re-encodes a Terrarium tile's pixels (RGBA) in place with the flattened heights. */
export function flattenTerrarium(d: Uint8ClampedArray) {
  for (let i = 0; i < d.length; i += 4) {
    const v = flatten(d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768) + 32768, w = Math.floor(v);
    d[i] = w >> 8; d[i + 1] = w & 255; d[i + 2] = Math.floor((v - w) * 256); d[i + 3] = 255;
  }
}

let registered = false;
function register() {
  if (registered || typeof OffscreenCanvas === "undefined") return registered;
  registered = true;
  addProtocol("flatdem", async (params, abort) => {
    const res = await fetch(params.url.replace("flatdem://", "https://"), { signal: abort.signal });
    if (!res.ok) throw new Error(`terrain ${res.status}`);
    const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
    const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext("2d", { willReadFrequently: true })!;
    x.drawImage(bmp, 0, 0);
    const img = x.getImageData(0, 0, bmp.width, bmp.height);
    flattenTerrarium(img.data);
    x.putImageData(img, 0, 0);
    return { data: await (await c.convertToBlob({ type: "image/png" })).arrayBuffer() };
  });
  return true;
}

/** The mountains on or off (3D): the flattened terrain under the map, the sky's haze over it. */
export function setMountains(m: ReliefMap, on: boolean) {
  if (!m.setTerrain) return;
  if (!on) { if (m.getTerrain?.()) m.setTerrain(null); return; }
  if (!register()) return;
  if (!m.getSource(TERRAIN)) {
    m.addSource(TERRAIN, { type: "raster-dem", tiles: [TILES.replace("https://", "flatdem://")], tileSize: 256, encoding: "terrarium", maxzoom: 13 });
  }
  m.setTerrain({ source: TERRAIN, exaggeration: 1 });
}
