// The 3D street mode: tilt, extruded buildings, a street style (asphalt, paving, kerbs, lane marks and, at night,
// pools of street light) and, drawn with three.js in one MapLibre custom layer, modelled OASA buses for the
// vehicles of the followed lines, all with soft shadows. three.js loads only when the mode is turned on.
//
// MapView owns the vehicles: it calls upsert() for each drawn vehicle every frame and drop() when one goes. The
// models are placed in metres around an origin near the view (re-anchored when the view moves far), so float32
// precision holds; MapLibre's main matrix projects them.
import { PALETTE } from "./basemap";
import { MercatorCoordinate, type CustomLayerInterface, type GeoJSONSource, type Map as MlMap } from "maplibre-gl";
import type * as Three from "three";
import { metres, yaw, type LngLat } from "../map3d";
import { BACK_MAX, follow, LAT_PERIOD, MOVE_OFF, MOVE_ON, separate, springStep, spacingTargets, type Box, type Car, type Follow, type Gap } from "./spacing";
import { covers, decode, type AthensRoads, type RoadsFile, type Widths } from "../athensRoads";
import { RoadIndex, Track } from "../roadSnap";
import { headlightBeam, lampCone, type Clock } from "./shaders";
import type { Look3D } from "./look3d";
import type { DelayClass } from "../format";
import { depthAt, ISLANDS, TRACK_GAP, trackGapAt, type Livery, DEPTH, metroStops } from "./metroDepth";
import { EntranceModels } from "./entrance/models";
import { Landmarks } from "./landmarks";
import { MODELLED_ENTRANCES, PARLIAMENT_IDS } from "./landmarks/syntagmaData";
import { squareEntrances } from "./landmarks/syntagmaGround";
import type { Entrance3D } from "../entrances";
import { PoseSmoother } from "./smoothPose";
import { BusInstances, SignAtlas, type BusPose } from "./busInstances";
import { XRay } from "./xray";
import { Turners } from "../turn";

export type VehicleKind = "bus" | "trolley" | "tram" | "metro";
// trail (trams): where its front has been, oldest first, in metres east and north of TRAIL_ORIGIN, about 1 m apart.
// glow: how late it is (format.ts delayClass): a glow under the model, green on time, orange late, red very late.
type Bus = { pos: LngLat; heading: number | null; color: string; kind: VehicleKind; label: string; glow: DelayClass; trail?: [number, number][]; livery?: Livery; laid?: boolean; fix?: LngLat };   // fix: its last GPS fix (spacing: who passes whom)
// A box's ±x face lays its texture's width along the box's z (our up), so a picture drawn upright, w wide and h high,
// goes on a canvas h wide and w high, turned a quarter: one way for the front (+x), the other for the back, so both
// read the right way from their side.
function sideCanvas(w: number, h: number, back: boolean, draw: (x: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = h; c.height = w;
  const x = c.getContext("2d")!;
  if (back) { x.translate(h, 0); x.rotate(Math.PI / 2); } else { x.translate(0, w); x.rotate(-Math.PI / 2); }
  draw(x);
  return c;
}

/** One stop's arrival screen: where the stop is ([lon, lat]) and its rows: line, where to, minutes. */
export interface Board { at: LngLat; rows: [string, string, string][] }

export const BUS_ZOOM = 16;    // models from here; below it the pills alone
export const MAX_PITCH_3D = 80;    // the tilt allowed in 3D (see enable): short of the horizon
export const BUILD_ZOOM = 15;   // the buildings stand up from here; below it the base map's flat ones (memory: a tilted view sees far)
const BUS_SCALE = 1.3;
const BUS_LEN = 12 * BUS_SCALE;   // the models are 12 m long (buildBus, buildTrolley), drawn larger
const LANE_W = 4.8;               // how far a bus pulls out to pass: a lane and a good gap beside the other (they are drawn 1.3× wide)
const BUS_WIDE = 2.5 * BUS_SCALE;  // the models are 2.5 m wide: side by side closer than this, two buses touch
const TRAM_WIDE = 1.25;   // a tram as wide and tall as the buses look (its length real: its cars follow the track)
// A tram rides on its direction's line itself (metro.json has one per direction, a few metres apart), where its rails
// are drawn: no shift to the side, so the model sits on them whichever way the line was drawn.
const TRAM_TRACK = 0;
const TRAIL_ORIGIN: LngLat = [23.73, 37.98];
const TKX = 111320 * Math.cos((TRAIL_ORIGIN[1] * Math.PI) / 180), TKY = 110540;   // the model a third bigger than life: as wide as its painted lane, readable from above
const READY_MS = 15000;   // the loading screen waits at most this long
export const STREET_ZOOM = 16;
const ROAD_NUDGE_M = 12;   // a bus on its shape moves onto the road running its way this close (OASA's shapes are coarse)
const SHAPE_RIGHT = 1.7;
const TURN_DEG = 6;        // a heading change of this much in under half a second: the bus is turning (no overtaking then)   // metres a bus off a painted route is drawn to the right of its line's shape (half a lane)
const LAYER = "x3d-scene";
const SOURCE = "openmaptiles";   // OpenFreeMap's vector source
const XRAY = 1;        // buses and trolleys seen through what hides them, as themselves (xray.ts)
const XRAY_HULL = 3;   // their hulls: where the X-ray looks
const XRAY_FLAT = 2;   // trams: as a flat blue shape (each is ~35 meshes: four passes of them would cost more than all the buses)
// Every way is drawn flat on the street, bridges and tunnels too (athensRoads.decode).
// Degrees: the road tiles (0.04° each, ~8 MB of streets) loaded round the view's centre: the one it is in, and a
// neighbour only within ~1 km of its edge. At STREET_ZOOM and closer the view is about that wide. (0.028 loaded six
// tiles, 48 MB, which the map's worker then held at every zoom: 3 GB, and the browser dropped the page.)
const ROAD_REACH = 0.012;
// The base map's buildings modelled by hand (landmarks/), left out of its extrusions.
const NOT_MODELLED = ["!", ["in", ["id"], ["literal", PARLIAMENT_IDS]]];
const NO_ROADS: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
// The street's markings: lane lines, zebras, arrows, bus-lane words, junction islands. False draws it plain (asphalt,
// kerbs and pavements; tried 2026-11-09), with athensRoads.decode's own flag.
const MARKINGS = true;
const STREET_LAYERS = ["x3d-roofs", "x3d-area", "x3d-pools", "x3d-buildings", "x3d-route-edge", "x3d-hl-edge",
  "x3d-tram-bed", "x3d-tram-sleepers", "x3d-tram-rail-1", "x3d-tram-rail-2",
  ...(MARKINGS ? ["x3d-mark-0", "x3d-mark-2", "x3d-mark-3", "x3d-mark-4", "x3d-mark-5", "x3d-arrows", "x3d-busword"] : [])];

const COLORS = {
  // «Ρεαλιστική», light and dark: the 2D map's own colours (basemap.ts PALETTE): its ground, parks, water and buildings,
  // its white (light) or slate (dark) streets; the pavements its paths', the kerbs its avenues' edge.
  light: { park: PALETTE.light.park, water: PALETTE.light.water, bldA: PALETTE.light.building, bldB: "#d6d9df", bldC: "#dee1e5",
    road: PALETTE.light.minor, walk: PALETTE.light.path, kerbA: PALETTE.light.majorEdge, mark: "#c3c8d0", busMark: "#f0b400", markOpacity: 1, bldTop: "#e8eaee",
    pool: "#ffffff", white: "#fbfcfd", sky: 0xeef4ff, ground: 0x707060,
    hemi: 2.3, sun: 2.0, shadow: 0.34 },
  dark: { park: PALETTE.dark.park, water: PALETTE.dark.water, bldA: PALETTE.dark.building, bldB: "#322f45", bldC: "#3b3850",
    road: PALETTE.dark.minor, walk: PALETTE.dark.path, kerbA: PALETTE.dark.major, mark: "#dcdfe4", busMark: "#d9a521", markOpacity: 0.8, bldTop: PALETTE.dark.buildingEdge,
    pool: "#f6e0a4", white: "#f2f4f6", sky: 0xd6deef, ground: 0x3a3a30,
    hemi: 1.9, sun: 1.5, shadow: 0.45 },
  // «Μινιατούρα»: a city model in warm daylight, as a toy town is painted: sand ground, mid-grey asphalt, cream walls
  // with rows of windows, terracotta roofs on the low houses and pale ones on the blocks.
  toon: { park: "#d6d79c", water: "#9fcbe6", bldA: "#efe8da", bldB: "#e9e1d0", bldC: "#f3eee3",
    road: "#8f9195", walk: "#ddd0b1", kerbA: "#c5b99c", mark: "#f4f1ea", busMark: "#e8c25a", markOpacity: 0.55, bldTop: "#f3eee3",
    pool: "#ffffff", white: "#fbfaf6", sky: 0xfff6e2, ground: 0x9b8b62,
    hemi: 2.25, sun: 2.3, shadow: 0.4 },
};
// The «Μινιατούρα» look's own colours: the ground, the roofs (low houses, tall blocks), the walls' windows, labels.
const TOON = { land: "#ecdcb2", roofLow: "#a9695a", roofHigh: "#c4bcac", roofTall: 14, wall: "#efe8da", glass: "#9eabb6", frame: "#fbf8f0",
  text: "#5b5246", halo: "#f7f0de", road: "#9a9ca0", casing: "#c9bea3", rail: "#a39a8b" };

// The walls' windows, one window to a tile (MapLibre repeats it along each wall and up it): cream wall, a pane with a
// light frame and a sill shadow. Drawn once, at twice the size for sharp edges.
function windowTile(): { width: number; height: number; data: Uint8Array } {
  const W = 24, H = 28, c = document.createElement("canvas");
  c.width = W; c.height = H;
  const x = c.getContext("2d")!;
  x.fillStyle = TOON.wall; x.fillRect(0, 0, W, H);
  x.fillStyle = TOON.frame; x.fillRect(5, 5, 14, 17);
  x.fillStyle = TOON.glass; x.fillRect(7, 7, 10, 13);
  x.fillStyle = "rgba(255,255,255,.35)"; x.fillRect(7, 7, 10, 4);
  x.fillStyle = "rgba(0,0,0,.08)"; x.fillRect(5, 22, 14, 2);
  return { width: W, height: H, data: new Uint8Array(x.getImageData(0, 0, W, H).data.buffer) };
}
// The roofs, so they read as roofs, not as blank floors: on a low house, terracotta tiles in rows; on a block, a
// flat concrete roof in slabs, with a water tank or a vent here and there (as on every Athens roof).
function roofTile(flat: boolean): { width: number; height: number; data: Uint8Array } {
  const W = 32, H = 32, c = document.createElement("canvas");
  c.width = W; c.height = H;
  const x = c.getContext("2d")!;
  x.fillStyle = flat ? TOON.roofHigh : TOON.roofLow; x.fillRect(0, 0, W, H);
  if (flat) {
    x.fillStyle = "rgba(0,0,0,.07)"; x.fillRect(0, 15, W, 2); x.fillRect(15, 0, 2, H);
    x.fillStyle = "rgba(255,255,255,.18)"; x.fillRect(0, 0, W, 1); x.fillRect(0, 0, 1, H);
    x.fillStyle = "#e9e5dc"; x.fillRect(5, 5, 7, 5);          // a tank
    x.fillStyle = "rgba(0,0,0,.12)"; x.fillRect(5, 10, 7, 2);
  } else {
    for (let y = 0; y < H; y += 8) { x.fillStyle = "rgba(0,0,0,.13)"; x.fillRect(0, y + 6, W, 2); x.fillStyle = "rgba(255,255,255,.1)"; x.fillRect(0, y, W, 2); }
  }
  return { width: W, height: H, data: new Uint8Array(x.getImageData(0, 0, W, H).data.buffer) };
}

// ?shaders=1: in development, three.js reads back every shader's compile log again (to see a broken shader's error).
const FORCED_SHADER_CHECK = typeof location !== "undefined" && new URLSearchParams(location.search).get("shaders") === "1";

// ?debug: the map and the 3D on window (__map, __scene3d, …) on the live site too, to measure it in a browser. Read
// when the module loads, before the app rewrites the address with its own state.
export const DEBUG = typeof location !== "undefined" && new URLSearchParams(location.search).has("debug");

// three.js (~170 kB gzipped) loads once, on demand: when 3D is turned on, or earlier, when the 3D button is pointed
// at (preloadThree), so the switch is quick.
let three: Promise<typeof Three> | null = null;
export const preloadThree = () => { void preloadRoads(); return (three ??= import("three")); };

// The streets of Attica (athensRoads.ts, scripts/roads.py): in tiles (public/roads, TILE degrees each) with an index
// of them, so only the tiles around the view load. Each kept in the browser's Cache Storage under the index's build
// stamp: fetched once per build, not on every visit or move; a new build sends the old ones away.
type RoadsIndexFile = { origin: LngLat; unit: number; tile: number; built: number; widths: Widths; tiles: Record<string, number> };
const ROAD_CACHE = "athens-roads";
let roadIndexP: Promise<RoadsIndexFile | null> | null = null;
export const preloadRoads = (base = import.meta.env?.BASE_URL ?? "/") => (roadIndexP ??= (async () => {
  try {
    const r = await fetch(`${base}roads/index.json`, { cache: "no-cache" });
    if (!r.ok) throw new Error(String(r.status));
    const ix = (await r.json()) as RoadsIndexFile;
    const store = typeof caches !== "undefined" ? await caches.open(ROAD_CACHE).catch(() => undefined) : undefined;
    if (store) for (const k of await store.keys()) if (!k.url.includes(`b=${ix.built}`)) void store.delete(k);   // an older build
    return ix;
  } catch {
    roadIndexP = null;   // try again next time 3D is turned on
    return null;
  }
})());
const roadTiles = new Map<string, Promise<AthensRoads | null>>();
// One worker decodes the tiles and keeps their features (roadsWorker.ts); where none can start, the page does it.
let roadWorker: Worker | null | undefined;
let roadJob = 0;
const roadJobs = new Map<number, { ok: (r: never) => void; fail: (e: Error) => void }>();
const roadsOff = (): Worker | null => {
  if (roadWorker !== undefined) return roadWorker;
  try {
    roadWorker = new Worker(new URL("./roadsWorker.ts", import.meta.url), { type: "module" });
    roadWorker.onmessage = (e: MessageEvent<{ id: number; data?: AthensRoads; blob?: Blob; error?: string }>) => {
      const job = roadJobs.get(e.data.id);
      roadJobs.delete(e.data.id);
      if (e.data.error != null) job?.fail(new Error(e.data.error)); else job?.ok((e.data.data ?? e.data.blob) as never);
    };
    roadWorker.onerror = () => { roadWorker = null; for (const j of roadJobs.values()) j.fail(new Error("worker")); roadJobs.clear(); };
  } catch { roadWorker = null; }
  return roadWorker;
};
const ask = <T,>(w: Worker, msg: object) => new Promise<T>((ok, fail) => { const id = ++roadJob; roadJobs.set(id, { ok: ok as never, fail }); w.postMessage({ id, ...msg }); });
const ROAD_KEEP = 6;   // decoded road tiles kept (roadsWorker keeps 8: every tile the page asks to merge is still there)
const pageTiles = new Map<string, AthensRoads>();   // without a worker: the tiles decoded here, with their features
function decodeOff(key: string, text: string): Promise<AthensRoads> {
  const w = roadsOff();
  if (w) return ask<AthensRoads>(w, { type: "tile", key, text });
  const d = decode(JSON.parse(text) as RoadsFile);
  pageTiles.set(key, d);
  return Promise.resolve(d);
}
/** The features of these tiles, for the street source: a Blob's address from the worker (the map reads it in its own
 *  worker), else a collection made here. */
async function roadFeatures(keys: string[]): Promise<string | GeoJSON.FeatureCollection> {
  const w = roadsOff();
  if (w) {
    try { return URL.createObjectURL(await ask<Blob>(w, { type: "merge", keys })); } catch { /* the page's own, below */ }
  }
  return { type: "FeatureCollection", features: keys.flatMap(k => pageTiles.get(k)?.features ?? []) };
}

function roadTile(ix: RoadsIndexFile, key: string, base = import.meta.env?.BASE_URL ?? "/"): Promise<AthensRoads | null> {
  let p = roadTiles.get(key);
  if (!p) {
    p = (async () => {
      const url = `${base}roads/${key}.json?b=${ix.built}`;
      const store = typeof caches !== "undefined" ? await caches.open(ROAD_CACHE).catch(() => undefined) : undefined;
      let res = await store?.match(url);
      if (!res) {
        res = await fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        if (store) await store.put(url, res.clone()).catch(() => {});
      }
      return decodeOff(key, await res.text());
    })().catch(() => { roadTiles.delete(key); return null; });
    roadTiles.set(key, p);
  }
  return p;
}
/** The tiles (of the index) within `r` degrees of a point. */
function tilesNear(ix: RoadsIndexFile, [lon, lat]: LngLat, r: number): string[] {
  const T = ix.tile, out: string[] = [];
  for (let i = Math.floor((lon - r) / T); i <= Math.floor((lon + r) / T); i++)
    for (let j = Math.floor((lat - r * 0.8) / T); j <= Math.floor((lat + r * 0.8) / T); j++) if (ix.tiles[`${i}_${j}`] != null) out.push(`${i}_${j}`);
  return out;
}
/** Tiles put together: their features, carriageways and streets; the widths of the whole area (the index's: one
 *  layer per width, the same whatever is loaded), the box of all the tiles. */
function mergeRoads(ix: RoadsIndexFile, parts: AthensRoads[]): AthensRoads {
  const keys = Object.keys(ix.tiles).map(k => k.split("_").map(Number));
  const T = ix.tile, box: [number, number, number, number] = [Math.min(...keys.map(k => k[0])) * T, Math.min(...keys.map(k => k[1])) * T,
    (Math.max(...keys.map(k => k[0])) + 1) * T, (Math.max(...keys.map(k => k[1])) + 1) * T];
  return { features: [], roads: parts.flatMap(p => p.roads), streets: parts.flatMap(p => p.streets),
    widths: ix.widths, box, origin: ix.origin };
}

// The poster in the bus shelters' side panels (public/ads): loaded once, before the stops are built.
const AD_URL = "ads/xoris-empodia.jpg";
let adImage: HTMLImageElement | null = null;
let adLoad: Promise<HTMLImageElement | null> | null = null;
function loadAd(base: string): Promise<HTMLImageElement | null> {
  return (adLoad ??= new Promise(ok => {
    const img = new Image();
    img.onload = () => { adImage = img; ok(img); };
    img.onerror = () => { adLoad = null; ok(null); };
    img.src = `${base}${AD_URL}`;
  }));
}

/** Everything the 3D mode needs, fetched before it shows (the loading screen): three.js, the streets of Athens, all
 *  the shelters' poster. Each is kept (the browser's caches), so the next time it is quick, and the mode
 *  does not stall on a download while the map moves. `step` hears how far it has got (0 to PREPARED) and what it
 *  is on; the map's own tiles come after (prefetchTiles). */
export const PREPARED = 0.7;
export async function prepare3d(step: (done: number, label: string) => void, base = import.meta.env?.BASE_URL ?? "/"): Promise<void> {
  step(0, "Μοντέλα");
  const roads = preloadRoads(), ad = loadAd(base);
  await preloadThree();
  step(0.15, "Δρόμοι");
  await roads;
  step(0.5, "Αφίσες");
  await ad;
  step(PREPARED, "Κτίρια");
}

// The base map's tiles (buildings, streets) fetched ahead into the browser's HTTP cache, where they stay (OpenFreeMap
// serves them for ten years): the map then finds them at once instead of filling in block by block as it moves.
// z14 (the buildings close in) within `km` of a point, z13 (seen far off in a tilted view) within twice that; four
// at a time; each once a session.
const fetchedTiles = new Set<string>();
function tileXY(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z, r = (lat * Math.PI) / 180;
  return [Math.floor(((lon + 180) / 360) * n), Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)];
}
export async function prefetchTiles(map: MlMap, at: LngLat, km: number, step?: (done: number) => void, signal?: AbortSignal): Promise<void> {
  const tpl = (map.getSource(SOURCE) as { tiles?: string[] } | undefined)?.tiles?.[0];
  if (!tpl) return;
  const urls: string[] = [];
  for (const [z, r] of [[14, km], [13, km * 2]] as const) {
    const dLat = r / 110.54, dLon = r / (111.32 * Math.cos((at[1] * Math.PI) / 180));
    const [x0, y0] = tileXY(at[0] - dLon, at[1] + dLat, z), [x1, y1] = tileXY(at[0] + dLon, at[1] - dLat, z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const u = tpl.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
      if (!fetchedTiles.has(u)) urls.push(u);
    }
  }
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(4, urls.length) }, async () => {
    while (next < urls.length && !signal?.aborted) {
      const u = urls[next++];
      try { const r = await fetch(u, { signal }); if (r.ok) { await r.arrayBuffer(); fetchedTiles.add(u); } } catch { /* the map asks again */ }
      step?.(++done / urls.length);
    }
  }));
}

export class Scene3D {
  on = false;
  private dark = false;
  private look: Look3D = "real";
  private pal() { return this.look === "toon" ? COLORS.toon : this.dark ? COLORS.dark : COLORS.light; }
  private map: MlMap | null = null;
  private T: typeof Three | null = null;
  private loading: Promise<typeof Three> | null = null;
  private buses = new Map<string, Bus>();
  private groups = new Map<string, Three.Group>();
  private xray: XRay | null = null;
  private xrayFlat: Three.MeshBasicMaterial | null = null;
  // Where a vehicle is seen (its depth test passed) it marks the stencil with 1, so the X-ray pass (render) leaves
  // it be and shows only the parts something hides.
  private markStencil(g: Three.Object3D) {
    const T = this.T!;
    g.traverse(o => {
      if (!(o as Three.Mesh).isMesh || o.name === "beam" || o.name === "hull" || o === g.userData.glow) return;
      for (const mat of ([] as Three.Material[]).concat((o as Three.Mesh).material)) {
        mat.stencilWrite = true; mat.stencilRef = 1; mat.stencilFunc = T.AlwaysStencilFunc; mat.stencilZPass = T.ReplaceStencilOp;
      }
    });
  }
  private layer: (CustomLayerInterface & { scene?: Three.Scene }) | null = null;
  private renderer: Three.WebGLRenderer | null = null;
  private scene: Three.Scene | null = null;
  private camera: Three.Camera | null = null;
  private sun: Three.DirectionalLight | null = null;
  private ground: Three.Mesh | null = null;
  private proto: Three.Group | null = null;
  private trolleyProto: Three.Group | null = null;
  private metroProtos = new Map<Livery, Three.Group>();   // a metro train per livery (buildMetro), made when first needed
  // The metro's tunnels around the view (buildTunnels): a tube per direction where the line runs underground, lamps
  // along its wall, and a lit hall at each station under the street.
  private metroLines: { id: string; paths: LngLat[][] }[] = [];
  private metroStations: { name: string; lon: number; lat: number; lines: string[] }[] = [];
  private tunnelMeshes: Three.Object3D[] = [];
  private tunnelAt: [number, number] | null = null;
  private tramProto: Three.Group | null = null;
  // Buses and trolleys: all of a kind in one set of instanced draws (busInstances.ts), their displays in one atlas.
  private busInst: BusInstances | null = null;
  private trolleyInst: BusInstances | null = null;
  private atlas: SignAtlas | null = null;
  private busPoses: BusPose[] = [];
  private trolleyPoses: BusPose[] = [];
  private busShown = new Set<string>();
  private drawnRot = new Map<string, number>();
  private origin: LngLat = [0, 0];
  private ref: MercatorCoordinate | null = null;
  private scale = 1;
  private poolsAt = "";
  private onMove = () => this.refresh();
  private built: { at: LngLat; reach: number } | null = null;
  private athens: AthensRoads | null = null;
  private inside: boolean | null = null;   // the view's centre in the streets' area (the base map's roads hidden there)
  // Shaders (shaders.ts): one clock; no motion with reduced motion.
  private time: Clock = { value: 0 };
  private sky: unknown = undefined;
  // Street lights: a pole on the pavement, an arm over the road, a lamp head; at night a cone of light under it.
  private lamps: { pole: LngLat; head: LngLat }[] = [];
  /** The carriageways of Athens (roadSnap.ts), once they have loaded; `onRoads` hears when (MapView snaps its
   *  routes onto them). */
  roads: RoadIndex | null = null;
  onRoads: (() => void) | null = null;
  // The drawn routes on their roads, by line (setRoutes): the vehicles of those lines ride on them.
  private tracks = new Map<string, Track[]>();
  private trackOf = new WeakMap<object, Track>();
  // Each vehicle's place on its track (place()): where it was drawn last, and a correction that glides away any jump
  // of where its position lands on the route (OASA's shape cuts a corner the route goes round).
  private onTrack = new Map<string, { t: Track; s: number; raw: number; err: number; at: number }>();
  private lampMeshes: Three.InstancedMesh[] = [];
  // The bus stops (MapView's setStops: every stop of the index) and the ones built near the view: a pole with the
  // blue OASA sign at the kerb, and on wide streets a shelter with a bench behind it.
  private stopsAll: LngLat[] = [];
  private stopsNear: { pole: LngLat; shelter: LngLat | null; angle: number }[] = [];
  private stopMeshes: Three.InstancedMesh[] = [];
  // The arrival screens on the nearest stops' poles (setBoards): the OASA telematics board, amber LED text.
  private boards: Board[] = [];
  private boardMeshes: Three.Mesh[] = [];
  private readonly still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(private readonly base = import.meta.env?.BASE_URL ?? "/") {}

