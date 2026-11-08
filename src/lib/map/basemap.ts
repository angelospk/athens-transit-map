// The base map in Apple Maps' colours, light and dark, on OpenFreeMap's tiles: green parks, blue water, buildings
// a shade off the land, roads by class, names in Greek only (the style writes "ANO LIOSIA\nΑΝΩ ΛΙΟΣΙΑ"). No points of
// interest (parks, museums, shops): their names crowd the stops and the vehicles.
// One style for both themes (OpenFreeMap's "dark", keyed by its layer ids): only the colours change. A layer it
// renames keeps its own paint; the map does not break.

type Paint = Record<string, string | number | null>;   // null: drop the style's own value

export interface Palette {
  land: string; residential: string; building: string; buildingEdge: string; park: string; wood: string; water: string;
  path: string; minor: string; major: string; majorEdge: string; motorway: string; motorwayEdge: string; rail: string;
  airport: string; runway: string; halo: string; street: string; place: string; suburb: string; waterName: string;
  border: string; oneway: number;
}

export const PALETTE: Record<"light" | "dark", Palette> = {
  light: {
    land: "#f1eee8", residential: "#f1eee8", building: "#dedad2", buildingEdge: "#ccc6bc",
    park: "#c5e6bb", wood: "#bbdfae", water: "#9fcff1",
    path: "#e3dfd8", minor: "#ffffff", major: "#ffffff", majorEdge: "#d6d1c9", motorway: "#fbd47f", motorwayEdge: "#e3b459",
    rail: "#cdc8c1", airport: "#e6e3dd", runway: "#d7d3cc",
    halo: "#ffffff", street: "#5e626a", place: "#2d3035", suburb: "#6a6e76", waterName: "#3b76ae", border: "#b9b4ad",
    oneway: 0.35,
  },
  dark: {
    land: "#24252e", residential: "#282934", building: "#36344b", buildingEdge: "#403d57",
    park: "#1f5549", wood: "#1d4e43", water: "#1a2b45",
    path: "#383b49", minor: "#484d5e", major: "#5a6175", majorEdge: "#3b3f50", motorway: "#6e7690", motorwayEdge: "#43485c",
    rail: "#4a495b", airport: "#2b2c37", runway: "#393b49",
    halo: "#24252e", street: "#adb2be", place: "#e7e8ed", suburb: "#a8acb8", waterName: "#7ea1cf", border: "#4d4f5c",
    oneway: 0.5,
  },
};

const NO_FADE = { duration: 0, delay: 0 };
// Greek names: the Greek one, else the local one. (The style joins the Latin and the local name.)
const GREEK = ["coalesce", ["get", "name:el"], ["get", "name"]];

export function basePaint(c: Palette): Record<string, Paint> {
  const label = (color: string) => ({ "text-color": color, "text-halo-color": c.halo, "text-halo-width": 1.2, "text-halo-blur": 0.4 });
  return {
    background: { "background-color": c.land },
    water: { "fill-color": c.water },
    waterway: { "line-color": c.water },
    landuse_residential: { "fill-color": c.residential },
    // The style paints woods with a "wood-pattern" its sprite lacks: nothing drew, and the console warned.
    landcover_wood: { "fill-pattern": null, "fill-color": c.wood },
    landuse_park: { "fill-color": c.park },
    building: { "fill-color": c.building, "fill-outline-color": c.buildingEdge },
    "aeroway-area": { "fill-color": c.airport },
    "aeroway-runway": { "line-color": c.runway },
    "aeroway-runway-casing": { "line-color": c.runway },
    "aeroway-taxiway": { "line-color": c.runway },
    road_area_pier: { "fill-color": c.land },
    road_pier: { "line-color": c.land },
    highway_path: { "line-color": c.path },
    highway_minor: { "line-color": c.minor, "line-opacity": 1 },
    highway_major_casing: { "line-color": c.majorEdge },
    highway_major_inner: { "line-color": c.major },
    highway_major_subtle: { "line-color": c.major },
    highway_motorway_casing: { "line-color": c.motorwayEdge },
    highway_motorway_inner: { "line-color": c.motorway },
    highway_motorway_subtle: { "line-color": c.motorway },
    road_oneway: { "icon-opacity": c.oneway },
    road_oneway_opposite: { "icon-opacity": c.oneway },
    railway_transit: { "line-color": c.rail },
    railway_transit_dashline: { "line-color": c.land },
    railway_minor: { "line-color": c.rail },
    railway_minor_dashline: { "line-color": c.land },
    railway: { "line-color": c.rail },
    railway_dashline: { "line-color": c.land },
    boundary_state: { "line-color": c.border },
    "boundary_country_z0-4": { "line-color": c.border },
    "boundary_country_z5-": { "line-color": c.border },
    highway_name_other: label(c.street),
    highway_name_motorway: { "text-color": c.street },
    water_name: label(c.waterName),
    place_other: label(c.suburb),
    place_suburb: label(c.suburb),
    place_village: label(c.suburb),
    place_town: label(c.place),
    place_city: label(c.place),
    place_city_large: label(c.place),
    place_state: label(c.suburb),
    place_country_other: label(c.place),
    place_country_minor: label(c.place),
    place_country_major: label(c.place),
  };
}

