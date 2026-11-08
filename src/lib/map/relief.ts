// The hills in relief (canvas mockup Μ5): Υμηττός, Πεντέλη, Πάρνηθα and the rest shaded from the north-west, softly,
// under the streets and the buildings, in 2D and in 3D. A computer only (MapView turns it off on a phone). In 2D it is
// gone by street level, where it would only dirty the streets; in 3D it stays, for the hills in the distance. The
// heights: Mapzen's Terrarium tiles on AWS (open data, no key).

export const RELIEF_LAYER = "base-relief";
const SOURCE = "base-dem";
const TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

interface ReliefMap {
  getStyle(): { layers: { id: string; type?: string; "source-layer"?: string }[] };
  getSource(id: string): unknown;
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