  /** Turn the mode on or off (and restyle it for the theme and the look). Safe to call again with the same values.
   *  «Μινιατούρα» (toon) is always in daylight. */
  async set(map: MlMap, on: boolean, dark: boolean, look: Look3D = "real") {
    const day = look === "toon" ? false : dark;
    const was = this.on, changed = on !== this.on || day !== this.dark || look !== this.look || map !== this.map;
    this.map = map;
    this.on = on;
    this.dark = day;
    this.look = look;
    map.getContainer().classList.toggle("map3d", on);
    if (!changed) return;
    if (!on) {
      this.teardown();
      this.flushReady();
      map.getContainer().classList.remove("map3d-near");
      if (!was) return;
      map.dragRotate.disable();
      (map.dragRotate as unknown as { _pitchWithRotate: boolean })._pitchWithRotate = false;
      map.keyboard.disableRotation();
      map.touchPitch.disable();
      // Flat again; the bearing kept (2D turns too: MapView turn2D enables its turning again).
      map.easeTo({ pitch: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 600 });
      return;
    }
    if (!was) {
      // Tilted up to 80°, not past the horizon: near 90° and beyond (MapLibre allows to 180) the map loads tiles and
      // buildings all the way to the horizon, and a phone's browser runs out of memory and reloads the page.
      map.setMaxPitch(MAX_PITCH_3D);
      // Right-drag (or Ctrl+drag) turns and tilts at once, as in any 3D map: MapLibre reads its pitch-with-rotate
      // flag when the handler is enabled (the map was made without it, for 2D).
      (map.dragRotate as unknown as { _pitchWithRotate: boolean })._pitchWithRotate = true;
      map.dragRotate.enable();
      map.touchZoomRotate.enableRotation();
      map.keyboard.enableRotation();
      map.touchPitch.enable();
      if (map.getPitch() < 30) map.easeTo({ pitch: 60, zoom: Math.max(map.getZoom(), 16.5), duration: 900 });
    }
    void this.streets();
    this.T = await (this.loading ??= preloadThree());
    if (!this.on || this.map !== map || !this.styleReady) return;   // off again, or a new style: restyled() adds it
    this.teardown();
    this.addStyle();
    this.addLayer();
  }

  // Whether the map's style is in place (set by MapView: restyled() after each load, styleGone() when it is replaced).
  // map.isStyleLoaded() will not do: it stays false while any tile is still loading, which is always while the map
  // moves (the chase camera).
  private styleReady = false;
  // A style gone: the layers it hid for the metro mode are gone with it (the new ones come visible).
  styleGone() { this.styleReady = false; this.groundHidden.clear(); }

  /** After every style load (MapView's addAll): the style's layers are new, so ours go in again. */
  restyled() {
    this.styleReady = true;
    // A new style: what was saved from the old one (to put back when 3D goes off) belongs to it, not to this one.
    this.forgetSaved();
    if (!this.on || !this.map) return;
    if (!this.T) { void this.loading?.then(() => this.restyled()); return; }
    this.teardown();
    this.addStyle();
    this.addLayer();
  }

  // A tram's front, on its track, added to its trail once it has moved a metre (a jump of more than 60 m, a new
  // placement, starts the trail again). The trail keeps the last 45 m: enough for all its cars. A tram first seen
  // standing starts its trail where it stands (its cars then lie back along its heading).
  private tramTrail(b: Bus) {
    if (b.heading == null && b.trail?.length) return;   // standing: it stays where its trail ends
    const r = (((b.heading ?? 0) + 90) * Math.PI) / 180;
    const side = b.kind === "metro" ? 0 : TRAM_TRACK, keep = b.kind === "metro" ? 125 : 45;   // a metro train is ~105 m
    const x = (b.pos[0] - TRAIL_ORIGIN[0]) * TKX + Math.sin(r) * side, y = (b.pos[1] - TRAIL_ORIGIN[1]) * TKY + Math.cos(r) * side;
    const t = (b.trail ??= []), last = t[t.length - 1];
    if (last) {
      const d = Math.hypot(x - last[0], y - last[1]);
      if (d > 60) t.length = 0;
      else if (d < 1) return;
    }
    t.push([x, y]);
    let len = 0;
    for (let i = t.length - 1; i > 0; i--) {
      len += Math.hypot(t[i][0] - t[i - 1][0], t[i][1] - t[i - 1][1]);
      if (len > keep) { t.splice(0, i - 1); break; }
    }
  }

  // The point `d` metres back along a tram's trail from its front; past the trail's start, straight on behind it
  // (along its first stretch, or its heading when it has not moved yet).
  private behind(b: Bus, d: number): [number, number] {
    // The front is where the tram is this frame, not the last point kept (one a metre): so it glides, not steps.
    const t0 = b.trail!, last = t0[t0.length - 1];
    const hx = (b.pos[0] - TRAIL_ORIGIN[0]) * TKX, hy = (b.pos[1] - TRAIL_ORIGIN[1]) * TKY;
    const t = last && Math.hypot(hx - last[0], hy - last[1]) > 0.01 && Math.hypot(hx - last[0], hy - last[1]) < 60 ? [...t0, [hx, hy] as [number, number]] : t0;
    for (let i = t.length - 1; i > 0; i--) {
      const L = Math.hypot(t[i][0] - t[i - 1][0], t[i][1] - t[i - 1][1]);
      if (d <= L) return [t[i][0] + ((t[i - 1][0] - t[i][0]) * d) / L, t[i][1] + ((t[i - 1][1] - t[i][1]) * d) / L];
      d -= L;
    }
    const a = t[0], h = ((b.heading ?? 0) * Math.PI) / 180;
    let ux = -Math.sin(h), uy = -Math.cos(h);
    if (t.length > 1) { const L = Math.hypot(t[0][0] - t[1][0], t[0][1] - t[1][1]) || 1; ux = (t[0][0] - t[1][0]) / L; uy = (t[0][1] - t[1][1]) / L; }
    return [a[0] + ux * d, a[1] + uy * d];
  }

  /** A vehicle to draw, every frame: `label` is its line's number, shown on its destination displays. */
  /** A bus's, a trolley's and a tram's model turns toward its heading (a road's or a track's bearing changes at each
   *  vertex); the metro's cars already lie along their rails. `busy` while one is still turning. */
  readonly turns = new Turners();

  upsert(key: string, pos: LngLat, heading: number | null, color: string, kind: VehicleKind = "bus", label = "", glow: DelayClass = "none", livery?: Livery) {
    if (kind !== "metro" && heading != null) heading = this.turns.toward(key, heading, performance.now() / 1000);
    const b = this.buses.get(key);
    if (b) { b.pos = pos; if (heading != null) b.heading = heading; b.color = color; b.kind = kind; b.label = label; b.glow = glow; b.livery = livery; }
    else this.buses.set(key, { pos, heading, color, kind, label, glow, livery });
    const nb = this.buses.get(key)!;
    if (kind === "tram" || (kind === "metro" && !nb.laid)) this.tramTrail(nb);
    if (this.on && this.layer) this.map?.triggerRepaint();
  }

  /** Where a bus's last GPS fix is (not where it is drawn): spacing lets one pass another only where these say so. */
  setFix(key: string, at: LngLat) { const b = this.buses.get(key); if (b) b.fix = at; }

  /** A metro train's cars laid along its own track (metroDepth.trackBehind: [lon, lat], oldest first, the front last),
   *  instead of along where its front has been: they follow the rails exactly. */
  layTrain(key: string, track: LngLat[]) {
    const b = this.buses.get(key);
    if (!b) return;
    b.laid = true;
    b.trail = track.map(([lon, lat]) => [(lon - TRAIL_ORIGIN[0]) * TKX, (lat - TRAIL_ORIGIN[1]) * TKY] as [number, number]);
  }

  /** The routes as drawn, already on their roads (MapView's onRoads; properties.line on each), or none. */
  setRoutes(fc: GeoJSON.FeatureCollection<GeoJSON.LineString> | null) {
    const idx = this.roads;
    this.tracks = new Map();
    if (!idx || !fc) return;
    for (const f of fc.features) {
      const line = f.properties?.line, coords = f.geometry.coordinates;
      if (typeof line !== "string" || coords.length < 2) continue;
      let t = this.trackOf.get(coords);
      if (!t) this.trackOf.set(coords, (t = new Track(coords as LngLat[], idx)));
      (this.tracks.get(line) ?? this.tracks.set(line, []).get(line)!).push(t);
    }
  }

  /** Where to draw a vehicle in 3D: on its line's drawn route (so it drives where the route is painted, through the
   *  same forks); else where its motion has it, on its line's shape. Never on a road of its own choosing. Close in
   *  only (STREET_ZOOM), in Athens. */
  place(pos: LngLat, heading: number | null, line?: string, key?: string, left = 0, inner = 0): { pos: LngLat; heading: number | null } {
    const r = this.placeOn(pos, heading, line, key, left, inner);
    if (!key || !this.on || !this.map || this.map.getZoom() < STREET_ZOOM) { if (key) this.smooth.drop(key); return r; }
    // Drawn where it is placed, glided (smoothPose): a place worked out afresh each frame hops a metre or two at a
    // vertex, a fork or a lane's edge.
    const [x, y] = [(r.pos[0] - TRAIL_ORIGIN[0]) * TKX, (r.pos[1] - TRAIL_ORIGIN[1]) * TKY];
    const g = this.smooth.step(key, x, y, r.heading, performance.now() / 1000);
    return { pos: [TRAIL_ORIGIN[0] + g.x / TKX, TRAIL_ORIGIN[1] + g.y / TKY], heading: g.heading };
  }
  private smooth = new PoseSmoother();
  private placeOn(pos: LngLat, heading: number | null, line?: string, key?: string, left = 0, inner = 0): { pos: LngLat; heading: number | null } {
    const idx = this.roads;
    const unit = (h: number | null): [number, number] | undefined => h == null ? undefined : [Math.sin((h * Math.PI) / 180), Math.cos((h * Math.PI) / 180)];
    // Its own heading picks its line's track (the way it runs). Standing, it has none (MapView): it keeps to the track
    // it was on, else the way its model faced picks it (never a track running against it: that put a standing bus on
    // the other direction's track, facing back along its route, and it stayed there till it moved).
    if (heading == null && key) heading = this.buses.get(key)?.heading ?? null;
    const dir = unit(heading);
    if (!this.on || !idx || !this.map || this.map.getZoom() < STREET_ZOOM) { if (key) this.onTrack.delete(key); return { pos, heading }; }
    const tracks = (line && this.tracks.get(line)) || [];
    if (tracks.length) {
      const now = performance.now(), was = key ? this.onTrack.get(key) : undefined;
      // On the track it was on, near where it was (a little back, well ahead), so it keeps to its own stretch.
      let hit: { t: Track; s: number } | null = null;
      if (was && tracks.includes(was.t)) {
        const h = was.t.at(pos, 25, dir, [was.raw - 15, was.raw + 120]);
        if (h) hit = { t: was.t, s: h.s };
      }
      // Else the nearest of its line's tracks running its way within 25 m, then within 60 m (its GPS, or OASA's
      // path, off its painted route). Never one running against it (the other direction's).
      for (const reach of [25, 60]) {
        if (hit) break;
        let best = Infinity;
        for (const t of tracks) { const h = t.at(pos, reach, dir); if (h && h.d < best) { best = h.d; hit = { t, s: h.s }; } }
      }
      if (hit) {
        let err = 0;
        if (was && was.t === hit.t && now - was.at < 1000) {
          // Where it lands jumped (more than it can drive in a frame): carry on from where it was drawn, and close
          // the gap over about half a second, so it glides instead of hopping.
          err = was.err * Math.exp(-(now - was.at) / 250);
          const step = hit.s - was.raw;
          if (Math.abs(step) > 3) err = was.s - hit.s;
          if (Math.abs(err) > 60) err = 0;   // too far: a new fix, not a jump of the projection
        }
        const s = Math.max(0, Math.min(hit.t.length, hit.s + err));
        if (key) this.onTrack.set(key, { t: hit.t, s, raw: hit.s, err, at: now });
        return hit.t.pose(s);
      }
    }
    if (key) this.onTrack.delete(key);
    // A bus is on a road: the nearest running its way within 20 m, else any within 60 m (its GPS off at a terminus,
    // or behind a building), rather than in a garden or inside a block.
    // Not on a road (2026-11-09): a bus is only ever drawn on its route. Off a painted route it stays where its motion
    // has it, which is on its line's shape (motion along along_m, or OASA's path), facing its way, kept SHAPE_RIGHT
    // to the right of the shape (a shape runs down the middle of a two-way street: two buses passing would go through
    // each other). Laid on the nearest road it went onto cross streets at junctions, and into gardens and blocks
    // where the shape and the mapped roads part.
    if (heading == null) return { pos, heading };
    // OASA's shapes run a few metres off the mapped street here and there: on the asphalt of the road running its
    // way within ROAD_NUDGE_M of the shape's point, in its lane, keeping the shape's heading; else right of the shape.
    const dirN = unit(heading)!;
    const near = idx.nearest(pos, ROAD_NUDGE_M, undefined, dirN);
    if (near) {
      const rd = (Math.atan2(near.tx, near.ty) * 180) / Math.PI, off = Math.abs(((rd - heading + 540) % 360) - 180);
      if (Math.min(off, 180 - off) <= 30) { const h = idx.lane(near, dirN, left, inner); return { pos: idx.ll(h.x, h.y), heading }; }
    }
    const r = (heading * Math.PI) / 180, kx = 111320 * Math.cos((pos[1] * Math.PI) / 180);
    return { pos: [pos[0] + (Math.cos(r) * SHAPE_RIGHT) / kx, pos[1] - (Math.sin(r) * SHAPE_RIGHT) / 110540], heading };
  }

  drop(key: string) {
    this.buses.delete(key);
    this.onTrack.delete(key);
    this.smooth.drop(key);
    this.turns.drop(key);
    this.drawnRot.delete(key);
    if (this.busShown.delete(key)) this.drawn.delete(key);
    const g = this.groups.get(key);
    if (g) { g.removeFromParent(); this.groups.delete(key); }
  }

  // The pavements, kerbs and carriageways: one line layer per width (athensRoads.ts Widths), drawn as a mapmaker
  // draws them, every pavement first, then every kerb, then every carriageway, so at a junction the surfaces join and
  // no kerb crosses. Added once the streets have loaded (or at once if they have), under the markings.
  private streetIds: string[] = [];
  private streetLayers(before?: string) {
    const m = this.map, A = this.athens;
    if (!m || !A || !m.getSource("x3d-roads") || this.streetIds.some(id => m.getLayer(id))) return;
    this.streetIds = [];   // none on the map (a new style dropped them): add them again
    const c = this.pal(), lat = m.getCenter().lat;
    // Under the markings when painted, else under the tram's tracks (the first layer over the street).
    const under = m.getLayer("x3d-mark-0") ? "x3d-mark-0" : m.getLayer("x3d-tram-bed") ? "x3d-tram-bed" : before;
    // Streets end round, so where two meet at an angle the corner is filled. Motorways end square: their ways meet
    // in line, but change width at every ramp (a lane more or less), and a round end of the wider one would bulge
    // out past the narrower one as a half disc.
    // One layer per width (athensRoads Widths), each a plain zoom curve in metres: exact at every zoom on every tile.
    // A width per feature in one layer per surface (tried 2026-11-09) is worked out by MapLibre at each tile's own
    // zoom and the next, so while the map zoomed (a tile of the last zoom shown until the new one is laid out) the
    // streets grew and shrank under the camera. The draw calls this costs stay few since the source's tiles are cut
    // at zoom 16 (a quarter as many tiles at street level as at 17), and a tile draws only the widths it has.
    const add = (id: string, kind: string, prop: string, v: number, width: number, color: string, cap: "round" | "butt") => {
      m.addLayer({ id, type: "line", source: "x3d-roads", minzoom: STREET_ZOOM,
        filter: ["all", ["==", ["get", "kind"], kind], ["==", ["get", prop], v]],
        layout: { "line-join": "round", "line-cap": cap, visibility: this.under ? "none" : "visible" },
        paint: { "line-color": color, "line-width": metres(width, lat) } } as never, under);
      this.streetIds.push(id);
    };
    for (const v of A.widths.walk) add(`x3d-walk-${v}`, "road", "pq", v, v, c.walk, "round");
    for (const v of A.widths.path) add(`x3d-path-${v}`, "path", "wq", v, v, c.walk, "round");
    // A road's pavement where it widens (athensRoads taperPatches), under every kerb and carriageway.
    m.addLayer({ id: "x3d-walk-patch", type: "fill", source: "x3d-roads", minzoom: STREET_ZOOM, filter: ["==", ["get", "kind"], "walkPatch"],
      layout: { visibility: this.under ? "none" : "visible" }, paint: { "fill-color": c.walk, "fill-antialias": false } } as never, under);
    this.streetIds.push("x3d-walk-patch");
    for (const v of A.widths.road) add(`x3d-kerb-${v}`, "road", "wq", v, v + 0.6, c.kerbA, "round");   // 30 cm kerbs, white (toon: its own)
    for (const v of A.widths.motor) add(`x3d-kerb-m-${v}`, "motor", "wq", v, v + 0.6, c.kerbA, "butt");
    for (const v of A.widths.road) add(`x3d-road-${v}`, "road", "wq", v, v, c.road, "round");
    for (const v of A.widths.motor) add(`x3d-road-m-${v}`, "motor", "wq", v, v, c.road, "butt");
    // Where a road forks: its patch, over the carriageways, with its kerbs (athensRoads forkPatches).
    m.addLayer({ id: "x3d-patch", type: "fill", source: "x3d-roads", minzoom: STREET_ZOOM, filter: ["==", ["get", "kind"], "patch"],
      layout: { visibility: this.under ? "none" : "visible" }, paint: { "fill-color": c.road, "fill-antialias": false } } as never, under);
    m.addLayer({ id: "x3d-patch-kerb", type: "line", source: "x3d-roads", minzoom: STREET_ZOOM, filter: ["==", ["get", "kind"], "patchKerb"],
      layout: { "line-cap": "round", visibility: this.under ? "none" : "visible" },
      paint: { "line-color": c.kerbA, "line-width": metres(0.3, lat) } } as never, under);
    // A junction's islands (scripts/junctions.py): pavement, over its surface, under its kerbs' line.
    if (MARKINGS) m.addLayer({ id: "x3d-island", type: "fill", source: "x3d-roads", minzoom: STREET_ZOOM, filter: ["==", ["get", "kind"], "island"],
      layout: { visibility: this.under ? "none" : "visible" }, paint: { "fill-color": c.walk, "fill-antialias": true } } as never, "x3d-patch-kerb");
    this.streetIds.push("x3d-patch", "x3d-patch-kerb");
    if (MARKINGS) this.streetIds.push("x3d-island");
  }

  // ---- The metro under the street.
  /** The metro lines' tracks (one path per direction, [lon, lat]) and its stations (MapView: metro.json). */
  setMetro(lines: { id: string; paths: LngLat[][] }[], stations: { name: string; lon: number; lat: number; lines: string[] }[]) {
    this.metroLines = lines.filter(l => l.id.startsWith("M"));
    this.metroStations = stations;
    this.tunnelAt = null;
    this.tunnelsNear();
  }

  // Underground on (a metro train picked, or the «Υπόγεια» button): only the underground. The street level goes: its
  // streets, buildings, lamps and stops hidden, the map under a dark veil, so the tunnels and the trains in them stand alone. Kept across a restyle (addStyle).
  under = false;   // read by MapView (labels, discs)
  setUnder(on: boolean) {
    if (this.under === on) return;
    this.under = on;
    this.applyUnder();
  }
  // Nothing on the ground while underground: every layer of the map (its streets, names, places; the app's stops,
  // vehicles and lines) hidden but the dark background, the veil and the 3D. Each keeps the visibility it had, given
  // back on the way up; a layer added or shown meanwhile is hidden too (styledata).
  private groundHidden = new Map<string, string>();
  private hidePending = false;
  private onStyleData = () => {
    if (this.hidePending || !this.under) return;
    this.hidePending = true;
    requestAnimationFrame(() => { this.hidePending = false; if (this.under) this.hideGround(); });
  };
  private hideGround() {
    const m = this.map;
    if (!m?.getStyle()) return;
    for (const l of m.getStyle().layers) {
      if (l.id === LAYER || l.id === "x3d-under" || l.type === "background" || STREET_LAYERS.includes(l.id) || this.streetIds.includes(l.id)) continue;   // the street's own: applyUnder
      const v = (m.getLayoutProperty(l.id, "visibility") as string | undefined) ?? "visible";
      if (v === "none") { if (!this.groundHidden.has(l.id)) this.groundHidden.set(l.id, v); continue; }
      this.groundHidden.set(l.id, v);   // shown meanwhile (the app's own toggle): its new state is what comes back
      m.setLayoutProperty(l.id, "visibility", "none");
    }
  }
  private showGround() {
    const m = this.map;
    if (m) for (const [id, v] of this.groundHidden) if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", v as "visible" | "none");
    this.groundHidden.clear();
  }
  private applyUnder() {
    for (const o of this.tunnelMeshes) o.visible = this.under;
    const m = this.map;
    // Up again: everything back, whatever state the 3D is in (turned off with the metro mode on, the street style
    // may be gone already, but the map's own layers were hidden all the same).
    if (m && !this.under) {
      m.off("styledata", this.onStyleData);
      this.showGround();
      if (m.getLayer("x3d-under")) m.removeLayer("x3d-under");
      m.triggerRepaint();
    }
    if (!m || !this.styleReady) return;
    for (const id of [...STREET_LAYERS, ...this.streetIds]) if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", this.under ? "none" : "visible");
    if (this.under && !m.getLayer("x3d-under")) {
      if (!m.getSource("x3d-under")) m.addSource("x3d-under", { type: "geojson", data: { type: "Feature", properties: {},
        geometry: { type: "Polygon", coordinates: [[[-179, -85], [179, -85], [179, 85], [-179, 85], [-179, -85]]] } } });
      m.addLayer({ id: "x3d-under", type: "fill", source: "x3d-under", paint: { "fill-color": "#05070a", "fill-opacity": this.dark ? 0.86 : 0.8 } },
        m.getLayer("x3d-buildings") ? "x3d-buildings" : undefined);
    } else if (!this.under && m.getLayer("x3d-under")) m.removeLayer("x3d-under");
    if (this.under) { this.hideGround(); m.on("styledata", this.onStyleData); }
    else void this.refresh();   // the street level back: its trees again
    m.triggerRepaint();
  }

  private metroProto(livery: Livery): Three.Group {
    let g = this.metroProtos.get(livery);
    if (!g) {
      g = buildMetro(this.T!, livery, this.dark);
      for (const car of g.children) if (car.userData.len != null) mergeParts(this.T!, car);
      this.metroProtos.set(livery, g);
    }
    return g;
  }

  // The tunnels' materials, made once (a material made again is a shader compiled again).
  private tunnelMat: Record<string, Three.Material> | null = null;
  private tunnelMaterials() {
    const T = this.T!;
    if (this.tunnelMat) return this.tunnelMat;
    const mat = {
      // Concrete, lit by its own lamps (a little light of its own) more than by the sun: the far wall seen through the street.
      wall: new T.MeshLambertMaterial({ color: 0x7b838f, emissive: 0x23272e, side: T.BackSide, transparent: true, opacity: 0.78, depthWrite: false }),
      steel: new T.MeshLambertMaterial({ color: 0x6f747c, emissive: 0x15171a, side: T.DoubleSide }),
      railTop: new T.MeshBasicMaterial({ color: 0xd9dee5, side: T.DoubleSide }),   // the rails' polished heads, catching the lamps' light
      third: new T.MeshLambertMaterial({ color: 0xd8d23a, emissive: 0x3a3608, side: T.DoubleSide }),   // the third rail's yellow cover
      sleeper: new T.MeshLambertMaterial({ color: 0x9c9c97 }),
      bed: new T.MeshLambertMaterial({ color: 0x2b2c2f, side: T.DoubleSide }),
      floor: new T.MeshLambertMaterial({ color: 0xe4e4df }),                        // the platforms' pale granite
      tactile: new T.MeshLambertMaterial({ color: 0x8c4a3a }),                      // the guide strip near the edge
      edge: new T.MeshLambertMaterial({ color: 0xf4f4f0 }),
      stationWall: new T.MeshLambertMaterial({ color: 0xe9ecef, transparent: true, opacity: 0.9 }),
      column: new T.MeshLambertMaterial({ color: 0xf1f2f3 }),
      lamp: new T.MeshBasicMaterial({ color: 0xffe2a0 }),
      strip: new T.MeshBasicMaterial({ color: 0xf6f8ff }),                          // the platforms' light lines
    };
    return (this.tunnelMat = mat);
  }