// Names in Greek, in their own case: upper case keeps the accents in Greek («ΚΟΛΩΝΆΚΙ»), which reads wrong.
const NAMED = ["highway_name_other", "water_name"];
const PLACES: Record<string, { font: string; size: unknown; spacing: number }> = {
  place_other: { font: "Noto Sans Bold", size: 11, spacing: 0.06 },
  place_suburb: { font: "Noto Sans Bold", size: 12, spacing: 0.06 },
  place_village: { font: "Noto Sans Bold", size: 11, spacing: 0.04 },
  place_town: { font: "Noto Sans Bold", size: 13, spacing: 0.02 },
  place_city: { font: "Noto Sans Bold", size: 14, spacing: 0.02 },
  place_city_large: { font: "Noto Sans Bold", size: 16, spacing: 0.02 },
  place_state: { font: "Noto Sans Regular", size: 11, spacing: 0.04 },
  place_country_other: { font: "Noto Sans Bold", size: 12, spacing: 0.04 },
  place_country_minor: { font: "Noto Sans Bold", size: 13, spacing: 0.04 },
  place_country_major: { font: "Noto Sans Bold", size: 14, spacing: 0.04 },
};


interface BaseMap {
  getStyle(): { layers: { id: string; type?: string; "source-layer"?: string; filter?: unknown }[] };
  setFilter?(id: string, filter: unknown): unknown;
  getLayer(id: string): unknown;
  setPaintProperty(id: string, prop: string, value: unknown): unknown;
  setLayoutProperty(id: string, prop: string, value: unknown): unknown;
  hasImage(id: string): boolean;
  addImage(id: string, image: { width: number; height: number; data: Uint8ClampedArray }, options?: { pixelRatio?: number }): unknown;
  addLayer(layer: object, before?: string): unknown;
}

// Green for every park, garden, lawn, pitch and cemetery: the style colours only land use "park" and woods (the
// National Garden and Filopappou were the colour of the land).
function addGreen(m: BaseMap, c: Palette) {
  if (m.getLayer("base-green-park")) return;
  const before = m.getStyle().layers.find(l => l.id === "landcover_wood")?.id;
  const polygon = ["match", ["geometry-type"], ["MultiPolygon", "Polygon"], true, false];
  const fill = (id: string, sourceLayer: string, filter: unknown[]) => m.addLayer({
    id, type: "fill", source: "openmaptiles", "source-layer": sourceLayer, filter: ["all", polygon, ...filter],
    paint: { "fill-color": c.park },
  }, before);
  fill("base-green-park", "park", []);
  fill("base-green-grass", "landcover", [["==", ["get", "class"], "grass"]]);
  fill("base-green-landuse", "landuse", [["match", ["get", "class"], ["cemetery", "pitch", "playground", "garden"], true, false]]);
}

// The style's own points of interest and their names (shops, cafés, sights): off.
function hidePois(m: BaseMap) {
  for (const l of m.getStyle().layers) if (l["source-layer"] === "poi") m.setLayoutProperty(l.id, "visibility", "none");
}

// Alleys (OSM's service=alley): the lanes behind a block, drawn as streets that lead nowhere a passenger walks. Off,
// in every road line of the style. Other service roads stay: the side roads along the avenues are among them.
const NOT_STREETS = ["alley"];
function hideAlleys(m: BaseMap) {
  if (!m.setFilter) return;
  for (const l of m.getStyle().layers) {
    if (l["source-layer"] !== "transportation" || l.type !== "line") continue;
    const f = l.filter;
    // The style's filters are the old kind (["all", ["in", "class", …]]); one written as an expression gets one too.
    const legacy = !f || !JSON.stringify(f).includes('["get"');
    const off = legacy ? ["!in", "service", ...NOT_STREETS] : ["!", ["in", ["coalesce", ["get", "service"], ""], ["literal", NOT_STREETS]]];
    m.setFilter(l.id, f ? (Array.isArray(f) && f[0] === "all" ? [...f, off] : ["all", f, off]) : off);
  }
}

// Call on `style.load`, before its tiles draw.
export function paintBase(m: BaseMap, dark: boolean) {
  const c = PALETTE[dark ? "dark" : "light"], paints = basePaint(c);
  for (const { id } of m.getStyle().layers) {
    const paint = paints[id];
    if (paint) for (const [prop, value] of Object.entries(paint)) {
      if (value !== null && typeof value === "string") m.setPaintProperty(id, `${prop}-transition`, NO_FADE);   // else the style's 300 ms fade shows its colours first
      m.setPaintProperty(id, prop, value);
    }
    const place = PLACES[id];
    if (place || NAMED.includes(id)) {
      m.setLayoutProperty(id, "text-field", GREEK);
      m.setLayoutProperty(id, "text-transform", "none");
    }
    if (place) {
      m.setLayoutProperty(id, "text-font", [place.font]);
      m.setLayoutProperty(id, "text-size", place.size);
      m.setLayoutProperty(id, "text-letter-spacing", place.spacing);
    }
    if (id === "highway_name_other") {
      m.setLayoutProperty(id, "text-font", ["Noto Sans Regular"]);
      m.setLayoutProperty(id, "text-size", ["interpolate", ["linear"], ["zoom"], 14, 10, 18, 13]);
    }
  }
  addGreen(m, c);
  hidePois(m);
  hideAlleys(m);
}
