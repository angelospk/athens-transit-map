<script lang="ts">
  import { LngLatBounds, Map as MlMap, Marker, NavigationControl, Popup, setWorkerUrl, type ExpressionSpecification, type FilterSpecification, type GeoJSONSource,
    type MapGeoJSONFeature } from "maplibre-gl";
  import "maplibre-gl/dist/maplibre-gl.css";
  import workerUrl from "virtual:maplibre-worker";
  import { debounce, throttle } from "../debounce";
  import { ageLabel, dayMonth, gtfsEnded, isGonePos, isStalePos, passes, type AgeMode } from "../format";
  import { untrack } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import type { LngLat } from "../glide";
  import { vehicleHeading } from "../heading";
  import { metroFC } from "../metro";
  import { suburbanFC } from "../suburban";
  import { trainsFC } from "../trains";
  import { RailGlide, trackStops, type Track } from "../rails";
  import { fetchStasy, fetchSuburban, fetchTrainRun } from "../api";
  import { PREFETCH_ZOOM, wanted, type Want } from "../prefetch";
  import { Locator, userPlan, type Fix, type LocState } from "../locate";
  import { Mover, planOnto } from "../motion";
  import { shapeLength, stopOffsets } from "../predict";
  import { loadSpeed, SPEED_STOPS, type SpeedData } from "../speed";
  import { resolveDark } from "../theme";
  import type { Variant } from "../types";
  import type { AppState } from "../state.svelte";
  import SpeedLegend from "../ui/SpeedLegend.svelte";
  import { lightenDark } from "./basemap";
  import { Fleet, routeGeom, type FleetEntry, type RouteGeom } from "./fleet";
  import { bounds, routesFC, stopsFC, variantFC, type DrawnLine } from "./layers";
  import { STOPS_ZOOM, busStopsFC, stopIndex } from "../stops";
  import { STOP_ZOOM, VEHICLE_ZOOM, focusZoom, sheetReserve, stopPin } from "../focus";
  import { busStopCard, busVehicleCard, railStationCard, routeCard, stationCard } from "../legacy";
  // Rail stations show from these zooms, small like the bus stops (from STOPS_ZOOM); there are fewer of them.
  const RAIL_ZOOM = 13, SUBURBAN_ZOOM = 12;
  const TRACK_SHIFT = 3;   // a moving train off its line's centre, in its image's pixels (B5)
  const POINTER_K = 0.68;  // a train's heading pointer, against its square
  import type { TripIndex } from "../trip";

  setWorkerUrl(workerUrl);

  let { app }: { app: AppState } = $props();

  const FOLLOW_VIEW_MS = 2000;   // following the user: the view is reported this often
  const VIEW_SETTLE_MS = 300;   // the map must rest this long before the city layer asks for tiles
  const DELAY_CLASSES = ["ontime", "late1", "late2", "late3", "none"];
  const STYLE = (dark: boolean) => `https://tiles.openfreemap.org/styles/${dark ? "dark" : "positron"}`;
  const EMPTY = { type: "FeatureCollection" as const, features: [] };
  const COS_LAT = Math.cos((37.98 * Math.PI) / 180);
  const M_PER_PX_Z0 = 156_543.03 * COS_LAT;   // metres per pixel at zoom 0, at Athens

  let map = $state.raw<MlMap>();
  // The map has its style and our layers; false while a new style (the other theme) loads.
  let loaded = $state(false);
  // Moves the map to a tapped stop or vehicle (set once the map is up).
  let focusOn: (at: LngLat, min: number) => void = () => {};
  let failed = $state(false);

  // The base map follows the theme. A new style drops our sources, layers and images: they are added again
  // (addAll) once it has loaded, and `loaded` going false then true makes the effects below send their data again.
  const systemDark = new MediaQuery("(prefers-color-scheme: dark)");
  const dark = $derived(resolveDark(app.theme, systemDark.current));
  let styleDark = untrack(() => dark);   // the theme of the style on the map
  let styleGen = 0;
  let started = false;                    // the first style has loaded

  // Every vehicle's motion, shared by the city layer and the detailed lines (fleet.ts).
  const fleet = new Fleet();
  // DOM markers of the detailed lines. They live outside Svelte's reactivity: moved every frame.
  interface Dom {
    marker: Marker; wrap: HTMLDivElement; el: HTMLButtonElement; dir: HTMLElement; age: HTMLElement;
    width: number; heading: number | null;
  }
  const doms = new Map<string, Dom>();
  let owned = new Set<string>();       // detailed lines with data: drawn as DOM markers
  let fadedKeys = new Set<string>();   // vehicles of an unknown direction under a direction focus
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const STILL_TRAIL_S = 1;   // motion off: the trail of a move to a new fix fades over this

  // Route geometry per variant, built once per static file.
  const routes = new WeakMap<Variant, RouteGeom>();
  function routeFor(line: string, variant: string | null): RouteGeom | null {
    const st = variant ? app.statics[line] : undefined;
    const v = variant ? st?.variants[variant] : undefined;
    if (!st || !v || v.shape.length < 2) return null;
    let r = routes.get(v);
    if (!r) {
      const known = v.stops.filter(id => st.stops[id]);
      r = routeGeom({ shape: v.shape, stopIds: known, endS: shapeLength(v.shape),
        stopS: stopOffsets(v.shape, known.map(id => [st.stops[id].lon, st.stops[id].lat] as LngLat)) });
      routes.set(v, r);
    }
    return r;
  }

  function setHeading(d: Dom, h: number | null) {
    if (h != null && d.heading != null && Math.abs(((h - d.heading + 540) % 360) - 180) < 2) return;
    d.heading = h;
    d.dir.hidden = h == null;
    if (h == null) return;
    // Around the pill (an ellipse), pointing outwards.
    const rx = d.width / 2 + 5, ry = 16, a = (h * Math.PI) / 180;
    d.dir.style.transform = `translate(${Math.sin(a) * rx}px, ${-Math.cos(a) * ry}px) rotate(${h}deg)`;
  }

  const LANE_PX = 3;   // each direction drawn to the right of its travel direction (two lanes)
  const key = (line: string, id: string) => `${line}/${id}`;

  const drawn: DrawnLine[] = $derived(
    app.detailLines.flatMap(id => {
      const data = app.statics[id];
      const focus = app.focus[id];
      return data ? [{ id, color: app.lineColor(id).bg, data, visible: focus && new Set(focus) }] : [];
    }),
  );

  // Keep framed content clear of the panel: beside it on wide screens, below it on phones.
  function padding() {
    const panel = document.querySelector(".panel")?.getBoundingClientRect();
    if (!panel) return 40;
    return innerWidth >= 720
      ? { top: 40, bottom: 40, left: panel.right + 24, right: 60 }
      : { top: panel.bottom + 16, bottom: 24, left: 24, right: 24 };
  }

  function fitTo(ids: string[]) {
    const b = bounds(drawn.filter(d => ids.includes(d.id)));
    if (b && map) map.fitBounds(b, { padding: padding(), maxZoom: 15, duration: 600 });
  }

  // A right-pointing chevron; symbol layers turn it along each line in travel direction.
  function arrowImage(): ImageData {
    const r = 2, c = document.createElement("canvas");
    c.width = c.height = 12 * r;
    const g = c.getContext("2d")!;
    g.scale(r, r);
    g.lineJoin = g.lineCap = "round";
    g.beginPath(); g.moveTo(3.5, 2.5); g.lineTo(8.5, 6); g.lineTo(3.5, 9.5);
    g.strokeStyle = "rgba(0,0,0,.55)"; g.lineWidth = 4; g.stroke();
    g.strokeStyle = "#fff"; g.lineWidth = 2; g.stroke();
    return g.getImageData(0, 0, c.width, c.height);
  }

  // A pointer for a city vehicle: the tip is up and sits outside the disc; the symbol layer turns
  // the whole image about its centre (the vehicle) by the heading.
  function pointerImage(): ImageData {
    const r = 2, c = document.createElement("canvas");
    c.width = c.height = 48 * r;
    const g = c.getContext("2d")!;
    g.scale(r, r);
    g.lineJoin = "round";
    g.beginPath(); g.moveTo(24, 2); g.lineTo(29, 11); g.lineTo(19, 11); g.closePath();
    g.strokeStyle = "#fff"; g.lineWidth = 3; g.stroke();
    g.fillStyle = "#222"; g.fill();
    return g.getImageData(0, 0, c.width, c.height);
  }

  // A rounded square of side k × 28 px, white on a 48 px transparent canvas, tinted by each layer (sdf): the marker
  // of every train (B3). One canvas size for every part, so one icon-size and one icon-offset move them together.
  function railImage(k: number): ImageData {
    const c = document.createElement("canvas"), side = 28 * k, o = (48 - side) / 2;
    c.width = c.height = 48;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.beginPath(); g.roundRect(o, o, side, side, 7 * Math.min(1, k)); g.fill();
    return g.getImageData(0, 0, c.width, c.height);
  }

  // Trains (metro and tram from the timetable, Proastiakos by GPS), over everything else, the size of a bus dot
  // (B3): a rounded square in the line's colour, hollow (a white centre) when its place comes from the timetable.
  // A moving train sits on the right-hand track of its line (`side`, B5). A GPS fix too old is faded, and its age
  // shows per «Ηλικία θέσης». Under them, the tapped train's line.
  function addTrainLayers(m: MlMap) {
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#3b5bdb";
    const byZoom = (stops: unknown[]) => ["interpolate", ["linear"], ["zoom"], ...stops] as ExpressionSpecification;
    const vis = app.trainsOn ? "visible" : "none";
    const fade = ["case", ["get", "stale"], 0.45, 1] as ExpressionSpecification;
    // The bus dot's diameter (5, 9, 20, 26 px at z10, 13, 14, 17) over the 16 px square (k = 1), times k.
    const size = (k: number) => byZoom([10, 0.31 * k, 13, 0.56 * k, 14, 1.25 * k, 17, 1.63 * k]);
    const square = (id: string, k: number, color: unknown, filter?: unknown) => {
      if (!m.hasImage(`rail-${k}`)) m.addImage(`rail-${k}`, railImage(k), { pixelRatio: 2, sdf: true });
      m.addLayer({
      id, type: "symbol", source: "trains", ...(filter ? { filter: filter as ExpressionSpecification } : {}),
      layout: { "icon-image": `rail-${k}`, "icon-size": size(1), "icon-offset": ["get", "off"] as ExpressionSpecification,
        "icon-allow-overlap": true, "icon-ignore-placement": true, visibility: vis },
      paint: { "icon-color": color as ExpressionSpecification, "icon-opacity": fade } });
    };
    m.addSource("train-route", { type: "geojson", data: EMPTY });
    m.addSource("trains", { type: "geojson", data: EMPTY });
    m.addLayer({ id: "train-route-casing", type: "line", source: "train-route", layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#ffffff", "line-width": byZoom([9, 5, 14, 8, 17, 11]), "line-opacity": 0.9 } }, "metro-station");
    // Two parallel tracks (B5), one each side of the line's shape: a moving train sits on its right-hand one.
    for (const [id, k] of [["train-route", 1], ["train-route-2", -1]] as const)
      m.addLayer({ id, type: "line", source: "train-route", layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": ["get", "color"], "line-width": byZoom([9, 1.5, 14, 2.5, 17, 3.5]),
          // The trains' own shift (TRACK_SHIFT × their icon-size), so each one sits on its track at every zoom.
          "line-offset": byZoom([10, 0.31 * TRACK_SHIFT * k, 13, 0.56 * TRACK_SHIFT * k, 14, 1.25 * TRACK_SHIFT * k, 17, 1.63 * TRACK_SHIFT * k]) } },
        "metro-station");
    square("train-sel", 1.45, accent, ["get", "sel"]);
    square("train-edge", 1.15, "#ffffff");
    square("train-dot", 1, ["get", "color"]);
    square("train-hole", 0.45, "#ffffff", ["get", "est"]);
    // The pointer turns with the heading, and its offset with it: in its own frame the right-hand track is +x.
    // Sized with the square (POINTER_K of it), so TRACK_SHIFT / POINTER_K of its pixels is the square's shift.
    m.addLayer({ id: "train-heading", type: "symbol", source: "trains", minzoom: 13, filter: ["has", "h"],
      layout: { "icon-image": "city-pointer", "icon-rotate": ["get", "h"], "icon-rotation-alignment": "map",
        "icon-size": size(POINTER_K), "icon-offset": ["literal", [TRACK_SHIFT / POINTER_K, 0]],
        "icon-allow-overlap": true, "icon-ignore-placement": true, visibility: vis },
      paint: { "icon-opacity": fade } });
    m.addLayer({ id: "train-age", type: "symbol", source: "trains", minzoom: 12, filter: ageFilter(app.ageMode),
      layout: { "text-field": ["get", "age"], "text-font": ["Noto Sans Bold"], "text-size": 10, "text-anchor": "top",
        "text-offset": [0, 1], "text-allow-overlap": true, "text-ignore-placement": true, visibility: vis },
      paint: { "text-color": ["case", ["get", "stale"], "#d9480f", "#333333"], "text-halo-color": "#ffffff", "text-halo-width": 1.5 } });
  }
  // The GPS trains whose age shows, per «Ηλικία θέσης» (B4); a timetable train has none.
  const ageFilter = (mode: AgeMode): FilterSpecification =>
    mode === "always" ? ["has", "age"] : mode === "old" ? ["all", ["has", "age"], ["get", "stale"]] : ["boolean", false];

  // City layer: every live vehicle, drawn by the GPU (DOM markers would not cope with ~1500).
  // Dots at city zoom, discs with the line number from zoom 14. Colours from app.css.
  function addCityLayers(m: MlMap) {
    const css = getComputedStyle(document.documentElement);
    const color = (c: string) => css.getPropertyValue(`--${c}`).trim() || "#6c757d";
    m.addSource("city", { type: "geojson", data: EMPTY });
    m.addLayer({ id: "city-dot", type: "circle", source: "city",
      paint: {
        "circle-color": ["match", ["get", "cls"], ...DELAY_CLASSES.slice(0, 4).flatMap(c => [c, color(c)]), color("none")],
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 13, 4.5, 14, 10, 17, 13],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 10, 0.5, 14, 1.5],
        "circle-opacity-transition": { duration: 300 }, "circle-stroke-opacity-transition": { duration: 300 },
      } as never });
    m.addLayer({ id: "city-label", type: "symbol", source: "city", minzoom: 14,
      layout: { "text-field": ["get", "line"], "text-font": ["Noto Sans Bold"],
        "text-size": ["case", [">", ["length", ["get", "line"]], 3], 8, 10],
        "text-allow-overlap": true, "text-ignore-placement": true },
      paint: { "text-color": "#ffffff", "text-opacity-transition": { duration: 300 } } as never });
    // A pointer on each moving vehicle (heading `h`), from zoom 13, where the dots are big enough.
    m.addImage("city-pointer", pointerImage(), { pixelRatio: 2 });
    m.addLayer({ id: "city-heading", type: "symbol", source: "city", minzoom: 13, filter: ["has", "h"],
      layout: { "icon-image": "city-pointer", "icon-rotate": ["get", "h"], "icon-rotation-alignment": "map",
        "icon-size": ["interpolate", ["linear"], ["zoom"], 13, 0.45, 14, 0.8, 17, 1],
        "icon-allow-overlap": true, "icon-ignore-placement": true },
      paint: { "icon-opacity-transition": { duration: 300 } } as never });
    // Ring round the selected vehicle while it is still on the city layer.
    m.addLayer({ id: "city-selected", type: "circle", source: "city", filter: ["boolean", false],
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 7, 14, 14, 17, 17], "circle-opacity": 0,
        "circle-stroke-color": color("accent"), "circle-stroke-width": 3 } });
  }

  // Metro, ISAP and tram: every station, small and from RAIL_ZOOM like the bus stops (moved over the city
  // vehicles in addLayers, so they always show). A line's track is drawn when it is picked (train-route).
  function addMetroLayers(m: MlMap) {
    const sel = (a: unknown, b: unknown) => ["case", ["get", "sel"], a, b] as ExpressionSpecification;
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#3b5bdb";
    const byZoom = (stops: unknown[]) => ["interpolate", ["linear"], ["zoom"], ...stops] as ExpressionSpecification;
    m.addSource("metro", { type: "geojson", data: EMPTY });
    m.addLayer({ id: "metro-line", type: "line", source: "metro", filter: ["==", ["get", "kind"], "line"],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": ["get", "color"], "line-width": byZoom([10, 2, 14, 4, 17, 6]), "line-opacity": 0.85 } });
    const stationVis = app.trainsOn ? "visible" : "none";
    m.addLayer({ id: "metro-station", type: "circle", source: "metro", filter: ["==", ["get", "kind"], "station"], minzoom: RAIL_ZOOM,
      layout: { visibility: stationVis },
      paint: { "circle-radius": byZoom([RAIL_ZOOM, sel(6, ["case", ["get", "hub"], 4, 3.5]), 17, sel(9, ["case", ["get", "hub"], 7, 6])]),
        "circle-color": "#ffffff", "circle-stroke-color": sel(accent, ["case", ["get", "hub"], "#222222", ["get", "color"]]),
        "circle-stroke-width": byZoom([RAIL_ZOOM, sel(3, 2), 17, sel(3.5, 2.5)]) } });
    m.addLayer({ id: "metro-label", type: "symbol", source: "metro", minzoom: RAIL_ZOOM + 1,
      filter: ["==", ["get", "kind"], "station"],
      layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": 10,
        "text-offset": [0, 0.9], "text-anchor": "top", "text-optional": true, visibility: stationVis },
      paint: { "text-color": "#333333", "text-halo-color": "#ffffff", "text-halo-width": 1.5 } });
  }

  // Suburban rail: its stations as small dots filled with their corridor's colour, from SUBURBAN_ZOOM (moved
  // over the city vehicles in addLayers, like the metro's). A corridor is drawn when it is picked (train-route).
  function addSuburbanLayers(m: MlMap) {
    const sel = (a: unknown, b: unknown) => ["case", ["get", "sel"], a, b] as ExpressionSpecification;
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#3b5bdb";
    const byZoom = (stops: unknown[]) => ["interpolate", ["linear"], ["zoom"], ...stops] as ExpressionSpecification;
    const vis = app.trainsOn ? "visible" : "none";
    m.addSource("suburban", { type: "geojson", data: EMPTY });
    m.addLayer({ id: "suburban-station", type: "circle", source: "suburban", filter: ["==", ["get", "kind"], "station"], minzoom: SUBURBAN_ZOOM,
      layout: { visibility: vis },
      paint: { "circle-radius": byZoom([SUBURBAN_ZOOM, sel(5, 3), 17, sel(8, 6)]), "circle-color": ["get", "color"],
        "circle-stroke-color": sel(accent, "#ffffff"), "circle-stroke-width": byZoom([SUBURBAN_ZOOM, sel(3, 1.5), 17, sel(3.5, 2)]) } });
    m.addLayer({ id: "suburban-label", type: "symbol", source: "suburban", minzoom: RAIL_ZOOM + 1,
      filter: ["==", ["get", "kind"], "station"],
      layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": 10,
        "text-offset": [0, 0.9], "text-anchor": "top", "text-optional": true, visibility: vis },
      paint: { "text-color": "#333333", "text-halo-color": "#ffffff", "text-halo-width": 1.5 } });
  }

  // My location's accuracy circle: a circle in map metres, px = metres · 2^zoom / metres-per-pixel at zoom 0.
  function addMeAcc(m: MlMap) {
    m.addSource("me-acc", { type: "geojson", data: EMPTY });
    m.addLayer({ id: "me-acc", type: "circle", source: "me-acc",
      paint: { "circle-radius": ["interpolate", ["exponential", 2], ["zoom"],
        0, ["/", ["get", "acc"], M_PER_PX_Z0], 22, ["/", ["*", ["get", "acc"], 2 ** 22], M_PER_PX_Z0]],
      "circle-color": "#1a73e8", "circle-opacity": 0.12, "circle-stroke-color": "#1a73e8", "circle-stroke-opacity": 0.35,
      "circle-stroke-width": 1 } }, "city-dot");
  }

  function showAcc(m: MlMap, f: Fix) {
    (m.getSource("me-acc") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection",
      features: [{ type: "Feature", properties: { acc: f.acc }, geometry: { type: "Point", coordinates: f.pos } }] });
  }

  function addAll(m: MlMap) {
    addLayers(m);
    addMeAcc(m);
    if (me) showAcc(m, me.fix);
    nextDue = 0;   // the city layer and the trails start empty: draw them now
    cityWasEmpty = trailsWereEmpty = true;
    started = true;
    loaded = true;
  }

  // The other theme: the base map's style is swapped. diff: false builds the style anew, so `style.load` fires.
  function restyle(m: MlMap, d: boolean) {
    styleDark = d;
    loaded = false;
    const gen = ++styleGen;
    m.once("style.load", () => { if (gen === styleGen) addAll(m); });   // a style replaced before it loaded never fires
    m.setStyle(STYLE(d), { diff: false });
  }

  // Typical bus speed per stop-to-stop segment (speed.ts): thin and translucent, under every other layer of ours.
  // Its data loads the first time the switch is on (effect below).
  function addSpeed(m: MlMap) {
    m.addSource("speed", { type: "geojson", data: speedData ?? EMPTY });
    m.addLayer({ id: "speed", type: "line", source: "speed",
      layout: { "line-join": "round", "line-cap": "round", visibility: app.speedOn ? "visible" : "none" },
      paint: { "line-color": ["interpolate", ["linear"], ["get", "kmh"], ...SPEED_STOPS.flat()] as ExpressionSpecification,
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 13, 2, 16, 4], "line-opacity": speedOpacity() } });
  }
  let speedData = $state.raw<SpeedData | null>(null);
  // Fainter while a line is followed: the line and its vehicles come first.
  const speedOpacity = () => (app.detailLines.length ? 0.3 : 0.6);

  function addLayers(m: MlMap) {
    addSpeed(m);
    addMetroLayers(m);
    addSuburbanLayers(m);
    addCityLayers(m);
    for (const id of ["metro-station", "metro-label", "suburban-station", "suburban-label"]) m.moveLayer(id);
    addTrainLayers(m);
    // Trails of corrections (the route a vehicle glided along) and, with motion off, of moves to a
    // new fix. Always under the vehicle: city dots' trails under the dots, detailed lines' trails
    // over the route lines (their vehicles are DOM markers, above the map).
    // A correction back is drawn apart: thin, grey and dashed, so it does not read as the bus reversing.
    m.addSource("trails", { type: "geojson", data: EMPTY });
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#0071e3";
    const trail = (id: string, dom: boolean, before?: string) => {
      m.addLayer({ id, type: "line", source: "trails",
        filter: ["all", ["==", ["get", "dom"], dom], ["!", ["to-boolean", ["get", "back"]]]], layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": accent, "line-width": 8, "line-opacity": ["*", 0.55, ["get", "alpha"]] } }, before);
      m.addLayer({ id: `${id}-back`, type: "line", source: "trails",
        filter: ["all", ["==", ["get", "dom"], dom], ["to-boolean", ["get", "back"]]], layout: { "line-join": "round" },
        paint: { "line-color": "#80868b", "line-width": 3, "line-dasharray": [1.5, 1.5], "line-opacity": ["*", 0.9, ["get", "alpha"]] } }, before);
    };
    trail("trails-city", false, "city-dot");
    m.addImage("route-arrow", arrowImage(), { pixelRatio: 2 });
    // The detailed lines' routes go under the city vehicles: a city vehicle just selected is still drawn
    // by the city layer while its line loads, and the highlighted route must not cover it.
    const under = "city-dot";
    m.addSource("routes", { type: "geojson", data: EMPTY });
    m.addSource("highlight", { type: "geojson", data: EMPTY });
    m.addSource("stops", { type: "geojson", data: EMPTY });
    m.addLayer({ id: "routes", type: "line", source: "routes",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.6, "line-offset": LANE_PX } }, under);
    m.addLayer({ id: "route-arrows", type: "symbol", source: "routes",
      layout: { "symbol-placement": "line", "symbol-spacing": 120, "icon-image": "route-arrow",
        "icon-rotation-alignment": "map", "icon-keep-upright": false, "icon-offset": [0, LANE_PX],
        "icon-allow-overlap": false, "icon-ignore-placement": true } }, under);
    // Invisible, wide copy so thin lines are easy to hit with a finger.
    m.addLayer({ id: "routes-hit", type: "line", source: "routes", paint: { "line-width": 18, "line-opacity": 0 } }, under);
    m.addLayer({ id: "highlight-casing", type: "line", source: "highlight",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#ffffff", "line-width": 10, "line-opacity": 0.9, "line-offset": LANE_PX } }, under);
    m.addLayer({ id: "highlight", type: "line", source: "highlight",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": ["get", "color"], "line-width": 6, "line-offset": LANE_PX } }, under);
    m.addLayer({ id: "highlight-arrows", type: "symbol", source: "highlight",
      layout: { "symbol-placement": "line", "symbol-spacing": 80, "icon-image": "route-arrow",
        "icon-rotation-alignment": "map", "icon-keep-upright": false, "icon-offset": [0, LANE_PX],
        "icon-allow-overlap": true, "icon-ignore-placement": true } }, under);
    trail("trails-line", true, under);
    // Every bus and trolley stop, from STOPS_ZOOM: over the routes, under the vehicles. The tapped one ringed.
    m.addSource("bus-stops", { type: "geojson", data: app.stopIx ? busStopsFC(app.stopIx) : EMPTY });
    m.addLayer({ id: "bus-stop", type: "circle", source: "bus-stops", minzoom: STOPS_ZOOM,
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], STOPS_ZOOM, 3.5, 17, 6], "circle-color": "#ffffff",
        "circle-stroke-color": "#5f6368", "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], STOPS_ZOOM, 1.5, 17, 2] } }, under);
    m.addLayer({ id: "bus-stop-selected", type: "circle", source: "bus-stops", filter: ["==", ["get", "i"], app.busStop ?? -1],
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 6, 17, 11], "circle-opacity": 0,
        "circle-stroke-color": accent, "circle-stroke-width": 3 } });
    m.addLayer({ id: "stops", type: "circle", source: "stops",
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3, 16, 6], "circle-color": "#ffffff",
        "circle-stroke-color": ["get", "color"], "circle-stroke-width": 2 } });
  }

  // The train under a click (finger margin r), the nearest if several.
  function nearestTrain(m: MlMap, p: { x: number; y: number }, r: number) {
    if (!app.trainsOn) return null;
    const hits = m.queryRenderedFeatures([[p.x - r, p.y - r], [p.x + r, p.y + r]], { layers: ["train-dot"] });
    const d = (f: (typeof hits)[number]) => {
      const q = m.project((f.geometry as GeoJSON.Point).coordinates as [number, number]);
      return Math.hypot(q.x - p.x, q.y - p.y);
    };
    return hits.sort((a, b) => d(a) - d(b))[0] ?? null;
  }
  const openTrain = (f: MapGeoJSONFeature) =>
    app.open(app.cardOfTrain({ kind: f.properties.kind === "metro" ? "metro" : "suburban", id: String(f.properties.id) }));

  // The metro or suburban station under a click, with a finger-sized margin r; the nearest if several.
  function nearestStation(m: MlMap, p: { x: number; y: number }, r = 10) {
    const hits = m.queryRenderedFeatures([[p.x - r, p.y - r], [p.x + r, p.y + r]], { layers: ["metro-station", "suburban-station"] });
    const d = (f: (typeof hits)[number]) => {
      const q = m.project((f.geometry as GeoJSON.Point).coordinates as [number, number]);
      return Math.hypot(q.x - p.x, q.y - p.y);
    };
    return hits.reduce<(typeof hits)[number] | null>((b, f) => (!b || d(f) < d(b) ? f : b), null);
  }
  const openStation = (f: MapGeoJSONFeature) =>
    app.open(f.layer.id === "suburban-station" ? railStationCard(String(f.properties.id), String(f.properties.name))
      : stationCard(String(f.properties.name), String(f.properties.lines ?? "").split(" ")));


  // The bus stop under a click, with a finger-sized margin; the nearest if several.
  function nearestBusStop(m: MlMap, p: { x: number; y: number }, r = 10) {
    if (!m.getLayer("bus-stop") || m.getZoom() < STOPS_ZOOM) return null;
    const hits = m.queryRenderedFeatures([[p.x - r, p.y - r], [p.x + r, p.y + r]], { layers: ["bus-stop"] });
    const d = (f: (typeof hits)[number]) => {
      const q = m.project((f.geometry as GeoJSON.Point).coordinates as [number, number]);
      return Math.hypot(q.x - p.x, q.y - p.y);
    };
    return hits.reduce<(typeof hits)[number] | null>((b, f) => (!b || d(f) < d(b) ? f : b), null);
  }

  // The stop index (public/trips.json, shared with the planner), loaded the first time the map comes
  // close enough to show stops; a failed load is tried again at the next rest.
  const loadStops = (): Promise<TripIndex | null> => app.loadStops();

  // The city vehicle under a click, with a finger-sized margin; the nearest if several.
  function nearestCity(m: MlMap, p: { x: number; y: number }) {
    if (!m.getLayer("city-dot") || m.getLayoutProperty("city-dot", "visibility") === "none") return null;
    const r = 12;
    const hits = m.queryRenderedFeatures([[p.x - r, p.y - r], [p.x + r, p.y + r]], { layers: ["city-dot"] });
    let best = null, bestD = Infinity;
    for (const f of hits) {
      const q = m.project((f.geometry as GeoJSON.Point).coordinates as [number, number]);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bestD) { best = f; bestD = d; }
    }
    return best;
  }

  // My location: polled by Locator, drawn as a DOM marker plus an accuracy circle (map metres).
  let locState = $state<LocState>("off");
  let follow = $state(false);
  let flyOnFix = false;
  let me: { marker: Marker; el: HTMLElement; mover: Mover; fix: Fix } | null = null;
  const locator = new Locator({
    geo: navigator.geolocation,
    onState: s => {
      locState = s;
      if (s === "denied") {
        follow = false;
        store("locOn", false);
        app.notify("Ο browser δεν επιτρέπει πρόσβαση στην τοποθεσία. Άλλαξέ το από τις ρυθμίσεις του.");
      } else if (s === "unavailable") app.notify("Δεν βρέθηκε η τοποθεσία σου. Νέα προσπάθεια σε λίγο.");
    },
    onFix: (f, speed) => onMyFix(f, speed),
  });
  function store(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } }

  function onMyFix(f: Fix, speed: number | null) {
    const m = map;
    if (!m) return;
    const now = Date.now() / 1000, plan = userPlan(f, speed);
    if (!me) {
      const el = document.createElement("div");
      el.className = "me";
      el.innerHTML = '<i class="cone"></i><b></b>';
      const wrap = document.createElement("div");
      wrap.append(el);
      const marker = new Marker({ element: wrap, anchor: "center", subpixelPositioning: true }).setLngLat(f.pos).addTo(m);
      me = { marker, el, mover: new Mover(f.pos), fix: f };
      me.mover.setPlan(plan, plan.target(now), now);
    } else {
      const h = planOnto(me.mover.pos, plan, now);
      me.mover.apply(h, now);
    }
    me.fix = f;
    me.el.classList.toggle("moving", plan.geom.length > 1);
    if (f.heading != null && Number.isFinite(f.heading)) me.el.style.setProperty("--h", `${f.heading}deg`);
    showAcc(m, f);
    if (flyOnFix) {
      flyOnFix = false;
      m.flyTo({ center: f.pos, zoom: Math.max(m.getZoom(), 15.5), duration: 1200 });
    }
  }

  function dropMe() {
    me?.marker.remove();
    me = null;
    (map?.getSource("me-acc") as GeoJSONSource | undefined)?.setData(EMPTY);
  }

  // The locate button: off → find me and follow; following → off; not following → follow again.
  function locateClick() {
    if (locState === "off" || locState === "denied") {
      follow = true;
      flyOnFix = true;
      store("locOn", true);
      locator.start();
    } else if (!follow && me) {
      follow = true;
      map?.easeTo({ center: me.mover.pos, zoom: Math.max(map.getZoom(), 15), duration: 600 });
    } else {
      follow = false;
      store("locOn", false);
      locator.stop();
      dropMe();
    }
  }

  // One frame loop for every moving dot (buses and trains). It runs as often as needed for steps of under half a
  // pixel at 20 m/s (zoomed out: once a second), faster during corrections and trails; nothing while
  // the tab is hidden. Off-screen city vehicles are not stepped: they snap when they come back.
  // With motion off, every vehicle is drawn at its last fix; a move to a new fix leaves a trail.
  let raf = 0, nextDue = 0, cityWasEmpty = true, trailsWereEmpty = true;
  function frame() {
    raf = requestAnimationFrame(frame);
    const m = map;
    const t = performance.now();
    if (!m || !loaded || document.hidden || t < nextDue) return;
    const now = app.serverMs() / 1000, z = m.getZoom(), mpp = M_PER_PX_Z0 / 2 ** z;
    const reduced = reducedMotion.matches;
    let cull: ((p: LngLat) => boolean) | null = null;
    if (z >= 12) {
      const b = m.getBounds(), w = b.getEast() - b.getWest(), h = b.getNorth() - b.getSouth();
      const W = b.getWest() - w * 0.2, E = b.getEast() + w * 0.2, S = b.getSouth() - h * 0.2, N = b.getNorth() + h * 0.2;
      cull = p => p[0] < W || p[0] > E || p[1] < S || p[1] > N;
    }
    let fixing = false;
    const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
    const trails: GeoJSON.Feature<GeoJSON.LineString>[] = [];
    const s = app.selection, selKey = s?.kind === "vehicle" ? `${s.line}/${s.id}` : null, only = app.only;
    const still = !app.motion;
    if (!still) fleet.spacing(now);
    for (const e of fleet.entries.values()) {
      const dom = owned.has(e.line);
      const shown = e.key === selKey || (!isGonePos(now - e.at) && passes(only, e.cls, now - e.at));
      if (!shown && !dom) continue;
      const moved = still && !reduced && e.moved && now - e.moved.at < STILL_TRAIL_S ? e.moved : null;
      if (!dom && (!app.cityOn || (cull && (still
        ? !moved && cull(e.pos)
        : !e.mover.fixing && cull(e.mover.pos) && cull(e.mover.targetPos(now) ?? e.mover.pos))))) continue;
      let pos: LngLat, trail: { geom: LngLat[]; alpha: number } | null, back = false, rewind = false;
      if (still) {
        pos = e.pos;
        trail = moved && { geom: [moved.from, e.pos], alpha: 1 - (now - moved.at) / STILL_TRAIL_S };
      } else {
        e.mover.reduced = reduced;
        const r = e.mover.step(now);
        pos = r.pos;
        trail = r.trail;
        back = r.back;
        rewind = back && r.fx != null;   // gliding back: the dot is drawn faint
        if (e.mover.fixing) fixing = true;
      }
      if (moved) fixing = true;
      // A trail is drawn like its vehicle: not for one filtered out, hidden or dimmed by a selection.
      const o = dom || !s || app.others === "normal" || e.key === selKey || (s.kind === "route" && e.line === s.line) ? 1 : app.others === "dim" ? 0.22 : 0;
      if (trail && shown && o && trail.geom.length > 1)
        trails.push({ type: "Feature", geometry: { type: "LineString", coordinates: trail.geom }, properties: { alpha: trail.alpha * o, dom, ...(back && { back }) } });
      if (dom) {
        const d = drawDom(e, pos, still);
        d.wrap.classList.toggle("filtered", !shown);
        d.el.classList.toggle("rewind", rewind);
      }
      else {
        const h = headingOf(e, still);
        features.push({ type: "Feature", geometry: { type: "Point", coordinates: pos },
          properties: { line: e.line, id: e.id, cls: e.cls, stale: isStalePos(now - e.at), ...(h != null && { h }), ...(rewind && { rewind }) } });
      }
    }
    for (const [k, d] of doms) {
      const e = fleet.entries.get(k);
      if (!e || !owned.has(e.line)) { d.marker.remove(); doms.delete(k); }
    }
    if (app.cityOn && (features.length || !cityWasEmpty)) {
      (m.getSource("city") as GeoJSONSource).setData({ type: "FeatureCollection", features });
      cityWasEmpty = !features.length;
    }
    if (app.stasyTrains.length || app.suburbanTrains.length || !trainsWereEmpty) {
      drawTrains();
      trainsWereEmpty = !app.stasyTrains.length && !app.suburbanTrains.length;
    }
    if (trails.length || !trailsWereEmpty) {
      (m.getSource("trails") as GeoJSONSource).setData({ type: "FeatureCollection", features: trails });
      trailsWereEmpty = !trails.length;
    }
    if (me) {
      me.mover.reduced = reduced;
      const r = me.mover.step(Date.now() / 1000);
      me.marker.setLngLat(r.pos);
      if (me.mover.fixing) fixing = true;
      if (follow && !m.isMoving()) m.setCenter(r.pos, { follow: true });   // not during the fly-to or a gesture
    }
    // Corrections and trails: 30 fps close up; zoomed out, where they are a few pixels and every frame
    // steps the whole city, 4 fps.
    const idle = Math.min(1000, Math.max(16, (0.5 * mpp / 20) * 1000));
    nextDue = t + (fixing ? Math.min(idle, z >= 13 ? 33 : 250) : idle);
  }

  // Heading: along the route while moving on it, else from the bearing or the last fixes; none
  // for a vehicle that stands and did not move over its last two fixes.
  function headingOf(e: FleetEntry, still: boolean): number | null {
    const held = !still && e.mover.cap != null && e.mover.s >= e.mover.cap - 0.5;   // behind another on its line
    const moving = !still && !held && e.mover.plan && e.mover.plan.geom.length > 1
      && e.mover.plan.target(app.serverMs() / 1000 + 1) > e.mover.s + 0.5;
    return moving ? e.mover.heading() : held || e.standing >= 2 ? null
      : vehicleHeading({ lon: e.pos[0], lat: e.pos[1], bearing: e.bearing }, e.route?.route.shape, e.prev);
  }

  function drawDom(e: FleetEntry, pos: LngLat, still: boolean): Dom {
    let d = doms.get(e.key);
    if (!d) d = makeDom(e, pos);
    d.marker.setLngLat(pos);
    const cls = e.cls;
    if (!d.el.classList.contains(cls)) {
      d.el.classList.remove(...DELAY_CLASSES);
      d.el.classList.add(cls);
    }
    d.el.classList.toggle("faded", fadedKeys.has(e.key));
    setHeading(d, headingOf(e, still));
    return d;
  }

  function makeDom(e: FleetEntry, pos: LngLat): Dom {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "bus";
    el.onclick = ev => {
      ev.stopPropagation();
      app.open(busVehicleCard(e.line, e.id));
    };
    const num = document.createElement("span");
    num.textContent = e.line;
    const dir = document.createElement("i");
    dir.className = "dir";
    const age = document.createElement("span");
    age.className = "age";
    el.append(num, dir);
    el.setAttribute("aria-label", `Γραμμή ${e.line}, όχημα ${e.id}`);
    // The marker element only positions; the visible pill is the child. The age label is beside the
    // pill, not in it: a stale pill is faint, its age stays readable.
    const wrap = document.createElement("div");
    wrap.className = "vm";
    wrap.append(el, age);
    const marker = new Marker({ element: wrap, anchor: "center", subpixelPositioning: true }).setLngLat(pos).addTo(map!);
    paint(el, e.line);
    const d: Dom = { marker, wrap, el, dir, age, width: el.offsetWidth, heading: null };
    doms.set(e.key, d);
    const s = app.selection;
    if (s?.kind === "vehicle" && s.line === e.line && s.id === e.id) { el.classList.add("selected"); wrap.classList.add("sel"); }
    updateAge(d, e, app.serverNow / 1000);
    return d;
  }

  // A detail line's vehicle wears the line's colour; its delay is the ring (app.css).
  function paint(el: HTMLElement, line: string) {
    const c = app.lineColor(line);
    el.style.setProperty("--c", c.bg);
    el.style.setProperty("--t", c.fg);
  }

  function updateAge(d: Dom, e: FleetEntry, now: number) {
    const age = now - e.at, label = ageLabel(age);
    if (d.age.textContent !== label) d.age.textContent = label;
    const stale = isStalePos(age);
    d.el.classList.toggle("stale", stale);
    d.wrap.classList.toggle("stale", stale);
  }

  function setup(node: HTMLDivElement) {
    let m: MlMap;
    try {
      m = new MlMap({
        container: node,
        style: STYLE(styleDark),
        center: [23.73, 37.98],
        zoom: 11.5,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
      });
    } catch {
      failed = true;   // GPUInitializationError: no WebGL2
      return;
    }
    // Every style load (the first and each restyle), before its tiles draw: the dark style is lightened (basemap.ts).
    m.on("style.load", () => { if (styleDark) lightenDark(m); });
    m.touchZoomRotate.disableRotation();
    m.addControl(new NavigationControl({ showCompass: false }), "top-right");
    m.addControl({ onAdd: () => locateCtl, onRemove: () => locateCtl.remove() }, "top-right");
    // Only the ⓘ stays on the map: it opens the info dialog (sources, credits, statistics) instead of toggling the
    // credits. Capture + stopImmediatePropagation: MapLibre's own click handler must not run.
    const credit = node.querySelector<HTMLElement>(".maplibregl-ctrl-attrib-button");
    if (credit) {
      credit.title = "Πηγές δεδομένων";
      credit.setAttribute("aria-label", "Πηγές δεδομένων");
      credit.setAttribute("aria-haspopup", "dialog");
      credit.addEventListener("click", e => { e.preventDefault(); e.stopImmediatePropagation(); void openInfo(); }, true);
    }
    m.on("dragstart", () => (follow = false));   // only user gestures fire it
    // The city layer loads the tiles of the view: at first, and 300 ms after the map stops moving (never during a move).
    const reportView = () => {
      if (m.getZoom() >= STOPS_ZOOM - 0.5 && !app.stopIx) loadStops();
      const b = m.getBounds();
      app.setCityView({ north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() }, m.getZoom());
      prefetchSoon();
    };
    const reportSoon = debounce(reportView, VIEW_SETTLE_MS);
    m.on("load", reportView);
    // Follow mode moves the map every frame: it never rests, so its view is reported on a clock instead.
    const reportFollow = throttle(reportView, FOLLOW_VIEW_MS);
    const ticked = (e: object) => "follow" in e;
    m.on("movestart", e => {
      prefetchSoon.cancel(); ahead = [];   // the old view's: not wanted any more (follow mode too)
      if (ticked(e)) return;
      reportSoon.cancel(); reportFollow.cancel(); app.setCityMoving();
    });
    m.on("moveend", e => (ticked(e) ? reportFollow() : reportSoon()));

    const popup = new Popup({ closeButton: false, offset: 10, maxWidth: "240px" });
    m.on("load", () => {
      // MapLibre opens the credits at first; collapse them. It does not reopen them (the control is compact).
      const attrib = node.querySelector(".maplibregl-ctrl-attrib");
      attrib?.classList.remove("maplibregl-compact-show");
      attrib?.removeAttribute("open");
      addAll(m);
      if (untrack(() => dark) !== styleDark) restyle(m, untrack(() => dark));   // the theme changed while the map loaded
    });
    raf = requestAnimationFrame(frame);
    const onVisible = () => {
      locator.visibilityChanged();
      if (document.hidden) return;
      for (const e of fleet.entries.values()) e.mover.snap();
      me?.mover.snap();
    };
    document.addEventListener("visibilitychange", onVisible);
    // Turned on last time and still allowed: start again (no fly-to; the map stays where it opens).
    let disposed = false;
    try {
      if (JSON.parse(localStorage.getItem("locOn") ?? "false"))
        navigator.permissions?.query({ name: "geolocation" }).then(r => {
          if (r.state === "granted" && !disposed) locator.start();
        }, () => {});
    } catch { /* storage blocked */ }
    // One dispatcher: DOM marker (its own handler) → train right under the finger → station right under the finger (drawn over the city
    // vehicles, under a picked line's stops) → city vehicle → stop → station near the finger → route → empty map.
    let taps = 0;   // a later tap wins over a stop card still waiting for the stop index
    m.on("click", e => {
      const tap = ++taps;
      if (!loaded) return;   // the style is being replaced: our layers are not there to hit
      if ((e.originalEvent.target as Element | null)?.closest?.(".bus")) return;
      const onTrain = nearestTrain(m, e.point, 4);
      if (onTrain) {
        popup.remove();
        return openTrain(onTrain);
      }
      const onStation = nearestStation(m, e.point, 3);
      if (onStation && !m.queryRenderedFeatures(e.point, { layers: ["stops"] }).length) {   // a line's stop is drawn over it
        popup.remove();
        return openStation(onStation);
      }
      const city = nearestCity(m, e.point);
      if (city) {
        popup.remove();
        app.open(busVehicleCard(String(city.properties.line), String(city.properties.id)));
        return;
      }
      const stop = m.queryRenderedFeatures(e.point, { layers: ["stops"] })[0];
      if (stop) {
        // Its card; the stop index loads first when the map was never close enough to show stops.
        const id = String(stop.properties.id), name = String(stop.properties.name);
        const ll = (stop.geometry as GeoJSON.Point).coordinates as [number, number];
        popup.remove();
        void (app.stopIx ? Promise.resolve(app.stopIx) : loadStops()).then(ix => {
          if (tap !== taps || disposed) return;
          const at = ix ? stopIndex(ix, id) : -1;
          if (at >= 0) app.open(busStopCard(id, ix!.s[at][0]));
          else popup.setLngLat(ll).setText(name).addTo(m);
        });
        return;
      }
      const bus = nearestBusStop(m, e.point);
      if (bus) {
        popup.remove();
        const i = Number(bus.properties.i), s = app.stopIx?.s[i];
        if (s?.[3]) return app.open(busStopCard(s[3], s[0]));
        return;
      }
      const station = nearestStation(m, e.point);
      if (station) {
        popup.remove();
        openStation(station);
        return;
      }
      const train = nearestTrain(m, e.point, 12);
      if (train) {
        popup.remove();
        return openTrain(train);
      }
      const route = m.queryRenderedFeatures(e.point, { layers: ["routes-hit"] })[0];
      if (route) return app.open(routeCard(String(route.properties.line), String(route.properties.variant)));
      const box: [[number, number], [number, number]] = [[e.point.x - 8, e.point.y - 8], [e.point.x + 8, e.point.y + 8]];
      const seg = app.speedOn ? m.queryRenderedFeatures(box, { layers: ["speed"] })[0] : undefined;
      if (seg) {
        const p = seg.properties;
        const kmh = (v: unknown) => (v == null ? "–" : `${Math.round(Number(v))}`);
        popup.setLngLat(e.lngLat).setDOMContent(segInfo(p, kmh)).addTo(m);
        return;
      }
      app.closeCards();
    });
    for (const layer of ["routes-hit", "stops", "city-dot", "metro-station", "suburban-station", "speed", "train-dot"]) {
      m.on("mouseenter", layer, () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", layer, () => (m.getCanvas().style.cursor = ""));
    }

    map = m;
    app.fit = fitTo;
    // The view's padding with the bottom sheet on a phone. A card that is still loading (opened from the
    // search) is not in the page yet: assume the sheet's usual half screen.
    const sheetPad = () => {
      const pp = padding(), card = document.querySelector(".card")?.getBoundingClientRect();
      const pad = typeof pp === "number" ? { top: pp, bottom: pp, left: pp, right: pp } : { ...pp };
      if (innerWidth < 720) pad.bottom = Math.max(pad.bottom, card ? innerHeight - card.top + 16 : innerHeight * 0.45);
      return pad;
    };
    // Into view, closer when far out; not when it is already well inside the view.
    app.flyTo = at => {
      const pad = sheetPad();
      const p = m.project(at), c = m.getCanvas();
      const inside = p.x > pad.left && p.x < c.clientWidth - pad.right && p.y > pad.top && p.y < c.clientHeight - pad.bottom;
      if (inside && m.getZoom() >= 13) return;
      m.easeTo({ center: at, zoom: Math.max(m.getZoom(), 14), padding: pad, duration: reducedMotion.matches ? 0 : 600 });
    };
    focusOn = (at, min) => {
      follow = false;   // the tapped thing, not the user, is what to look at
      const pad = sheetPad();
      if (innerWidth < 720) pad.bottom = Math.max(pad.bottom, sheetReserve(innerHeight));   // a loading card grows
      const p = m.project(at), c = m.getCanvas();
      const inside = p.x > pad.left && p.x < c.clientWidth - pad.right && p.y > pad.top && p.y < c.clientHeight - pad.bottom;
      const zoom = focusZoom(m.getZoom(), inside, min);
      if (zoom != null) m.easeTo({ center: at, zoom, padding: pad, duration: reducedMotion.matches ? 0 : 600 });
    };
    // Frames a set of points (a line's stops), at most as close as a street.
    app.fitPoints = pts => {
      if (pts.length < 2) { if (pts.length) app.flyTo(pts[0]); return; }
      const b = pts.reduce((b, p) => b.extend(p), new LngLatBounds(pts[0], pts[0]));
      m.fitBounds(b, { padding: sheetPad(), maxZoom: 15, duration: reducedMotion.matches ? 0 : 600 });
    };
    if (import.meta.env.DEV) Object.assign(window, { __map: m, __fleet: fleet, __doms: doms });
    return () => {
      app.fit = () => {};
      app.flyTo = () => {};
      app.fitPoints = () => {};
      focusOn = () => {};
      pin.remove();
      disposed = true;
      cancelAnimationFrame(raf);
      reportSoon.cancel();
      prefetchSoon.cancel();
      reportFollow.cancel();
      document.removeEventListener("visibilitychange", onVisible);
      locator.stop();
      dropMe();
      for (const d of doms.values()) d.marker.remove();
      doms.clear();
      fleet.entries.clear();
      m.remove();
      map = undefined;
      loaded = false;
    };
  }

  // The popup for a speed segment; built from text nodes (stop names come from data).
  function segInfo(p: Record<string, unknown>, kmh: (v: unknown) => string) {
    const el = document.createElement("div");
    el.className = "segpop";
    const line = (text: string, tag = "div") => el.appendChild(Object.assign(document.createElement(tag), { textContent: text }));
    line(`${kmh(p.kmh)} km/h`, "b");
    line(`${p.from} → ${p.to}`);
    line(`Αιχμή καθημερινής ${kmh(p.peak)} · εκτός ${kmh(p.off)} km/h`);
    line(`${p.n} μετρήσεις · γραμμές ${p.lines}`);
    line("Με τον χρόνο στις στάσεις.");
    return el;
  }


  $effect(() => {
    if (!loaded) return;
    const data = app.suburban;
    (map!.getSource("suburban") as GeoJSONSource).setData(data ? suburbanFC(data, app.railStation) : EMPTY);
  });

  $effect(() => {
    const vis = app.trainsOn ? "visible" : "none";
    if (loaded) for (const id of ["train-sel", "train-edge", "train-dot", "train-hole", "train-heading", "train-age", "train-route", "train-route-2", "train-route-casing", "metro-station", "metro-label",
      "suburban-station", "suburban-label"]) map!.setLayoutProperty(id, "visibility", vis);
  });

  $effect(() => { const f = ageFilter(app.ageMode); if (loaded) map!.setFilter("train-age", f); });

  // The rail cards' data of what is on screen, loaded while the map rests (prefetch.ts), by at most
  // four requests at a time from one queue that each view replaces; what the cache holds fresh is
  // not asked again. Also after each trains poll (they move into view), unless the map is moving.
  const loadAhead = (w: Want) =>
    w.kind === "stasy" ? fetchStasy(w.id) : w.kind === "suburban-station" ? fetchSuburban(w.id)
      : fetchTrainRun(w.kind === "metro-run" ? "metro" : "suburban", w.id);
  let ahead: Want[] = [], workers = 0;
  const work = async () => {
    workers++;
    for (let w = ahead.shift(); w; w = ahead.shift()) await loadAhead(w);
    workers--;
  };
  const prefetchSoon = debounce(() => {
    const m = map;
    if (!m || !loaded || document.hidden || m.isMoving() || m.getZoom() < PREFETCH_ZOOM) return;
    const layers = ["train-dot", "metro-station", "suburban-station"].filter(id => m.getLayer(id) && m.getLayoutProperty(id, "visibility") !== "none");
    if (!layers.length) return;
    const c = m.getCanvas();
    const seen = m.queryRenderedFeatures({ layers }).map(f => {
      const q = m.project((f.geometry as GeoJSON.Point).coordinates as [number, number]);
      return { layer: f.layer.id, px: [q.x, q.y] as [number, number], props: f.properties };
    });
    ahead = wanted(seen, [c.clientWidth / 2, c.clientHeight / 2], app.metro?.stations ?? []);
    while (workers < 4 && ahead.length) void work();
  }, VIEW_SETTLE_MS);

  $effect(() => {
    void app.stasyTrains; void app.suburbanTrains;
    prefetchSoon();
  });

  // Each metro/tram line's tracks as [lat, lon] shapes (rails.ts), and the Proastiakos trains snapped
  // onto their corridor, run on along it at their speed between fixes (server time: fixes carry it).
  const tracks = $derived(Object.fromEntries((app.metro?.lines ?? []).map(l =>
    [l.id, l.paths.map(p => p.map(([lon, lat]) => [lat, lon] as [number, number]))])) as Record<string, Track[]>);
  const glide = new RailGlide(2_000);
  // Each corridor's stations along it: a train runs on no farther than the next one.
  const corridorStops = $derived.by(() => {
    const d = app.suburban;
    if (!d) return {} as Record<string, number[]>;
    const at = new Map(d.stations.map(st => [st.id, [st.lon, st.lat] as [number, number]]));
    return Object.fromEntries(Object.entries(d.corridors).map(([id, c]) => [id, trackStops(c.path, c.stations.flatMap(x => { const q = at.get(x); return q ? [q] : []; }))]));
  });
  $effect(() => {
    const corridors = app.suburban?.corridors, stops = corridorStops, now = app.serverMs();
    for (const t of app.suburbanTrains)
      glide.update(t.train, corridors?.[t.corridor]?.path ?? null, [t.lon, t.lat], now,
        { kmh: t.speed_kmh, course: t.course, at: t.position_at * 1000 }, stops[t.corridor]);
    glide.keep(new Set(app.suburbanTrains.map(t => t.train)));
  });

  // The trains, stepped in the frame loop as the buses are, and at once on new data or a tap: the
  // metro's by their run's knots (else along their track by their two stops' times).
  function drawTrains() {
    const now = app.serverMs();
    const fc = trainsFC({ stasy: app.stasyTrains, suburban: app.suburbanTrains, corridors: app.suburban?.corridors ?? {},
      nowS: now / 1000, sel: app.train, tracks, motions: app.stasyMotion, glide: t => glide.at(t.train, now) });
    // icon-offset is in the image's pixels, times icon-size: TRACK_SHIFT of them land on the track's line-offset.
    for (const f of fc.features) { const [x, y] = f.properties!.side as number[]; f.properties!.off = [x * TRACK_SHIFT, y * TRACK_SHIFT]; }
    (map!.getSource("trains") as GeoJSONSource).setData(fc);
  }
  let trainsWereEmpty = true;
  $effect(() => {
    void app.stasyTrains; void app.suburbanTrains; void app.stasyMotion; void app.train; void app.suburban; void tracks;
    if (loaded) untrack(drawTrains);
  });

  // The picked rail line, or the tapped train's: the metro line's track, or the suburban corridor.
  const trainRoute = $derived.by((): GeoJSON.FeatureCollection => {
    const t = app.train, l = app.railLine;
    if (!t && !l) return EMPTY;
    if ((l ?? t)!.kind === "metro") {
      const id = l?.id ?? app.stasyTrains.find(v => v.trip === t!.id)?.line;
      const line = app.metro?.lines.find(x => x.id === id);
      return line ? { type: "FeatureCollection", features: [{ type: "Feature", properties: { color: line.color },
        geometry: { type: "MultiLineString", coordinates: line.paths } }] } : EMPTY;
    }
    const c = app.suburban?.corridors[l?.id ?? app.suburbanTrains.find(v => v.train === t!.id)?.corridor ?? ""];
    return c ? { type: "FeatureCollection", features: [{ type: "Feature", properties: { color: c.color },
      geometry: { type: "LineString", coordinates: c.path.map(([lat, lon]) => [lon, lat]) } }] } : EMPTY;
  });

  $effect(() => {
    const fc = trainRoute;
    if (loaded) (map!.getSource("train-route") as GeoJSONSource).setData(fc);
  });


  $effect(() => {
    const on = app.speedOn;
    if (on && !speedData) loadSpeed().then(d => (speedData = d), () => {
      app.notify("Δεν φόρτωσαν οι ταχύτητες. Δοκίμασε ξανά.");
      app.setSpeedOn(false);
    });
    if (loaded) map!.setLayoutProperty("speed", "visibility", on ? "visible" : "none");
  });

  $effect(() => {
    const d = speedData;
    if (loaded && d) (map!.getSource("speed") as GeoJSONSource).setData(d);
  });

  $effect(() => {
    const o = speedOpacity();
    if (loaded) map!.setPaintProperty("speed", "line-opacity", o);
  });

  $effect(() => {
    const m = map, d = dark;
    if (m && started && d !== styleDark) restyle(m, d);
  });

  $effect(() => {
    if (loaded) (map!.getSource("routes") as GeoJSONSource).setData(routesFC(drawn));
  });

  $effect(() => {
    if (!loaded) return;
    const data = app.metro;
    (map!.getSource("metro") as GeoJSONSource).setData(data ? metroFC(data, [], app.metroStation) : EMPTY);
  });

  // The trip planner's start (A) and end (B).
  $effect(() => {
    const ends = app.tripEnds, m = map;
    if (!ends || !m) return;
    const pins = ([["from", "A"], ["to", "B"]] as const).map(([k, label]) => {
      const el = document.createElement("div");
      el.className = "trip-end";
      el.innerHTML = `<i><b>${label}</b></i>`;
      return new Marker({ element: el, anchor: "bottom" }).setLngLat([ends[k][1], ends[k][0]]).addTo(m);
    });
    return () => pins.forEach(p => p.remove());
  });

  // The picked trip's stops: get on, change, get off.
  $effect(() => {
    const stops = app.tripStops, m = map;
    if (!stops.length || !m) return;
    const pins = stops.map(st => {
      const el = document.createElement("div");
      el.className = "trip-stop";
      el.textContent = st.name;
      return new Marker({ element: el, anchor: "bottom", offset: [0, -6] }).setLngLat([st.at[1], st.at[0]]).addTo(m);
    });
    return () => pins.forEach(p => p.remove());
  });

  // New city data, or a change of the lines drawn in detail: hand the vehicles to the fleet.
  $effect(() => {
    const city = app.city, on = app.cityOn, own = app.cityExclude;
    untrack(() => {
      owned = own;
      fleet.city(on && city ? city.vehicles : [], own, app.serverMs() / 1000);
      nextDue = 0;   // draw new fixes (and their trails) now
      if (loaded && !on) (map!.getSource("city") as GeoJSONSource).setData(EMPTY);
    });
  });

  // While a vehicle or route is selected, the other city vehicles are normal, dimmed or hidden;
  // the selected one stays as it is.
  $effect(() => {
    if (!loaded) return;
    const m = map!, s = app.selection;
    // A route keeps its own line's vehicles: one still on the city layer (its line's data loading, or
    // failing) must not vanish when its route is tapped.
    const sel: ExpressionSpecification = s?.kind === "vehicle"
      ? ["all", ["==", ["get", "line"], s.line], ["==", ["get", "id"], s.id]]
      : s?.kind === "route" ? ["==", ["get", "line"], s.line] : ["boolean", false];
    const o = !s || app.others === "normal" ? 1 : app.others === "dim" ? 0.22 : 1;
    const opacity: ExpressionSpecification = ["*", ["case", sel, 1, o], ["case", ["get", "stale"], 0.3, 1], ["case", ["to-boolean", ["get", "rewind"]], 0.5, 1]];
    m.setPaintProperty("city-dot", "circle-opacity", opacity);
    m.setPaintProperty("city-dot", "circle-stroke-opacity", opacity);
    m.setPaintProperty("city-label", "text-opacity", opacity);
    m.setPaintProperty("city-heading", "icon-opacity", opacity);
    const filter = s && app.others === "hide" ? sel : null;
    m.setFilter("city-dot", filter);
    m.setFilter("city-heading", filter ? ["all", ["has", "h"], filter] : ["has", "h"]);
    m.setFilter("city-label", filter);
    m.setFilter("city-selected", s?.kind === "vehicle" ? sel : ["boolean", false]);
    const vis = app.cityOn ? "visible" : "none";
    for (const id of ["city-dot", "city-label", "city-heading", "city-selected"]) m.setLayoutProperty(id, "visibility", vis);
  });

  $effect(() => {
    const ix = app.stopIx;
    if (loaded && ix) (map!.getSource("bus-stops") as GeoJSONSource | undefined)?.setData(busStopsFC(ix));
  });
  $effect(() => {
    if (loaded) map!.setFilter("bus-stop-selected", ["==", ["get", "i"], app.busStop ?? -1]);
  });

  // A red pin on the open stop (bus, metro, tram or suburban); the map moves to it once, when it opens.
  const pinEl = document.createElement("div");
  pinEl.className = "stop-pin";
  pinEl.innerHTML = `<svg viewBox="0 0 24 32" width="28" height="37" aria-hidden="true"><path d="M12 31s10-11.2 10-19A10 10 0 0 0 2 12c0 7.8 10 19 10 19z" fill="#e5383b" stroke="#fff" stroke-width="2"/><circle cx="12" cy="12" r="3.6" fill="#fff"/></svg>`;
  const pin = new Marker({ element: pinEl, anchor: "bottom" });
  let pinKey = "";
  $effect(() => {
    if (!loaded) return;
    const at = stopPin(app);
    const key = at ? at.join(",") : "";
    if (key === pinKey) return;
    pinKey = key;
    if (!at) { pin.remove(); return; }
    pin.setLngLat(at).addTo(map!);
    pinEl.classList.remove("drop");
    void pinEl.offsetWidth;   // restart the drop animation
    pinEl.classList.add("drop");
    untrack(() => focusOn(at, STOP_ZOOM));
  });

  // A tapped vehicle: the map moves to it once, when it is selected (or once its position is in, from a link).
  let focusKey = "";
  $effect(() => {
    if (!loaded) return;
    const s = app.selection, key = s?.kind === "vehicle" ? `${s.line}/${s.id}` : "";
    if (key === focusKey) return;
    if (!key) { focusKey = ""; return; }
    const c = app.selectedCity ?? app.selectedVehicle?.v, e = untrack(() => fleet.entries.get(key));
    const at: LngLat | null = e ? e.mover.pos ?? e.pos : c ? [c.lon, c.lat] : null;
    if (!at) return;
    focusKey = key;
    untrack(() => focusOn(at, VEHICLE_ZOOM));
  });

  $effect(() => {
    if (!loaded) return;
    const h = app.highlight;
    const line = h ? drawn.find(d => d.id === h.line) : undefined;
    (map!.getSource("highlight") as GeoJSONSource).setData(variantFC(line, h?.variant));
    // No direction focused ("Όλες"): the stops of every direction, not only of the one clicked.
    (map!.getSource("stops") as GeoJSONSource).setData(stopsFC(line, h?.variant, !!h && !app.focus[h.line]));
  });

  // New data of the detailed lines (or a direction focus): hand it to the fleet, line by line.
  $effect(() => {
    const vs = app.vehicles, own = app.cityExclude;
    void app.statics;
    untrack(() => {
      owned = own;
      fadedKeys = new Set(vs.filter(p => p.faded).map(p => `${p.line}/${p.v.id}`));
      const now = app.serverMs() / 1000;
      const byLine = new Map<string, typeof vs>();
      for (const p of vs) byLine.set(p.line, [...(byLine.get(p.line) ?? []), p]);
      for (const line of own) fleet.line(line, (byLine.get(line) ?? []).map(p => ({ v: p.v, route: routeFor(line, p.v.variant) })), now);
      nextDue = 0;
    });
  });

  // Motion back on: every dot goes straight to where its motion says (no glide from the last fix).
  $effect(() => {
    const on = app.motion;
    untrack(() => {
      if (on) for (const e of fleet.entries.values()) e.mover.snap();
      nextDue = 0;
    });
  });

  // Every second: the GPS age on each marker.
  $effect(() => {
    const now = app.serverNow / 1000;
    if (document.hidden) return;
    for (const [k, d] of doms) {
      const e = fleet.entries.get(k);
      if (e) updateAge(d, e, now);
    }
  });

  $effect(() => {
    const s = app.selection;
    const sel = s?.kind === "vehicle" ? `${s.line}/${s.id}` : null;
    for (const [k, d] of doms) {
      d.el.classList.toggle("selected", k === sel);
      d.wrap.classList.toggle("sel", k === sel);
    }
  });

  // The locate button (a MapLibre control under the zoom buttons).
  const locateCtl = document.createElement("div");
  locateCtl.className = "maplibregl-ctrl maplibregl-ctrl-group";
  const locateBtn = document.createElement("button");
  locateBtn.type = "button";
  locateBtn.className = "locate";
  locateBtn.innerHTML = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="10" cy="10" r="5.2"/><circle class="core" cx="10" cy="10" r="2"/><path d="M10 1.5v2.8M10 15.7v2.8M1.5 10h2.8M15.7 10h2.8"/></svg>';
  locateBtn.onclick = locateClick;
  locateCtl.append(locateBtn);
  $effect(() => {
    const s = locState, f = follow;
    locateBtn.dataset.state = s === "on" && f ? "follow" : s;
    const label = s === "off" || s === "denied" ? "Η θέση μου" : f ? "Σταμάτα να δείχνεις τη θέση μου" : "Ακολούθησε τη θέση μου";
    locateBtn.title = label;
    locateBtn.setAttribute("aria-label", label);
    locateBtn.setAttribute("aria-pressed", String(s !== "off" && s !== "denied"));
  });

  let infoOpen = $state(false);
  let infoTab = $state<"sources" | "stats" | "feedback">("sources");
  let Info = $state.raw<typeof import("../ui/InfoDialog.svelte").default | null>(null);
  let infoLoad: Promise<typeof import("../ui/InfoDialog.svelte").default> | null = null;
  async function openInfo(tab?: "feedback") {
    if (tab) infoTab = tab;
    infoLoad ??= import("../ui/InfoDialog.svelte").then(m => m.default);
    try {
      Info = await infoLoad;
      infoOpen = true;
    } catch {
      infoLoad = null;
      app.notify("Δεν φόρτωσαν οι πληροφορίες. Δοκίμασε ξανά.");
    }
  }
  const ended = $derived(gtfsEnded(app.status?.gtfs_expires));
  // «Δώσε feedback» in the ? pop (Panel) opens the ⓘ sheet on its feedback tab.
  $effect(() => {
    const on = () => void openInfo("feedback");
    addEventListener("openfeedback", on);
    return () => removeEventListener("openfeedback", on);
  });
</script>

<div class="map ages-{app.ageMode}" {@attach setup}></div>
{#if app.speedOn}<SpeedLegend meta={speedData?.meta ?? null} onclose={() => app.setSpeedOn(false)} />{/if}
{#if Info}<Info bind:open={infoOpen} bind:tab={infoTab} motion={app.motion} {ended} />{/if}
{#if failed}
  <div class="nogl" role="alert">
    Ο χάρτης δεν μπορεί να εμφανιστεί: ο browser δεν υποστηρίζει WebGL2. Δοκίμασε άλλον browser ή ενεργοποίησε την
    επιτάχυνση γραφικών.
  </div>
{/if}

<style>
  .map { position: absolute; inset: 0; }
  :global(.stop-pin) { pointer-events: none; filter: drop-shadow(0 2px 3px rgb(0 0 0 / 0.35)); }
  :global(.stop-pin.drop svg) { animation: pin-drop 0.45s cubic-bezier(0.3, 1.6, 0.5, 1) both; transform-origin: 50% 100%; }
  @keyframes pin-drop { from { transform: translateY(-18px) scale(0.6); opacity: 0; } to { transform: none; opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { :global(.stop-pin.drop svg) { animation: none; } }
  :global(.segpop b) { font-size: 15px; }
  :global(.segpop div) { font-size: 12px; }
  .nogl { position: absolute; inset: auto 16px 16px; padding: 12px 14px; border-radius: 12px;
    background: var(--warn-bg); box-shadow: var(--shadow); }
</style>