  // The tunnels within reach of the view, built again once the view has moved 400 m (or the origin moved).
  private tunnelsNear() {
    const m = this.map, T = this.T, scene = this.scene;
    if (!m || !T || !scene || !this.ref || !this.metroLines.length) return;
    const [cx, cy] = this.local(m.getCenter().toArray() as LngLat);
    if (this.tunnelAt && Math.hypot(cx - this.tunnelAt[0], cy - this.tunnelAt[1]) < 400) return;
    this.tunnelAt = [cx, cy];
    const mat = this.tunnelMaterials(), kept = new Set<Three.Material>(Object.values(mat));
    for (const o of this.tunnelMeshes) {
      o.removeFromParent();
      const me = o as Three.Mesh;
      me.geometry?.dispose();
      for (const m of ([] as Three.Material[]).concat(me.material ?? [])) if (!kept.has(m)) m.dispose();
    }
    this.tunnelMeshes = [];
    const R = 1600, RAIL_R = 1000;   // tunnels within 1.6 km of the view; the track (many small parts) within 1 km
    const add = (me: Three.Object3D) => { me.frustumCulled = false; this.tunnelMeshes.push(me); };
    const lamps: [number, number, number, number][] = [], sleepers: [number, number, number, number][] = [];

    // The stations under the street within reach, on their line (a marker may stand off it), turned along it: the
    // tunnels stop at their ends, the track runs on through them.
    const stations: { line: string; x: number; y: number; ang: number; d: number; island: boolean; half: number }[] = [];
    // Each line's centre path in local metres, once (not again for each of its stations).
    const centres = new Map<string, [number, number][]>();
    const centreOf = (id: string) => {
      let c = centres.get(id);
      if (!c) centres.set(id, (c = (this.metroLines.find(l => l.id === id)?.paths[0] ?? []).map(p => this.local(p))));
      return c;
    };
    for (const line of ["M1", "M2", "M3"]) for (const st of metroStops(this.metroStations, line)) {   // the line's own, once each
      // Only where its line runs at full depth: never a station on a portal's ramp, halfway to the street.
      if (!line.startsWith("M") || depthAt(line, st.lon, st.lat) < (DEPTH[line] ?? 0) * 0.9) continue;
      const on = onLine(centreOf(line), this.local([st.lon, st.lat]));
      if (!on || on.d > 150 || Math.hypot(on.at[0] - cx, on.at[1] - cy) > R) continue;
      const [lon, lat] = this.unlocal(on.at[0], on.at[1]);
      stations.push({ line, x: on.at[0], y: on.at[1], ang: on.ang, d: depthAt(line, lon, lat),
        island: ISLANDS.some(i => i.name === st.name && i.line === line), half: trackGapAt(lon, lat, line) / 2 });
    }
    const inStation = (line: string, x: number, y: number) => stations.some(s => s.line === line && Math.abs((x - s.x) * Math.cos(s.ang) + (y - s.y) * Math.sin(s.ang)) < ST_LEN / 2
      && Math.abs(-(x - s.x) * Math.sin(s.ang) + (y - s.y) * Math.cos(s.ang)) < 12);

    for (const l of this.metroLines) {
      // The line's centre every 4 m (local), underground and near: each point with its depth and its tracks' gap.
      const pts: { x: number; y: number; d: number; gap: number }[] = [];
      const centre = centreOf(l.id);
      for (let i = 1; i < centre.length; i++) {
        const [ax, ay] = centre[i - 1], [bx, by] = centre[i], L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / 4));
        for (let k = i === 1 ? 0 : 1; k <= n; k++) {
          const x = ax + ((bx - ax) * k) / n, y = ay + ((by - ay) * k) / n;
          if (Math.hypot(x - cx, y - cy) > R) { pts.push({ x, y, d: 0, gap: TRACK_GAP }); continue; }
          const [lon, lat] = this.unlocal(x, y);
          pts.push({ x, y, d: depthAt(l.id, lon, lat), gap: trackGapAt(lon, lat, l.id) });
        }
      }
      // The line's own colour between its two tracks, lit: its route, under the street (the map's line goes).
      let mid: Three.Vector3[] = [];
      const midOut = () => {
        if (mid.length > 1) add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(mid, false, "centripetal"), mid.length, 0.22, 5, false),
          new T.MeshBasicMaterial({ color: LINE_COLOR[l.id] ?? "#0a7cc4" })));
        mid = [];
      };
      for (const p of pts) { if (p.d >= 4 && Math.hypot(p.x - cx, p.y - cy) <= R && !inStation(l.id, p.x, p.y)) mid.push(new T.Vector3(p.x, p.y, -p.d + 0.05)); else midOut(); }
      midOut();
      // The bore: one big tube round both tracks (as Athens' tunnels are dug), up to each station's ends; where the
      // tracks part round an island platform, a tube each (below).
      let bore: { x: number; y: number; z: number; ux: number; uy: number }[] = [];
      const boreOut = () => {
        if (bore.length > 1) {
          const curve = new T.CatmullRomCurve3(bore.map(q => new T.Vector3(q.x, q.y, q.z)), false, "centripetal");
          const mesh = new T.Mesh(new T.TubeGeometry(curve, Math.max(4, Math.round(curve.getLength() / 6)), BORE_R, 20, false), mat.wall);
          mesh.renderOrder = 2;   // after the trains: the far wall shows only where no train is in front of it
          add(mesh);
          for (let i = 3; i < bore.length; i += 3) for (const sd of [-1, 1]) {   // a lamp every 12 m along each wall
            const q = bore[i];
            lamps.push([q.x + sd * q.uy * BORE_R * 0.85, q.y - sd * q.ux * BORE_R * 0.85, q.z + BORE_R * 0.4, Math.atan2(q.uy, q.ux)]);
          }
        }
        bore = [];
      };
      pts.forEach((p, i) => {
        if (p.d < 4 || p.gap > SPLIT_GAP || Math.hypot(p.x - cx, p.y - cy) > R || inStation(l.id, p.x, p.y)) { boreOut(); return; }
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        bore.push({ x: p.x, y: p.y, z: -p.d + 2.2, ux: (b.x - a.x) / L, uy: (b.y - a.y) / L });
      });
      boreOut();
      for (const side of [-1, 1]) {
        // Each track: to this side of the centre (right of the path's way for +1).
        const track = pts.map((p, i) => {
          const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
          return { x: p.x + uy * side * p.gap / 2, y: p.y - ux * side * p.gap / 2, z: -p.d, ux, uy, gap: p.gap, under: p.d >= 4 && Math.hypot(p.x - cx, p.y - cy) <= R,
            station: inStation(l.id, p.x, p.y) };
        });
        // Runs of consecutive points: the tube's (underground, not in a station) and the track's (underground).
        const runs = (keep: (q: typeof track[number]) => boolean) => {
          const out: (typeof track)[] = [];
          let cur: typeof track = [];
          for (const q of track) { if (keep(q)) cur.push(q); else { if (cur.length > 1) out.push(cur); cur = []; } }
          if (cur.length > 1) out.push(cur);
          return out;
        };
        // A tube of its own only where the tracks part (round an island platform); elsewhere both share the bore.
        for (const run of runs(q => q.under && !q.station && q.gap > SPLIT_GAP)) {
          const curve = new T.CatmullRomCurve3(run.map(q => new T.Vector3(q.x, q.y, q.z + 1.9)), false, "centripetal");
          const mesh = new T.Mesh(new T.TubeGeometry(curve, Math.max(4, Math.round(curve.getLength() / 6)), TUBE_R, 14, false), mat.wall);
          mesh.renderOrder = 2;   // after the trains: the far wall shows only where no train is in front of it
          add(mesh);
          // A lamp every 12 m along the upper wall, on the outer side.
          for (let i = 3; i < run.length; i += 3) {
            const q = run[i];
            lamps.push([q.x + side * q.uy * TUBE_R * 0.8, q.y - side * q.ux * TUBE_R * 0.8, q.z + 1.9 + TUBE_R * 0.45, Math.atan2(q.uy, q.ux)]);
          }
        }
        // The track, as in Athens' tunnels: concrete sleepers, two steel rails at standard gauge, and the third rail
        // under its yellow cover on the side away from the platform (toward the other track).
        for (const run of runs(q => q.under && Math.hypot(q.x - cx, q.y - cy) <= RAIL_R)) {
          // Flat strips along the track (a bed, the rails' heads, the third rail's cover), each `w` wide, `off` across
          // from the track's centre, `dz` up from its foot: seen from above, as the view mostly is.
          const ribbon = (off: number, w: number, dz: number, m0: Three.Material) => {
            const pos: number[] = [], idx: number[] = [];
            run.forEach((q, i) => {
              for (const e of [-w / 2, w / 2]) pos.push(q.x + q.uy * (off + e), q.y - q.ux * (off + e), q.z + dz);
              if (i) { const a = 2 * (i - 1); idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
            });
            const g = new T.BufferGeometry();
            g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
            g.setIndex(idx);
            g.computeVertexNormals();
            const me = new T.Mesh(g, m0);
            add(me);
          };
          ribbon(0, 3.2, -0.04, mat.bed);
          for (const off of [-0.72, 0.72]) { ribbon(off, 0.16, 0.24, mat.steel); ribbon(off, 0.05, 0.25, mat.railTop); }
          ribbon(-side * 1.45, 0.4, 0.34, mat.third);
          for (let i = 0; i < run.length; i++) for (const f of [0, 0.25, 0.5, 0.75]) {   // a sleeper every metre
            const q = run[i], r = run[Math.min(run.length - 1, i + 1)];
            if (i === run.length - 1 && f > 0) break;
            sleepers.push([q.x + (r.x - q.x) * f, q.y + (r.y - q.y) * f, q.z + (r.z - q.z) * f + 0.06, Math.atan2(q.uy, q.ux)]);
          }
        }
      }
    }
    const instanced = (geo: Three.BufferGeometry, m0: Three.Material, at: [number, number, number, number][]) => {
      if (!at.length) return;
      const me = new T.InstancedMesh(geo, m0, at.length), o = new T.Object3D();
      at.forEach(([x, y, z, ang], i) => { o.position.set(x, y, z); o.rotation.set(0, 0, ang); o.updateMatrix(); me.setMatrixAt(i, o.matrix); });
      add(me);
    };
    instanced(new T.BoxGeometry(1.4, 0.25, 0.18), mat.lamp, lamps);
    instanced(new T.BoxGeometry(0.26, 2.5, 0.16), mat.sleeper, sleepers);

    // Each station, as Athens' are: the two tracks in a trench, a platform each side (or one between them, an island:
    // Monastiraki) of pale granite with its white edge and the brown guide strip, light lines along the ceiling's
    // edge, pale walls behind the platforms with a band in the line's colour, white columns, tunnel mouths each end.
    for (const st of stations) {
      const { x, y, ang, d, half } = st, col = new T.Color(LINE_COLOR[st.line] ?? "#0a7cc4");
      const across = (off: number): [number, number] => [x - Math.sin(ang) * off, y + Math.cos(ang) * off];
      const box = (w: number, h: number, off: number, z: number, m0: Three.Material, len = ST_LEN) => {
        const me = new T.Mesh(new T.BoxGeometry(len, w, h), m0);
        const [px, py] = across(off);
        me.position.set(px, py, z);
        me.rotation.z = ang;
        add(me);
      };
      const top = -d + 1.1, clear = 1.55, PW = 6;   // the platforms' top (the trains' floor), track centre to edge, width
      const plats: { off: number; w: number; edges: number[] }[] = st.island
        ? [{ off: 0, w: 2 * (half - clear), edges: [-1, 1] }]
        : [-1, 1].map(sd => ({ off: sd * (half + clear + PW / 2), w: PW, edges: [-sd] }));
      for (const p of plats) {
        box(p.w, 1.3, p.off, top - 0.65, mat.floor);
        for (const e of p.edges) {
          const edgeOff = p.off + e * (p.w / 2);
          box(0.35, 0.03, edgeOff - e * 0.18, top + 0.01, mat.edge);
          box(0.3, 0.03, edgeOff - e * 0.75, top + 0.01, mat.tactile);
        }
        // The walls behind side platforms (with the line's band), or a row of columns down an island.
        if (st.island) for (let k = -4; k <= 4; k++) {
          const c = new T.Mesh(new T.CylinderGeometry(0.55, 0.55, 4.6, 16), mat.column);
          const [px, py] = across(p.off);
          c.position.set(px + Math.cos(ang) * k * 13, py + Math.sin(ang) * k * 13, top + 2.3);
          c.rotation.x = Math.PI / 2;
          add(c);
        } else {
          const outer = p.off + Math.sign(p.off) * (PW / 2 + 0.2);
          box(0.4, 5.2, outer, top + 2.6, mat.stationWall);
          box(0.42, 0.5, outer, top + 3.6, new T.MeshBasicMaterial({ color: col }));
          for (let k = -4; k <= 4; k++) {
            const c = new T.Mesh(new T.CylinderGeometry(0.45, 0.45, 4.6, 14), mat.column);
            const [px, py] = across(p.off + Math.sign(p.off) * (PW / 2 - 1.2));
            c.position.set(px + Math.cos(ang) * k * 13, py + Math.sin(ang) * k * 13, top + 2.3);
            c.rotation.x = Math.PI / 2;
            add(c);
          }
        }
        box(0.25, 0.08, p.off, top + 4.7, mat.strip);   // a light line along the ceiling over the platform
      }
      // The tunnel mouths at each end: a dark ring round the bore (both tracks), or round each track's own tube.
      for (const end of [-1, 1]) for (const sd of st.island ? [-1, 1] : [0]) {
        const [px, py] = across(sd * half), r = st.island ? TUBE_R : BORE_R;
        const ring = new T.Mesh(new T.TorusGeometry(r, 0.35, 8, 32), mat.bed);
        ring.position.set(px + Math.cos(ang) * end * ST_LEN / 2, py + Math.sin(ang) * end * ST_LEN / 2, -d + (st.island ? 1.9 : 2.2));
        ring.rotation.set(0, Math.PI / 2, ang, "ZYX");
        add(ring);
      }
    }
    for (const o of this.tunnelMeshes) o.visible = this.under;
    if (this.tunnelMeshes.length) scene.add(...this.tunnelMeshes);
    m.triggerRepaint();
  }

  // ---- The tram's railway: each direction of each tram line (setTramTracks: one line per direction) gets its track
  // where the trams ride, on the line itself: a bed, sleepers and two rails (standard gauge), all in metres at every
  // zoom, over the street and its markings.
  private tramFC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
  /** Every tram line's tracks, [lon, lat] lines (MapView: the metro data's T lines). */
  setTramTracks(fc: GeoJSON.FeatureCollection) {
    this.tramFC = fc;
    (this.map?.getSource("x3d-tram") as GeoJSONSource | undefined)?.setData(fc);
  }
  private tramLayers(before: string | undefined, lat: number) {
    const m = this.map!, dark = this.dark;
    m.addSource("x3d-tram", { type: "geojson", data: this.tramFC, tolerance: 0 });
    const off = (o: number) => (o >= 0 ? metres(o, lat) : metres(["-", 0, -o], lat));
    const add = (id: string, width: number, offset: number, color: string, dash?: number[]) =>
      m.addLayer({ id, type: "line", source: "x3d-tram", minzoom: STREET_ZOOM,
        layout: { "line-join": "round", "line-cap": dash ? "butt" : "round" },
        paint: { "line-color": color, "line-width": metres(width, lat, 1), "line-offset": off(offset), ...(dash ? { "line-dasharray": dash } : {}) } } as never, before);
    const G = 1.435 / 2;
    add("x3d-tram-bed", 3, TRAM_TRACK, dark ? "#2f2c29" : "#c9c4bb");
    add("x3d-tram-sleepers", 2.4, TRAM_TRACK, dark ? "#4a4139" : "#a8998a", [0.1, 0.25]);
    add("x3d-tram-rail-1", 0.12, TRAM_TRACK + G, dark ? "#9aa1ab" : "#6f767f");
    add("x3d-tram-rail-2", 0.12, TRAM_TRACK - G, dark ? "#9aa1ab" : "#6f767f");
  }

  // ---- the MapLibre side: the street style under the labels ----
  private addStyle() {
    const m = this.map!, c = this.pal();
    if (!m.getSource(SOURCE)) return;   // another basemap: no street style, the models still draw
    const before = m.getStyle().layers.find(l => l.type === "symbol")?.id;
    // Real sizes, the same in metres at every zoom (map3d.ts metres()): carriageways by class, 3 m of pavement each
    // side, 35 cm kerbs, an 18 cm centre line.
    const lat = m.getCenter().lat;
    // The streets of Athens (athensRoads.ts), at their real widths from OpenStreetMap: drawn as a mapmaker draws
    // them, every pavement first, then every kerb, then every carriageway, then the markings, so at a junction the
    // surfaces join and no kerb or line crosses. Set once for the whole area and never rebuilt. The source cuts its
    // tiles once, at zoom 16, where the street is first drawn, and every closer zoom reuses them (overzoomed: no new
    // cut, only the tile's drawing again at that zoom), so a zoom in and out at street level does not cut the area
    // again (2026-11-09: it was 17, so crossing 17 cut every tile once more). The lines are simplified by 0.1 px of
    // a z16 tile (about 20 cm), unseen. Not tolerance 0: the source's worker keeps a tile at every zoom down the way
    // to the one asked for, and unsimplified each held every kerb of the area again. A buffer of 64 (60 m at z16)
    // holds the widest avenue across a tile's edge.
    m.addSource("x3d-roads", { type: "geojson", data: this.roadData ?? NO_ROADS, tolerance: 0.1, maxzoom: STREET_ZOOM, buffer: 64 });
    const kind = (k: string | string[]) => typeof k === "string" ? ["==", ["get", "kind"], k] : ["in", ["get", "kind"], ["literal", k]];
    m.addLayer({ id: "x3d-area", type: "fill", source: "x3d-roads", minzoom: STREET_ZOOM, filter: kind("area"),
      paint: { "fill-color": c.walk, "fill-antialias": true } } as never, before);
    this.streetLayers(before);
    // Lane and centre lines 15 cm, bus-lane lines 25 cm (yellow), zebra stripes 50 cm: every dash and stripe its own
    // short line (athensRoads.ts), so they keep their size in metres at every zoom; one layer per width (see Widths).
    // The edge lines (t 4) and stop lines (t 5, 40 cm) white and whole, as painted; lane and centre lines in the
    // street's marking colour.
    const toonMarks = this.look === "toon";
    if (MARKINGS) for (const [t, w] of [[0, 0.15], [4, 0.15], [5, 0.4], [2, 0.25], [3, 0.5]] as const) {
      const filter = t === 0 ? ["all", kind("mark"), ["in", ["get", "t"], ["literal", [0, 1]]]] : ["all", kind("mark"), ["==", ["get", "t"], t]];
      // Calibrated (Roads3D mockup): the edge line a soft guide, not a white wall; the zebras a little under full.
      const white = (t === 4 || t === 5) && !toonMarks;
      const color = t === 2 ? c.busMark : white ? "#ffffff" : c.mark;
      const op = t === 4 && white ? (this.dark ? 0.4 : 0.6) : t === 5 && white ? (this.dark ? 0.7 : 0.85)
        : t === 3 ? c.markOpacity * (this.dark ? 0.8 : 0.9) : white ? 1 : c.markOpacity;
      m.addLayer({ id: `x3d-mark-${t}`, type: "line", source: "x3d-roads", minzoom: STREET_ZOOM + 0.5, filter,
        layout: { "line-join": "round", "line-cap": "butt" },
        paint: { "line-color": color, "line-width": metres(w, lat),
          "line-opacity": ["interpolate", ["linear"], ["zoom"], STREET_ZOOM + 0.5, 0, STREET_ZOOM + 1.2, op] } } as never, before);
    }
    // The turn arrows, white, and ΛΕΩΦΟΡΕΙΑ down the bus lanes, in the lane's yellow: painted flat on the street,
    // their size in metres (letters 1.5 m).
    if (MARKINGS) m.addLayer({ id: "x3d-arrows", type: "fill", source: "x3d-roads", minzoom: STREET_ZOOM + 0.5, filter: kind("arrow"),
      paint: { "fill-color": toonMarks ? c.mark : "#ffffff", "fill-antialias": true,
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], STREET_ZOOM + 0.5, 0, STREET_ZOOM + 1.2, toonMarks ? c.markOpacity : this.dark ? 0.72 : 0.9] } } as never, before);
    if (MARKINGS) m.addLayer({ id: "x3d-busword", type: "symbol", source: "x3d-roads", minzoom: 17.5, filter: kind("busword"),
      layout: { "text-field": "ΛΕΩΦΟΡΕΙΑ", "text-font": ["Noto Sans Bold"], "text-size": metres(1.5, lat), "text-letter-spacing": 0.12,
        "text-rotate": ["get", "rot"], "text-rotation-alignment": "map", "text-pitch-alignment": "map",
        "text-allow-overlap": true, "text-ignore-placement": true, "symbol-placement": "point" },
      paint: { "text-color": c.busMark, "text-opacity": ["interpolate", ["linear"], ["zoom"], 17.5, 0, 18.2, 0.9] } } as never, before);
    this.tramLayers(before, lat);
    m.addSource("x3d-pools", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    m.addLayer({ id: "x3d-pools", type: "circle", source: "x3d-pools", minzoom: STREET_ZOOM,
      paint: { "circle-color": c.pool, "circle-blur": 1, "circle-opacity": this.dark ? 0.26 : 0, "circle-pitch-alignment": "map",
        "circle-radius": metres(4.5, lat, 2) } } as never, before);
    const toon = this.look === "toon";
    const H = ["coalesce", ["get", "render_height"], 10], B = ["coalesce", ["get", "render_min_height"], 0];
    if (toon) {
      // Walls with rows of windows (a pattern up and along each wall), and a roof on top: a slab half a metre thick,
      // terracotta tiles on the low houses, a concrete roof on the blocks (roofTile).
      if (!m.hasImage("x3d-windows")) m.addImage("x3d-windows", windowTile(), { pixelRatio: 2 });
      if (!m.hasImage("x3d-roof-tiles")) m.addImage("x3d-roof-tiles", roofTile(false), { pixelRatio: 2 });
      if (!m.hasImage("x3d-roof-flat")) m.addImage("x3d-roof-flat", roofTile(true), { pixelRatio: 2 });
      m.addLayer({ id: "x3d-buildings", type: "fill-extrusion", source: SOURCE, "source-layer": "building", minzoom: BUILD_ZOOM, filter: NOT_MODELLED,
        paint: { "fill-extrusion-pattern": "x3d-windows", "fill-extrusion-height": H, "fill-extrusion-base": B, "fill-extrusion-opacity": 1 } } as never, before);
      m.addLayer({ id: "x3d-roofs", type: "fill-extrusion", source: SOURCE, "source-layer": "building", minzoom: BUILD_ZOOM, filter: NOT_MODELLED,
        paint: { "fill-extrusion-pattern": ["step", H, "x3d-roof-tiles", TOON.roofTall, "x3d-roof-flat"],
          "fill-extrusion-base": H, "fill-extrusion-height": ["+", H, 0.6], "fill-extrusion-opacity": 1 } } as never, before);
    } else m.addLayer({ id: "x3d-buildings", type: "fill-extrusion", source: SOURCE, "source-layer": "building", minzoom: BUILD_ZOOM, filter: NOT_MODELLED,
      // Three shades, picked by the building's id, so a block reads as separate buildings; taller ones a little lighter.
      paint: { "fill-extrusion-color": ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 10],
        0, ["match", ["%", ["coalesce", ["to-number", ["id"]], 0], 3], 0, c.bldA, 1, c.bldB, c.bldC], 40, c.bldTop],
        "fill-extrusion-vertical-gradient": true,
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 10],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0], "fill-extrusion-opacity": 1 } } as never, before);
    this.lanes(true);
    // Underground was on: again on the street style just added. Not forgetting what was hidden before: on the same style
    // (the 3D added again after its code loaded) those layers are still hidden by us, and forgotten they stayed hidden
    // when the metro mode went off (the map blank). A new style forgets them in styleGone.
    if (this.under) { this.under = false; this.setUnder(true); }
    // Walls lit from one side and shaded on the other (the light of the extrusions), parks soft green, water blue.
    this.restyledPaint = [];
    const repaint = (id: string, prop: string, v: unknown) => {
      this.restyledPaint.push([id, prop, m.getPaintProperty(id, prop as never)]);
      m.setPaintProperty(id, prop as never, v as never);
    };
    if (this.light3d === undefined) this.light3d = m.getLight() ?? null;
    m.setLight(toon ? { anchor: "map", position: [1.3, 200, 40], color: "#fff3dc", intensity: 0.38 }
      : { anchor: "map", position: [1.4, 210, 35], color: "#ffffff", intensity: this.dark ? 0.3 : 0.42 });
    for (const l of m.getStyle().layers) {
      const sl = (l as { "source-layer"?: string })["source-layer"];
      // «Μινιατούρα»: dark labels on a light halo (the base map's own may be the night's), the ground all sand.
      if (toon && l.type === "symbol" && (l as { source?: string }).source === SOURCE) {
        repaint(l.id, "text-color", TOON.text);
        repaint(l.id, "text-halo-color", TOON.halo);
        continue;
      }
      // The street names over the modelled streets: light on a halo of the asphalt (dark), dark on white (light).
      if (!toon && l.type === "symbol" && sl === "transportation_name") {
        repaint(l.id, "text-color", this.dark ? "#e8eaee" : "#2c3038");
        repaint(l.id, "text-halo-color", this.dark ? "#2a2c33" : "#ffffff");
        repaint(l.id, "text-halo-width", 1.6);
        continue;
      }
      // ...and its roads (outside the modelled streets, or further out) in the toy town's greys, not the night's.
      if (toon && l.type === "line" && sl === "transportation") {
        repaint(l.id, "line-color", /rail|transit/.test(l.id) ? TOON.rail : /casing/.test(l.id) ? TOON.casing : TOON.road);
        continue;
      }
      // Under the street zoom, the base map's roads are drawn wider in 3D (up to 2.4 times at STREET_ZOOM, where the
      // modelled streets take over at their real widths): seen tilted, the base map's hairlines read as no map at all.
      if (l.type === "line" && sl === "transportation" && !l.id.startsWith("x3d-") && !/rail|transit/.test(l.id)) {
        const w = widenBy(m.getPaintProperty(l.id, "line-width"), z => z <= 12 ? 1 : z >= STREET_ZOOM ? 2.4 : z <= 14 ? 1 + (0.6 * (z - 12)) / 2 : 1.6 + (0.8 * (z - 14)) / (STREET_ZOOM - 14));
        if (w) repaint(l.id, "line-width", w);
        continue;
      }
      if (l.type !== "fill" || !sl) continue;
      if (sl === "park" || (sl === "landcover" && /grass|wood|park|garden/.test(l.id))) repaint(l.id, "fill-color", c.park);
      else if (sl === "water") repaint(l.id, "fill-color", c.water);
      else if (toon && (sl === "landuse" || sl === "landcover" || sl === "aeroway")) repaint(l.id, "fill-color", TOON.land);
      // The base map's flat footprints go: drawn after the extrusions, they would lie over the roofs as blank floors.
      else if (sl === "building" && !l.id.startsWith("x3d-")) repaint(l.id, "fill-opacity", ["step", ["zoom"], 1, BUILD_ZOOM, 0]);
    }
    const bg = m.getStyle().layers.find(l => l.type === "background");
    if (bg) {
      this.ground3d = [bg.id, m.getPaintProperty(bg.id, "background-color")];
      m.setPaintProperty(bg.id, "background-color", toon ? TOON.land : PALETTE[this.dark ? "dark" : "light"].land);
    }
    if (this.isQuiet) this.quiet(true);   // returns at once if it already ran on this style
    // In Athens, the base map's own roads, bridges, tunnels, rails and tram markings go while the street style is
    // shown: one road drawing, not two (the app draws the lines of the trains itself). Outside it they stay: the rest
    // of the map is not modelled.
    this.hidden = [];
    for (const l of m.getStyle().layers) {
      const sl = (l as { "source-layer"?: string })["source-layer"];
      // ...and the road-number badges (ΕΟ91 and the like), which clutter a street seen up close.
      if ((l.type === "line" && sl === "transportation" && !l.id.startsWith("x3d-")) || (l.type === "symbol" && /shield/.test(l.id))) {
        this.hidden.push([l.id, l.maxzoom ?? 24, m.getFilter(l.id) ?? null]);
      }
    }
    this.inside = null;
    this.cover();
    // A sky and a haze towards the horizon, so the tilted city fades into the distance instead of ending.
    if (this.sky === undefined) this.sky = m.getSky() ?? null;
    m.setSky(toon
      ? { "sky-color": "#bfdcf0", "horizon-color": "#f6eedb", "fog-color": "#f1e5c8", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.7, "fog-ground-blend": 0.5 }
      : this.dark
      ? { "sky-color": "#0f1218", "horizon-color": "#2a2f3a", "fog-color": "#22252d", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.7, "fog-ground-blend": 0.55 }
      : { "sky-color": "#bcd3ee", "horizon-color": "#eef2f7", "fog-color": "#e8ebef", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.7, "fog-ground-blend": 0.55 });
    this.poolsAt = "";
    this.built = null;   // a new style: its street source is empty, build at once
    m.on("moveend", this.onMove);
  }

  /** The streets around the view (the tiles within ROAD_REACH degrees), once loaded: into the street source, and the
   *  carriageways to the snapping. Again after a move that needs other tiles (refresh); the far ones let go. */
  private roadKeys = "";
  private roadBusy = false;
  private roadData: string | GeoJSON.FeatureCollection | null = null;   // the street source's data (a Blob's address)
  private async streets() {
    const m = this.map, ix = await preloadRoads();
    if (!ix || !this.on || !m || this.roadBusy) return;
    // Zoomed out, the streets are not drawn: their data leaves the map (the carriageways stay, for the snapping), and
    // comes back from the decoded tiles when the view is close again.
    if (m.getZoom() < STREET_ZOOM - 1) {
      if (!this.roadKeys) return;
      this.roadKeys = "";
      (m.getSource("x3d-roads") as GeoJSONSource | undefined)?.setData(NO_ROADS);
      const old = this.roadData;
      this.roadData = null;
      if (typeof old === "string") setTimeout(() => URL.revokeObjectURL(old), 10_000);
      return;
    }
    const want = tilesNear(ix, m.getCenter().toArray() as LngLat, ROAD_REACH).sort(), key = want.join(",");
    if (key === this.roadKeys && this.athens) { this.streetLayers(); return; }
    this.roadBusy = true;
    try {
      const parts = (await Promise.all(want.map(k => roadTile(ix, k)))).filter((x): x is AthensRoads => !!x);
      if (!this.on || this.map !== m) return;
      if (roadTiles.size > ROAD_KEEP) for (const k of [...roadTiles.keys()]) if (!want.includes(k)) { roadTiles.delete(k); pageTiles.delete(k); }   // memory: the far ones go
      this.roadKeys = key;
      const data = mergeRoads(ix, parts);
      this.athens = data;
      this.roads = new RoadIndex(data.roads, data.origin[0], data.origin[1]);
      const fc = await roadFeatures(want);
      if (!this.on || this.map !== m) { if (typeof fc === "string") URL.revokeObjectURL(fc); return; }
      // The old file's address goes once the map has read the new one (a restyle reads the current one again).
      const old = this.roadData;
      this.roadData = fc;
      (m.getSource("x3d-roads") as GeoJSONSource | undefined)?.setData(fc);
      if (typeof old === "string") setTimeout(() => URL.revokeObjectURL(old), 10_000);
      this.streetLayers();
      this.inside = null;
      this.cover();
      this.poolsAt = "";
      this.built = null;
      this.roadBusy = false;
      this.refresh();
      this.onRoads?.();
    } finally { this.roadBusy = false; }
  }

  // The base map's roads hidden from STREET_ZOOM in Athens, shown everywhere else.
  // The base map's roads give way to the modelled streets only inside the area the street file covers, and only
  // from STREET_ZOOM: past its edge (the Α6, the coast road) the base map still draws them. A road crossing the edge
  // stays whole ("within" takes a line only when all of it is inside).
  private cover() {
    const m = this.map;
    if (!m || !this.hidden.length || !this.athens) return;
    if (this.inside) return;   // set once per style: the filter does the rest
    this.inside = true;
    const [w, s, e, n] = this.athens.box;
    const box = { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] };
    for (const [id, max, filter] of this.hidden) {
      const l = m.getLayer(id);
      if (!l) continue;
      const own = filter == null ? true : asExpression(filter);
      // A filter this code cannot read: the old way, hidden everywhere close in.
      if (own === null) { m.setLayerZoomRange(id, l.minzoom ?? 0, Math.min(max, STREET_ZOOM)); continue; }
      m.setFilter(id, ["all", own, ["any", ["<", ["zoom"], STREET_ZOOM], ["!", ["within", box]]]] as never);
    }
  }

  // The followed routes, close in: a bus lane painted on the asphalt in the line's colour, about one lane (3.4 m)
  // wide in real metres, flat on the road, with no casing and no arrows. Further out, and in 2D, the lines are as MapView draws them; off again, they go back.
  private saved = new Map<string, unknown>();
  private hidden: [string, number, unknown][] = [];   // [layer, its own maxzoom, its own filter]
  private ground3d: [string, unknown] | null = null;   // the base map's background colour before 3D
  private restyledPaint: [string, string, unknown][] = [];   // base map paint changed for 3D: [layer, property, before]
  private light3d: unknown = undefined;                         // the map's light before 3D
  // Quiet (while riding behind a vehicle): the base map's labels and icons but street names go, and its park and
  // land-use colours; [layer, property, value before].
  private quieted: [string, "visibility" | "fill-opacity", unknown][] = [];
  private isQuiet = false;

  quiet(on: boolean) {
    this.isQuiet = on;
    const m = this.map;
    if (!m || !this.styleReady) return;
    if (!on) {
      for (const [id, prop, v] of this.quieted) if (m.getLayer(id)) {
        if (prop === "visibility") m.setLayoutProperty(id, "visibility", (v ?? "visible") as never);
        else m.setPaintProperty(id, "fill-opacity", v as never);
      }
      this.quieted = [];
      return;
    }
    if (this.quieted.length) return;
    for (const l of m.getStyle().layers) {
      const sl = (l as { "source-layer"?: string })["source-layer"];
      if (!sl || l.id.startsWith("x3d-")) continue;   // only the base map's own layers
      if (l.type === "symbol" && sl !== "transportation_name") {
        this.quieted.push([l.id, "visibility", m.getLayoutProperty(l.id, "visibility")]);
        m.setLayoutProperty(l.id, "visibility", "none");
      } else if (l.type === "fill" && ["landcover", "landuse", "park"].includes(sl)) {
        this.quieted.push([l.id, "fill-opacity", m.getPaintProperty(l.id, "fill-opacity")]);
        m.setPaintProperty(l.id, "fill-opacity", 0);
      }
    }
  }
  private lanes(on: boolean) {
    const m = this.map;
    if (!m) return;
    const near = (far: unknown, close: unknown) => ["step", ["zoom"], far, STREET_ZOOM, close];
    // Metres to pixels by zoom (Athens' latitude): 3.4 m is ~4 px at z17.2 and ~29 px at z20.
    // 2.9 m at every zoom (3.5 m with its white edges: inside a 3.25 m lane, kerb to lane line); never thinner than
    // the 2D line was.
    const lat = m.getCenter().lat;
    const width = (far: number) => metres(2.9, lat, far);
    // A value, or a function of the layer's own value (saved before the 3D mode changed it).
    const paint: Record<string, Record<string, unknown>> = {
      // No lane offset yet: OASA's shapes are not snapped to the roads, and a shift sideways would only widen the gap.
      // Solid close in: two directions on one street (a day and a night variant) overlap without darker seams.
      routes: { "line-width": width(4), "line-opacity": near(0.6, 1), "line-offset": near(3, 0) },
      highlight: { "line-width": width(6), "line-opacity": near(1, 1), "line-offset": near(3, 0) },
      // The vehicles' trails follow OASA's shapes, not the roads: close in they would cut across lanes and
      // buildings, and the moving models show the motion anyway.
      ...Object.fromEntries(["trails-city", "trails-line"].map(id =>
        [id, { "line-opacity": (orig: unknown) => near(orig ?? 1, 0) }])),
      "highlight-casing": { "line-opacity": near(0.9, 0), "line-offset": near(3, 0) },
      "route-arrows": { "icon-opacity": near(1, 0) },
      "highlight-arrows": { "icon-opacity": near(1, 0) },
    };
    for (const [id, props] of Object.entries(paint)) {
      if (!m.getLayer(id)) continue;
      for (const [k, v] of Object.entries(props)) {
        const key = `${id}|${k}`;
        if (on) {
          if (!this.saved.has(key)) this.saved.set(key, m.getPaintProperty(id, k as never));
          m.setPaintProperty(id, k as never, (typeof v === "function" ? v(this.saved.get(key)) : v) as never);
        } else if (this.saved.has(key)) {
          m.setPaintProperty(id, k as never, this.saved.get(key) as never);
        }
      }
    }
    if (!on) { this.saved.clear(); return; }
    // A white edge along each painted lane (0.3 m each side), under it, like a road marking.
    const edge = (id: string, source: string, below: string) => {
      if (!m.getSource(source) || !m.getLayer(below) || m.getLayer(id)) return;
      // Born hidden while a chase is on (only the chased vehicle's own route, the highlight, shows then).
      m.addLayer({ id, type: "line", source, minzoom: STREET_ZOOM,
        layout: { "line-join": "round", "line-cap": "round", visibility: this.isQuiet && id === "x3d-route-edge" ? "none" : "visible" },
        paint: { "line-color": this.dark ? "#e9ecf1" : "#ffffff", "line-width": metres(3.5, lat, 6), "line-opacity": 0.95 } } as never, below);
    };
    edge("x3d-route-edge", "routes", "routes");
    edge("x3d-hl-edge", "highlight", "highlight");
  }

  // The street lights near the view: one every 32 m, sides alternating, along the streets wide enough to have them.
  // The pole stands 60 cm past the kerb, the lamp head hangs 1.2 m in over the road, and at night the pool of light
  // (x3d-pools) lies under the head. A pole that would stand on another road (a crossing, the other half of an
  // avenue) is left out.
  private pools() {
    const m = this.map, A = this.athens, idx = this.roads;
    if (!m || m.getZoom() < STREET_ZOOM || !m.getSource("x3d-pools") || !A || !idx) return;
    // Built again only when the view has moved well away from the last build (40% of its reach): rebuilding on every
    // small move made the city flicker.
    const c0 = m.getCenter(), lat0 = c0.lat, mLat = 1 / 110540, mLon = 1 / (111320 * Math.cos((lat0 * Math.PI) / 180));
    if (this.poolsAt && this.built) {
      const moved = Math.hypot((c0.lng - this.built.at[0]) / mLon, (c0.lat - this.built.at[1]) / mLat);
      if (moved < this.built.reach * 0.4) return;
    }
    this.poolsAt = "built";
    const reach = this.reach(900);
    this.built = { at: [c0.lng, c0.lat], reach };
    const bw = c0.lng - reach * mLon, be = c0.lng + reach * mLon, bs = lat0 - reach * mLat, bn = lat0 + reach * mLat;
    const out: GeoJSON.Feature[] = [], lamps: { pole: LngLat; head: LngLat }[] = [];
    // No two poles closer than GAP metres: a street is several ways, each spacing its own lamps from its start, so where
    // two meet (or two halves of an avenue run side by side) poles would stand in pairs. A grid of GAP cells to check.
    const GAP = 16, grid = new Map<string, LngLat[]>();
    const cell = (p: LngLat) => [Math.floor(p[0] / mLon / GAP), Math.floor(p[1] / mLat / GAP)];
    const crowded = (p: LngLat) => {
      const [gx, gy] = cell(p);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++)
        for (const q of grid.get(`${gx + i},${gy + j}`) ?? []) if (Math.hypot((q[0] - p[0]) / mLon, (q[1] - p[1]) / mLat) < GAP) return true;
      return false;
    };
    for (const r of A.streets) {
      if (r.half < 3.5 || r.pave < 1.5) continue;   // no lamps along narrow lanes, or without a pavement for the pole
      if (r.box[2] < bw || r.box[0] > be || r.box[3] < bs || r.box[1] > bn) continue;
      const cs = r.coords, half = r.half;
      let k = 0, acc = 0;
      for (let i = 1; i < cs.length; i++) {
        const [x0, y0] = cs[i - 1], [x1, y1] = cs[i];
        const dx = (x1 - x0) / mLon, dy = (y1 - y0) / mLat, L = Math.hypot(dx, dy);
        if (!L) continue;
        for (let s = (32 - acc) % 32; s < L; s += 32) {
          const t = s / L, side = k++ % 2 ? 1 : -1;
          const cx = x0 + (x1 - x0) * t, cy = y0 + (y1 - y0) * t, nx = (-dy / L) * side, ny = (dx / L) * side;
          const at = (d: number): LngLat => [cx + nx * d * mLon, cy + ny * d * mLat];
          if (Math.hypot((cx - c0.lng) / mLon, (cy - lat0) / mLat) > reach) continue;   // lamps only where they can be seen
          // The pole 40 cm past the kerb (clear of the buildings, which the pavement's mapped width does not always
          // leave room for), its head 1 m out over the road.
          const head = at(half - 1.0), pole = at(half + 0.4);
          if (crowded(pole) || idx.onRoad(pole, 0.3)) continue;
          const [gx, gy] = cell(pole), ck = `${gx},${gy}`;
          (grid.get(ck) ?? grid.set(ck, []).get(ck)!).push(pole);
          lamps.push({ pole, head });
          out.push({ type: "Feature", geometry: { type: "Point", coordinates: head }, properties: {} });
        }
        acc = (acc + L) % 32;
      }
    }
    (m.getSource("x3d-pools") as GeoJSONSource).setData({ type: "FeatureCollection", features: this.dark ? out : [] });
    this.lamps = lamps;
    this.buildLamps();
    this.stopsNear = this.nearStops([c0.lng, c0.lat], Math.min(reach, 600));
    this.buildStops();
    this.buildBoards();
  }
  private poolsIdle = 0;

  /** How far from the centre the view reaches (to its farthest screen corner, a fifth more), in metres, within
   *  200 m and `max`: what is built beyond it would not be seen. */
  private reach(max: number): number {
    const m = this.map!, c = m.getCenter().toArray() as LngLat, cv = m.getCanvas();
    const [x0, y0] = this.ref ? this.local(c) : [0, 0];
    let r = 0;
    for (const pt of [[0, 0], [cv.clientWidth, 0], [0, cv.clientHeight], [cv.clientWidth, cv.clientHeight]] as [number, number][]) {
      const p = m.unproject(pt).toArray() as LngLat;
      const [x, y] = this.ref ? this.local(p) : [(p[0] - c[0]) * 111320 * Math.cos((c[1] * Math.PI) / 180), (p[1] - c[1]) * 110540];
      r = Math.max(r, Math.hypot(x - x0, y - y0));
    }
    return Math.min(max, Math.max(200, r * 1.2));
  }

  /** Every bus stop, [lon, lat]: those near the view are built (pools()). */
  // The metro's street entrances (public/entrances.json, or the admin's edits): sign, stairwell and lift models.
  private entrances = (() => { const e = new EntranceModels(); e.onChange = () => this.map?.triggerRepaint(); return e; })();
  // Σύνταγμα's own entrances (entrances.json) give way to the landmark's: two stairwells in the wall under Αμαλίας,
  // either side of the great steps, its lift at the wall's foot, and the stairs across the street on the Garden's
  // pavement (syntagmaGround.squareEntrances), built from the same models.
  setEntrances(list: Entrance3D[]) {
    const own = list.filter(e => MODELLED_ENTRANCES.includes(e.id));
    const rest = list.filter(e => !MODELLED_ENTRANCES.includes(e.id));
    const stairs = own.find(e => e.kind !== "elevator"), lift = own.find(e => e.kind === "elevator") ?? stairs;
    const square = own.length ? squareEntrances().flatMap((w, i) => {
      const base = w.kind === "elevator" ? lift : stairs;
      return base ? [{ ...base, kind: w.kind, id: `syntagma-square-${i + 1}`, at: [w.at[1], w.at[0]] as [number, number], heading: w.heading, elevation: w.elevation, signSide: w.signSide }] : [];
    }) : [];
    this.entrances.set([...rest, ...square]);
  }
  // Landmarks modelled by hand (landmarks/): Σύνταγμα and the Βουλή. Their own buildings leave the base map's extrusions.
  private landmarks = (() => { const l = new Landmarks(); l.onChange = () => this.map?.triggerRepaint(); return l; })();
  setClosedStations(names: string[]) { this.entrances.setClosed(names); }

  setStops(stops: LngLat[]) {
    this.stopsAll = stops;
    this.built = null;   // build again with them
    this.pools();
  }

  /** Where the 3D stop at `p` stands: its shelter on a wide street, else its pole (or `p` before the roads load). */
  stopAt(p: LngLat): LngLat {
    const idx = this.roads;
    if (!idx) return p;
    const h = idx.nearest(p, 25);
    return (h && h.half >= 4.5 ? idx.kerb(p, 1.9)?.at : null) ?? idx.kerb(p, 0.4)?.at ?? p;
  }

  // The stops within reach, at the kerb of their road (a stop's point is often on the pavement or the carriageway's
  // edge): the pole 40 cm past the kerb, the shelter 1.5 m past it, both along the road.
  private nearStops(c0: LngLat, reach: number) {
    const idx = this.roads, out: typeof this.stopsNear = [];
    if (!idx) return out;
    const mLat = 1 / 110540, mLon = 1 / (111320 * Math.cos((c0[1] * Math.PI) / 180));
    for (const p of this.stopsAll) {
      if (Math.abs(p[0] - c0[0]) > reach * mLon || Math.abs(p[1] - c0[1]) > reach * mLat) continue;
      if (Math.hypot((p[0] - c0[0]) / mLon, (p[1] - c0[1]) / mLat) > reach) continue;
      const k = idx.kerb(p, 0.4);
      if (!k) continue;
      const h = idx.nearest(p, 25);
      const wide = !!h && h.half >= 4.5;
      const sh = wide ? idx.kerb(p, 1.5) : null;   // the shelter close to the kerb: off the buildings' fronts
      out.push({ pole: k.at, shelter: sh?.at ?? null, angle: k.angle });
      if (out.length >= 160) break;
    }
    return out;
  }

  // A stop under the mouse (MapView): its pole and shelter lit up in the accent, a ring round them on the pavement, so
  // the whole stop reads as the thing to tap.
  private stopGlow: Three.Group | null = null;
  hoverStop(at: LngLat | null) {
    const T = this.T, scene = this.scene;
    if (!T || !scene || !this.ref) return;
    let hit: (typeof this.stopsNear)[number] | null = null;
    if (at) {
      let best = 25;
      for (const s of this.stopsNear) {
        const [x, y] = this.local(s.pole), [ax, ay] = this.local(at), d = Math.hypot(x - ax, y - ay);
        if (d < best) { best = d; hit = s; }
      }
    }
    if (!hit) { if (this.stopGlow) this.stopGlow.visible = false; this.map?.triggerRepaint(); return; }
    if (!this.stopGlow) {
      const g = new T.Group(), accent = new T.Color(this.dark ? "#5b9dff" : "#1f5fc8");
      const glow = new T.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.22, depthWrite: false });
      const box = new T.Mesh(new T.BoxGeometry(4.2, 2.0, 3.0), glow);
      box.position.set(0, 0, 1.5);
      box.name = "box";
      const ring = new T.Mesh(new T.RingGeometry(2.6, 3.0, 40), new T.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.9, depthWrite: false }));
      ring.position.z = 0.08;
      g.add(box, ring);
      g.traverse(o => { o.frustumCulled = false; });
      this.stopGlow = g;
      scene.add(g);
    }
    const [x, y] = this.local(hit.shelter ?? hit.pole);
    this.stopGlow.position.set(x, y, 0);
    this.stopGlow.rotation.z = hit.angle;
    this.stopGlow.getObjectByName("box")!.visible = !!hit.shelter;
    this.stopGlow.visible = !this.under;
    this.map?.triggerRepaint();
  }

  private buildStops() {
    const T = this.T, scene = this.scene;
    for (const mesh of this.stopMeshes) {
      mesh.removeFromParent(); mesh.geometry.dispose();
      for (const mat of ([] as Three.Material[]).concat(mesh.material)) { (mat as Three.MeshLambertMaterial).map?.dispose(); mat.dispose(); }
      mesh.dispose();
    }
    this.stopMeshes = [];
    if (!T || !scene || !this.ref || !this.stopsNear.length) return;
    const all = this.stopsNear, n = all.length, sheltered = all.filter(s => s.shelter), ns = Math.max(1, sheltered.length);
    const metal = new T.MeshLambertMaterial({ color: this.dark ? 0x3a3f48 : 0x8e959e });
    // The pole and its sign: OASA blue, white face for the bus glyph, at 2.3-2.9 m, square to the road.
    const poleG = new T.CylinderGeometry(0.06, 0.07, 3.4, 8); poleG.rotateX(Math.PI / 2); poleG.translate(0, 0, 1.7);
    const signG = new T.BoxGeometry(0.16, 0.75, 0.9); signG.translate(0, 0, 2.95);   // thicker than the pole: it hides it
    const poles = new T.InstancedMesh(poleG, metal, n);
    // The sign: OASA blue with a white bus and «ΣΤΑΣΗ» on both faces (the back drawn mirrored, so it reads too), lit
    // from within as the real ones are at night.
    const face = (back: boolean) => {
      const c = sideCanvas(200, 240, back, x => {
      x.fillStyle = "#1f5fc8"; x.fillRect(0, 0, 200, 240);
      x.strokeStyle = "#ffffff"; x.lineWidth = 6; x.strokeRect(10, 10, 180, 220);
      // The bus: a white body, two blue windows, wheels.
      x.fillStyle = "#ffffff";
      x.beginPath(); x.roundRect(44, 40, 112, 110, 16); x.fill();
      x.fillStyle = "#1f5fc8";
      x.beginPath(); x.roundRect(56, 56, 40, 40, 6); x.fill();
      x.beginPath(); x.roundRect(104, 56, 40, 40, 6); x.fill();
      x.fillRect(56, 112, 88, 8);
      x.fillStyle = "#ffffff";
      for (const wx of [64, 136]) { x.beginPath(); x.arc(wx, 156, 12, 0, Math.PI * 2); x.fill(); }
      x.font = "bold 36px Commissioner, Arial, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText("ΣΤΑΣΗ", 100, 202);
      });
      const t = new T.CanvasTexture(c);
      t.colorSpace = T.SRGBColorSpace;
      t.anisotropy = 8;
      return new T.MeshLambertMaterial({ map: t, emissive: this.dark ? 0x9fb4e0 : 0x222222, emissiveMap: t });
    };
    const blue = new T.MeshLambertMaterial({ color: 0x1f5fc8, emissive: this.dark ? 0x1a3f8a : 0x000000 });
    // Box faces: +x, -x (the two faces of the sign), then the edges.
    const signs = new T.InstancedMesh(signG, [face(false), face(true), blue, blue, blue, blue], n);
    // The shelter: a roof, a glass back, two posts and a bench, 3.2 m along the road.
    const roofG = new T.BoxGeometry(3.3, 1.5, 0.08); roofG.translate(0, 0, 2.5);
    const backG = new T.BoxGeometry(3.2, 0.04, 2.2); backG.translate(0, 0.62, 1.25);
    const postG = new T.BoxGeometry(0.08, 0.08, 2.5); postG.translate(0, 0, 1.25);
    const benchG = new T.BoxGeometry(2.2, 0.4, 0.06); benchG.translate(0, 0.35, 0.48);
    const roofs = new T.InstancedMesh(roofG, new T.MeshLambertMaterial({ color: this.dark ? 0x9aa3b2 : 0xc9ced6, emissive: this.dark ? 0x3b4250 : 0x000000 }), ns);
    const backs = new T.InstancedMesh(backG, new T.MeshLambertMaterial({ color: this.dark ? 0x9cc4f5 : 0xb8d4f2, emissive: this.dark ? 0x22406a : 0x000000,
      transparent: true, opacity: 0.45, depthWrite: false }), ns);
    const posts = new T.InstancedMesh(postG, metal.clone(), ns * 2);
    const benches = new T.InstancedMesh(benchG, new T.MeshLambertMaterial({ color: this.dark ? 0x5b4636 : 0x8a6a4f }), ns);
    // The side panel at one end of the shelter, across it: a backlit poster (public/ads) in a metal frame, on both
    // faces (each drawn to read from its side), lit softly by day and brightly at night, as the real ones are.
    const adG = new T.BoxGeometry(0.1, 1.34, 1.42); adG.translate(1.62, 0, 0.55 + 0.71);
    const adFace = (back: boolean) => {
      const c = sideCanvas(512, 512, back, x => {
        x.fillStyle = "#ffffff"; x.fillRect(0, 0, 512, 512);
        if (adImage) x.drawImage(adImage, 10, 10, 492, 492);
      });
      const t = new T.CanvasTexture(c);
      t.colorSpace = T.SRGBColorSpace;
      t.anisotropy = 8;
      return new T.MeshLambertMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: this.dark ? 0.85 : 0.22 });
    };
    const frame = new T.MeshLambertMaterial({ color: this.dark ? 0x2b2e35 : 0x6f757e });
    const ads = new T.InstancedMesh(adG, [adFace(false), adFace(true), frame, frame, frame, frame], adImage ? ns : 1);
    if (!adImage) { ads.count = 0; void loadAd(this.base).then(img => { if (img && this.on) this.buildStops(); }); }
    const o = new T.Object3D();
    const put = (mesh: Three.InstancedMesh, i: number, x: number, y: number, ang: number) => {
      o.position.set(x, y, 0); o.rotation.set(0, 0, ang); o.scale.set(1, 1, 1); o.updateMatrix(); mesh.setMatrixAt(i, o.matrix);
    };
    all.forEach((s, i) => {
      const [x, y] = this.local(s.pole);
      put(poles, i, x, y, s.angle); put(signs, i, x, y, s.angle);
    });
    sheltered.forEach((s, i) => {
      const [x, y] = this.local(s.shelter!), [px, py] = this.local(s.pole);
      // The glass back faces away from the road: the side away from the pole.
      const away = Math.atan2(y - py, x - px), ang = s.angle, flip = Math.cos(away - (ang + Math.PI / 2)) < 0 ? Math.PI : 0;
      put(roofs, i, x, y, ang + flip); put(backs, i, x, y, ang + flip); put(benches, i, x, y, ang + flip);
      if (adImage) put(ads, i, x, y, ang + flip);
      const ux = Math.cos(ang) * 1.55, uy = Math.sin(ang) * 1.55;
      put(posts, i * 2, x + ux, y + uy, ang); put(posts, i * 2 + 1, x - ux, y - uy, ang);
    });
    if (!sheltered.length) for (const mesh of [roofs, backs, posts, benches, ads]) mesh.count = 0;
    this.stopMeshes = [poles, signs, roofs, backs, posts, benches, ads];
    for (const mesh of this.stopMeshes) { mesh.castShadow = mesh !== backs; mesh.frustumCulled = false; }
    scene.add(...this.stopMeshes);
    this.map?.triggerRepaint();
  }

  /** The arrival screens: up to a few stops, each with its next buses ([line, where to, minutes]). */
  setBoards(boards: Board[]) {
    this.boards = boards;
    this.buildBoards();
  }

  // A screen under the stop's sign, square to the road as the sign is: black, with the rows in amber LED letters on
  // both faces (the back mirrored), lit from within.
  private buildBoards() {
    const T = this.T, scene = this.scene;
    for (const mesh of this.boardMeshes) {
      mesh.removeFromParent(); mesh.geometry.dispose();
      for (const mat of ([] as Three.Material[]).concat(mesh.material)) { (mat as Three.MeshLambertMaterial).map?.dispose(); mat.dispose(); }
    }
    this.boardMeshes = [];
    const idx = this.roads;
    if (!T || !scene || !this.ref || !idx || !this.boards.length) return;
    const geom = new T.BoxGeometry(0.16, 1.5, 0.62); geom.translate(0, 0, 2.1);
    const black = new T.MeshLambertMaterial({ color: 0x0b0b0c });
    for (const b of this.boards) {
      const k = idx.kerb(b.at, 0.4);
      if (!k) continue;
      const face = (back: boolean) => {
        const c = sideCanvas(480, 200, back, x => {
        x.fillStyle = "#070708"; x.fillRect(0, 0, 480, 200);
        x.fillStyle = "#ffc642"; x.shadowColor = "#ff9d00"; x.shadowBlur = 10;
        x.font = "bold 44px 'Courier New', monospace"; x.textBaseline = "middle";
        const rows = b.rows.length ? b.rows.slice(0, 3) : [["", "ΚΑΝΕΝΑ ΤΩΡΑ", ""]];
        rows.forEach(([line, to, min], i) => {
          const y = 200 / (rows.length + 1) * (i + 1);
          x.textAlign = "left"; x.fillText(line, 16, y);
          x.fillText(to.slice(0, 10), line ? 116 : 16, y);
          x.textAlign = "right"; x.fillText(min, 464, y);
        });
        });
        const t = new T.CanvasTexture(c);
        t.colorSpace = T.SRGBColorSpace;
        t.anisotropy = 8;
        return new T.MeshLambertMaterial({ map: t, emissive: 0xffffff, emissiveMap: t });
      };
      const mesh = new T.Mesh(geom.clone(), [face(false), face(true), black, black, black, black]);
      const [x, y] = this.local(k.at);
      mesh.position.set(x, y, 0);
      mesh.rotation.set(0, 0, k.angle + Math.PI / 2);   // facing the road and the pavement, where people wait
      mesh.castShadow = true;
      this.boardMeshes.push(mesh);
    }
    geom.dispose();
    if (this.boardMeshes.length) scene.add(...this.boardMeshes);
    this.map?.triggerRepaint();
  }

  private buildLamps() {
    const T = this.T, scene = this.scene;
    for (const mesh of this.lampMeshes) { mesh.removeFromParent(); mesh.geometry.dispose(); (mesh.material as Three.Material).dispose(); mesh.dispose(); }
    this.lampMeshes = [];
    if (!T || !scene || !this.ref || !this.lamps.length) return;
    const n = this.lamps.length, H = 6.2;
    const metal = new T.MeshLambertMaterial({ color: this.dark ? 0x2b2e35 : 0xa9afb7 });   // light grey by day: not pins
    const poleG = new T.CylinderGeometry(0.09, 0.13, H, 10);
    poleG.rotateX(Math.PI / 2); poleG.translate(0, 0, H / 2);
    // The arm from the pole's top to the head, thick enough to be seen, its end under the head: one piece with it.
    const armG = new T.BoxGeometry(1, 0.12, 0.12);
    armG.translate(0.5, 0, 0);
    const headG = new T.BoxGeometry(0.8, 0.34, 0.16);
    const poles = new T.InstancedMesh(poleG, metal, n), arms = new T.InstancedMesh(armG, metal, n);
    const heads = new T.InstancedMesh(headG, new T.MeshLambertMaterial({ color: this.dark ? 0xfff1d0 : 0xd9dde2,
      emissive: this.dark ? 0xffd28a : 0x000000 }), n);
    const cone = this.dark ? lampCone(T, n, H - 0.2) : null;   // from the head itself down
    const o = new T.Object3D();
    this.lamps.forEach(({ pole, head }, i) => {
      const [px, py] = this.local(pole), [hx, hy] = this.local(head);
      const ang = Math.atan2(hy - py, hx - px), len = Math.hypot(hx - px, hy - py);
      o.position.set(px, py, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); o.updateMatrix(); poles.setMatrixAt(i, o.matrix);
      o.position.set(px, py, H - 0.06); o.rotation.set(0, 0, ang); o.scale.set(len + 0.3, 1, 1); o.updateMatrix(); arms.setMatrixAt(i, o.matrix);
      o.position.set(hx, hy, H - 0.12); o.rotation.set(0, 0, ang); o.scale.set(1, 1, 1); o.updateMatrix(); heads.setMatrixAt(i, o.matrix);
      if (cone) { o.position.set(hx, hy, 0); o.rotation.set(0, 0, 0); o.updateMatrix(); cone.setMatrixAt(i, o.matrix); }
    });
    for (const mesh of [poles, arms, heads]) { mesh.castShadow = true; mesh.frustumCulled = false; }
    this.lampMeshes = cone ? [poles, arms, heads, cone] : [poles, arms, heads];
    scene.add(...this.lampMeshes);
    this.map?.triggerRepaint();
  }

  // ---- the three.js side ----
  private addLayer() {
    const m = this.map!, T = this.T!;
    if (m.getLayer(LAYER)) m.removeLayer(LAYER);
    const self = this;
    this.layer = {
      id: LAYER, type: "custom", renderingMode: "3d",
      onAdd(map, gl) {
        const c = self.pal();
        self.scene = new T.Scene();
        self.camera = new T.Camera();
        const hemi = new T.HemisphereLight(c.sky, c.ground, c.hemi);
        self.scene.add(hemi);
        const sun = new T.DirectionalLight(self.dark ? 0xbfd0ff : 0xfff6e5, c.sun);
        // The X-ray pass draws its layer alone, and three.js leaves out lights not on the camera's layers.
        hemi.layers.enable(XRAY); sun.layers.enable(XRAY);
        sun.castShadow = true;
        const sc = sun.shadow.camera;
        sc.left = -120; sc.right = 120; sc.top = 120; sc.bottom = -120; sc.near = 1; sc.far = 400;
        // Phones (a touch screen): a smaller shadow map and a cheaper filter, so the street stays smooth to move.
        const phone = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
        sun.shadow.mapSize.set(phone ? 1024 : 2048, phone ? 1024 : 2048);
        sun.shadow.bias = -0.0004;
        self.scene.add(sun, sun.target);
        self.sun = sun;
        self.ground = new T.Mesh(new T.PlaneGeometry(400, 400), new T.ShadowMaterial({ opacity: c.shadow, depthWrite: false }));
        self.ground.position.z = 0.05;
        self.ground.receiveShadow = true;
        self.ground.frustumCulled = false;
        self.scene.add(self.ground);
        // Each model's parts merged by material (mergeParts): a bus is ~80 meshes as built, a draw call each, twice
        // with its shadow; merged, a dozen.
        self.proto = mergeParts(T, buildBus(T, self.dark));
        self.trolleyProto = mergeParts(T, buildTrolley(T, self.dark));
        self.tramProto = buildTram(T, self.dark);
        for (const car of self.tramProto.children) if (car.userData.len != null) mergeParts(T, car);
        self.groups.clear();
        self.instances();
        self.anchor(map.getCenter().toArray() as LngLat);
        self.renderer = new T.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
        self.renderer.autoClear = false;
        // No reading back each shader's compile log: that waits for the GPU to finish compiling (seconds, in all, on
        // a phone) where the compile could run alongside.
        self.renderer.debug.checkShaderErrors = !!import.meta.env?.DEV && FORCED_SHADER_CHECK;
        self.renderer.shadowMap.enabled = true;
        self.renderer.shadowMap.type = phone ? T.PCFShadowMap : T.PCFSoftShadowMap;
        // A phone draws the shadow map (every building, lamp and bus once more, from the sun) every other frame: a
        // shadow one frame behind is not seen, half the shadow passes are.
        // (On a computer too, since 2026-11-09: a pan across the city was choppy.)
        self.renderer.shadowMap.autoUpdate = false;
        self.shadowEvery = 2;
        // Once the lamps and stops around are built, every shader is compiled at the next frame (prewarm), under the loading
        // screen, not one by one as each thing first comes into view.
        void (self.refresh() ?? Promise.resolve()).finally(() => { self.warmUp = true; map.triggerRepaint(); });
      },
      render(_gl, args) { self.draw(args.defaultProjectionData.mainMatrix as unknown as number[]); },
      onRemove() { self.renderer?.dispose(); self.renderer = null; },
    };
    m.addLayer(this.layer);
    // The stations' discs, logos and names over the models (the Σύνταγμα terrace, a bus at the entrance), not under.
    for (const id of ["metro-station", "metro-station-glyph", "metro-label"]) if (m.getLayer(id)) m.moveLayer(id);
  }

  private anchor(at: LngLat) {
    this.origin = at;
    this.ref = MercatorCoordinate.fromLngLat(at, 0);
    this.scale = this.ref.meterInMercatorCoordinateUnits();
    for (const g of this.groups.values()) g.removeFromParent();
    this.groups.clear();
    this.poolsAt = "";   // lamps again, around the new origin
    this.tunnelAt = null;
    this.buildLamps();
    this.buildStops();
    this.buildBoards();
    if (this.scene) this.entrances.mount(this.scene, p => this.local(p));
    if (this.scene) this.landmarks.mount(this.scene, p => this.local(p));
  }

  // Metres east and north of the origin.
  // (MapLibre's Web Mercator, written out: these run for every point of the bridges, tunnels and metro lines built
  // round the view, and an object per call added up.)
  private local(p: LngLat): [number, number] {
    const mx = (180 + p[0]) / 360, my = (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (p[1] * Math.PI) / 360))) / 360;
    return [(mx - this.ref!.x) / this.scale, -(my - this.ref!.y) / this.scale];
  }
  private unlocal(x: number, y: number): LngLat {
    const mx = this.ref!.x + x * this.scale, my = this.ref!.y - y * this.scale;
    return [mx * 360 - 180, (360 / Math.PI) * Math.atan(Math.exp(((180 - my * 360) * Math.PI) / 180)) - 90];
  }

  private refresh(): Promise<void> | undefined {
    const m = this.map;
    if (!this.on || !m || !this.scene) return;
    const c = m.getCenter().toArray() as LngLat;
    const [ex, ny] = this.local(c);
    if (Math.hypot(ex, ny) > 3000) this.anchor(c);   // keep the numbers small
    this.cover();
    this.tunnelsNear();
    void this.streets();   // other road tiles, when the view has moved on to them
    // The lamps and stops around: at once the first time (under the loading screen), after a move when the
    // browser has a moment, so the move itself does not stop to build them.
    if (this.under) { /* underground only: nothing to build at street level */ }
    else if (!this.built) this.pools();
    else {
      if (this.poolsIdle) (window.cancelIdleCallback ?? clearTimeout)(this.poolsIdle);
      this.poolsIdle = (window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 60)))(() => { this.poolsIdle = 0; if (this.on) this.pools(); }, { timeout: 400 });
    }
    return Promise.resolve();
  }

  // Buses as traffic (spacing.ts): each one's sideways gap (a spring: out to pass, back in), how far back it is drawn
  // and its drawn speed (follow: it brakes and pulls away as a bus does, never backwards), its speed over its last
  // positions, whether it moves (with a margin), its place last frame, and when the gaps were last moved.
  private gaps = new Map<string, Gap & Follow & { latV: number; v: number; moving: boolean; at?: [number, number]; t?: number;
    h?: number; hT?: number; turning?: boolean; px?: number; py?: number }>();
  private gapsAt = 0;
  private spaced(now: number): Map<string, { x: number; y: number; turn: number }> {
    const out = new Map<string, { x: number; y: number; turn: number }>();
    const dt = this.gapsAt ? Math.min(0.1, (now - this.gapsAt) / 1000) : 0;
    this.gapsAt = now;
    const cars: Car[] = [];
    for (const [key, b] of this.buses) {
      if (b.kind === "tram" || b.kind === "metro") continue;
      const [x, y] = this.local(b.pos);
      let g = this.gaps.get(key);
      if (!g) this.gaps.set(key, (g = { lat: 0, back: 0, latV: 0, u: 0, v: 0, moving: false }));
      if (!g.at || !g.t) { g.at = [x, y]; g.t = now; }
      else if (now - g.t >= 250) {
        const v = Math.hypot(x - g.at[0], y - g.at[1]) / ((now - g.t) / 1000);
        g.v = g.v * 0.7 + Math.min(v, 30) * 0.3;   // about a second of speeds: a correction's jump is not a start
        g.at = [x, y]; g.t = now;
        g.moving = g.moving ? g.v > MOVE_OFF : g.v > MOVE_ON;
      }
      // Turning: its heading changed more than TURN_DEG over the last half second or so (a bend, a junction).
      if (b.heading != null) {
        if (g.h == null || g.hT == null) { g.h = b.heading; g.hT = now; }
        else if (now - g.hT >= 400) {
          g.turning = Math.abs(((b.heading - g.h + 540) % 360) - 180) > TURN_DEG;
          g.h = b.heading; g.hT = now;
        }
      }
      cars.push({ key, x, y, heading: b.heading, v: g.v, moving: g.moving, turning: g.turning, fix: b.fix && this.local(b.fix) });
    }
    for (const k of this.gaps.keys()) if (!this.buses.has(k)) this.gaps.delete(k);
    // Out to pass only where there is road to pull out onto (a lane's width to that side, on a carriageway): not into
    // a building or onto the pavement; with no lane either side, it keeps in line behind.
    const idx = this.roads;
    const canPass = idx ? (c: Car, side: 1 | -1) => {
      if (c.heading == null) return false;
      const d = [Math.sin((c.heading * Math.PI) / 180), Math.cos((c.heading * Math.PI) / 180)];
      return !!idx.onRoad(this.unlocal(c.x - d[1] * LANE_W * side, c.y + d[0] * LANE_W * side), -0.6);
    } : undefined;
    const want = spacingTargets(cars, this.gaps, BUS_LEN, LANE_W, BUS_WIDE, canPass);
    const boxes: Box[] = [];
    const unit = (h: number): [number, number] => [Math.sin((h * Math.PI) / 180), Math.cos((h * Math.PI) / 180)];
    for (const c of cars) {
      const g = this.gaps.get(c.key)!, t = want.get(c.key)!;
      if (dt) [g.lat, g.latV] = springStep(g.lat, g.latV, t.lat, LAT_PERIOD, dt);     // out to the next lane in about three and a half seconds
      if (Math.abs(g.lat) < 0.01 && Math.abs(g.latV) < 0.01) g.lat = g.latV = 0;
      const h = c.heading;
      // Along its way: how far its place moved this frame, and the speed it is drawn at to keep its gap (follow).
      // A new place (a fade over, a fix far off): it starts again there, on it.
      const jumped = g.px != null && Math.hypot(c.x - g.px, c.y - (g.py ?? 0)) > 30, fresh = g.px == null || jumped;
      if (h != null && dt && g.px != null && !jumped) {
        const d = unit(h);
        follow(g, (c.x - g.px) * d[0] + (c.y - g.py!) * d[1], t.back, dt);
      } else if (jumped) { g.back = 0; g.u = 0; }
      g.px = c.x; g.py = c.y;
      if (h == null) continue;
      const d = unit(h);
      boxes.push({ key: c.key, x: c.x - d[1] * g.lat - d[0] * g.back, y: c.y + d[0] * g.lat - d[1] * g.back, h, fresh });
    }
    // Never inside one another, whatever the targets have not foreseen (one appearing, a sharp corner): the one behind
    // is moved back at once, and its drawn speed is what it then really moved.
    const extra = separate(boxes, BUS_LEN, BUS_WIDE);
    for (const [k, s] of extra) {
      const g = this.gaps.get(k)!;
      g.back = Math.min(2 * BACK_MAX, g.back + s);
      if (dt) g.u = Math.max(0, g.u - s / dt);
    }
    for (const c of cars) {
      const g = this.gaps.get(c.key)!, h = c.heading;
      if (h == null || (!g.lat && !g.back)) { out.set(c.key, { x: c.x, y: c.y, turn: 0 }); continue; }
      const d = unit(h);
      // Turned toward where it moves sideways, from the spring's own speed: smooth as the move itself.
      // (Its own speed, crawling too: taken as 4 m/s it slid sideways at a crawl.)
      const turn = Math.max(-0.35, Math.min(0.35, Math.atan2(g.latV, Math.max(g.u, c.v, 1.5))));
      out.set(c.key, { x: c.x - d[1] * g.lat - d[0] * g.back, y: c.y + d[0] * g.lat - d[1] * g.back, turn });
    }
    return out;
  }

  private draw(main: number[]) {
    const m = this.map, T = this.T;
    if (!m || !T || !this.scene || !this.renderer || !this.camera || !this.ref) return;
    const z = m.getZoom();
    m.getContainer().classList.toggle("map3d-near", z >= BUS_ZOOM);
    const spaced = z >= BUS_ZOOM ? this.spaced(performance.now()) : null;
    // The buses: one group per vehicle, cloned from the prototype; the roof plate in the line's colour. Only those
    // within reach of the view (the farthest corner of the screen): the rest of the city's are not drawn at all.
    const seen = new Set<string>();
    this.atlas?.tick();
    const [vx, vy] = this.local(m.getCenter().toArray() as LngLat), near = (this.reach(1200) + 40) ** 2;
    if (z >= BUS_ZOOM) for (const [key, b] of this.buses) {
      if (this.under && b.kind !== "metro") continue;   // underground: nothing on the street
      const [bx, by] = this.local(b.pos);
      if ((bx - vx) ** 2 + (by - vy) ** 2 > near) continue;
      if (b.kind === "bus" || b.kind === "trolley") {
        // Instanced (busInstances.ts): its place, its turn, its line's colour and number, its delay's glow.
        const sp = spaced?.get(key), [x, y] = sp ? [sp.x, sp.y] : [bx, by];
        if (b.heading == null && !this.drawnRot.has(key)) continue;   // never drawn and no way to face yet
        const rot = b.heading != null ? yaw(b.heading) + (sp?.turn ?? 0) : this.drawnRot.get(key)!;
        this.drawnRot.set(key, rot);
        (b.kind === "trolley" ? this.trolleyPoses : this.busPoses).push({ x, y, rot, color: b.color, sign: `${b.kind}|${b.label}`, glow: glowColor(b.glow) });
        this.drawn.set(key, [x, y]);
        this.busShown.add(key);
        seen.add(key);
        continue;
      }
      let g = this.groups.get(key);
      const look = b.kind === "metro" ? `metro-${b.livery ?? "m23"}` : b.kind;
      if (g && g.userData.kind !== look) { g.removeFromParent(); this.groups.delete(key); g = undefined; }
      if (!g) {
        g = (b.kind === "tram" ? this.tramProto! : this.metroProto(b.livery ?? "m23")).clone();
        g.userData.kind = look;
        g.traverse(o => { if ((o as Three.Mesh).isMesh) { o.castShadow = o.name !== "beam"; o.frustumCulled = false;
          if (b.kind !== "metro" && o.name !== "beam") o.layers.enable(XRAY_FLAT); } });   // seen through buildings (render)
        if (b.kind !== "metro") g.userData.xray = true;
        this.groups.set(key, g);
        this.scene.add(g);
      }
      if (g.userData.label !== b.label) {
        g.userData.label = b.label;
        g.traverse(o => { if (o.name === "sign") (o as Three.Mesh).material = this.sign(b.kind, b.label); });
        if (g.userData.xray) this.markStencil(g);
      }
      if (b.kind === "tram" || b.kind === "metro") {
        // Each car on the track where it is: its two ends that far back along the trail, turned from one to the other.
        // A metro car at its depth there (metroDepth.ts): under the street, climbing out at a portal.
        if (!b.trail?.length) continue;
        const metro = b.kind === "metro";
        for (const car of g.children) {
          const { front, len } = car.userData as { front: number; len: number };
          if (len == null) continue;
          const [ax, ay] = this.behind(b, front), [bx, by] = this.behind(b, front + len);
          const ll = (x: number, y: number): LngLat => [TRAIL_ORIGIN[0] + x / TKX, TRAIL_ORIGIN[1] + y / TKY];
          const [x, y] = this.local(ll((ax + bx) / 2, (ay + by) / 2));
          const mid = ll((ax + bx) / 2, (ay + by) / 2);
          const dz = metro ? -depthAt(b.label, mid[0], mid[1]) : 0;
          car.position.set(x, y, dz);
          car.visible = !metro || dz > -3 || this.under;   // under the street: seen only with «Υπόγεια» on
          car.rotation.z = Math.atan2(ay - by, ax - bx);
          if (metro) {
            const [fa, fb] = [ll(ax, ay), ll(bx, by)];
            car.rotation.y = Math.atan2(depthAt(b.label, fa[0], fa[1]) - depthAt(b.label, fb[0], fb[1]), len);   // nose up on a ramp
          } else car.scale.set(1, TRAM_WIDE, TRAM_WIDE);
        }
        g.visible = true;
        seen.add(key);
        const c0 = g.children.find(c => c.userData.len != null);
        if (c0) this.drawn.set(key, [c0.position.x, c0.position.y]);
        continue;
      }
    }
    for (const [key, g] of this.groups) if (!seen.has(key)) { g.visible = false; this.drawn.delete(key); }
    for (const key of this.busShown) if (!seen.has(key)) { this.busShown.delete(key); this.drawn.delete(key); }
    this.busInst?.set(this.busPoses);
    this.trolleyInst?.set(this.trolleyPoses);
    this.busPoses.length = 0;
    this.trolleyPoses.length = 0;
    const street = z >= STREET_ZOOM && !this.under;   // underground only: no street level
    for (const l of this.lampMeshes) l.visible = street;
    for (const l of this.stopMeshes) l.visible = street;
    for (const l of this.boardMeshes) l.visible = street;
    this.entrances.show(street);
    this.landmarks.show(street);
    this.ground!.visible = !this.under;
    // The sun and the shadow catcher follow the view.
    const [cx, cy] = this.local(m.getCenter().toArray() as LngLat);
    this.sun!.position.set(cx - 28, cy - 22, 100);   // high: each tree's shadow pools under it
    this.sun!.target.position.set(cx, cy, 0);
    this.ground!.position.set(cx, cy, 0.05);
    if (!this.still) this.time.value = performance.now() / 1000;
    const l = new T.Matrix4().makeTranslation(this.ref.x, this.ref.y, this.ref.z).scale(new T.Vector3(this.scale, -this.scale, this.scale));
    this.camera.projectionMatrix = new T.Matrix4().fromArray(main).multiply(l);
    this.renderer.resetState();
    if (this.warmUp) this.prewarm();
    // Underground: the street and the buildings are drawn already, and the street's fills wrote their depth, which
    // would hide all that is under them. So the depth starts clean: the tunnels and trains below show through the
    // dimmed street, and the models still hide one another.
    if (this.under) this.renderer.clearDepth();
    else this.renderer.clearStencil();   // clean for the vehicles' marks (X-ray)
    if (this.shadowEvery > 1) this.renderer.shadowMap.needsUpdate = this.frameNo++ % this.shadowEvery === 0;
    this.renderer.render(this.scene, this.camera);
    // X-ray: the buses, trolleys and trams once more, only where something stands in front of them (a building, a
    // lamp): there they show through it as themselves, tinted blue (xray.ts), so a bus behind a block is not lost.
    if (!this.under && (this.groups.size || this.busShown.size)) {
      const sm = this.renderer.shadowMap.autoUpdate;
      this.xray ??= new XRay(this.T!, XRAY, XRAY_HULL);
      this.renderer.shadowMap.autoUpdate = false;
      if (this.busShown.size) this.xray.render(this.renderer, this.scene, this.camera);
      if (this.groups.size) {
        const T = this.T!;
        this.xrayFlat ??= new T.MeshBasicMaterial({ color: 0x6fa8ff, transparent: true, opacity: 0.42, depthWrite: false, depthFunc: T.GreaterDepth,
          stencilWrite: true, stencilRef: 1, stencilFunc: T.NotEqualStencilFunc, stencilWriteMask: 0, stencilFail: T.KeepStencilOp,
          stencilZFail: T.KeepStencilOp, stencilZPass: T.KeepStencilOp });
        this.camera.layers.set(XRAY_FLAT);
        this.scene.overrideMaterial = this.xrayFlat;
        this.renderer.render(this.scene, this.camera);
        this.scene.overrideMaterial = null;
        this.camera.layers.set(0);
      }
      this.renderer.shadowMap.autoUpdate = sm;
    }
    this.onFrame?.();
  }

  // ---- Where each model is drawn (with its spacing: out to pass, back in a queue), for its label (MapView): the
  // label rides on the model, not on the GPS position.
  private drawn = new Map<string, [number, number]>();
  /** Where a model's roof is on the screen (px, from the map's top left), as just drawn: a bus's over its middle, a
   *  tram's or a metro train's over its front car (at its depth, under the street). Its label goes there (MapView),
   *  moved at every frame the 3D draws (onFrame), so it rides on the model, never under the street. Null when not
   *  drawn or behind the camera. */
  onFrame: (() => void) | null = null;
  private shadowEvery = 1;
  private frameNo = 0;
  screenAt(key: string): [number, number] | null {
    const g = this.groups.get(key), T = this.T, m = this.map;
    if (!T || !m || !this.camera) return null;
    let p: { x: number; y: number; z: number }, roof: number;
    const bus = this.busShown.has(key) ? this.drawn.get(key) : undefined;
    if (bus) { p = { x: bus[0], y: bus[1], z: 0 }; roof = 3.3 * BUS_SCALE; }
    else {
      if (!g?.visible) return null;
      const c0 = g.children.find(c => c.userData.len != null);
      if (c0 && !c0.visible) return null;
      p = c0 ? c0.position : g.position; roof = c0 ? 3.9 : 3.3 * BUS_SCALE;
    }
    const v = new T.Vector3(p.x, p.y, p.z + roof).applyMatrix4(this.camera.projectionMatrix);
    if (!(v.z > -1 && v.z < 1)) return null;
    const cv = m.getCanvas();
    return [((v.x + 1) / 2) * cv.clientWidth, ((1 - v.y) / 2) * cv.clientHeight];
  }
  drawnAt(key: string): LngLat | null {
    const d = this.drawn.get(key);
    return d && this.ref ? this.unlocal(d[0], d[1]) : null;
  }

  // ---- The glow under a bus, in its delay's colour: a soft disc on the ground, a little longer than the bus, lit by
  // itself (added light at night; by day, a tint). One material, white: each bus's colour multiplies it.
  private glowMaterial(): Three.Material {
    const T = this.T!, c = document.createElement("canvas");
    c.width = c.height = 128;
    const x = c.getContext("2d")!, gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.45, "rgba(255,255,255,.45)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    return new T.MeshBasicMaterial({ map: new T.CanvasTexture(c), color: 0xffffff, transparent: true, depthWrite: false,
      blending: this.dark ? T.AdditiveBlending : T.NormalBlending, opacity: this.dark ? 0.95 : 0.6 });
  }

  // The buses' and trolleys' instanced sets, from their models (onAdd, after each style or theme). The hull, one box
  // as big as the model (12 m by 2.6, 3.1 high, along +x), drawn without colour or depth, casts each one's shadow and
  // is its shape in the X-ray.
  private hullGeo: Three.BufferGeometry | null = null;
  private hullMat: Three.Material | null = null;
  private instances() {
    const T = this.T!, scene = this.scene!;
    if (!this.hullGeo) { this.hullGeo = new T.BoxGeometry(12.1, 2.6, 3.1); this.hullGeo.translate(0, 0, 0.32 + 1.55); }
    this.hullMat ??= new T.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    const glowGeo = new T.PlaneGeometry(21, 9.5);   // in the model's frame: 12 m along x (scaled 1.3)
    glowGeo.translate(0, 0, 0.15);
    const glowMat = this.glowMaterial();
    this.atlas = new SignAtlas(T, (x, w, h, key) => { const k = key.indexOf("|"); paintSign(x, w, h, key.slice(0, k) as VehicleKind, key.slice(k + 1)); });
    this.busInst = new BusInstances(T, this.proto!, this.hullGeo, this.hullMat, glowGeo, glowMat, this.atlas, BUS_SCALE, XRAY, XRAY_HULL);
    this.trolleyInst = new BusInstances(T, this.trolleyProto!, this.hullGeo, this.hullMat, glowGeo, glowMat, this.atlas, BUS_SCALE, XRAY, XRAY_HULL);
    for (const inst of [this.busInst, this.trolleyInst]) {
      scene.add(inst.root);
      for (const mat of inst.seenMaterials) { mat.stencilWrite = true; mat.stencilRef = 1; mat.stencilFunc = T.AlwaysStencilFunc; mat.stencilZPass = T.ReplaceStencilOp; }
    }
  }

  // ---- Ready: the loading screen waits for the first full frame (trees built, shaders compiled, the map's tiles in).
  private warmUp = false;
  private warmed = false;
  private warmWait: (() => void)[] = [];
  /** Resolves once the mode shows whole, or at once when it is off or already whole (at most READY_MS). */
  whenReady(): Promise<void> {
    if (this.warmed || !this.on) return Promise.resolve();
    return new Promise(ok => { this.warmWait.push(ok); setTimeout(ok, READY_MS); });
  }
  private flushReady() { for (const ok of this.warmWait.splice(0)) ok(); }
  private prewarm() {
    this.warmUp = false;
    const extra = [this.tramProto].flatMap(p => (p ? [p.clone()] : []));
    for (const e of extra) this.scene!.add(e);
    const back = [this.busInst?.showAllForCompile(), this.trolleyInst?.showAllForCompile()];
    this.renderer!.compile(this.scene!, this.camera!);
    for (const f of back) f?.();
    for (const e of extra) e.removeFromParent();
    this.renderer!.resetState();
    // Then the map's tiles (buildings, streets): "idle" would not do, the moving buses keep the map drawing.
    const t0 = performance.now();
    const wait = () => {
      if (!this.on || this.warmed) return;
      if (this.map?.areTilesLoaded() || performance.now() - t0 > 6000) { this.warmed = true; this.flushReady(); }
      else setTimeout(wait, 150);
    };
    wait();
  }

  // A destination display: black, the line's number in LEDs (amber on a bus, green-yellow on a trolley, as on
  // OASA's and ΗΛΠΑΠ's), lit at night. One material per kind and number, shared by every vehicle that shows it.
  private signs = new Map<string, Three.Material>();
  private sign(kind: VehicleKind, label: string) {
    const key = `${kind}|${label}`;
    let mat = this.signs.get(key);
    if (!mat) {
      const T = this.T!, c = document.createElement("canvas");
      c.width = 512; c.height = 72;
      paintSign(c.getContext("2d")!, c.width, c.height, kind, label);
      const t = new T.CanvasTexture(c);
      t.colorSpace = T.SRGBColorSpace;
      t.anisotropy = 8;
      mat = new T.MeshBasicMaterial({ map: t });   // self-lit: readable day and night
      this.signs.set(key, mat);
    }
    return mat;
  }

  private forgetSaved() {
    this.saved.clear();
    this.hidden = [];
    this.quieted = [];
    this.restyledPaint = [];
    this.ground3d = null;
    this.sky = undefined;
    this.light3d = undefined;
  }

  private teardown() {
    this.drawn.clear();
    this.warmed = false;
    this.warmUp = false;
    const m = this.map;
    if (m) {
      m.off("moveend", this.onMove);
      this.lanes(false);
      for (const [id, max, filter] of this.hidden) {
        const l = m.getLayer(id);
        if (!l) continue;
        m.setFilter(id, (filter ?? null) as never);
        m.setLayerZoomRange(id, l.minzoom ?? 0, max);
      }
      this.hidden = [];
      this.inside = null;
      if (this.ground3d && m.getLayer(this.ground3d[0])) m.setPaintProperty(this.ground3d[0], "background-color", this.ground3d[1] as never);
      this.ground3d = null;
      for (const [id, prop, v] of this.restyledPaint) if (m.getLayer(id)) m.setPaintProperty(id, prop as never, v as never);
      this.restyledPaint = [];
      if (this.light3d !== undefined && this.styleReady) m.setLight((this.light3d ?? {}) as never);
      this.light3d = undefined;
      if (m.getLayer(LAYER)) m.removeLayer(LAYER);
      for (const id of [...STREET_LAYERS, ...this.streetIds]) if (m.getLayer(id)) m.removeLayer(id);
      this.streetIds = [];
      if (m.getSource("x3d-pools")) m.removeSource("x3d-pools");
      if (m.getSource("x3d-tram")) m.removeSource("x3d-tram");
      if (m.getLayer("x3d-under")) m.removeLayer("x3d-under");
      if (m.getSource("x3d-under")) m.removeSource("x3d-under");
      if (m.getSource("x3d-roads")) m.removeSource("x3d-roads");
      if (this.sky !== undefined && this.styleReady) m.setSky((this.sky ?? undefined) as never);
    }
    this.sky = undefined;
    for (const mesh of this.lampMeshes) mesh.dispose();
    this.lampMeshes = [];
    for (const mesh of this.stopMeshes) mesh.dispose();
    this.stopMeshes = [];
    for (const mesh of this.boardMeshes) { mesh.geometry.dispose(); for (const mat of ([] as Three.Material[]).concat(mesh.material)) { (mat as Three.MeshLambertMaterial).map?.dispose(); mat.dispose(); } }
    this.boardMeshes = [];
    this.groups.clear();
    // Free the GPU memory three.js holds (renderer.dispose() alone leaves buffers, textures and the shadow map), and
    // the renderer itself: MapLibre does not call the layer's onRemove when the whole style is replaced.
    const seen = new Set<object>();
    const free = (x: { dispose?: () => void } | null | undefined) => { if (x && !seen.has(x)) { seen.add(x); x.dispose?.(); } };
    const freeMat = (mat: Three.Material) => {
      for (const v of Object.values(mat)) if (v && (v as Three.Texture).isTexture) free(v as Three.Texture);
      free(mat);
    };
    const freeTree = (root: Three.Object3D | null) => root?.traverse(o => {
      const mesh = o as Three.Mesh;
      if (mesh.geometry) free(mesh.geometry);
      if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(freeMat);
    });
    freeTree(this.scene);
    freeTree(this.proto);
    freeTree(this.trolleyProto);
    freeTree(this.tramProto);
    for (const g of this.metroProtos.values()) freeTree(g);
    this.metroProtos.clear();
    this.tunnelMeshes = [];
    this.tunnelAt = null;
    this.stopGlow = null;
    for (const mat of this.signs.values()) freeMat(mat);
    this.signs.clear();
    this.sun?.shadow.dispose();
    this.renderer?.dispose();
    this.proto = null;
    this.trolleyProto = null;
    this.busInst = this.trolleyInst = null;
    this.atlas = null;
    this.busShown.clear();
    this.drawnRot.clear();
    this.hullGeo = null;
    this.hullMat = null;
    this.xray?.dispose();
    this.xray = null;
    this.xrayFlat?.dispose();
    this.xrayFlat = null;
    this.tramProto = null;
    this.sun = null;
    this.ground = null;
    this.lampMeshes = [];
    this.stopMeshes = [];
    this.layer = null;
    this.scene = null;
    this.renderer = null;
  }
}

