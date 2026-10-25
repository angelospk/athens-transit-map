// OpenFreeMap's dark style is near black (roads #181818 on rgb(12,12,12)): streets and names do not show.
// These paints lighten it, keyed by its layer ids. A layer it renames keeps its own dark colour; the map does not break.

type Paint = Record<string, string>;

const NAME: Paint = { "text-color": "#a8adb5", "text-halo-color": "rgba(0,0,0,0.8)" };   // every place_* layer
const NO_FADE = { duration: 0, delay: 0 };
const GREEN = "#24302a";   // parks and woods: they must not read as holes in the city

export const DARK_PAINT: Record<string, Paint> = {
  background: { "background-color": "#1b1d21" },
  water: { "fill-color": "#1f2a36" },
  waterway: { "line-color": "#1f2a36" },
  landuse_residential: { "fill-color": "#1e2024" },
  landcover_wood: { "fill-color": GREEN },
  landuse_park: { "fill-color": GREEN },
  building: { "fill-color": "#25272c", "fill-outline-color": "#2e3137" },
  "aeroway-area": { "fill-color": "#24262b" },
  highway_path: { "line-color": "#34373e" },
  highway_minor: { "line-color": "#3a3d44" },
  highway_major_casing: { "line-color": "#2a2c31" },
  highway_major_inner: { "line-color": "#4a4e57" },
  highway_major_subtle: { "line-color": "#4a4e57" },
  highway_motorway_casing: { "line-color": "#2a2c31" },
  highway_motorway_inner: { "line-color": "#5a5f69" },
  highway_motorway_subtle: { "line-color": "#4a4e57" },
  railway_transit: { "line-color": "#4a4e57" },
  railway_minor: { "line-color": "#4a4e57" },
  railway: { "line-color": "#4a4e57" },
  highway_name_other: { "text-color": "#8d929b", "text-halo-color": "#1b1d21" },
  highway_name_motorway: { "text-color": "#9a9fa8" },
  water_name: { "text-color": "#6f8aa6", "text-halo-color": "#1b1d21" },
};

interface PaintableMap {
  getStyle(): { layers: { id: string }[] };
  setPaintProperty(id: string, prop: string, value: unknown): unknown;
}

// Call on `style.load` of the dark style, before its tiles draw.
export function lightenDark(m: PaintableMap) {
  for (const { id } of m.getStyle().layers) {
    const paint = DARK_PAINT[id] ?? (id.startsWith("place_") ? NAME : undefined);
    if (!paint) continue;
    for (const [prop, value] of Object.entries(paint)) {
      m.setPaintProperty(id, `${prop}-transition`, NO_FADE);   // else the style's 300 ms fade shows the near-black first
      m.setPaintProperty(id, prop, value);
    }
  }
}