// A destination display's picture: black, the number in LEDs (amber on a bus, green-yellow on a trolley).
function paintSign(x: CanvasRenderingContext2D, w: number, h: number, kind: VehicleKind, label: string) {
  x.fillStyle = "#050506"; x.fillRect(0, 0, w, h);
  x.fillStyle = kind === "trolley" ? "#cfe84e" : kind === "tram" ? "#ff8a1c" : "#ffae1f";
  x.font = "bold 58px 'Courier New', monospace"; x.textAlign = "center"; x.textBaseline = "middle";
  x.fillText(label, w / 2, h / 2 + 3, w - 40);
  // The dot matrix: a dark grid over the letters leaves them made of separate LEDs.
  x.fillStyle = "#050506";
  for (let i = 0; i < w; i += 6) x.fillRect(i, 0, 2, h);
  for (let j = 0; j < h; j += 6) x.fillRect(0, j, w, 2);
}

// A delay's glow colour under a bus (format.ts delayClass), or none.
function glowColor(cls: DelayClass): number | null {
  return cls === "ontime" ? 0x46c267 : cls === "late1" || cls === "late2" ? 0xf0a033 : cls === "late3" ? 0xff5a4f : null;
}

// A model's parts merged into one mesh per material, in the model's own frame (for each draw call saved, a bus
// costs less every frame). The named parts stay as they are (the roof plate and the signs change per vehicle, the
// beam has its own shader), and a tram car's are merged within it (each car moves on its own).
function mergeParts<O extends Three.Object3D>(T: typeof Three, root: O): O {
  root.updateMatrixWorld(true);
  const inv = new T.Matrix4().copy(root.matrixWorld).invert(), m4 = new T.Matrix4();
  // Parts of one plain colour (a Lambert material with no picture and no glow of its own) are merged into one mesh
  // whatever their colour, the colour in its vertices: a bus's white, dark grey, tyres, rims, hubs and bumpers are
  // one draw. Parts with a picture, a glow or a sheen merge by material. A box with a material per face is cut into
  // its faces first, so each face merges with the rest of its material.
  const plain = (m: Three.Material) => (m as Three.MeshLambertMaterial).isMeshLambertMaterial && !(m as Three.MeshLambertMaterial).map
    && (m as Three.MeshLambertMaterial).emissive.getHex() === 0 && !m.transparent;
  let vc: Three.MeshLambertMaterial | null = null;
  const sets = new Map<string, { mat: Three.Material; parts: Three.BufferGeometry[] }>();
  const done: Three.Mesh[] = [];
  const add = (geo: Three.BufferGeometry, mat: Three.Material) => {
    const uv = !!geo.attributes.uv, flat = plain(mat);
    for (const n of Object.keys(geo.attributes)) if (n !== "position" && n !== "normal" && (n !== "uv" || flat)) geo.deleteAttribute(n);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    if (flat) {
      const c = (mat as Three.MeshLambertMaterial).color, n = geo.attributes.position.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      geo.setAttribute("color", new T.BufferAttribute(col, 3));
      vc ??= new T.MeshLambertMaterial({ vertexColors: true });
    }
    const key = flat ? "plain" : `${mat.uuid}|${uv}`;
    let set = sets.get(key);
    if (!set) sets.set(key, (set = { mat: flat ? vc! : mat, parts: [] }));
    set.parts.push(geo);
  };
  root.traverse(o => {
    const me = o as Three.Mesh;
    if (!me.isMesh || !me.visible || me.name || (me as Three.InstancedMesh).isInstancedMesh) return;
    const mats = ([] as Three.Material[]).concat(me.material);
    if (mats.some(m => (m as Three.ShaderMaterial).isShaderMaterial)) return;
    for (let a = me.parent; a && a !== root; a = a.parent) if (a.userData.len != null) return;   // inside a tram car
    const whole = (me.geometry.index ? me.geometry.toNonIndexed() : me.geometry.clone());
    whole.applyMatrix4(m4.multiplyMatrices(inv, me.matrixWorld));
    if (!Array.isArray(me.material)) add(whole, me.material);
    else {
      // One geometry per face group (toNonIndexed keeps the groups, in vertices now).
      const groups = whole.groups.length ? whole.groups : [{ start: 0, count: whole.attributes.position.count, materialIndex: 0 }];
      for (const gr of groups) {
        const part = new T.BufferGeometry();
        for (const [name, attr] of Object.entries(whole.attributes)) {
          const a = attr as Three.BufferAttribute;
          part.setAttribute(name, new T.BufferAttribute((a.array as Float32Array).slice(gr.start * a.itemSize, (gr.start + gr.count) * a.itemSize), a.itemSize));
        }
        add(part, me.material[gr.materialIndex ?? 0]);
      }
      whole.dispose();
    }
    done.push(me);
  });
  for (const me of done) me.removeFromParent();
  for (const { mat, parts } of sets.values()) {
    const geo = new T.BufferGeometry();
    for (const name of ["position", "normal", "uv", "color"]) {
      if (!parts.every(g => g.attributes[name])) continue;
      const size = parts[0].attributes[name].itemSize;
      const out = new Float32Array(parts.reduce((n, g) => n + g.attributes[name].count * size, 0));
      let at = 0;
      for (const g of parts) { out.set(g.attributes[name].array as Float32Array, at); at += g.attributes[name].count * size; }
      geo.setAttribute(name, new T.BufferAttribute(out, size));
    }
    for (const g of parts) g.dispose();
    root.add(new T.Mesh(geo, mat));
  }
  return root;
}

// Destination displays on a model (Scene3D.sign() gives them the line's number): across the top of the windscreen,
// facing ahead, and a smaller one in the rear window, facing back (seen when following a vehicle). Named "sign".
function addSigns(T: typeof Three, g: Three.Group, frontX: number, frontZ: number, rearX: number, rearZ: number) {
  const front = new T.PlaneGeometry(2.0, 0.28);
  front.rotateX(Math.PI / 2); front.rotateZ(Math.PI / 2);   // upright, facing +x, the text running along +y
  const rear = new T.PlaneGeometry(1.7, 0.34);   // big enough to read from the follow camera, behind the bus
  rear.rotateX(Math.PI / 2); rear.rotateZ(-Math.PI / 2);    // facing -x
  for (const [geo, x, z] of [[front, frontX, frontZ], [rear, rearX - 0.04, rearZ]] as const) {
    const me = new T.Mesh(geo, new T.MeshBasicMaterial({ color: 0x050506 }));
    me.name = "sign";
    me.position.set(x, 0, z);
    g.add(me);
  }
}

// An OASA city bus (a Mercedes Citaro in the white, blue, yellow and light-blue livery), 12 m long, along +x.
export function buildBus(T: typeof Three, dark: boolean): Three.Group {
  const g = new T.Group();
  const WHT = dark ? "#f2f4f6" : "#fbfcfd", BLUE = "#2c3a9e", YEL = "#f6c21a", LBL = "#8fd3f2";
  const cv = (w: number, h: number, draw: (x: CanvasRenderingContext2D, w: number, h: number) => void) => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    draw(c.getContext("2d")!, w, h);
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  const poly = (x: CanvasRenderingContext2D, pts: number[][], c: string) => {
    x.fillStyle = c; x.beginPath();
    pts.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b)));
    x.closePath(); x.fill();
  };
  const skirt = cv(1200, 100, (x, w, h) => {
    x.fillStyle = WHT; x.fillRect(0, 0, w, h);
    poly(x, [[60, 0], [160, 0], [110, h]], LBL); poly(x, [[150, 0], [290, 0], [220, h]], YEL);
    poly(x, [[420, 0], [700, 0], [640, h], [470, h]], BLUE); poly(x, [[560, 0], [700, 0], [700, h]], WHT);
    poly(x, [[700, 0], [930, 0], [815, h]], YEL); poly(x, [[900, 0], [960, 0], [960, h], [880, h]], BLUE);
    x.fillStyle = "#b9bec5"; x.fillRect(0, h - 10, w, 10);
    x.fillStyle = "#16181c";
    for (const u of [340, 930]) { x.beginPath(); x.arc(u, h + 2, 62, Math.PI, 0); x.fill(); }
  });
  const mirror = (t: Three.Texture) => { const c = t.clone(); c.wrapS = T.RepeatWrapping; c.repeat.x = -1; c.needsUpdate = true; return c; };
  const glass = cv(1200, 150, (x, w, h) => {
    const gr = x.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, dark ? "#2a3d55" : "#3c5674"); gr.addColorStop(0.35, dark ? "#131c28" : "#1b2838"); gr.addColorStop(1, dark ? "#0e151f" : "#152131");
    x.fillStyle = gr; x.fillRect(0, 0, w, h);
    x.fillStyle = dark ? "rgba(255,214,140,.10)" : "rgba(255,255,255,.06)"; x.fillRect(60, 40, 1000, 70);
    x.strokeStyle = "rgba(0,0,0,.65)"; x.lineWidth = 5;
    for (const u of [170, 330, 520, 760, 900]) { x.beginPath(); x.moveTo(u, 0); x.lineTo(u, h); x.stroke(); }
    x.strokeStyle = dark ? "#8d96a3" : "#c6ccd3";
    for (const [a, b] of [[560, 700], [1010, 1130]]) { x.strokeRect(a, 8, b - a, h + 20); x.beginPath(); x.moveTo((a + b) / 2, 8); x.lineTo((a + b) / 2, h); x.stroke(); }
  });
  const front = cv(256, 100, (x, w, h) => {
    x.fillStyle = WHT; x.fillRect(0, 0, w, h);
    poly(x, [[60, h], [110, 15], [150, h]], BLUE); poly(x, [[110, 15], [200, 15], [175, h], [150, h]], YEL);
    poly(x, [[200, 15], [256, 15], [256, h], [185, h]], LBL);
    x.fillStyle = "#c6ccd3"; x.fillRect(0, h - 12, w, 12);
  });
  const wind = cv(256, 150, (x, w, h) => {
    const gr = x.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, "#111"); gr.addColorStop(0.18, "#111"); gr.addColorStop(0.2, dark ? "#355071" : "#4d6c8f"); gr.addColorStop(1, dark ? "#1a2738" : "#24364d");
    x.fillStyle = gr; x.fillRect(0, 0, w, h);
    x.fillStyle = "#ff9a1a"; x.fillRect(40, 6, w - 80, 14);
    x.fillStyle = WHT; x.fillRect(0, 0, 8, h); x.fillRect(w - 8, 0, 8, h);
  });
  const rot = (t: Three.Texture, a: number) => { t.center.set(0.5, 0.5); t.rotation = a; return t; };
  const L = (o: Three.MeshLambertMaterialParameters) => new T.MeshLambertMaterial(o);
  const P = (o: Three.MeshPhongMaterialParameters) => new T.MeshPhongMaterial(o);
  const white = L({ color: WHT }), dkg = L({ color: 0x2a2d33 }), tyre = L({ color: 0x141518 }), rim = L({ color: 0xb9c0c7 }), hub = L({ color: 0x6d747c });
  const bumper = L({ color: dark ? 0xcfd4da : 0xdde1e6 }), tail = L({ color: 0xd32f2f, emissive: 0x7a0d0d });
  const lit = dark ? 0x2b2414 : 0x000000;   // at night the cabin is lit: a warm glow through the glass
  const head = L({ color: 0xffffff, emissive: dark ? 0xfff1c9 : 0x777777 }), door = P({ color: 0x0e141c, shininess: 90, specular: 0x99aabb });
  const box = (w: number, d: number, h: number, mat: Three.Material | Three.Material[], x: number, y: number, z: number) => {
    const me = new T.Mesh(new T.BoxGeometry(w, d, h), mat);
    me.position.set(x, y, z + h / 2);
    g.add(me);
    return me;
  };
  // A rounded box from a box with bevelled edges (no addon import): a box plus a slightly larger, flatter one.
  const soft = (w: number, d: number, h: number, mat: Three.Material, x: number, y: number, z: number, r: number) => {
    box(w - 2 * r, d, h, mat, x, y, z); box(w, d - 2 * r, h, mat, x, y, z); box(w - 2 * r, d - 2 * r, h + r, mat, x, y, z);
  };
  // Faces of a box: +x (front), -x (rear), +y (left), -y (right, the doors), +z, -z.
  box(12, 2.55, 1.0, [L({ map: rot(front, Math.PI / 2) }), white, L({ map: mirror(skirt) }), L({ map: skirt }), white, white], 0, 0, 0.32);
  box(11.9, 2.5, 1.5, [P({ map: rot(wind, Math.PI / 2), shininess: 90, specular: 0x8899aa }), P({ color: 0x111a24, shininess: 80 }),
    P({ map: mirror(glass), shininess: 90, specular: 0x667788, emissive: lit }), P({ map: glass, shininess: 90, specular: 0x667788, emissive: lit }), white, white], 0, 0, 1.32);
  soft(12.04, 2.56, 0.45, white, 0, 0, 2.7, 0.18);                       // roof
  soft(3.8, 1.9, 0.34, white, -1.9, 0, 3.12, 0.14);                      // air conditioning
  soft(2.9, 1.7, 0.28, bumper, 2.4, 0, 3.12, 0.12);                      // gas tanks
  const plate = box(2.2, 1.3, 0.04, white, 2.4, 0, 3.42);                // the line's colour, seen from above
  plate.name = "plate";
  box(0.25, 2.6, 0.32, bumper, 6.0, 0, 0.18);
  box(0.25, 2.6, 0.3, bumper, -6.0, 0, 0.18);
  box(0.04, 2.0, 0.16, dkg, 6.13, 0, 0.62);
  box(0.04, 2.2, 0.55, dkg, -6.03, 0, 0.5);
  for (const y of [-0.95, 0.95]) box(0.12, 0.5, 0.2, head, 6.07, y, 0.6);
  for (const y of [-1.0, 1.0]) box(0.08, 0.35, 0.45, tail, -6.03, y, 0.55);
  for (const y of [-0.55, 0.55]) box(0.03, 0.9, 0.04, dkg, 6.03, y, 1.45).rotation.x = y > 0 ? 0.35 : -0.35;
  for (const y of [-1.36, 1.36]) { box(0.5, 0.06, 0.06, dkg, 5.75, y, 2.45); box(0.14, 0.12, 0.55, white, 6.0, y * 1.04, 1.95); }
  for (const [a, b] of [[-0.5, 0.9], [4.1, 5.3]]) {
    box(b - a, 0.04, 2.4, door, (a + b) / 2, -1.29, 0.35);
    box(0.06, 0.06, 2.4, bumper, a, -1.3, 0.35);
    box(0.06, 0.06, 2.4, bumper, b, -1.3, 0.35);
  }
  for (const x of [-2.6, 3.3]) for (const y of [-1.18, 1.18]) {
    const w = new T.Mesh(new T.CylinderGeometry(0.5, 0.5, 0.3, 28), tyre); w.position.set(x, y, 0.5); g.add(w);
    const r = new T.Mesh(new T.CylinderGeometry(0.29, 0.29, 0.32, 20), rim); r.position.set(x, y, 0.5); g.add(r);
    const hc = new T.Mesh(new T.CylinderGeometry(0.12, 0.12, 0.36, 16), hub); hc.position.set(x, y, 0.5); g.add(hc);
  }
  addSigns(T, g, 5.97, 2.64, -5.97, 2.5);
  if (dark) g.add(headlightBeam(T));
  return g;
}

// An OASA trolleybus (ΗΛΠΑΠ / ΕΛΒΟ-Neoplan): yellow all over, a blue-violet sweep across the lower front, a lavender
// and blue wave low on the rear half of each side, dark glass, a long roof fairing and the two trolley poles reaching
// back and up to the wires. 12 m long, along +x, like buildBus.
export function buildTrolley(T: typeof Three, dark: boolean): Three.Group {
  const g = new T.Group();
  const YEL = "#f3cf2c", YEL2 = "#e5bd1c", BLUE = "#3b3f9e", LAV = "#c4c3ee";
  const cv = (w: number, h: number, draw: (x: CanvasRenderingContext2D, w: number, h: number) => void) => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    draw(c.getContext("2d")!, w, h);
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  const poly = (x: CanvasRenderingContext2D, pts: number[][], c: string) => {
    x.fillStyle = c; x.beginPath();
    pts.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b)));
    x.closePath(); x.fill();
  };
  // The lower side, drawn front on the right (u = 1200 at the front): yellow, and towards the rear a blue band low
  // down rising into lavender and blue slanted bars, as on the ΗΛΠΑΠ livery.
  const skirt = cv(1200, 100, (x, w, h) => {
    x.fillStyle = YEL; x.fillRect(0, 0, w, h);
    poly(x, [[0, 58], [520, 70], [560, h], [0, h]], BLUE);
    poly(x, [[300, 8], [360, 8], [330, 48], [270, 48]], LAV);
    poly(x, [[380, 8], [470, 8], [440, 48], [350, 48]], LAV);
    poly(x, [[0, 8], [60, 8], [60, 52], [0, 52]], BLUE);
    poly(x, [[80, 8], [260, 8], [230, 52], [80, 52]], LAV);
    x.fillStyle = YEL2; x.fillRect(0, h - 8, w, 8);
    x.fillStyle = "#16181c";
    for (const u of [300, 960]) { x.beginPath(); x.arc(u, h + 2, 62, Math.PI, 0); x.fill(); }
  });
  const mirror = (t: Three.Texture) => { const c = t.clone(); c.wrapS = T.RepeatWrapping; c.repeat.x = -1; c.needsUpdate = true; return c; };
  // Side glass: dark, nearly black (tinted), the window posts black; a yellow strip above with the maker's name.
  const glass = cv(1200, 150, (x, w, h) => {
    const gr = x.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, dark ? "#1d2735" : "#26303d"); gr.addColorStop(0.4, "#0d1117"); gr.addColorStop(1, "#0a0d12");
    x.fillStyle = gr; x.fillRect(0, 0, w, h);
    x.fillStyle = dark ? "rgba(255,214,140,.10)" : "rgba(255,255,255,.07)"; x.fillRect(60, 40, 1040, 64);
    x.strokeStyle = "#000"; x.lineWidth = 7;
    for (const u of [150, 330, 520, 700, 880, 1040]) { x.beginPath(); x.moveTo(u, 0); x.lineTo(u, h); x.stroke(); }
  });
  // The name towards the front on each side; its own texture per side (the livery is mirrored, letters must not be).
  const band = (left: boolean) => cv(1200, 40, (x, w, h) => {
    x.fillStyle = YEL; x.fillRect(0, 0, w, h);
    x.fillStyle = "#1b1d22"; x.font = "bold 22px Commissioner, Arial, sans-serif"; x.textBaseline = "middle";
    x.textAlign = left ? "left" : "right";
    x.fillText("ΕΛΛΗΝΙΚΗ ΒΙΟΜΗΧΑΝΙΑ ΟΧΗΜΑΤΩΝ", left ? 60 : w - 60, h / 2 + 1);
  });
  // The front below the windscreen: yellow, a blue-violet sweep across it holding the headlights, yellow again below.
  const front = cv(256, 100, (x, w, h) => {
    x.fillStyle = YEL; x.fillRect(0, 0, w, h);
    x.fillStyle = BLUE; x.beginPath();
    x.moveTo(0, 18); x.quadraticCurveTo(w / 2, 52, w, 18); x.lineTo(w, 62); x.quadraticCurveTo(w / 2, 88, 0, 62); x.closePath(); x.fill();
    x.fillStyle = YEL2; x.fillRect(0, h - 10, w, 10);
  });
  // The windscreen: dark glass, black across the top behind the destination display (addSigns), yellow pillars.
  const wind = cv(256, 150, (x, w, h) => {
    const gr = x.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, "#0b0c0e"); gr.addColorStop(0.2, "#0b0c0e"); gr.addColorStop(0.22, dark ? "#24364a" : "#33475f"); gr.addColorStop(1, dark ? "#121c28" : "#1a2634");
    x.fillStyle = gr; x.fillRect(0, 0, w, h);
    x.fillStyle = YEL; x.fillRect(0, 0, 10, h); x.fillRect(w - 10, 0, 10, h);
  });
  const rot = (t: Three.Texture, a: number) => { t.center.set(0.5, 0.5); t.rotation = a; return t; };
  const L = (o: Three.MeshLambertMaterialParameters) => new T.MeshLambertMaterial(o);
  const P = (o: Three.MeshPhongMaterialParameters) => new T.MeshPhongMaterial(o);
  const yel = L({ color: YEL }), dkg = L({ color: 0x22252b }), blk = L({ color: 0x111215 }), tyre = L({ color: 0x141518 });
  const rim = L({ color: 0xb9c0c7 }), hub = L({ color: 0x6d747c }), pole = L({ color: 0x2b2e34 });
  const tail = L({ color: 0xd32f2f, emissive: 0x7a0d0d });
  const lit = dark ? 0x2b2414 : 0x000000;
  const head = L({ color: 0xffffff, emissive: dark ? 0xfff1c9 : 0x777777 }), door = P({ color: 0x0b0f14, shininess: 90, specular: 0x99aabb });
  const box = (w: number, d: number, h: number, mat: Three.Material | Three.Material[], x: number, y: number, z: number) => {
    const me = new T.Mesh(new T.BoxGeometry(w, d, h), mat);
    me.position.set(x, y, z + h / 2);
    g.add(me);
    return me;
  };
  const soft = (w: number, d: number, h: number, mat: Three.Material, x: number, y: number, z: number, r: number) => {
    box(w - 2 * r, d, h, mat, x, y, z); box(w, d - 2 * r, h, mat, x, y, z); box(w - 2 * r, d - 2 * r, h + r, mat, x, y, z);
  };
  // Faces of a box: +x (front), -x (rear), +y (left), -y (right, the doors), +z, -z.
  box(12, 2.55, 1.0, [L({ map: rot(front, Math.PI / 2) }), yel, L({ map: mirror(skirt) }), L({ map: skirt }), yel, yel], 0, 0, 0.32);
  box(11.9, 2.5, 1.32, [P({ map: rot(wind, Math.PI / 2), shininess: 90, specular: 0x8899aa }), P({ color: 0x0d1117, shininess: 80 }),
    P({ map: mirror(glass), shininess: 90, specular: 0x667788, emissive: lit }), P({ map: glass, shininess: 90, specular: 0x667788, emissive: lit }), yel, yel], 0, 0, 1.32);
  box(11.96, 2.53, 0.24, [yel, yel, L({ map: band(true) }), L({ map: band(false) }), yel, yel], 0, 0, 2.64);   // the strip with the name
  soft(12.04, 2.56, 0.3, yel, 0, 0, 2.86, 0.16);                          // roof
  soft(7.6, 2.1, 0.42, yel, -0.9, 0, 3.12, 0.16);                         // the long equipment fairing
  const plate = box(2.2, 1.3, 0.04, yel, 2.0, 0, 3.55);                   // the line's colour, seen from above
  plate.name = "plate";
  // The trolley poles: a black base on the fairing, two poles 60 cm apart reaching 6.6 m back and up to the
  // wires (about 5.7 m up), each with its collector shoe at the tip.
  box(1.2, 1.2, 0.18, blk, 1.0, 0, 3.54);
  const rod = (a: Three.Vector3, b: Three.Vector3, r0: number, r1: number, mat: Three.Material) => {
    const d = b.clone().sub(a), me = new T.Mesh(new T.CylinderGeometry(r1, r0, d.length(), 8), mat);
    me.position.copy(a).add(b).multiplyScalar(0.5);
    me.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize());   // from a (r0) to b (r1)
    g.add(me);
  };
  const len = 6.6, base = 3.75, wire = 5.7, back = Math.sqrt(len * len - (wire - base) ** 2);
  for (const y of [-0.3, 0.3]) {
    const a = new T.Vector3(1.0, y, base), b = new T.Vector3(1.0 - back, y, wire);
    rod(a, b, 0.05, 0.035, pole);
    rod(new T.Vector3(1.45, y, 3.8), new T.Vector3(0.95, y, 3.8), 0.09, 0.09, blk);   // the spring housing
    const shoe = new T.Mesh(new T.BoxGeometry(0.34, 0.1, 0.12), blk);
    shoe.position.set(b.x - 0.05, y, b.z + 0.02);
    g.add(shoe);
  }
  // Retaining hooks at the rear of the roof, where the poles are tied down when lowered.
  for (const y of [-0.3, 0.3]) box(0.12, 0.12, 0.3, blk, -5.6, y, 3.12);
  box(0.28, 2.6, 0.3, yel, 6.0, 0, 0.16);                                // bumpers, yellow like the body
  box(0.28, 2.6, 0.3, yel, -6.0, 0, 0.16);
  box(0.04, 2.2, 0.55, dkg, -6.03, 0, 0.5);
  for (const y of [-0.85, 0.85]) box(0.12, 0.42, 0.18, head, 6.07, y, 0.66);
  for (const y of [-1.0, 1.0]) box(0.08, 0.35, 0.45, tail, -6.03, y, 0.55);
  for (const y of [-0.55, 0.55]) box(0.03, 0.9, 0.04, blk, 6.03, y, 1.45).rotation.x = y > 0 ? 0.35 : -0.35;
  // Mirrors on black stalks, hanging forward at the top of the windscreen.
  for (const y of [-1.36, 1.36]) { box(0.6, 0.06, 0.06, blk, 6.2, y, 2.5); box(0.14, 0.12, 0.6, blk, 6.45, y * 1.04, 1.95); }
  for (const [a, b] of [[-1.2, 0.2], [3.9, 5.2]]) {
    box(b - a, 0.04, 2.3, door, (a + b) / 2, -1.29, 0.35);
    box(0.06, 0.06, 2.3, yel, a, -1.3, 0.35);
    box(0.06, 0.06, 2.3, yel, b, -1.3, 0.35);
  }
  for (const x of [-3.3, 3.1]) for (const y of [-1.18, 1.18]) {
    const w = new T.Mesh(new T.CylinderGeometry(0.5, 0.5, 0.3, 28), tyre); w.position.set(x, y, 0.5); g.add(w);
    const r = new T.Mesh(new T.CylinderGeometry(0.29, 0.29, 0.32, 20), rim); r.position.set(x, y, 0.5); g.add(r);
    const hc = new T.Mesh(new T.CylinderGeometry(0.12, 0.12, 0.36, 16), hub); hc.position.set(x, y, 0.5); g.add(hc);
  }
  addSigns(T, g, 5.97, 2.48, -5.97, 2.36);
  if (dark) g.add(headlightBeam(T));
  return g;
}

// An Athens tram (Alstom Citadis, STASY's orange): five cars, 33.6 m, a cab at each end, the pantograph on the
// middle car. Each car is its own group along +x, centred, with userData { front, len }: how far its front end is
// behind the tram's front, and its length (Scene3D lays each on the track). Real size; Scene3D widens it.
// Shaped as the real one is: rounded roof edges, a raked windscreen over a black chin with oval lamps, an orange
// lip and cap round the cab, flush glass doors in orange frames, black bellows between the cars, low rounded roof
// fairings and a single-arm pantograph.
export function buildTram(T: typeof Three, dark: boolean): Three.Group {
  const root = new T.Group();
  const P = (o: Three.MeshPhongMaterialParameters) => new T.MeshPhongMaterial(o);
  const L = (o: Three.MeshLambertMaterialParameters) => new T.MeshLambertMaterial(o);
  const org = P({ color: 0xec7428, shininess: 40, specular: 0x3a2412 }), org2 = P({ color: 0xd8641e, shininess: 30, specular: 0x2a1a0e });
  const blk = P({ color: 0x121316, shininess: 50, specular: 0x333333 }), rubber = L({ color: 0x1a1b1e });
  const grey = P({ color: 0xb8bec5, shininess: 80, specular: 0x888888 }), metal = L({ color: 0x55595f });
  const lit = dark ? 0x2b2414 : 0x000000;
  const glass = P({ color: 0x0c1118, shininess: 110, specular: 0x8899aa, emissive: lit });
  const screen = P({ color: dark ? 0x172231 : 0x1c2a3a, shininess: 120, specular: 0xa0b0c0 });
  const head = L({ color: 0xffffff, emissive: dark ? 0xfff1c9 : 0x888888 }), red = L({ color: 0xd32f2f, emissive: 0x8a1010 });
  const W = 2.4, FLOOR = 0.12, SILL = 1.05, HEAD = 2.55, ROOF = 3.0;
  // A profile (u along the car's length, outward from a cab end; v up) extruded across the car's width, edges rounded.
  const across = (pts: [number, number][], width: number, mat: Three.Material, bevel = 0.05) => {
    const geo = new T.ExtrudeGeometry(new T.Shape(pts.map(([u, v]) => new T.Vector2(u, v))),
      { depth: width - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.6, bevelSegments: 3, curveSegments: 6 });
    geo.applyMatrix4(new T.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1));   // u → x, v → z, depth → -y
    geo.translate(0, (width - 2 * bevel) / 2, 0);
    return new T.Mesh(geo, mat);
  };
  // A cross-section (u across the width, v up) extruded along a car's length.
  const along = (shape: Three.Shape, len: number, mat: Three.Material) => {
    const geo = new T.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, curveSegments: 6 });
    geo.applyMatrix4(new T.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));   // depth → x, u → y, v → z
    geo.translate(-len / 2, 0, 0);
    return new T.Mesh(geo, mat);
  };
  // The roof's cross-section: the car's width, its top corners rounded off (r 0.32 m).
  const roofShape = (w: number, z0: number, z1: number, r: number) => {
    const sh = new T.Shape(), h = w / 2;
    sh.moveTo(-h, z0); sh.lineTo(h, z0); sh.lineTo(h, z1 - r); sh.quadraticCurveTo(h, z1, h - r, z1);
    sh.lineTo(-h + r, z1); sh.quadraticCurveTo(-h, z1, -h, z1 - r); sh.closePath();
    return sh;
  };
  const rod = (g: Three.Group, a: Three.Vector3, b: Three.Vector3, r: number, mat: Three.Material) => {
    const d = b.clone().sub(a), me = new T.Mesh(new T.CylinderGeometry(r, r, d.length(), 8), mat);
    me.position.copy(a).add(b).multiplyScalar(0.5);
    me.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize());
    g.add(me);
  };
  const cars: [number, boolean, boolean][] = [[8.6, true, false], [6.0, false, false], [3.4, false, true], [6.0, false, false], [8.6, true, false]];
  let front = 0;
  cars.forEach(([len, cab, panto], k) => {
    const g = new T.Group();
    g.userData = { front, len };
    front += len + 0.25;   // the bellows between cars
    const box = (w: number, d: number, h: number, mat: Three.Material, x: number, y: number, z: number) => {
      const me = new T.Mesh(new T.BoxGeometry(w, d, h), mat);
      me.position.set(x, y, z + h / 2);
      g.add(me);
      return me;
    };
    const nose = cab ? (k === 0 ? 1 : -1) : 0;    // which end is a cab: +x on the first car, -x on the last
    const body = cab ? len - 0.45 : len;           // the cab's nose (0.45 m) is shaped separately
    const bx = cab ? -nose * 0.225 : 0;            // the body's centre, shifted off the nose
    const half = body / 2, fx = bx + nose * half;  // fx: where the body meets the nose
    // The body: black underframe, orange below the windows, glass, orange above, the rounded roof.
    box(body, W - 0.3, 0.3, blk, bx, 0, 0.02);
    box(body, W, SILL - FLOOR, org, bx, 0, FLOOR);
    box(body - 0.04, W - 0.04, HEAD - SILL, glass, bx, 0, SILL);
    const roof = along(roofShape(W, HEAD, ROOF, 0.32), body, org); roof.position.x = bx; g.add(roof);
    // Window frames: black lines under and over the glass, and the posts between the panes.
    for (const y of [-W / 2 - 0.004, W / 2 + 0.004]) {
      box(body, 0.01, 0.06, blk, bx, y, SILL - 0.03);
      box(body, 0.01, 0.05, blk, bx, y, HEAD - 0.02);
      const panes = Math.max(1, Math.round(body / 1.9));
      for (let i = 1; i < panes; i++) box(0.07, 0.01, HEAD - SILL, blk, bx - half + (i * body) / panes, y, SILL);
    }
    // Doors on both sides: two glass leaves to the floor, in orange frames, a black seal down the middle.
    const doors = cab ? [bx - nose * 0.4] : len > 4 ? [bx] : [];
    for (const dx of doors) for (const y of [-W / 2 - 0.006, W / 2 + 0.006]) {
      box(1.32, 0.012, HEAD - 0.32, glass, dx, y, 0.3);
      for (const e of [-0.68, 0.68]) box(0.1, 0.02, HEAD - 0.3, org2, dx + e, y, 0.3);
      box(1.42, 0.02, 0.08, org2, dx, y, HEAD - 0.06);
      box(0.03, 0.022, HEAD - 0.32, rubber, dx, y, 0.3);
      for (const e of [-0.33, 0.33]) box(0.6, 0.016, 0.03, grey, dx + e, y, 1.1);   // handrails seen through the glass
    }
    if (cab) {
      // The nose, profiles drawn outward from the body (u) and up (v), mirrored on the rear cab.
      const at = (m: Three.Mesh) => { m.position.x = fx; if (nose < 0) m.scale.x = -1; g.add(m); return m; };
      at(across([[0, 0.02], [0.32, 0.06], [0.36, 0.28], [0, 0.28]], W - 0.04, org));               // the orange lip
      at(across([[0, 0.28], [0.36, 0.28], [0.44, 0.62], [0.42, SILL], [0, SILL]], W - 0.06, blk)); // the black chin
      at(across([[0, SILL], [0.42, SILL], [0.2, HEAD + 0.05], [0, HEAD + 0.05]], W - 0.2, screen, 0.03));   // windscreen
      for (const y of [-(W / 2 - 0.07), W / 2 - 0.07]) {                                              // orange pillars
        const pil = at(across([[0, SILL], [0.43, SILL], [0.21, HEAD + 0.05], [0, HEAD + 0.05]], 0.14, org, 0.02));
        pil.position.y = y;
      }
      at(across([[0, HEAD + 0.05], [0.21, HEAD + 0.05], [0.1, ROOF - 0.06], [0, ROOF]], W - 0.04, org, 0.12));   // cap
      at(across([[0, HEAD - 0.32], [0.264, HEAD - 0.32], [0.214, HEAD + 0.05], [0, HEAD + 0.05]], W - 0.24, blk, 0.01));   // black band
      // Wiper, oval lamps (white ahead, red behind), the display high in the windscreen.
      const s = nose;
      rod(g, new T.Vector3(fx + s * 0.4, 0.55, SILL + 0.1), new T.Vector3(fx + s * 0.3, -0.2, SILL + 0.85), 0.018, blk);
      for (const y of [-0.82, 0.82]) {
        const ring = new T.Mesh(new T.CylinderGeometry(0.2, 0.2, 0.05, 24), grey);
        ring.scale.set(1, 1, 0.72); ring.rotation.z = Math.PI / 2; ring.position.set(fx + s * 0.44, y, 0.7); g.add(ring);
        const lamp = new T.Mesh(new T.CylinderGeometry(0.09, 0.09, 0.06, 16), k === 0 ? head : red);
        lamp.rotation.z = Math.PI / 2; lamp.position.set(fx + s * 0.46, y + (y > 0 ? -0.05 : 0.05), 0.7); g.add(lamp);
      }
      const sign = new T.PlaneGeometry(1.5, 0.24);
      sign.rotateX(Math.PI / 2); sign.rotateZ(s * Math.PI / 2);
      const sm = new T.Mesh(sign, new T.MeshBasicMaterial({ color: 0x050506 }));
      sm.name = "sign"; sm.position.set(fx + s * 0.262, 0, HEAD - 0.15); sm.rotation.y = -s * 0.14; g.add(sm);
    }
    // Bellows at each joint (on the cars' fronts): black, ribbed, a little smaller than the body.
    if (k > 0) for (let r = 0; r < 3; r++) {
      const rib = along(roofShape(W - 0.16 - (r % 2) * 0.06, FLOOR + 0.1, ROOF - 0.08, 0.28), 0.08, rubber);
      rib.position.x = half + 0.04 + r * 0.06; g.add(rib);
    }
    // On the roof: low rounded fairings over the equipment, with louvres; the pantograph on the middle car.
    if (len > 4) {
      const f = along(roofShape(1.6, ROOF - 0.02, ROOF + 0.3, 0.14), body * 0.62, org2); f.position.x = bx; g.add(f);
      for (const sx of [-1, 1]) box(body * 0.3, 0.01, 0.12, blk, bx + sx * body * 0.12, 0.81, ROOF + 0.08);
    }
    if (panto) {
      box(1.6, 1.3, 0.12, metal, 0, 0, ROOF - 0.02);
      for (const y of [-0.55, 0.55]) box(0.12, 0.12, 0.18, grey, 0.6, y, ROOF + 0.1);   // insulators
      // Single arm: a lower arm back and up to the knee, an upper arm forward and up to the head.
      const base = new T.Vector3(0.55, 0, ROOF + 0.18), knee = new T.Vector3(-0.85, 0, ROOF + 1.05), top = new T.Vector3(0.25, 0, 5.55);
      for (const y of [-0.22, 0.22]) rod(g, base.clone().setY(y), knee.clone().setY(y * 0.3), 0.035, metal);
      rod(g, knee, top, 0.03, metal);
      rod(g, new T.Vector3(0.45, 0, ROOF + 0.2), new T.Vector3(-0.3, 0, ROOF + 0.75), 0.02, metal);   // the push rod
      // The head: two contact strips across, horns bent down at the ends.
      for (const dx of [-0.12, 0.12]) {
        box(0.07, 1.3, 0.05, grey, top.x + dx, 0, 5.56);
        for (const sy of [-1, 1]) rod(g, new T.Vector3(top.x + dx, sy * 0.65, 5.585), new T.Vector3(top.x + dx, sy * 0.86, 5.45), 0.02, grey);
      }
      rod(g, new T.Vector3(top.x - 0.12, 0, 5.56), new T.Vector3(top.x + 0.12, 0, 5.56), 0.02, metal);
    }
    root.add(g);
  });
  return root;
}


// A base-map layer filter as an expression, so it can be combined with one: expressions pass as they are; the legacy
// forms the base map uses (all/any/none, ==, !=, <, <=, >, >=, in, !in, has, !has, $type) are converted; null for
// anything else.
/** A style's line width (a number, a zoom interpolate, or a legacy stops function) with every width multiplied by
 *  `by(zoom)`: one interpolate over the zoom, with its own stops and stops at 12, 14 and 16 (the style allows one zoom
 *  interpolate in an expression, so the factor cannot be a second one). Null for a width this cannot read. */
export function widenBy(w: unknown, by: (z: number) => number): unknown {
  let base = 1, stops: [number, number][] | null = null;
  if (typeof w === "number") stops = [[0, w], [24, w]];
  else if (w && typeof w === "object" && !Array.isArray(w) && Array.isArray((w as { stops?: unknown }).stops)) {
    const f = w as { base?: number; stops: unknown[] };
    base = f.base ?? 1;
    stops = f.stops.map(s => (Array.isArray(s) && typeof s[0] === "number" && typeof s[1] === "number" ? [s[0], s[1]] as [number, number] : null)).filter((s): s is [number, number] => !!s);
    if (stops.length !== f.stops.length) return null;
  } else if (Array.isArray(w) && w[0] === "interpolate" && Array.isArray(w[2]) && w[2][0] === "zoom" && Array.isArray(w[1])) {
    if (w[1][0] === "exponential") base = w[1][1] as number; else if (w[1][0] !== "linear") return null;
    stops = [];
    for (let i = 3; i + 1 < w.length; i += 2) { if (typeof w[i] !== "number" || typeof w[i + 1] !== "number") return null; stops.push([w[i] as number, w[i + 1] as number]); }
  }
  if (!stops || stops.length < 1) return null;
  const at = (z: number) => {
    const st = stops!;
    if (z <= st[0][0]) return st[0][1];
    if (z >= st[st.length - 1][0]) return st[st.length - 1][1];
    let i = 0;
    while (st[i + 1][0] < z) i++;
    const [z0, w0] = st[i], [z1, w1] = st[i + 1], d = z1 - z0;
    const t = d === 0 ? 0 : base === 1 ? (z - z0) / d : (Math.pow(base, z - z0) - 1) / (Math.pow(base, d) - 1);
    return w0 + (w1 - w0) * t;
  };
  const zs = [...new Set([...stops.map(s => s[0]), 12, 14, STREET_ZOOM])].sort((a, b) => a - b);
  return ["interpolate", base === 1 ? ["linear"] : ["exponential", base], ["zoom"], ...zs.flatMap(z => [z, at(z) * by(z)])];
}

export function asExpression(f: unknown): unknown {
  if (!Array.isArray(f) || typeof f[0] !== "string") return f === true || f === false ? f : null;
  const [op, ...args] = f as [string, ...unknown[]];
  const legacy = typeof args[0] === "string" && !["all", "any", "none"].includes(op);
  if (!legacy) {
    if (op === "all" || op === "any" || op === "none") {
      const parts = args.map(asExpression);
      if (parts.some(p => p === null)) return null;
      // An expression filter's own "all"/"any" passes through; "none" (legacy only) becomes a negated "any".
      return op === "none" ? ["!", ["any", ...parts]] : [op, ...parts];
    }
    return f;   // already an expression
  }
  const key = args[0] as string;
  const get = key === "$type" ? ["geometry-type"] : key === "$id" ? ["id"] : ["get", key];
  const vals = args.slice(1);
  switch (op) {
    case "==": case "!=": case "<": case "<=": case ">": case ">=":
      return [op, get, vals[0]];
    case "in": return ["match", get, vals, true, false];
    case "!in": return ["match", get, vals, false, true];
    case "has": return key === "$type" || key === "$id" ? true : ["has", key];
    case "!has": return key === "$type" || key === "$id" ? false : ["!", ["has", key]];
    default: return null;
  }
}

// ---- The metro train: six cars about 17.5 m long and 2.8 m wide (Athens' metro), in its line's livery (liveryOf):
// M1's green with steel; M2 and M3's silver with the green stripe and a black nose; the airport's silver with the
// orange stripe and a silver face. Each car centred on its own origin, its front toward +x, userData { front, len }
// for its place along the train's trail (as the tram's cars). A cab at both ends of the train.
const TUBE_R = 3.3;   // a single-track tube, its wall about 1 m clear of the train
const BORE_R = 5.4;   // the twin-track bore: both tracks, about 1 m clear of each train
const SPLIT_GAP = 6;  // tracks farther apart than this (round an island platform) each get their own tube
// A train: six cars of 17.5 m with their gaps. The timetable's place is its middle (MapView), so at a station it stands
// centred along the platform, which is a little longer than it.
export const TRAIN_LEN = 6 * 17.5 + 5 * 0.6;
export const ST_LEN = 130;
const LINE_COLOR: Record<string, string> = { M1: "#16a34a", M2: "#e2231a", M3: "#0a7cc4" };
export function buildMetro(T: typeof Three, livery: Livery, dark: boolean): Three.Group {
  if (livery === "airport") return buildAirportTrain(T, dark);
  const root = new T.Group();
  const P = (color: number, o: Three.MeshPhongMaterialParameters = {}) => new T.MeshPhongMaterial({ color, shininess: 60, specular: 0x555555, ...o });
  const look = {
    m1: { body: 0x23a148, roof: 0xb8bec5, stripe: 0xb8bec5, cab: 0x23a148, frame: 0xb8bec5 },
    m23: { body: 0xdfe3e8, roof: 0xc9ced5, stripe: 0x7cc242, cab: 0x15191f, frame: 0x15191f },
    airport: { body: 0xc4cad1, roof: 0xb2b8c0, stripe: 0xf08a24, cab: 0xb4bac2, frame: 0xb4bac2 },
  }[livery];
  const body = P(look.body), roof = P(look.roof), stripe = P(look.stripe, { shininess: 30 }), cab = P(look.cab, { shininess: 90 });
  const under = new T.MeshLambertMaterial({ color: 0x2a2d32 }), door = P(look.body === 0x23a148 ? 0x1f8e3f : 0xb3b9c1);
  const glass = P(0x10151c, { shininess: 120, specular: 0x8899aa, emissive: dark ? 0x1d2635 : 0x111821 });
  const lamp = new T.MeshBasicMaterial({ color: 0xffffff }), led = new T.MeshBasicMaterial({ color: 0xff9a1f });
  const W = 2.8, LEN = 17.5, GAP = 0.6;
  const box = (g: Three.Group, w: number, d: number, h: number, x: number, y: number, z: number, mat: Three.Material) => {
    const me = new T.Mesh(new T.BoxGeometry(w, d, h), mat);
    me.position.set(x, y, z);
    g.add(me);
  };
  for (let c = 0; c < 6; c++) {
    const car = new T.Group(), L = LEN;
    car.rotation.order = "ZYX";   // turned along the track, then tilted up a ramp
    car.userData = { front: c * (LEN + GAP), len: L };
    box(car, L - 0.4, W - 0.3, 0.9, 0, 0, 0.45, under);
    box(car, L, W, 2.6, 0, 0, 2.2, body);
    box(car, L - 0.2, W - 0.3, 0.3, 0, 0, 3.65, roof);
    box(car, L - 1.2, W + 0.04, 0.95, 0, 0, 2.6, glass);                     // the windows, both sides
    box(car, L, W + 0.06, 0.3, 0, 0, 1.45, stripe);                          // the stripe low along the side
    for (const dx of [-L * 0.24, L * 0.24]) box(car, 1.45, W + 0.08, 2.0, dx, 0, 2.0, door);
    for (const end of c === 0 ? [1] : c === 5 ? [-1] : []) {
      const x = end * (L / 2 - 0.35);
      box(car, 0.75, W + 0.02, 2.7, x, 0, 2.25, cab);                        // the face
      box(car, 0.8, W - 0.5, 1.1, x, 0, 2.75, glass);                        // the windscreen
      box(car, 0.82, 1.3, 0.22, x, 0, 3.42, led);                            // the destination sign
      box(car, 0.82, W + 0.04, 0.3, x, 0, 1.45, stripe);
      for (const dy of [-0.95, 0.95]) box(car, 0.84, 0.32, 0.22, x, dy, 1.85, lamp);
    }
    root.add(car);
  }
  return root;
}

// The airport's train (M3 to and from the airport; the photos of it at Doukissis Plakentias): brushed steel; a rounded
// cab, its black windscreen raked back and wrapping round the corners, the destination in amber LEDs at its top; an
// orange band across the face with a headlamp and a red lamp each side and the Metro's white roundel between; a thin
// orange line along each side; four double doors a side with windows in them; air conditioning on the roof and a
// pantograph, folded (the airport stretch runs under wires; under the street it takes the third rail). Six cars, as
// buildMetro's, a cab at both ends.
function buildAirportTrain(T: typeof Three, dark: boolean): Three.Group {
  const root = new T.Group();
  const P = (color: number, o: Three.MeshPhongMaterialParameters = {}) => new T.MeshPhongMaterial({ color, shininess: 70, specular: 0x666666, ...o });
  const steel = P(0xc8cdd3, { shininess: 95, specular: 0x8c8c8c }), doorM = P(0xd7dce1, { shininess: 95, specular: 0x8c8c8c });
  const roofM = P(0xadb3bb, { shininess: 35 }), orange = P(0xee6f1f, { shininess: 45 });
  const glass = P(0x0e131a, { shininess: 140, specular: 0x9aaabb, emissive: dark ? 0x1b2433 : 0x0b1017 });
  const under = new T.MeshLambertMaterial({ color: 0x2a2d32 }), black = new T.MeshLambertMaterial({ color: 0x15181c });
  const lampOn = new T.MeshBasicMaterial({ color: 0xffffff }), lampOff = P(0xd9dee3), redOn = new T.MeshBasicMaterial({ color: 0xff2a2a }), redOff = P(0x7a1515);
  const led = new T.MeshBasicMaterial({ color: 0xff8a1a }), roundel = new T.MeshBasicMaterial({ color: 0xf3f5f7 }), mark = new T.MeshBasicMaterial({ color: 0x2a62ad });
  const W = 2.8, HW = W / 2, LEN = 17.5, GAP = 0.6, half = LEN / 2;
  const BASE = 0.78, TOP = 3.75, NOSE = 2.4, R = 0.72, RR = 0.42;
  // A point of a car's box, made into the car's shape: the roof's edges rounded; toward a cab end (e: +1 the car's
  // +x end, -1 its -x end) the face drawn back, raked above the band, tucked under below it, its corners round in plan.
  const shape = (x: number, y: number, z: number, ends: number[]): [number, number] => {
    let fy = 1;
    if (z > TOP - RR) { const k = Math.min(1, (z - TOP + RR) / RR); fy = (HW - RR + RR * Math.sqrt(1 - k * k)) / HW; }
    for (const e of ends) {
      let xe = x * e;
      if (xe <= half - NOSE) continue;
      const set = z > 2.55 ? 0.62 * Math.pow(Math.min(1, (z - 2.55) / (TOP - 2.55)), 1.3) : z < 1.3 ? 0.2 * Math.min(1, (1.3 - z) / (1.3 - BASE)) : 0;
      const x0 = half - NOSE;
      xe = x0 + ((xe - x0) * (NOSE - set)) / NOSE;
      const q = Math.min(1, Math.max(0, xe - (half - set - R)) / R);
      fy *= (HW - R + R * Math.sqrt(1 - q * q)) / HW;
      x = xe * e;
    }
    return [x, y * fy];
  };
  // A box (x0..x1 along the car, ±hy across, z0..z1 up), shaped as the car is; seg cuts along it, zseg up it.
  const part = (car: Three.Group, ends: number[], x0: number, x1: number, hy: number, z0: number, z1: number, mat: Three.Material, seg = 1, zseg = 1) => {
    const g = new T.BoxGeometry(x1 - x0, 2 * hy, z1 - z0, seg, 1, zseg);
    g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const p = g.attributes.position as Three.BufferAttribute;
    for (let i = 0; i < p.count; i++) { const [x, y] = shape(p.getX(i), p.getY(i), p.getZ(i), ends); p.setXY(i, x, y); }
    g.computeVertexNormals();
    car.add(new T.Mesh(g, mat));
  };
  // The whole length of a car (out over its cab ends by `out`), cut finely along each nose.
  const along = (car: Three.Group, ends: number[], hy: number, z0: number, z1: number, mat: Three.Material, zseg = 1, out = 0) => {
    const a = ends.includes(-1) ? -half - out : -half, b = ends.includes(1) ? half + out : half;
    const n0 = ends.includes(-1) ? -half + NOSE : a, n1 = ends.includes(1) ? half - NOSE : b;
    if (ends.includes(-1)) part(car, ends, a, n0, hy, z0, z1, mat, 16, zseg);
    part(car, ends, n0, n1, hy, z0, z1, mat, 1, zseg);
    if (ends.includes(1)) part(car, ends, n1, b, hy, z0, z1, mat, 16, zseg);
  };
  const blk = (car: Three.Group, x: number, y: number, z: number, sx: number, sy: number, sz: number, mat: Three.Material) => {
    const me = new T.Mesh(new T.BoxGeometry(sx, sy, sz), mat);
    me.position.set(x, y, z);
    car.add(me);
    return me;
  };
  const DOORS = [-5.7, -2, 2, 5.7];
  for (let c = 0; c < 6; c++) {
    const car = new T.Group();
    car.rotation.order = "ZYX";   // turned along the track, then tilted up a ramp
    car.userData = { front: c * (LEN + GAP), len: LEN };
    const ends = c === 0 ? [1] : c === 5 ? [-1] : [];
    along(car, ends, HW, BASE, TOP, steel, 12);                              // the body
    along(car, ends, HW + 0.01, 1.74, 1.86, orange, 1, 0.012);               // the line along the side, round the nose
    blk(car, 0, 0, 0.62, LEN - 1.4, W - 0.5, 0.36, under);                   // under the floor
    for (const bx of [-(half - 2.6), half - 2.6]) blk(car, bx, 0, 0.4, 2.5, W - 0.6, 0.45, black);   // the bogies
    // Windows between the doors and toward each end (the cab's own side window, below).
    const stops = [ends.includes(-1) ? -half + NOSE + 0.1 : -half + 0.55, ...DOORS.flatMap(d => [d - 0.85, d + 0.85]), ends.includes(1) ? half - NOSE - 0.1 : half - 0.55];
    for (let i = 0; i + 1 < stops.length; i += 2) if (stops[i + 1] - stops[i] > 0.4) part(car, [], stops[i], stops[i + 1], HW + 0.008, 2.3, 3.05, glass);
    for (const d of DOORS) {
      part(car, [], d - 0.65, d + 0.65, HW + 0.014, 1.02, 3.15, doorM);
      for (const lx of [d - 0.55, d + 0.1]) part(car, [], lx, lx + 0.45, HW + 0.02, 2.25, 2.95, glass);
      part(car, [], d - 0.012, d + 0.012, HW + 0.022, 1.02, 3.15, black);
    }
    // The roof: air conditioning at each end, the pantograph folded on the second car from each end.
    for (const ax of [-4.3, 4.3]) blk(car, ax, 0, TOP + 0.1, 2.6, 1.7, 0.3, roofM);
    if (c === 1 || c === 4) {
      blk(car, 0, 0, TOP + 0.08, 1.8, 1.3, 0.12, black);                     // its frame on the insulators
      for (const dy of [-0.35, 0.35]) blk(car, 0.1, dy, TOP + 0.24, 1.6, 0.05, 0.05, black).rotation.y = -0.12;   // the folded arms
      blk(car, 0.9, 0, TOP + 0.34, 0.12, 1.7, 0.06, black);                  // the collector head
    }
    if (c > 0) blk(car, half + GAP / 2, 0, 2.3, GAP + 0.1, 2.1, 2.5, black); // the gangway to the car ahead
    for (const e of ends) {
      const lead = c === 0;   // the front cab: headlamps lit; the back one: its red lamps
      const lo = e > 0 ? half - 0.85 : -half - 0.03, hi = e > 0 ? half + 0.03 : -half + 0.85;
      part(car, ends, lo, hi, HW + 0.025, 2.12, 2.5, orange, 10, 2);         // the band across the face
      const wlo = e > 0 ? half - 0.7 : -half - 0.025, whi = e > 0 ? half + 0.025 : -half + 0.7;
      part(car, ends, wlo, whi, HW + 0.02, 2.62, 3.58, glass, 10, 8);        // the windscreen, round the corners
      const llo = e > 0 ? half - 0.3 : -half - 0.045, lhi = e > 0 ? half + 0.045 : -half + 0.3;
      part(car, ends, llo, lhi, 0.52, 3.34, 3.5, led, 4, 2);                 // the destination
      const slo = e > 0 ? half - 2.05 : -half + 1.3, shi = e > 0 ? half - 1.3 : -half + 2.05;
      part(car, ends, slo, shi, HW + 0.012, 2.4, 3.1, glass, 4, 1);          // the cab's side window
      // On the band's face: a headlamp and a red lamp each side, the roundel between; below, the coupler.
      const fx = e * (half + 0.05);
      for (const sy of [-1, 1]) {
        blk(car, fx, sy * 0.53, 2.31, 0.04, 0.3, 0.26, black);                 // the lamp's housing
        blk(car, fx + e * 0.012, sy * 0.55, 2.31, 0.04, 0.2, 0.15, lead ? lampOn : lampOff);
        const r = new T.Mesh(new T.CylinderGeometry(0.085, 0.085, 0.04, 16), lead ? redOff : redOn);
        r.rotation.z = Math.PI / 2;
        r.position.set(fx + e * 0.012, sy * 0.3, 2.31);
        car.add(r);
      }
      const disc = new T.Mesh(new T.CylinderGeometry(0.15, 0.15, 0.04, 24), roundel);
      disc.rotation.z = Math.PI / 2;
      disc.position.set(fx, 0, 2.31);
      car.add(disc);
      blk(car, fx + e * 0.012, 0, 2.31, 0.03, 0.16, 0.05, mark);              // the roundel's M, as a stroke
      blk(car, e * (half + 0.1), 0, 0.85, 0.45, 0.45, 0.3, black);            // the coupler
    }
    root.add(car);
  }
  return root;
}

// The point of a line (local metres) nearest a point, the line's direction there (radians) and how far off it is.
function onLine(line: [number, number][], p: [number, number]): { at: [number, number]; ang: number; d: number } | null {
  let out: { at: [number, number]; ang: number; d: number } | null = null;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1], [bx, by] = line[i], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    if (!L2) continue;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2)), x = ax + dx * t, y = ay + dy * t;
    const d = Math.hypot(p[0] - x, p[1] - y);
    if (!out || d < out.d) out = { at: [x, y], ang: Math.atan2(dy, dx), d };
  }
  return out;
}
