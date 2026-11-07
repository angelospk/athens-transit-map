<script lang="ts">
  import { LngLatBounds, Map as MlMap, type LngLatLike, Marker, NavigationControl, Popup, setWorkerUrl, type ExpressionSpecification, type FilterSpecification, type GeoJSONSource,
    type MapGeoJSONFeature, type PaddingOptions } from "maplibre-gl";
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
  import { fetchV2Stop } from "../api";
  import { stopRows, type V2Arrival } from "../v2";
  import { Locator, userPlan, type Fix, type LocState } from "../locate";
  import { CITIES, nearestCity as cityAt } from "../cities";
  import { onOpen, type Perm } from "../nearby";
  import { distanceM } from "../glide";
  import { BUS_ZOOM, prefetchTiles, prepare3d, PREPARED, Scene3D, ST_LEN, STREET_ZOOM as STREET3D_ZOOM, TRAIN_LEN } from "./scene3d";
  import type { Look3D } from "./look3d";
  import Route3D from "../ui/Route3D.svelte";
  import { busRoute, lateness, minsTo } from "../bus3d";
  import { smoothPath, snapTram } from "./tramRails";
  import { metroGlyph, metroLogo, oasaLogo, stopSign, tramGlyph, tramLogo } from "./mapIcons";
  import { Clouds } from "./clouds";
  import { bearingOf, depthAt, liveryOf, metroStops, nearestIndex, rightOf, straighten, trackBehind } from "./metroDepth";
  import { snapLine } from "../roadSnap";
  import { Mover, planOnto } from "../motion";
  import { predictS, shapeLength, stopOffsets } from "../predict";
  import { loadSpeed, SPEED_STOPS, type SpeedData } from "../speed";
  import { municipalFC } from "../municipal";
    import { stitch } from "../muniLine";
  import { resolveDark } from "../theme";
  import { fetchLineStatic } from "../api";
  import type { LineStatic, Variant } from "../types";
  import type { AppState } from "../state.svelte";
  import SpeedLegend from "../ui/SpeedLegend.svelte";
  import { paintBase } from "./basemap";
  import { AppleBase, MAPKIT_TOKEN } from "./appleBase";
  import { Fleet, routeGeom, type FleetEntry, type RouteGeom } from "./fleet";
  import { bounds, routesFC, smoothLine, stopsFC, variantFC, type DrawnLine } from "./layers";
  import { STOPS_ZOOM, busStopsFC, placeNote, toward } from "../stops";
  import { pinLinesFC, pinStopsFC } from "../pins";
  import { fold } from "../search";
  import { titleCase } from "../nearby";
  import { durText } from "../format";
  import { STOP_ZOOM, VEHICLE_ZOOM, focusZoom, sheetReserve, stopPin } from "../focus";
  import type { Card } from "../cards";
  import { busStopCard, busVehicleCard, railStationCard, routeCard, stationCard } from "../legacy";
  // Rail stations show from these zooms, small like the bus stops (from STOPS_ZOOM); there are fewer of them.
  const RAIL_ZOOM = 13, SUBURBAN_ZOOM = 12;
  const TRACK_SHIFT = 3;   // a moving train off its line's centre, in its image's pixels (B5)
  // A layer reads a feature's arrays as strings (the GeoJSON goes to the map's worker), so an offset can't be a
  // property: the side's direction is one of 16 (`q`), each with its offset as a literal.
  const SIDES = 16;
  const sideOffset = ["match", ["get", "q"],
    ...Array.from({ length: SIDES }, (_, q) => { const a = (q / SIDES) * 2 * Math.PI; return [q, ["literal", [Math.round(Math.cos(a) * TRACK_SHIFT * 100) / 100, Math.round(Math.sin(a) * TRACK_SHIFT * 100) / 100]]]; }).flat(),
    ["literal", [0, 0]]] as unknown as ExpressionSpecification;
  const POINTER_K = 0.68;  // a train's heading pointer, against its square
  import type { TripIndex } from "../trip";

  setWorkerUrl(workerUrl);

  let { app }: { app: AppState } = $props();

  const FOLLOW_VIEW_MS = 2000;   // following the user: the view is reported this often
  const VIEW_SETTLE_MS = 300;   // the map must rest this long before the city layer asks for tiles
  const DELAY_CLASSES = ["ontime", "late1", "late2", "late3", "none"];
  // One style for both themes: basemap.ts paints it in the light or the dark colours.
  const STYLE = "https://tiles.openfreemap.org/styles/dark";
  const EMPTY = { type: "FeatureCollection" as const, features: [] };
  const COS_LAT = Math.cos((37.98 * Math.PI) / 180);
  const M_PER_PX_Z0 = 156_543.03 * COS_LAT;   // metres per pixel at zoom 0, at Athens

  let map = $state.raw<MlMap>();
  // The map has its style and our layers; false while a new style (the other theme) loads.
  let loaded = $state(false);
  // The 3D street mode (scene3d.ts): its layers go in after every style load; the vehicles are fed each frame.
  const scene3d = new Scene3D();
  // In 3D, close in, the drawn routes go onto their roads (roadSnap.ts): each new set of roads in view bumps this.
  let roadsSeen = $state(0);
  scene3d.onRoads = () => roadsSeen++;
  // Close enough in for the routes to go onto their roads: it flips as the zoom crosses STREET3D_ZOOM, and the routes
  // are sent again then (not only when their data changes).
  let streetZoom = $state(false);
  // Each route snapped once per road index: the same shape always gives the same line, at every zoom and data refresh.
  const snapCache = new WeakMap<object, Map<string, [number, number][]>>();
  function onRoads<F extends GeoJSON.FeatureCollection<GeoJSON.LineString>>(fc: F): F {
    const idx = scene3d.roads;
    if (!app.threeD || !idx || !map || !streetZoom) return fc;
    const cache = snapCache.get(idx) ?? new Map<string, [number, number][]>();
    snapCache.set(idx, cache);
    return { ...fc, features: fc.features.map(f => {
      const src = f.geometry.coordinates as [number, number][];
      const key = src.join(";");
      let coords = cache.get(key);
      if (!coords) cache.set(key, (coords = smoothLine(snapLine(src, idx), 6, 4)));
      return { ...f, geometry: { ...f.geometry, coordinates: coords } };
    }) };
  }
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
    marker: Marker; wrap: HTMLDivElement; el: HTMLButtonElement; dir: HTMLElement; age: HTMLElement; eta: HTMLElement;
    width: number; heading: number | null;
  }
  const doms = new Map<string, Dom>();
  let owned = new Set<string>();       // detailed lines with data: drawn as DOM markers
  let fadedKeys = new Set<string>();   // vehicles of an unknown direction under a direction focus
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const STILL_TRAIL_S = 1;   // motion off: the trail of a move to a new fix fades over this

  // City layer (contract rev 20): the static files of the lines of vehicles in view with along_m,
  // loaded once each (the HTTP cache keeps them across loads), so those vehicles drive on along
  // their whole shape. A failed file is asked again after a minute.
  const cityStatics = new Map<string, LineStatic | number>();   // the file, or when its load started
  const CITY_RETRY_MS = 60_000;
  function cityRoute(line: string, variant: string | null): RouteGeom | null {
    if (!variant) return null;
    const got = cityStatics.get(line);
    if (!app.statics[line] && (got === undefined || (typeof got === "number" && Date.now() - got > CITY_RETRY_MS))) {
      cityStatics.set(line, Date.now());
      fetchLineStatic(line).then(st => cityStatics.set(line, st), () => {});
    }
    return routeFor(line, variant);
  }

  // Route geometry per variant, built once per static file.
  const routes = new WeakMap<Variant, RouteGeom>();
  function routeFor(line: string, variant: string | null): RouteGeom | null {
    const file = cityStatics.get(line);
    const st = variant ? app.statics[line] ?? (typeof file === "object" ? file : undefined) : undefined;
    const v = variant ? st?.variants[variant] : undefined;
    if (!st || !v || v.shape.length < 2) return null;
    let r = routes.get(v);
    if (!r) {
      const known = v.stops.filter(id => st.stops[id]);
      r = routeGeom({ shape: v.shape, stopIds: known, endS: shapeLength(v.shape), lengthM: v.length_m,
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

  const CREDITS_MS = 5000;   // the map's credits show this long, then fold to the ⓘ
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
    // On a computer the left column is the panel and what hangs under it (a card, the planner).
    // The planner may still be loading when its trip is framed: its column is 392 px all the same.
    const right = Math.max(panel.right, app.tab === "trip" ? 392 : 0, ...[...document.querySelectorAll(".popwrap.tabbed, section.card, .start.side .box")].map(e => e.getBoundingClientRect().right));
    // Following a trip: clear of its instruction on top and its panel (or bar) at the foot.
    const gt = document.querySelector(".guide .banner")?.getBoundingClientRect();
    const gb = document.querySelector(".guide .sheet:not([hidden]), .guide .minibar")?.getBoundingClientRect();
    if (gt || gb) return { top: (gt?.bottom ?? 0) + 16, bottom: gb ? Math.min(innerHeight * 0.7, innerHeight - gb.top + 16) : 24, left: 24, right: innerWidth >= 720 ? 84 : 24 };
    // The tab bar floats over the foot of the map: what is framed stays above it.
    const tabs = document.querySelector("nav.tabs")?.getBoundingClientRect();
    const foot = tabs && tabs.height ? Math.max(40, innerHeight - tabs.top + 16) : 40;
    return innerWidth >= 720
      ? { top: 40, bottom: foot, left: right + 24, right: 84 }
      : { top: panel.bottom + 16, bottom: 24, left: 24, right: 24 };
  }

  function fitTo(ids: string[]) {
    const b = bounds(drawn.filter(d => ids.includes(d.id)));
    if (!b || !map) return;
    // With a card open, clear of the sheet too, at its usual height on a phone (a loading card grows), as focusOn.
    const pad = app.stack.length ? padNow() : padding();
    if (app.stack.length && innerWidth < 720 && typeof pad !== "number") pad.bottom = Math.max(pad.bottom ?? 0, sheetReserve(innerHeight));
    map.fitBounds(b, { padding: pad, maxZoom: 15, duration: 600, absolutePadding: true });
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
  // The map's icons (public/icons, made from the OASA/STASY pictograms): a vehicle per mode, a white glyph per rail
  // mode to set on a disc of the line's colour, a bus stop. They start loading with the module, so they are there
  // when the style is.
  const ICONS = { "mode-bus": ["bus", 2], "mode-trolley": ["trolley", 2] } as const;
  const iconImages = Object.fromEntries(Object.entries(ICONS).map(([name, [file]]) => {
    const img = new Image();
    img.src = `${import.meta.env.BASE_URL}icons/${file}.png`;
    return [name, img.decode().then(() => img, () => null)];
  })) as Record<keyof typeof ICONS, Promise<HTMLImageElement | null>>;
  function addIcons(m: MlMap) {
    for (const [name, [, ratio]] of Object.entries(ICONS)) {
      void iconImages[name as keyof typeof ICONS].then(img => {
        if (img && !m.hasImage(name)) { m.addImage(name, img, { pixelRatio: ratio }); m.triggerRepaint(); }
      });
    }
    if (!m.hasImage("mode-disc")) m.addImage("mode-disc", discImage(), { pixelRatio: 2, sdf: true });
    // Drawn crisp (mapIcons.ts), at the sizes the layers expect: the glyphs 24 px, the stop sign 48 px.
    if (!m.hasImage("mode-glyph-metro")) m.addImage("mode-glyph-metro", metroGlyph(), { pixelRatio: 128 / 24 });
    if (!m.hasImage("mode-glyph-logo")) m.addImage("mode-glyph-logo", metroLogo(), { pixelRatio: 128 / 24 });
    if (!m.hasImage("mode-glyph-tramlogo")) m.addImage("mode-glyph-tramlogo", tramLogo(), { pixelRatio: 128 / 24 });
    if (!m.hasImage("mode-glyph-tram")) m.addImage("mode-glyph-tram", tramGlyph(), { pixelRatio: 128 / 24 });
    if (!m.hasImage("mode-stop")) m.addImage("mode-stop", stopSign(), { pixelRatio: 128 / 48 });
    void oasaLogo().then(img => { if (img && m.hasImage("mode-stop")) m.updateImage("mode-stop", stopSign()); });
  }
  // A white disc (tinted per feature: sdf), 28 px across in a 48 px image, like the rail squares were.
  function discImage(): ImageData {
    const c = document.createElement("canvas");
    c.width = c.height = 48;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.beginPath(); g.arc(24, 24, 14, 0, Math.PI * 2); g.fill();
    return g.getImageData(0, 0, 48, 48);
  }

  // Trains (metro and tram from the timetable, Proastiakos by GPS), over everything else, the size of a bus dot
  // (B3): a disc in the line's colour with its mode's glyph (metro, tram; Proastiakos as metro).
  // A moving train sits on the right-hand track of its line (`side`, B5). A GPS fix too old is faded, and its age
  // shows per «Ηλικία θέσης». Under them, the tapped train's line.
  function addTrainLayers(m: MlMap) {
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#3b5bdb";
    const ring = (getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || "#ffffff");
    const byZoom = (stops: unknown[]) => ["interpolate", ["linear"], ["zoom"], ...stops] as ExpressionSpecification;
    const vis = app.trainsOn ? "visible" : "none";
    // A tram drawn as a model (3D, close in: m3d) leaves its disc out.
    const fade = ["case", ["to-boolean", ["get", "m3d"]], 0, ["get", "stale"], 0.45, 1] as ExpressionSpecification;
    // The bus dot's diameter (5, 9, 20, 26 px at z10, 13, 14, 17) over the 16 px square (k = 1), times k.
    const size = (k: number) => byZoom([10, 0.31 * k, 13, 0.56 * k, 14, 1.25 * k, 17, 1.63 * k]);
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
    // A disc in the line's colour with a white ring, the mode's glyph on it (train-hole keeps its old id); the tapped
    // train gets an accent ring round it.
    const disc = (id: string, k: number, color: unknown, filter?: unknown) => m.addLayer({
      id, type: "symbol", source: "trains", ...(filter ? { filter: filter as ExpressionSpecification } : {}),
      layout: { "icon-image": "mode-disc", "icon-size": size(k * 1.15), "icon-offset": sideOffset,
        "icon-allow-overlap": true, "icon-ignore-placement": true, visibility: vis },
      paint: { "icon-color": color as ExpressionSpecification, "icon-opacity": fade } });
    disc("train-sel", 1.4, accent, ["get", "sel"]);
    disc("train-edge", 1.1, ring);   // a thin ring in the map's own colour: a flat sticker, not a raised button
    disc("train-dot", 1, ["get", "color"]);
    m.addLayer({ id: "train-hole", type: "symbol", source: "trains",
      layout: { "icon-image": ["concat", "mode-glyph-", ["get", "glyph"]] as ExpressionSpecification, "icon-size": size(1.15),
        "icon-offset": sideOffset, "icon-allow-overlap": true, "icon-ignore-placement": true, visibility: vis },
      paint: { "icon-opacity": fade } });
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
    // Each vehicle is its mode's pictogram (bus blue, trolley orange), its delay a small dot on its shoulder (from
    // zoom 12, where it can be told apart), its line under it from zoom 14.
    const iconSize = ["interpolate", ["linear"], ["zoom"], 10, 0.2, 13, 0.3, 14, 0.45, 17, 0.58] as ExpressionSpecification;
    m.addLayer({ id: "city-dot", type: "symbol", source: "city",
      layout: { "icon-image": ["match", ["get", "mode"], "trolley", "mode-trolley", "mode-bus"] as ExpressionSpecification,
        "icon-size": iconSize, "icon-allow-overlap": true, "icon-ignore-placement": true },
      paint: { "icon-opacity-transition": { duration: 300 } } as never });
    m.addLayer({ id: "city-delay", type: "circle", source: "city", minzoom: 12,
      paint: {
        "circle-color": ["match", ["get", "cls"], ...DELAY_CLASSES.slice(0, 4).flatMap(c => [c, color(c)]), color("none")],
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 2.5, 14, 3.5, 17, 4.5],
        "circle-translate": ["interpolate", ["linear"], ["zoom"], 12, ["literal", [5, -5]], 14, ["literal", [8, -8]], 17, ["literal", [10, -10]]],
        "circle-stroke-color": color("ring"), "circle-stroke-width": 1.5,
        "circle-opacity-transition": { duration: 300 }, "circle-stroke-opacity-transition": { duration: 300 },
      } as never });
    m.addLayer({ id: "city-label", type: "symbol", source: "city", minzoom: 14,
      layout: { "text-field": ["get", "line"], "text-font": ["Noto Sans Bold"], "text-size": 10, "text-offset": [0, 1.7],
        "text-allow-overlap": true, "text-ignore-placement": true },
      paint: { "text-color": color("fg"), "text-halo-color": color("surface"), "text-halo-width": 1.5,
        "text-opacity-transition": { duration: 300 } } as never });
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
    const ring = (getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || "#ffffff");
    const byZoom = (stops: unknown[]) => ["interpolate", ["linear"], ["zoom"], ...stops] as ExpressionSpecification;
    m.addSource("metro", { type: "geojson", data: EMPTY });
    m.addLayer({ id: "metro-line", type: "line", source: "metro", filter: ["==", ["get", "kind"], "line"],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": ["get", "color"], "line-width": byZoom([10, 2, 14, 4, 17, 6]), "line-opacity": 0.85 } });
    const stationVis = app.trainsOn ? "visible" : "none";
    m.addLayer({ id: "metro-station", type: "circle", source: "metro", filter: ["==", ["get", "kind"], "station"], minzoom: RAIL_ZOOM,
      layout: { visibility: stationVis },
      paint: { "circle-radius": byZoom([RAIL_ZOOM, sel(6, ["case", ["get", "hub"], 4, 3.5]), 14, sel(10, 9), 17, sel(16, 15)]),
        "circle-color": ["case", ["get", "hub"], "#2b2f36", ["get", "color"]], "circle-stroke-color": sel(accent, ring),
        "circle-stroke-width": byZoom([RAIL_ZOOM, sel(3, 1), 17, sel(3.5, 1.5)]) } });
    // Close in, the station shows its mode's glyph (metro or tram) on its disc.
    m.addLayer({ id: "metro-station-glyph", type: "symbol", source: "metro", filter: ["==", ["get", "kind"], "station"], minzoom: 14,
      layout: { visibility: stationVis, "icon-image": ["concat", "mode-glyph-", ["get", "glyph"]] as ExpressionSpecification,
        "icon-size": byZoom([14, 0.8, 17, 1.25]), "icon-allow-overlap": true, "icon-ignore-placement": true } });
    m.addLayer({ id: "metro-label", type: "symbol", source: "metro", minzoom: RAIL_ZOOM + 1,
      filter: ["==", ["get", "kind"], "station"],
      layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": byZoom([RAIL_ZOOM + 1, 10, 15, 11.5, 17, 13]),
        "text-letter-spacing": 0.03, "text-offset": byZoom([RAIL_ZOOM + 1, ["literal", [0, 0.9]], 17, ["literal", [0, 1.5]]]), "text-anchor": "top",
        "text-optional": true, visibility: stationVis },
      paint: { "text-color": styleDark ? "#f1f3f6" : "#1d2026", "text-halo-color": styleDark ? "#14171c" : "#ffffff", "text-halo-width": 1.6, "text-halo-blur": 0.4 } });
  }

  // Suburban rail: its stations as small dots filled with their corridor's colour, from SUBURBAN_ZOOM (moved
  // over the city vehicles in addLayers, like the metro's). A corridor is drawn when it is picked (train-route).
  function addSuburbanLayers(m: MlMap) {
    const sel = (a: unknown, b: unknown) => ["case", ["get", "sel"], a, b] as ExpressionSpecification;
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#3b5bdb";
    const ring = (getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || "#ffffff");
    const byZoom = (stops: unknown[]) => ["interpolate", ["linear"], ["zoom"], ...stops] as ExpressionSpecification;
    const vis = app.trainsOn ? "visible" : "none";
    m.addSource("suburban", { type: "geojson", data: EMPTY });
    m.addLayer({ id: "suburban-station", type: "circle", source: "suburban", filter: ["==", ["get", "kind"], "station"], minzoom: SUBURBAN_ZOOM,
      layout: { visibility: vis },
      paint: { "circle-radius": byZoom([SUBURBAN_ZOOM, sel(5, 3), 15, sel(10, 9), 17, sel(13, 12)]), "circle-color": ["get", "color"],
        "circle-stroke-color": sel(accent, ring), "circle-stroke-width": byZoom([SUBURBAN_ZOOM, sel(3, 1), 17, sel(3.5, 1.5)]) } });
    m.addLayer({ id: "suburban-station-glyph", type: "symbol", source: "suburban", filter: ["==", ["get", "kind"], "station"], minzoom: 15,
      layout: { visibility: vis, "icon-image": "mode-glyph-metro", "icon-size": byZoom([15, 0.85, 17, 1.1]),
        "icon-allow-overlap": true, "icon-ignore-placement": true } });
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

  // Clouds where the sky has them now (clouds.ts): under the map's names and all of ours, gone by street level.
  const clouds = new Clouds();
  const showClouds = (m: MlMap) => {
    const before = m.getStyle()?.layers.find(l => l.type === "symbol")?.id;
    void clouds.show(m, CITIES[untrack(() => app.cityId)].center, styleDark, before);
  };
  function addAll(m: MlMap) {
    addIcons(m);
    addLayers(m);
    showClouds(m);
    addMeAcc(m);
    if (me) showAcc(m, me.fix);
    nextDue = 0;   // the city layer and the trails start empty: draw them now
    cityWasEmpty = trailsWereEmpty = true;
    started = true;
    loaded = true;
    scene3d.restyled();
  }

  // The other theme: the base map's style is swapped. diff: false builds the style anew, so `style.load` fires.
  function restyle(m: MlMap, d: boolean) {
    // Offline the new style cannot load, and setStyle drops the old one first: the map would stay blank, with no
    // layers to tap. It keeps its look; the online event (setup) switches it then.
    if (!navigator.onLine) return;
    styleDark = d;
    loaded = false;
    const gen = ++styleGen;
    scene3d.styleGone();
    m.once("style.load", () => {   // a style replaced before it loaded never fires
      if (gen !== styleGen) return;
      addAll(m);
      const want = untrack(() => dark);
      if (want !== styleDark) restyle(m, want);   // the theme changed meanwhile, offline (restyle skipped it)
    });
    m.setStyle(STYLE, { diff: false });
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

  // «Δημοτικά» (municipal.ts): the municipal bus routes, thin, dashed and muted, under every other layer of ours
  // but the speeds; their stops from zoom 14. Hidden while the switch is off; empty until the data loads.
  const MUNI = "#8c7fa6";
  const MUNI_FOCUS = "#4f3d7a";
  function addMunicipal(m: MlMap) {
    const vis = app.municipalOn ? "visible" : "none";
    m.addSource("municipal", { type: "geojson", data: app.municipal ? municipalFC(app.municipal) : EMPTY });
    m.addLayer({ id: "municipal-line", type: "line", source: "municipal", filter: ["==", ["get", "kind"], "line"],
      layout: { "line-join": "round", "line-cap": "round", visibility: vis },
      paint: { "line-color": MUNI, "line-opacity": 0.75, "line-dasharray": [2, 1.5],
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.2, 14, 2.5, 17, 4] } });
    m.addLayer({ id: "municipal-hit", type: "line", source: "municipal", filter: ["==", ["get", "kind"], "line"],
      layout: { visibility: vis }, paint: { "line-width": 14, "line-opacity": 0 } });
    m.addLayer({ id: "municipal-stop", type: "circle", source: "municipal", filter: ["==", ["get", "kind"], "stop"], minzoom: 14,
      layout: { visibility: vis },
      paint: { "circle-radius": 3.5, "circle-color": "#fff", "circle-stroke-color": MUNI, "circle-stroke-width": 1.5 } });
    // The open municipal card (MuniLineCard): its direction, solid, and its buses as the timetable implies them,
    // hollow, so they never pass for live ones. Shown with the layer switch off too.
    // Darker than the dashed lines and on a white casing, as a picked OASA line, so it never blends with them;
    // the other municipal lines fade while it is open (the effect on app.muniFocus).
    m.addSource("muni-focus", { type: "geojson", data: muniFocusFC() });
    m.addLayer({ id: "muni-focus-casing", type: "line", source: "muni-focus", filter: ["==", ["get", "kind"], "line"],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#fff", "line-width": ["interpolate", ["linear"], ["zoom"], 11, 6, 14, 9, 17, 12] } });
    m.addLayer({ id: "muni-focus-line", type: "line", source: "muni-focus", filter: ["==", ["get", "kind"], "line"],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": MUNI_FOCUS, "line-width": ["interpolate", ["linear"], ["zoom"], 11, 3.5, 14, 5.5, 17, 7.5] } });
    m.addLayer({ id: "muni-focus-bus", type: "circle", source: "muni-focus", filter: ["==", ["get", "kind"], "bus"],
      paint: { "circle-radius": 7, "circle-color": "#fff", "circle-stroke-color": MUNI_FOCUS, "circle-stroke-width": 3 } });
  }
  function muniFocusFC(): GeoJSON.FeatureCollection {
    const f = app.muniFocus;
    if (!f) return EMPTY as GeoJSON.FeatureCollection;
    return { type: "FeatureCollection", features: [
      { type: "Feature", properties: { kind: "line" },
        geometry: { type: "LineString", coordinates: stitch(f.route.shape).map(([lat, lon]) => [lon, lat]) } },
      ...f.vehicles.map(v => ({ type: "Feature" as const, properties: { kind: "bus" }, geometry: { type: "Point" as const, coordinates: [v.lon, v.lat] } })),
    ] };
  }
  const MUNI_LAYERS = ["municipal-line", "municipal-hit", "municipal-stop"];

  // The card of a municipal route (MuniLineCard), with the route's direction chosen.
  function muniCardOf(rid: string): Card | null {
    const c = app.muniCards.find(x => x.routes.some(r => r.id === rid));
    if (!c) return null;
    const d = c.routes.findIndex(r => r.id === rid);
    return { kind: "line", id: c.id, title: c.ref ? `${c.ref} · ${c.name}` : c.name, ...(d === 1 ? { dir: 1 as const } : {}) };
  }

  function addLayers(m: MlMap) {
    addSpeed(m);
    addMunicipal(m);
    addMetroLayers(m);
    addSuburbanLayers(m);
    addCityLayers(m);
    for (const id of ["metro-station", "metro-station-glyph", "metro-label", "suburban-station", "suburban-station-glyph", "suburban-label"]) m.moveLayer(id);
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
    // tolerance 0: MapLibre simplifies GeoJSON lines per tile zoom by default (0.375), which bends a route a little
    // differently at each zoom; in 3D, on the modelled streets, that shows as the line changing shape while zooming.
    m.addSource("routes", { type: "geojson", data: EMPTY, tolerance: 0 });
    m.addSource("highlight", { type: "geojson", data: EMPTY, lineMetrics: true, tolerance: 0 });   // lineMetrics: the chase dims what is behind
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
    m.addLayer({ id: "bus-stop", type: "symbol", source: "bus-stops", minzoom: STOPS_ZOOM,
      layout: { "icon-image": "mode-stop", "icon-size": ["interpolate", ["linear"], ["zoom"], STOPS_ZOOM, 0.3, 17, 0.46],
        "icon-allow-overlap": true, "icon-ignore-placement": true } }, under);
    m.addLayer({ id: "bus-stop-selected", type: "circle", source: "bus-stops", filter: ["==", ["get", "i"], app.busStop ?? -1],
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 6, 17, 11], "circle-opacity": 0,
        "circle-stroke-color": accent, "circle-stroke-width": 3 } });
    m.addLayer({ id: "stops", type: "circle", source: "stops",
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3, 16, 6], "circle-color": "#ffffff",
        "circle-stroke-color": ["get", "color"], "circle-stroke-width": 2 } });
    // The planner's timed trip (app.tripPlan): rides in their line's colour on a white casing, walks dotted.
    m.addSource("trip-plan", { type: "geojson", data: app.tripPlan ?? EMPTY });
    const ride = ["==", ["get", "kind"], "ride"] as ["==", ["get", string], string];
    m.addLayer({ id: "trip-plan-casing", type: "line", source: "trip-plan", filter: ride,
      layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#ffffff", "line-width": 9 } }, under);
    m.addLayer({ id: "trip-plan-ride", type: "line", source: "trip-plan", filter: ride,
      layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": ["get", "color"], "line-width": 5 } }, under);
    // A walk: round dots, light on the dark map and dark on the light one, on a soft casing, so a change between two
    // means reads as a way to walk, never a blank.
    const walk = ["==", ["get", "kind"], "walk"] as ["==", ["get", string], string];
    m.addLayer({ id: "trip-plan-walk-casing", type: "line", source: "trip-plan", filter: walk, layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": styleDark ? "#0b0d12" : "#ffffff", "line-width": 8, "line-opacity": 0.55 } }, under);
    m.addLayer({ id: "trip-plan-walk", type: "line", source: "trip-plan", filter: walk,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": ["coalesce", ["get", "color"], styleDark ? "#e3e7ee" : "#4b5563"], "line-width": 4.5, "line-dasharray": [0, 1.8] } }, under);
    // The open line's changes (LineCard): a badge strip by each stop with a station near, drawn by the map itself, so
    // it stays on its stop as the map moves and zooms, and gives way where it would cover another.
    m.addSource("line-hubs", { type: "geojson", data: EMPTY });
    m.addLayer({ id: "line-hubs", type: "symbol", source: "line-hubs", minzoom: 12.5,
      layout: { "icon-image": ["get", "img"], "icon-anchor": "left", "icon-offset": [7, 0], "icon-allow-overlap": false, "icon-padding": 2 } });
    // Pinned lines and stops (pins.ts): over the other routes, under the vehicles, in the user's colour on a soft halo.
    m.addSource("pin-lines", { type: "geojson", data: EMPTY, tolerance: 0 });
    m.addSource("pin-stops", { type: "geojson", data: EMPTY });
    m.addLayer({ id: "pin-lines-halo", type: "line", source: "pin-lines", layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": ["get", "color"], "line-width": ["+", ["*", ["get", "w"], 1.5], 5], "line-opacity": 0.2 } }, under);
    m.addLayer({ id: "pin-lines", type: "line", source: "pin-lines", layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": ["get", "color"], "line-width": ["get", "w"] } }, under);
    m.addLayer({ id: "pin-stops", type: "circle", source: "pin-stops",
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 6, 16, 9], "circle-color": ["get", "color"],
        "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 } });
    m.addLayer({ id: "pin-stops-label", type: "symbol", source: "pin-stops", minzoom: 12,
      layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": 12, "text-anchor": "left", "text-offset": [1.1, 0],
        "text-optional": true },
      paint: { "text-color": styleDark ? "#eef0f3" : "#13161b", "text-halo-color": styleDark ? "#0f1218" : "#ffffff", "text-halo-width": 1.6 } });
    // The guide (NavGuide): the stop to wait at, a ring of light on the pavement; the bus's way to it, a lane of
    // light on the road that grows brighter towards the stop.
    m.addSource("guide", { type: "geojson", data: EMPTY, lineMetrics: true });
    const gz = (stops: unknown[]) => ["interpolate", ["linear"], ["zoom"], ...stops] as ExpressionSpecification;
    m.addLayer({ id: "guide-approach", type: "line", source: "guide", filter: ["==", ["get", "kind"], "approach"],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-width": gz([12, 5, 16, 12, 19, 30]), "line-blur": gz([12, 1, 18, 6]),
        "line-gradient": ["interpolate", ["linear"], ["line-progress"], 0, "rgba(91,157,255,0)", 0.6, "rgba(91,157,255,0.35)", 1, "rgba(91,157,255,0.8)"] } }, under);
    m.addLayer({ id: "guide-halo", type: "circle", source: "guide", filter: ["==", ["get", "kind"], "ring"],
      paint: { "circle-radius": gz([12, 10, 16, 28, 19, 90]), "circle-color": "#5b9dff", "circle-opacity": 0.2, "circle-blur": 0.7,
        "circle-pitch-alignment": "map" } });
    m.addLayer({ id: "guide-ring", type: "circle", source: "guide", filter: ["==", ["get", "kind"], "ring"],
      paint: { "circle-radius": gz([12, 6, 16, 16, 19, 52]), "circle-opacity": 0, "circle-stroke-color": "#5b9dff",
        "circle-stroke-width": gz([12, 2, 18, 4]), "circle-stroke-opacity": 0.9, "circle-pitch-alignment": "map" } });
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
  function nearestBusStop(m: MlMap, p: { x: number; y: number }, r = scene3d.on ? 26 : 10) {   // in 3D: the whole shelter
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
  // The view's padding around the open sheet (set once the map loads).
  let padNow: () => PaddingOptions = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
  let flyOnFix = false;
  // The first fix of the page, and of each locate tap, may switch the city; a city named in the URL
  // (app.cityLocked) stops it until the user taps locate.
  let cityOnFix = true;
  let me: { marker: Marker; el: HTMLElement; mover: Mover; fix: Fix } | null = null;
  const locator = new Locator({
    geo: navigator.geolocation,
    onState: s => {
      locState = app.locState = s;
      if (s === "on") store("geoLast", "granted");   // for a browser without the Permissions API (nearby.ts onOpen)
      if (s === "denied") {
        follow = false;
        store("locOn", false);
        store("geoLast", "denied");   // «Κοντά σου» stays open: it asks for the city instead
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
    app.myFix = { at: [f.pos[1], f.pos[0]], acc: f.acc, heading: f.heading, speed: f.speed, t: f.at };
    // The first fix of the page or after a locate tap, in another city's area: the app switches to it. Later fixes
    // leave the city alone, so a hand pick in «Κοντά σου» stays.
    const near = cityOnFix && !app.cityLocked ? cityAt(f.pos) : null;
    cityOnFix = false;
    if (near && near !== app.cityId) app.setCity(near, false);
    // «Κοντά σου» follows the user, but not every few metres of GPS noise.
    const at = app.myPos;
    if (!at || distanceM([at[1], at[0]], f.pos) > 25) app.myPos = [f.pos[1], f.pos[0]];
    me.el.classList.toggle("moving", plan.geom.length > 1);
    if (f.heading != null && Number.isFinite(f.heading)) me.el.style.setProperty("--h", `${f.heading}deg`);
    showAcc(m, f);
    if (flyOnFix) {
      flyOnFix = false;
      // A trip on the map (the planner fitted it) matters more than where the user stands: no fly to them.
      // Nor while «Θέλω να πάω» stands as a panel beside the map (a wide window): it shows the city, or the trip's ends.
      if (app.tripPlan || app.tripEnds || (app.start && innerWidth >= 1024)) return;
      // Above «Κοντά σου», which may still be loading: keep the lower half free on a phone.
      const pad = padNow();
      if (innerWidth < 720) pad.bottom = Math.max(pad.bottom ?? 0, innerHeight * 0.5);
      m.flyTo({ center: f.pos, zoom: Math.max(m.getZoom(), 15.5), padding: pad, duration: 1200 });
    }
  }

  function dropMe() {
    me?.marker.remove();
    me = null;
    app.myPos = null;
    (map?.getSource("me-acc") as GeoJSONSource | undefined)?.setData(EMPTY);
  }

  // The locate button: off → find me and follow; following → off; not following → follow again.
  // Each tap that leaves the location on also opens «Κοντά σου»; turning it off closes it.
  function locateClick() {
    if (locState === "off" || locState === "denied") {
      app.cityLocked = false;   // a tap asks for the city the user is in
      locateMe();
    } else if (!app.nearShown && !app.stack.length && app.tab !== "now" && app.tab !== "alerts") {
      // On, with «Κοντά σου» closed: open it again (also while the first fix is still on its way).
      follow = true;
      app.showNear();
      if (me) map?.easeTo({ center: me.mover.pos, zoom: Math.max(map.getZoom(), 15), padding: padNow(), duration: 600 });
    } else if (!follow && me) {
      follow = true;
      map?.easeTo({ center: me.mover.pos, zoom: Math.max(map.getZoom(), 15), padding: padNow(), duration: 600 });
    } else {
      follow = false;
      app.nearOpen = false;
      store("locOn", false);
      locator.stop();
      dropMe();
    }
  }
  function locateMe() {
    follow = true;
    flyOnFix = true;
    cityOnFix = true;
    store("locOn", true);
    app.showNear();
    locator.start();
  }

  // The navigator, following: the user and the frame's points (the stop walked to, the bus when it is close) in view,
  // eased there every couple of seconds; turned with the phone when «Γύρνα το κινητό» is on.
  let framedGuide = false, frameAt = 0;
  function frameGuide(m: MlMap, at: LngLat, pts: [number, number][]) {
    const t = performance.now();
    if (t - frameAt < 2500) return;
    frameAt = t;
    const b = pts.reduce((b, p) => b.extend(p), new LngLatBounds(at, at));
    // Its own padding, from the guide's own parts (the banner on top, the sheet or bar at the foot, the round buttons
    // at the right): the map's general padding changes with other panels and notices, and the view swung with it.
    const rectOf = (sel: string) => { const el = document.querySelector<HTMLElement>(sel); return el && el.offsetParent !== null ? el.getBoundingClientRect() : null; };
    const topEnd = Math.max(rectOf(".guide .then")?.bottom ?? 0, rectOf(".guide .banner")?.bottom ?? 0, 60);
    const footTop = rectOf(".guide .minibar")?.top ?? rectOf(".guide .sheet")?.top ?? innerHeight;
    const pad = { top: topEnd + 24, bottom: Math.max(24, innerHeight - footTop + 24), left: 32, right: 72 };
    if (pad.top + pad.bottom > innerHeight - 120) pad.bottom = Math.max(24, innerHeight - 120 - pad.top);
    m.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    const bearing = m.getBearing();
    const cam = m.cameraForBounds(b, { padding: pad, maxZoom: 17.5, bearing });
    if (!cam || cam.zoom == null || !cam.center) return;
    // Close to where it already is: left still (no small swings every few seconds).
    const c0 = m.project(m.getCenter()), c1 = m.project(cam.center as LngLatLike);
    if (framedGuide && Math.abs(cam.zoom - m.getZoom()) < 0.3 && Math.hypot(c1.x - c0.x, c1.y - c0.y) < 48) return;
    m.easeTo({ center: cam.center, zoom: cam.zoom, bearing, duration: framedGuide && !reducedMotion.matches ? 1000 : 0 });
    framedGuide = true;
  }
  // The phone's compass turns the map (heading-up); off again, north is up.
  let lastBearing = 0;
  $effect(() => {
    const on = app.headingUp, c = app.compass, m = map;
    if (!m) return;
    if (!on) { if (lastBearing) { lastBearing = 0; m.rotateTo(0, { duration: 400 }); } return; }
    if (c == null || m.isMoving()) return;
    const d = Math.abs(((c - m.getBearing() + 540) % 360) - 180);
    if (d < 3) return;
    lastBearing = c;
    m.rotateTo(c, { duration: 250 });
  });

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
    const infoKey = scene3d.on && streetZoom ? selKey ?? hoverKey : null;   // the 3D info chip's vehicle
    let infoAt: LngLat | null = null;
    const still = !app.motion;
    if (!still) fleet.spacing(now);
    // In 3D, close in, the city's vehicles in view are models too (up to CITY_3D of them), not the flat pictograms:
    // their feature stays, unseen (m3d), for the taps and the info chip.
    const city3d = scene3d.on && z >= BUS_ZOOM && cull && !app.chase ? new Set<string>() : null;   // a chase shows its bus alone
    const labelAt = new Map<string, LngLat>();
    for (const e of fleet.entries.values()) {
      const dom = owned.has(e.line);
      const shown = e.key === selKey || (!isGonePos(now - e.at) && passes(only, e.cls, now - e.at));
      if (!shown && !dom) continue;
      const moved = still && !reduced && e.moved && now - e.moved.at < STILL_TRAIL_S ? e.moved : null;
      if (!dom && (!app.cityOn || (focusLines && !focusLines.has(e.line)) || (cull && (still
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
        // In 3D, close in, the vehicle is drawn in the middle of its lane, where its route is painted (scene3d.place).
        const placed = scene3d.on ? scene3d.place(pos, doms.get(e.key)?.heading ?? null, e.line, e.key) : null;
        const d = drawDom(e, placed?.pos ?? pos, still);
        if (e.key === infoKey) infoAt = placed?.pos ?? pos;
        if (e.key === focus?.key) focusAt = placed?.pos ?? pos;
        if (app.chase === e.key && shown) chaseTo(placed?.pos ?? pos, placed?.heading ?? d.heading);
        else if (e.key === selKey && shown) dimBehind(m, placed?.pos ?? pos);
        d.wrap.classList.toggle("filtered", !shown);
        if (scene3d.on) {
          if (shown) scene3d.upsert(e.key, placed?.pos ?? pos, placed?.heading ?? d.heading, app.lineColor(e.line).bg, app.lineInfo.get(e.line)?.kind === "trolley" ? "trolley" : "bus", e.line, e.cls); else scene3d.drop(e.key);
          if (shown && z >= BUS_ZOOM) labelAt.set(e.key, placed?.pos ?? pos);
          const label = etaLabel(e);
          if (d.eta.textContent !== label) d.eta.textContent = label;
        }
        d.el.classList.toggle("rewind", rewind);
      }
      else {
        const h = headingOf(e, still);
        // A city vehicle (a line not followed) being chased: the camera rides behind it and it is a model too (the
        // city layer is hidden while chasing).
        if (app.chase === e.key && scene3d.on) {
          const placed = scene3d.place(pos, h ?? chasedHeading);
          if (placed.heading != null) chasedHeading = placed.heading;
          scene3d.upsert(e.key, placed.pos, placed.heading, app.lineColor(e.line).bg, app.lineInfo.get(e.line)?.kind === "trolley" ? "trolley" : "bus", e.line, e.cls);
          chaseTo(placed.pos, placed.heading);
          chasedCity = e.key;
          if (e.key === infoKey) infoAt = placed.pos;
        } else {
          let at = pos;
          if (city3d && city3d.size < CITY_3D && shown && o && !cull!(pos)) {
            const placed = scene3d.place(pos, h, e.line, e.key);
            scene3d.upsert(e.key, placed.pos, placed.heading, app.lineColor(e.line).bg, app.lineInfo.get(e.line)?.kind === "trolley" ? "trolley" : "bus", e.line, e.cls);
            city3d.add(e.key);
            at = placed.pos;
            labelAt.set(e.key, at);
          }
          if (e.key === infoKey) infoAt = at;
          if (e.key === focus?.key) focusAt = at;
          if (e.key === selKey && shown) dimBehind(m, at);
        }
        features.push({ type: "Feature", geometry: { type: "Point", coordinates: pos },
          properties: { line: e.line, id: e.id, cls: e.cls, mode: app.lineInfo.get(e.line)?.kind ?? "bus", stale: isStalePos(now - e.at), ...(h != null && { h }), ...(rewind && { rewind }),
            ...(city3d?.has(e.key) && { m3d: true }) } });
      }
    }
    // The guide's bus: on the city layer's own vehicle as it moves (its polled place only until the fleet has it).
    const gb = app.guideBus, gbe = gb && guideBusMarker ? fleet.entries.get(`${gb.line}/${gb.vehicle}`) : undefined;
    if (gbe) guideBusMarker!.setLngLat(still ? gbe.pos : gbe.mover.pos);
    showInfo(infoKey && !labels.has(infoKey) ? infoKey : null, infoAt, now);
    for (const [k, at] of metroWant) labelAt.set(k, at);
    for (const [k, at] of tramWant) labelAt.set(k, at);
    if (scene3d.under) for (const k of [...labelAt.keys()]) if (!k.startsWith("metro/")) labelAt.delete(k);   // underground: the trains' only
    syncLabels(labelAt, now);
    for (const k of cityModels) if (!city3d?.has(k) && k !== chasedCity) scene3d.drop(k);
    cityModels = city3d ?? new Set();
    for (const [k, d] of doms) {
      const e = fleet.entries.get(k);
      if (!e || !owned.has(e.line)) { d.marker.remove(); doms.delete(k); scene3d.drop(k); }
    }
    if (app.cityOn && (features.length || !cityWasEmpty)) {
      (m.getSource("city") as GeoJSONSource).setData({ type: "FeatureCollection", features });
      cityWasEmpty = !features.length;
    }
    if (app.stasyTrains.length || app.suburbanTrains.length || !trainsWereEmpty) {
      drawTrains();
      trainsWereEmpty = !app.stasyTrains.length && !app.suburbanTrains.length;
      if (trams3d.size && z >= BUS_ZOOM) fixing = true;   // a tram model moves every frame, not once a second
    }
    if (focus?.follow) { focusFrame(m); fixing = true; }   // followed: every frame, so the camera glides
    if (trails.length || !trailsWereEmpty) {
      (m.getSource("trails") as GeoJSONSource).setData({ type: "FeatureCollection", features: trails });
      trailsWereEmpty = !trails.length;
    }
    if (me) {
      me.mover.reduced = reduced;
      const r = me.mover.step(Date.now() / 1000);
      me.marker.setLngLat(r.pos);
      if (me.mover.fixing) fixing = true;
      // Not during the fly-to or a gesture, nor with a finger on the map: a camera move then (setCenter is a jumpTo)
      // stops MapLibre's drag before it starts, so the drag that would end the follow never came and the map stood
      // still under the finger while the fix was being smoothed. A trip framed stays, unless followed.
      if (follow && (!app.tripPlan || app.guide) && !m.isMoving() && !handsOn()) {
        const fr = app.guide && !app.headingUp ? app.guideFrame : null;   // the phone turned: the user ahead, not an overview
        if (fr?.length) frameGuide(m, r.pos, fr);
        else {
          if (framedGuide) { framedGuide = false; m.easeTo({ center: r.pos, zoom: Math.max(m.getZoom(), 17), padding: padNow(), duration: reducedMotion.matches ? 0 : 700 }); }
          else m.setCenter(r.pos, { follow: true });
        }
      }
    }
    // Corrections and trails: 30 fps close up; zoomed out, where they are a few pixels and every frame
    // steps the whole city, 4 fps.
    // In 3D close in (the models, their labels riding on them, the near street seen large at a slant): every frame.
    // With motion off nothing steps: between fixes (a new one leaves a trail, fast again) once a second is enough.
    const idle = scene3d.on && z >= BUS_ZOOM ? 0 : still ? 1000 : Math.min(1000, Math.max(16, (0.5 * mpp / 20) * 1000));
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

  // Minutes to the vehicle's next stop, from its track (where it is on the route, how fast, where the stops are):
  // «τώρα» under half a minute; "" when unknown (no track: not a detail line).
  // The chase camera (3D, a vehicle followed from its card): behind and above it, steep and close, turning with
  // it smoothly; the vehicle sits low on the screen. The user's zoom is kept (within 17-19.5); a drag ends it.
  const MAX_RATIO = 2;   // the map's pixel ratio, at most
  const MAX_RATIO_3D = 1.5;   // in 3D
  let chaseBearing: number | null = null;
  // The chased vehicle's route (the highlight), drawn as it is: what is behind the vehicle fades (dimBehind).
  let hl: { coords: LngLat[]; color: string } | null = null;
  let dimAt = 0;
  let chasedCity: string | null = null, chasedHeading: number | null = null;   // a chased vehicle of the city layer
  // The city vehicles drawn as models (3D, close in), at most CITY_3D at a time.
  const CITY_3D = 80;
  let cityModels = new Set<string>();
  let chaseZoom: number | null = null;   // the chase's zoom, set by the wheel
  function chaseTo(pos: LngLat, heading: number | null) {
    const m = map;
    if (!m) return;
    dimBehind(m, pos);
    // It starts behind the vehicle, looking the way it goes; after that the angle is the user's (turn and tilt as
    // they like: right-drag, Ctrl+drag, two fingers), and the camera only keeps the vehicle in place, never turning.
    const first = chaseBearing == null;
    if (first) chaseBearing = heading ?? m.getBearing();
    if (!first && pointersDown > 0) return;   // a turn or a tilt in hand: let it run
    // On a phone the card's header covers the bottom: the vehicle sits low in the strip above it.
    const h = m.getCanvas().clientHeight;
    const card = innerWidth < 720 ? document.querySelector<HTMLElement>("section.card") : null;
    const under = card ? Math.max(0, Math.min(h * 0.6, h - card.getBoundingClientRect().top)) : 0;
    m.jumpTo({ center: pos, ...(first ? { bearing: chaseBearing!, pitch: 66 } : {}), zoom: first ? (chaseZoom = 18.6) : (chaseZoom ?? 18.6),
      padding: { top: (h - under) * 0.3, bottom: under, left: 0, right: 0 } }, { follow: true });
  }
  // Riding behind a vehicle, the part of its route already driven goes faint (30% of its colour): where it is on the
  // drawn line, as a fraction of the line's length, is the step of a line gradient (lineMetrics on the source). A few
  // times a second is enough.
  // The route behind the selected (or chased) vehicle goes faint; back to whole when nothing is selected.
  let dimmed = false;
  function undim(m: MlMap) {
    if (!dimmed) return;
    dimmed = false;
    if (m.getLayer("highlight")) m.setPaintProperty("highlight", "line-gradient", undefined as never);
    if (m.getLayer("highlight-casing")) m.setPaintProperty("highlight-casing", "line-gradient", undefined as never);
  }
  $effect(() => {
    const s = app.selection, m = map;
    void app.highlight;
    if (m && loaded && s?.kind !== "vehicle") untrack(() => undim(m));
  });
  function dimBehind(m: MlMap, pos: LngLat) {
    const now = performance.now();
    if (!hl || hl.coords.length < 2 || now - dimAt < 150 || !m.getLayer("highlight")) return;
    dimAt = now;
    const kx = 111320 * Math.cos((pos[1] * Math.PI) / 180), ky = 110540;
    let total = 0, best = Infinity, at = 0;
    for (let i = 1; i < hl.coords.length; i++) {
      const [ax, ay] = [(hl.coords[i - 1][0] - pos[0]) * kx, (hl.coords[i - 1][1] - pos[1]) * ky];
      const [bx, by] = [(hl.coords[i][0] - pos[0]) * kx, (hl.coords[i][1] - pos[1]) * ky];
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, L = Math.sqrt(L2);
      const t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
      const d = Math.hypot(ax + dx * t, ay + dy * t);
      if (d < best) { best = d; at = total + L * t; }
      total += L;
    }
    if (!total || best > 60) return;
    const p = Math.min(0.999, Math.max(0.001, at / total));
    const c = hl.color.replace("#", ""), [r, g, b] = [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16));
    m.setPaintProperty("highlight", "line-gradient", ["step", ["line-progress"], `rgba(${r},${g},${b},0.3)`, p, `rgb(${r},${g},${b})`]);
    m.setPaintProperty("highlight-casing", "line-gradient", ["step", ["line-progress"], "rgba(255,255,255,0.15)", p, "rgba(255,255,255,1)"]);
    dimmed = true;
  }

  // The chase ends with its vehicle's card; while it runs the map is quiet (scene3d: no labels but street names,
  // no icons, no park colours) and shows no other vehicles.
  $effect(() => {
    const k = app.chase, s = app.selection;
    if (k && !(s?.kind === "vehicle" && `${s.line}/${s.id}` === k)) app.setChase(null);
  });
  $effect(() => {
    const on = !!app.chase, m = map;
    if (!m || !loaded) return;
    scene3d.quiet(on);
    m.getContainer().classList.toggle("chasing", on);
    document.documentElement.toggleAttribute("data-chase", on);   // app.css: a phone gives the street the whole screen
    const vis = on || !app.cityOn ? "none" : "visible";
    for (const id of ["city-dot", "city-delay", "city-label", "city-heading", "city-selected"]) if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", vis);
    // The other routes go (the vehicle's own stays: the highlight), and the stops and stations: only the street, its
    // route and the vehicle.
    for (const id of ["routes", "route-arrows", "x3d-route-edge", "highlight-arrows"]) if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", on ? "none" : "visible");
    const rail = on || !app.trainsOn ? "none" : "visible";
    for (const [id, v] of [["bus-stop", on ? "none" : "visible"], ["bus-stop-selected", on ? "none" : "visible"], ["metro-station", rail],
      ["metro-station-glyph", rail], ["metro-label", rail], ["suburban-station", rail], ["suburban-station-glyph", rail], ["suburban-label", rail]])
      if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", v as "none" | "visible");
    if (!on) chaseZoom = null;
    if (!on && chasedCity) { scene3d.drop(chasedCity); chasedCity = null; chasedHeading = null; }
    if (!on && app.selection?.kind !== "vehicle") undim(m);
    if (!on && chaseBearing != null) {
      chaseBearing = null;
      m.easeTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 500 });
    }
  });

  // 3D, close in: a chip above the selected bus (or the one under the mouse) with what its card would say first: the
  // line, where it goes, how late it is, and the minutes to its next stop. Rebuilt at most twice a second.
  let hoverKey: string | null = null;
  let info: { marker: Marker; el: HTMLDivElement; key: string; at: number } | null = null;
  function showInfo(key: string | null, at: LngLat | null, now: number) {
    if (!key || !at || !map) { if (info) info.el.hidden = true; return; }
    if (!info) {
      const el = document.createElement("div");
      el.className = "info3d";
      el.setAttribute("role", "status");
      info = { marker: new Marker({ element: el, anchor: "bottom", offset: [0, -92] }).setLngLat(at).addTo(map), el, key: "", at: 0 };
    }
    info.el.hidden = false;
    info.marker.setLngLat(at);
    if (info.key === key && now - info.at < 0.5) return;
    info.key = key;
    info.at = now;
    info.el.innerHTML = infoHtml(key);
  }
  // A vehicle's line, where it goes, how late it is and the minutes to its next stop, as the info chips show them.
  function infoHtml(key: string, mini = false): string {
    const e = fleet.entries.get(key);
    const [line, id] = key.split("/");
    const pv = app.vehicles.find(p => p.line === line && p.v.id === id)?.v;
    const cv = pv ? null : app.cityByKey.get(key) ?? null;
    const variant = pv?.variant ?? cv?.variant ?? null;
    const head = variant ? app.statics[line]?.variants[variant]?.headsign : undefined;
    const delay = pv?.delay_s ?? cv?.delay_s ?? null;
    const eta = e ? etaLabel(e) : "";
    const c = app.lineColor(line);
    const esc = (t: string) => t.replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
    const late = delay == null ? "" : delay >= 120 ? `<span class="late">+${Math.round(delay / 60)}′ αργεί</span>`
      : delay <= -120 ? `<span class="ok">${Math.round(-delay / 60)}′ νωρίτερα</span>` : `<span class="ok">στην ώρα του</span>`;
    if (mini) {
      // One line: the line, where it goes when known, how late it is.
      const d = delay == null ? "" : delay >= 120 ? `<em class="late">+${Math.round(delay / 60)}′</em>` : delay <= -120 ? `<em class="ok">${Math.round(-delay / 60)}′ νωρίς</em>` : `<em class="ok">στην ώρα</em>`;
      return `<span class="b" style="background:${esc(c.bg)};color:${esc(c.fg)}">${esc(line)}</span>` +
        `${head ? `<span class="to">${esc(titleCase(placeNote(toward(head)).place))}</span>` : ""}${d}`;
    }
    return `<span class="b" style="background:${esc(c.bg)};color:${esc(c.fg)}">${esc(line)}</span>` +
      `<span class="t"><b>${head ? `→ ${esc(titleCase(placeNote(toward(head)).place))}` : `Όχημα ${esc(id)}`}</b>` +
      `<small>${late}${eta ? `${late ? " · " : ""}${eta === "τώρα" ? "φτάνει στη στάση" : `στάση σε ${esc(eta)}`}` : ""}</small></span>`;
  }

  // 3D, close in: a label on each bus model near the view's centre (LABEL_MAX of them): its line, its next stop and
  // the minutes to it, how late it is (bus3d.ts); on a phone only the line and the minutes, in the delay's colour. It
  // rides on the model as drawn (scene3d.drawnAt: out to pass, back in a queue), moved at every frame the map draws.
  // A tap opens the bus's route across (Route3D).
  const LABEL_ZOOM = 16.8, LABEL_MAX = 10;
  const labels = new Map<string, { el: HTMLButtonElement; at: number; html: string; want: LngLat }>();
  // The labels' own layer over the map (not MapLibre markers, which stand on the street and move a step behind the
  // models): each placed at its model's roof as the 3D draws it (scene3d.screenAt, onFrame).
  let labelLayer: HTMLDivElement | null = null;
  const narrowLabels = () => innerWidth < 720;
  const escHtml = (t: string) => t.replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
  function busOf(key: string) {
    const [line, id] = key.split("/");
    const v = app.vehicles.find(p => p.line === line && p.v.id === id)?.v ?? app.cityByKey.get(key) ?? null;
    if (v) app.ensureStatic(line);
    return { line, id, v, route: busRoute(line, id, v, app.statics[line]) };
  }
  // A label's place on the map: on its model as drawn; a metro train's, where its car is on the screen under the street
  // (the marker stands on the street there, so it shows right at the train).
  function labelAt(key: string, want?: LngLat): [number, number] | null {
    const q = scene3d.screenAt(key);
    if (q) return q;
    if (!want || !map || key.startsWith("metro/") || key.startsWith("tram/")) return null;
    const p = map.project(want);
    return [p.x, p.y];
  }
  // A metro train's or a tram's label: its line, its next station (a tram's: stop) and the minutes to it.
  function metroLabelHtml(key: string, now: number): string {
    const tram = key.startsWith("tram/"), v = app.stasyTrains.find(x => x.trip === key.slice(key.indexOf("/") + 1));
    if (!v) return "";
    const chip = `<span class="b" style="background:${escHtml(v.route_color || "#0a7cc4")};color:#fff">${escHtml(v.line)}</span>`;
    const eta = minsTo(v.to.at, now);
    if (narrowLabels()) return chip + `<em>${escHtml(eta)}</em>`;
    return chip + `<span class="t"><b>${escHtml(titleCase(v.to.name))}</b><small>${tram ? "επόμενη στάση" : "επόμενος σταθμός"}</small></span><span class="m"><b>${escHtml(eta)}</b></span>`;
  }
  function labelHtml(key: string, now: number): string {
    if (key.startsWith("metro/") || key.startsWith("tram/")) return metroLabelHtml(key, now);
    const { line, v, route } = busOf(key), c = app.lineColor(line), late = lateness(v?.delay_s ?? null);
    const next = route?.ahead[0], eta = next ? minsTo(next.at, now) : "";
    const chip = `<span class="b" style="background:${escHtml(c.bg)};color:${escHtml(c.fg)}">${escHtml(line)}</span>`;
    if (narrowLabels()) return chip + (eta || late.short ? `<em class="${late.tone === "none" ? "" : late.tone}">${escHtml(eta || late.short)}</em>` : "");
    const head = v?.variant ? app.statics[line]?.variants[v.variant]?.headsign : undefined;
    const name = next ? next.name : head ? `→ ${titleCase(placeNote(toward(head)).place)}` : "";
    return chip + (name ? `<span class="t"><b>${escHtml(name)}</b>${next ? "<small>επόμενη στάση</small>" : ""}</span>` : "") +
      (eta || late.short ? `<span class="m">${eta ? `<b>${escHtml(eta)}</b>` : ""}${late.short ? `<small class="${late.tone === "none" ? "" : late.tone}">${escHtml(late.short)}</small>` : ""}</span>` : "");
  }
  function syncLabels(want: Map<string, LngLat>, now: number) {
    const m = map!;
    const keys: string[] = [];
    if (m.getZoom() >= LABEL_ZOOM && want.size) {
      const c = m.getCenter(), k = Math.cos((c.lat * Math.PI) / 180), [bw, bh] = narrowLabels() ? [84, 34] : [214, 54];
      // The open one first, then nearest the centre; one that would cover another on the screen is left out.
      const taken: { x: number; y: number }[] = [];
      const d = (p: LngLat) => Math.hypot((p[0] - c.lng) * k, p[1] - c.lat);
      for (const key of [...want.keys()].sort((a, b) => (a === app.bus3d ? -1 : b === app.bus3d ? 1 : d(want.get(a)!) - d(want.get(b)!)))) {
        if (keys.length >= LABEL_MAX) break;
        const q = labelAt(key, want.get(key));
        if (!q) continue;
        if (taken.some(t => Math.abs(t.x - q[0]) < bw && Math.abs(t.y - q[1]) < bh)) continue;
        taken.push({ x: q[0], y: q[1] });
        keys.push(key);
      }
    }
    const keep = new Set(keys);
    for (const [k, l] of labels) if (!keep.has(k)) { l.el.remove(); labels.delete(k); }
    if (!labelLayer && keys.length) {
      labelLayer = document.createElement("div");
      labelLayer.className = "labels3d";
      m.getContainer().append(labelLayer);
    }
    for (const k of keys) {
      let l = labels.get(k);
      if (!l) {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "label3d";
        const [line, id] = k.split("/");
        if (line === "tram") {
          el.setAttribute("aria-label", "Τραμ: η κάρτα του");
          el.onclick = ev => { ev.stopPropagation(); app.open(app.cardOfTrain({ kind: "metro", id })); };   // as a tap on its disc
        } else if (line === "metro") {
          el.setAttribute("aria-label", "Τρένο του μετρό: η διαδρομή του");
          el.onclick = ev => { ev.stopPropagation(); app.bus3d = k; };   // its route across (Route3D), the camera down with it
        } else {
          el.setAttribute("aria-label", `Γραμμή ${line}, όχημα ${id}: η διαδρομή του`);
          el.onclick = ev => { ev.stopPropagation(); app.bus3d = k; };
        }
        labelLayer!.append(el);
        l = { el, at: 0, html: "", want: want.get(k)! };
        labels.set(k, l);
      }
      l.want = want.get(k)!;
      const picked = app.bus3d === k || (app.train?.kind === "metro" && k === `metro/${app.train.id}`);   // (a metro key in bus3d too)
      l.el.classList.toggle("picked", picked);
      l.el.setAttribute("aria-expanded", String(app.bus3d === k));
      if (now - l.at > 2) {
        l.at = now;
        const html = labelHtml(k, now);
        if (html !== l.html) { l.html = html; l.el.innerHTML = html; l.el.hidden = !html; }   // nothing to say: no empty box
      }
    }
    rideLabels();
    for (const [k, d] of doms) d.wrap.classList.toggle("lab", labels.has(k));
  }
  // At every frame the map draws: each label onto its model, where it was just drawn.
  function rideLabels() {
    for (const [k, l] of labels) {
      const q = labelAt(k, l.want);
      l.el.style.visibility = q ? "" : "hidden";
      // Not rounded to whole pixels: a slow bus would make its label hop a pixel at a time.
      if (q) l.el.style.transform = `translate3d(${(q[0] - 14).toFixed(2)}px, ${(q[1] - 8).toFixed(2)}px, 0) translateY(-100%)`;
    }
  }

  function etaLabel(e: FleetEntry): string {
    const t = e.track;
    if (!t) return "";
    const s = predictS(t, app.serverMs() / 1000), next = t.stopS.find(x => x > s + 5);
    if (next == null) return "";
    const sec = (next - s) / Math.max(t.speed ?? 5, 3);
    return sec < 30 ? "τώρα" : `${Math.max(1, Math.round(sec / 60))}′`;
  }

  function makeDom(e: FleetEntry, pos: LngLat): Dom {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "bus";
    el.onclick = ev => {
      ev.stopPropagation();
      if (app.pickFor) { app.mapPick = [e.pos[1], e.pos[0]]; return; }   // «Πού πας;» on the map
      app.open(busVehicleCard(e.line, e.id));
    };
    const num = document.createElement("span");
    num.className = "num";
    num.textContent = e.line;
    // 3D close in (app.css .map3d-near): the minutes to its next stop, beside the line, as in a callout.
    const eta = document.createElement("span");
    eta.className = "eta";
    const dir = document.createElement("i");
    dir.className = "dir";
    const age = document.createElement("span");
    age.className = "age";
    el.append(num, eta, dir);
    el.setAttribute("aria-label", `Γραμμή ${e.line}, όχημα ${e.id}`);
    // The marker element only positions; the visible pill is the child. The age label is beside the
    // pill, not in it: a stale pill is faint, its age stays readable.
    const wrap = document.createElement("div");
    wrap.className = "vm";
    wrap.append(el, age);
    wrap.onmouseenter = () => (hoverKey = e.key);   // 3D: its info chip (showInfo)
    wrap.onmouseleave = () => { if (hoverKey === e.key) hoverKey = null; };
    const marker = new Marker({ element: wrap, anchor: "center", subpixelPositioning: true }).setLngLat(pos).addTo(map!);
    paint(el, e.line);
    el.dataset.line = e.line;
    const d: Dom = { marker, wrap, el, dir, age, eta, width: el.offsetWidth, heading: null };
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
        style: STYLE,
        center: CITIES[untrack(() => app.cityId)].center,   // untracked: a city change moves this map, it does not rebuild it
        zoom: CITIES[untrack(() => app.cityId)].zoom,
        attributionControl: { compact: true },
        pixelRatio: Math.min(devicePixelRatio || 1, MAX_RATIO),
        // Tiles kept off screen for going back: two zoom levels' worth, not five. Each keeps its buffers on the GPU
        // (in 3D its buildings and streets too), and five filled a phone's memory until the browser dropped the map.
        maxTileCacheZoomLevels: 2,
        // Greek names for the map's own controls (a screen reader read them in English).
        locale: { "Map.Title": "Χάρτης", "NavigationControl.ZoomIn": "Μεγέθυνση", "NavigationControl.ZoomOut": "Σμίκρυνση",
          "AttributionControl.ToggleAttribution": "Πηγές του χάρτη" },
        dragRotate: false,
        pitchWithRotate: false,
        // Smooth edges: the 3D buildings, roads and models are not jagged (multisampling; cheap on phone GPUs).
        canvasContextAttributes: { antialias: true },
      });
    } catch {
      failed = true;   // GPUInitializationError: no WebGL2
      return;
    }
    // Every style load (the first and each restyle), before its tiles draw: the base map is painted for the theme (basemap.ts),
    // and its own layers are noted (before ours go in): the ones Apple's map replaces in 2D.
    m.on("style.load", () => {
      paintBase(m, styleDark);
      baseLayers = m.getStyle().layers.map(l => [l.id, (m.getLayoutProperty(l.id, "visibility") as string | undefined) ?? "visible"] as [string, string]);
      baseHidden = false;
      baseGen++;
    });
    // Apple Maps under ours in 2D, when a token is set (appleBase.ts).
    if (MAPKIT_TOKEN) {
      apple = new AppleBase(node);
      apple.onFail = () => { appleFailed = true; };
      const follow = () => { const c = m.getCanvas(); apple?.sync(m.getCenter(), m.getZoom(), c.clientWidth, c.clientHeight); };
      m.on("move", follow);
      m.on("resize", follow);
    }
    m.touchZoomRotate.disableRotation();
    // Bottom right, over the credits: the zoom buttons last (lowest), the locate button above them; the rest of the
    // map's buttons are at the top right (Panel's rail). A new bottom control goes above the ones there.
    m.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    m.addControl({ onAdd: () => locateCtl, onRemove: () => locateCtl.remove() }, "bottom-right");
    m.addControl({ onAdd: () => northCtl, onRemove: () => northCtl.remove() }, "bottom-right");
    m.on("rotate", () => needleTo(m));
    needleTo(m);
    m.addControl({ onAdd: () => infoCtl, onRemove: () => infoCtl.remove() }, "bottom-right");
    // MapLibre puts a new bottom control above the others; after the credits it floats left of the ⓘ, on its row.
    infoCtl.parentElement?.append(infoCtl);
    watchHands(m);
    const cloudTimer = setInterval(() => { if (!document.hidden) showClouds(m); }, 20 * 60_000);
    m.on("remove", () => clearInterval(cloudTimer));
    // 3D: a stop under the mouse lights up whole (pole, shelter, a ring), and the pointer says it can be tapped.
    let hovered = false;
    m.on("mousemove", e => {
      if (!scene3d.on || m.getZoom() < STOPS_ZOOM || pointersDown) { if (hovered) { hovered = false; scene3d.hoverStop(null); } return; }
      const f = nearestBusStop(m, e.point);
      scene3d.hoverStop(f ? ((f.geometry as GeoJSON.Point).coordinates as LngLat) : null);
      if (!!f !== hovered) { hovered = !!f; m.getCanvas().style.cursor = f ? "pointer" : ""; }
    });
    m.on("dragstart", () => { follow = false; if (dive) dive.follow = false; if (focus) focus.follow = false; });   // only user gestures fire them
    // Untracked: setup runs inside the attachment's effect, and reading streetZoom there would make the whole map
    // depend on it (crossing zoom 15 would then tear the map down and build it again at the city's starting view).
    const zoomed = () => untrack(() => { const z = m.getZoom() >= STREET3D_ZOOM; if (z !== streetZoom) streetZoom = z; });
    m.on("zoom", zoomed);
    zoomed();
    // 3D, close in, a mouse over a city bus shows its info chip (showInfo); a few times a second is enough.
    let hoverAt = 0;
    m.on("mousemove", e => {
      const now = performance.now();
      if (now - hoverAt < 120) return;
      hoverAt = now;
      if (!scene3d.on || !streetZoom) { hoverKey = null; return; }
      if ((e.originalEvent.target as Element | null)?.closest?.(".vm")) return;
      const f = nearestCity(m, e.point);
      hoverKey = f ? `${f.properties?.line}/${f.properties?.id}` : null;
      m.getCanvas().style.cursor = f ? "pointer" : "";
    });
    m.on("mouseout", () => (hoverKey = null));
    scene3d.onFrame = rideLabels;   // each label onto its model, in the same frame the 3D draws it
    // The chase camera moves the map every frame, which cuts MapLibre's own drag and wheel short: a press on the map
    // ends the chase, and the wheel sets its zoom (17-19.5) instead.
    const canvasBox = m.getCanvasContainer();
    // Only a plain left press (a drag of the map): the right button and Ctrl+drag turn and tilt the view, chasing on.
    const endChase = (e: MouseEvent) => { if (app.chase && e.button === 0 && !e.ctrlKey) app.setChase(null); };
    canvasBox.addEventListener("mousedown", endChase);
    // Touch: two fingers pinch the chase's zoom (as the wheel); one finger that moves past a tap ends the chase, so a
    // tap (a bus, a stop) or a slip of the thumb does not.
    let touch: { x: number; y: number } | null = null, pinch: { d: number; z: number } | null = null;
    const gap = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    canvasBox.addEventListener("touchstart", e => {
      if (!app.chase) return;
      if (e.touches.length >= 2) {
        e.preventDefault(); e.stopPropagation();
        pinch = { d: gap(e.touches), z: chaseZoom ?? m.getZoom() };
        touch = null;
      } else {
        // MapLibre gets it too: the chase camera waits while a finger is down (chaseTo), so a drag that ends the
        // chase moves the map at once instead of needing a second try.
        touch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    }, { capture: true, passive: false });
    canvasBox.addEventListener("touchmove", e => {
      if (!app.chase) return;
      if (pinch && e.touches.length >= 2) {
        e.preventDefault(); e.stopPropagation();
        chaseZoom = Math.min(19.5, Math.max(17, pinch.z + Math.log2(gap(e.touches) / pinch.d)));
      } else if (touch && Math.hypot(e.touches[0].clientX - touch.x, e.touches[0].clientY - touch.y) > 12) {
        touch = null;
        if (app.chase) app.setChase(null);
      }
    }, { capture: true, passive: false });
    canvasBox.addEventListener("touchend", e => { if (e.touches.length < 2) pinch = null; if (!e.touches.length) touch = null; }, { capture: true, passive: true });
    canvasBox.addEventListener("wheel", e => {
      if (!app.chase) return;
      e.preventDefault(); e.stopPropagation();
      chaseZoom = Math.min(19.5, Math.max(17, (chaseZoom ?? m.getZoom()) - e.deltaY * 0.0025));
    }, { capture: true, passive: false });
    // MapLibre shows the credits (ⓘ) open until the first drag: on a phone they cover the map. They fold after a few
    // seconds instead; a tap on the ⓘ opens them again (#34: they must be seen first).
    // A tap on the ⓘ before then is the user's choice: the timer stops.
    m.once("load", () => {
      const t = setTimeout(() =>
        node.querySelector(".maplibregl-ctrl-attrib.maplibregl-compact-show")?.classList.remove("maplibregl-compact-show"), CREDITS_MS);
      node.querySelector(".maplibregl-ctrl-attrib-button")?.addEventListener("click", () => clearTimeout(t), { once: true });
    });
    // The city layer loads the tiles of the view: at first, and 300 ms after the map stops moving (never during a move).
    const reportView = () => {
      if (m.getZoom() >= STOPS_ZOOM - 0.5 && !app.stopIx) loadStops();
      const b = m.getBounds();
      app.setCityView({ north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() }, m.getZoom());
    };
    const reportSoon = debounce(reportView, VIEW_SETTLE_MS);
    m.on("load", reportView);
    // Follow mode moves the map every frame: it never rests, so its view is reported on a clock instead.
    const reportFollow = throttle(reportView, FOLLOW_VIEW_MS);
    const ticked = (e: object) => "follow" in e;
    m.on("movestart", e => {
      if (ticked(e)) return;
      reportSoon.cancel(); reportFollow.cancel(); app.setCityMoving();
    });
    m.on("moveend", e => (ticked(e) ? reportFollow() : reportSoon()));

    const popup = new Popup({ closeButton: false, offset: 10, maxWidth: "240px" });
    // The GPU dropped the map (out of memory, a driver reset). MapLibre puts back a copy of the style without our 3D
    // layer and without our other additions in step, so tiles stayed empty: the style is loaded afresh instead, and
    // everything goes in again (addAll), the 3D scene too.
    m.on("webglcontextlost", () => { loaded = false; scene3d.styleGone(); });
    m.on("webglcontextrestored", () => restyle(m, styleDark));
    m.on("load", () => {
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
    const onOnline = () => { const d = untrack(() => dark); if (loaded && d !== styleDark) restyle(m, d); };   // a theme chosen offline
    addEventListener("online", onOnline);
    // On open, «Κοντά σου» (nearby.ts onOpen): location allowed → find me and show the stops near me; not decided
    // yet → the browser asks once, later a button in the panel asks; refused or a linked card → nothing. A link with
    // the location turned on last time and still allowed starts it again (no fly-to: the map shows the link).
    let disposed = false;
    const raw = (k: string): unknown => { try { return JSON.parse(localStorage.getItem(k) ?? "null"); } catch { return null; } };
    const read = (k: string) => !!raw(k);
    const last = raw("geoLast") === "granted" ? "granted" : raw("geoLast") === "denied" ? "denied" : undefined;
    const perm: Promise<Perm> = navigator.permissions
      ? navigator.permissions.query({ name: "geolocation" }).then(r => r.state, () => "unknown" as const)
      : Promise.resolve("unknown");
    void perm.then(p => {
      if (disposed) return;
      const what = onOpen({ linked: app.linked, perm: p, asked: read("nearAsked"), last });
      if (what === "none") { if (p === "granted" && read("locOn")) locator.start(); return; }
      if (what === "ask") store("nearAsked", true);
      if (what === "button") app.showNear();
      else locateMe();
    });
    // One dispatcher: DOM marker (its own handler) → train right under the finger → station right under the finger (drawn over the city
    // vehicles, under a picked line's stops) → city vehicle → stop → station near the finger → route → municipal route or
    // stop → speed segment → empty map.
    m.on("click", e => {
      if (!loaded) return;   // the style is being replaced: our layers are not there to hit
      if ((e.originalEvent.target as Element | null)?.closest?.(".bus")) return;
      // «Πού πας;», choosing an end on the map: a click (a computer) takes that point; nothing else opens.
      if (app.pickFor) { app.mapPick = [e.lngLat.lat, e.lngLat.lng]; return; }
      // «Λάθος θέση;»: a tap puts the blue pin there (a tap on the pin itself does nothing); nothing else opens.
      if (app.stopFix) {
        if (!(e.originalEvent.target as Element | null)?.closest?.(".fix-pin")) {
          fixPin.setLngLat(e.lngLat);
          app.stopFixAt = [e.lngLat.lat, e.lngLat.lng];
        }
        return;
      }
      const pinned = m.getLayer("pin-stops") ? m.queryRenderedFeatures(e.point, { layers: ["pin-stops"] })[0] : undefined;
      if (pinned) { app.push({ kind: "stop", id: `oasa:${pinned.properties.id}`, title: String(pinned.properties.name) }); return; }
      const hub = m.getLayer("line-hubs") ? m.queryRenderedFeatures(e.point, { layers: ["line-hubs"] })[0] : undefined;
      if (hub) { app.push({ kind: "stop", id: String(hub.properties.id), title: String(hub.properties.name) }); return; }
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
        // Its card at once: it shows from the stop's board until the stop index loads (AppState.show, which also
        // drops a late index answer once another card is on top).
        popup.remove();
        app.open(busStopCard(String(stop.properties.id), String(stop.properties.name)));
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
      if (app.municipalOn) {
        const near = (r: number) => m.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]],
          { layers: ["municipal-stop", "municipal-hit"] });
        const hits = near(10), muni = hits.find(f => f.properties.kind === "stop") ?? hits[0];
        // A stop or a line opens its card, as the bus stops and lines do (MuniStopCard, MuniLineCard).
        const c = muni?.properties.kind === "stop"
          ? { kind: "stop" as const, id: `muni:${String(muni.properties.sid).replace(/^osm:/, "")}`, title: String(muni.properties.name) }
          : muni ? muniCardOf(String(muni.properties.rid)) : null;
        if (c) { popup.remove(); return app.open(c); }
      }
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
    for (const layer of ["pin-stops", "line-hubs", "routes-hit", "stops", "city-dot", "metro-station", "suburban-station", "speed", "train-dot", "municipal-hit", "municipal-stop"]) {
      m.on("mouseenter", layer, () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", layer, () => (m.getCanvas().style.cursor = ""));
    }

    map = m;
    app.fit = fitTo;
    // «Χρήση της θέσης μου» (NearbyPanel): a tap, so the user's city wins over a ?city= in the URL.
    app.locate = () => { if (locState === "off" || locState === "denied") { app.cityLocked = false; locateMe(); } };
    // The guide: the location on, the map on it, close in (a street's width).
    app.followMe = () => {
      if (locState === "off" || locState === "denied") { follow = true; flyOnFix = false; cityOnFix = true; locator.start(); }
      follow = true;
      // The guide keeps its frame (the stop, the bus): the next frame step fits it at once, no jump to the user first.
      if (app.guide && app.guideFrame?.length && !app.headingUp && me) { frameAt = 0; return; }
      if (me) m.easeTo({ center: me.mover.pos, zoom: Math.max(m.getZoom(), 17), padding: padNow(), duration: reducedMotion.matches ? 0 : 800 });
      else if (app.guide?.legs[0]) { const l = app.guide.legs[0], at = l.kind === "walk" ? l.from : l.board.at; m.easeTo({ center: [at[1], at[0]], zoom: 17, duration: 0 }); }
    };
    // The guide's look at the bus and the user together: off the user until followMe again.
    app.peekAt = pts => {
      if (!pts.length) return;
      follow = false;
      const b = pts.reduce((b, p) => b.extend(p), new LngLatBounds(pts[0], pts[0]));
      // The guide's padding stays on the map (easeTo keeps it): fitBounds would add its own on top of it.
      m.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
      m.fitBounds(b, { padding: padNow(), maxZoom: 17, duration: reducedMotion.matches ? 0 : 700, absolutePadding: true });
    };
    app.showCity = c => {
      follow = false;
      m.flyTo({ center: CITIES[c].center, zoom: CITIES[c].zoom, duration: reducedMotion.matches ? 0 : 1200 });
    };
    // The view's padding with the bottom sheet on a phone. A card that is still loading (opened from the
    // search) is not in the page yet: assume the sheet's usual half screen.
    const sheetPad = () => {
      const pp = padding(), card = document.querySelector(".card")?.getBoundingClientRect();
      const pad = typeof pp === "number" ? { top: pp, bottom: pp, left: pp, right: pp } : { ...pp };
      // A phone: above the card, or the trip's sheet at the foot (its details open), else the lower half.
      const sheet = document.querySelector(".popwrap.tabbed")?.getBoundingClientRect();
      const foot = card ?? (sheet && sheet.top > innerHeight * 0.25 ? sheet : null);
      if (innerWidth < 720) pad.bottom = Math.max(pad.bottom, foot ? innerHeight - foot.top + 16 : innerHeight * 0.45);
      return pad;
    };
    padNow = sheetPad;
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
      follow = false;   // framing a trip: the camera no longer follows the user back to where they stand
      if (pts.length < 2) { if (pts.length) app.flyTo(pts[0]); return; }
      const b = pts.reduce((b, p) => b.extend(p), new LngLatBounds(pts[0], pts[0]));
      // absolutePadding: these insets alone, not added to what an earlier move left on the map (it framed the trip off
      // to one side, under the panel).
      m.fitBounds(b, { padding: sheetPad(), maxZoom: 15, duration: reducedMotion.matches ? 0 : 600, absolutePadding: true });
    };
    if (import.meta.env.DEV) Object.assign(window, { __map: m, __fleet: fleet, __doms: doms, __scene3d: scene3d, __labels: labels, __dive: () => dive, __focus: () => ({ focus, focusAt }), __app: app });
    return () => {
      app.fit = () => {};
      app.locate = () => {};
      app.followMe = () => {};
      app.peekAt = () => {};
      app.showCity = () => {};
      app.flyTo = () => {};
      app.fitPoints = () => {};
      focusOn = () => {};
      pin.remove();
      fixPin.remove();
      disposed = true;
      cancelAnimationFrame(raf);
      reportSoon.cancel();
      reportFollow.cancel();
      document.removeEventListener("visibilitychange", onVisible);
      removeEventListener("online", onOnline);
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
    const vis = app.trainsOn ? "visible" : "none", stations = app.trainsOn && !app.chase ? "visible" : "none";   // a chase hides the stations
    if (loaded) for (const id of ["train-sel", "train-edge", "train-dot", "train-hole", "train-heading", "train-age", "train-route", "train-route-2", "train-route-casing"])
      map!.setLayoutProperty(id, "visibility", vis);
    if (loaded) for (const id of ["metro-station", "metro-station-glyph", "metro-label", "suburban-station", "suburban-station-glyph", "suburban-label"])
      map!.setLayoutProperty(id, "visibility", stations);
  });

  $effect(() => { const f = ageFilter(app.ageMode); if (loaded) map!.setFilter("train-age", f); });

  // Each metro/tram line's tracks as [lat, lon] shapes (rails.ts), and the Proastiakos trains snapped
  // onto their corridor, run on along it at their speed between fixes (server time: fixes carry it).
  const tracks = $derived(Object.fromEntries((app.metro?.lines ?? []).map(l =>
    [l.id, l.paths.map(p => p.map(([lon, lat]) => [lat, lon] as [number, number]))])) as Record<string, Track[]>);
  const glide = new RailGlide(2_000);
  // The tram lines' railway, for 3D (scene3d's rails): rounded at the corners (tramRails.ts), and the trams put on it.
  const tramPaths = $derived(Object.fromEntries(Object.entries(tracks).filter(([id]) => id.startsWith("T"))
    .map(([id, paths]) => [id, paths.map(p => smoothPath(p).map(([lat, lon]) => [lon, lat] as LngLat))])) as Record<string, LngLat[][]>);
  // The metro lines' tracks the same way: its trains ride them in 3D, under the street where the line is underground,
  // in their tunnels (scene3d.setMetro).
  // Straight through each station (metroDepth.straighten), as they are built.
  const metroPaths = $derived(Object.fromEntries(Object.entries(tracks).filter(([id]) => id.startsWith("M"))
    .map(([id, paths]) => {
      const stops = metroStops(app.metro?.stations ?? [], id).map(st => [st.lon, st.lat] as LngLat);   // its own, once each
      return [id, paths.map(p => straighten(smoothPath(p).map(([lat, lon]) => [lon, lat] as LngLat), stops, ST_LEN))];
    })) as Record<string, LngLat[][]>);
  // Underground (the rail's button, or a metro train picked in 3D): the street dims so the tunnels show, and the
  // metro's lines leave the street: each is drawn along its tunnel's floor instead (scene3d).
  $effect(() => {
    const under = app.threeD && app.under, m = map;   // the metro mode: the «Υπόγεια» button (a metro train picked turns it on)
    if (!app.threeD && app.under) untrack(() => (app.under = false));   // 3D off ends the metro mode: back to a whole map
    scene3d.setUnder(under);
    document.documentElement.toggleAttribute("data-under", under);   // app.css: no markers on the street
    if (!m || !loaded) return;
    const line = ["==", ["get", "kind"], "line"];
    if (m.getLayer("metro-line")) m.setFilter("metro-line", (under ? ["all", line, ["!=", ["slice", ["get", "id"], 0, 1], "M"]] : line) as FilterSpecification);
    const metroPicked = under && app.train?.kind === "metro";
    for (const id of ["train-route-casing", "train-route", "train-route-2"])
      if (m.getLayer(id)) m.setPaintProperty(id, "line-opacity", metroPicked ? 0 : id === "train-route-casing" ? 0.9 : 1);
  });
  $effect(() => {
    scene3d.setMetro(Object.entries(metroPaths).map(([id, paths]) => ({ id, paths })), app.metro?.stations ?? []);
  });
  $effect(() => {
    scene3d.setTramTracks({ type: "FeatureCollection", features: Object.entries(tramPaths)
      .flatMap(([id, paths]) => paths.map(p => ({ type: "Feature" as const, properties: { line: id }, geometry: { type: "LineString" as const, coordinates: p } }))) });
  });
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
    if (focusLines) fc.features = fc.features.filter(f => focusLines!.has(String(f.properties!.line)));   // a picked trip: its own lines only
    for (const f of fc.features) { const [x, y] = f.properties!.side as number[]; f.properties!.q = ((Math.round(Math.atan2(y, x) / (2 * Math.PI / SIDES)) % SIDES) + SIDES) % SIDES; }
    // In 3D, close in, each tram is a model too (scene3d.ts buildTram): its cars follow the track it has driven, and
    // its disc gives way (m3d).
    const now3d = new Set<string>(), near3d = scene3d.on && map!.getZoom() >= BUS_ZOOM;
    tramWant.clear();
    if (near3d) for (const f of fc.features) if (f.properties!.glyph === "tram") f.properties!.m3d = true;
    // Only the trams near the view (a model is drawn within ~1 km): snapping one onto its rails each frame is not free.
    const vc = map!.getCenter(), vkx = 111320 * Math.cos((vc.lat * Math.PI) / 180);
    if (near3d) for (const f of fc.features) {
      const pr = f.properties!;
      if (pr.glyph !== "tram") continue;
      const at = (f.geometry as GeoJSON.Point).coordinates as LngLat, h = (pr.h as number | undefined) ?? null;
      if (Math.hypot((at[0] - vc.lng) * vkx, (at[1] - vc.lat) * 110540) > 2500) continue;
      const key = `tram/${pr.id}`;
      now3d.add(key);
      // On the rails as drawn (rounded), heading along them; standing at a stop it has no heading of its own: its
      // line's way where it stands, so its cars lie along the rails.
      const on = snapTram(tramPaths[String(pr.line)] ?? [], at, h);
      scene3d.upsert(key, on?.pos ?? at, on?.heading ?? h ?? pathHeading(tracks[String(pr.line)] ?? [], at), String(pr.color ?? "#ee7a2c"), "tram", String(pr.line ?? ""));
      tramWant.set(key, at);   // its label, as a bus's
    }
    // The metro's trains too: on their direction's track, at their depth (metroDepth.ts), in their own livery. Their
    // disc stays on the street above them, to tap.
    if (focus?.key.startsWith("train/")) {
      const f = fc.features.find(x => `train/${x.properties!.id}` === focus!.key);
      if (f) focusAt = scene3d.drawnAt(`tram/${f.properties!.id}`) ?? ((f.geometry as GeoJSON.Point).coordinates as LngLat);
    }
    metroWant.clear();
    if (airportTrains.size > 200) airportTrains.clear();
    const stasyBy = new Map(app.stasyTrains.map(v => [v.trip, v]));
    // A station's name to match a headsign: no accents, one case («Ελληνικό» and «ΕΛΛΗΝΙΚΟ» are one).
    const key1 = (t: string) => fold(t).toLocaleUpperCase("el").trim();
    const stationAt = new Map((app.metro?.stations ?? []).map(st => [key1(st.name), [st.lon, st.lat] as [number, number]]));
    if (near3d) for (const f of fc.features) {
      const pr = f.properties!;
      if (pr.kind !== "metro" || pr.glyph !== "metro") continue;
      const at = (f.geometry as GeoJSON.Point).coordinates as LngLat, h = (pr.h as number | undefined) ?? null, line = String(pr.line ?? "");
      if (Math.hypot((at[0] - vc.lng) * vkx, (at[1] - vc.lat) * 110540) > 2500) continue;
      const key = `metro/${pr.id}`;
      now3d.add(key);
      // On the line's centre, then its own track to the right of its way: two trains passing never share the rails.
      const on = snapTram((metroPaths[line] ?? []).slice(0, 1), at, h);
      const heading = on?.heading ?? h ?? pathHeading(tracks[line] ?? [], at);
      // Its model shows it (on the surface, or under the street with «Υπόγεια» on), with its label: its disc gives way.
      if (scene3d.under || depthAt(line, at[0], at[1]) <= 3) { pr.m3d = true; metroWant.set(key, at); }
      // Its cars along the rails behind it, on its own track; else (off the drawn line) along where it has been. Which
      // way it runs comes from its two stations along the line (kept while it stands at one), not from a heading.
      const centre = metroPaths[line]?.[0] ?? [], v = stasyBy.get(String(pr.id));
      if (v && centre.length) {
        // Toward the end of its run (its headsign, a station of the line); else from its last station to its next.
        const end = stationAt.get(key1(v.headsign)), here = nearestIndex(centre, on?.pos ?? at);
        const fi = nearestIndex(centre, [v.from.lon, v.from.lat]), ti = nearestIndex(centre, [v.to.lon, v.to.lat]);
        if (end) { const ei = nearestIndex(centre, end); if (ei !== here) metroWay.set(key, ei > here); }
        else if (fi !== ti) metroWay.set(key, ti > fi);
      }
      const laid = trackBehind(centre, on?.pos ?? at, heading, TRAIN_LEN, line, metroWay.get(key), TRAIN_LEN / 2);   // centred on its place
      const way = laid && laid.length > 1 ? bearingOf(laid[laid.length - 2], laid[laid.length - 1]) : heading;
      const onTrack = laid ? laid[laid.length - 1] : on && heading != null ? rightOf(on.pos, heading) : on?.pos ?? at;
      // The airport's train once seen as one (its headsign, or on the airport branch) stays one back into town.
      let livery = liveryOf(line, String(pr.head ?? ""), at[0]);
      if (livery === "airport") airportTrains.add(key); else if (airportTrains.has(key)) livery = "airport";
      scene3d.upsert(key, onTrack, way, String(pr.color ?? "#0a7cc4"), "metro", line, "none", livery);
      if (laid) scene3d.layTrain(key, laid);
      if (dive?.key === key && way != null) dive.heading = way;
    }
    if (dive) diveFrame(dive);
    (map!.getSource("trains") as GeoJSONSource).setData(fc);
    for (const k of trams3d) if (!now3d.has(k)) scene3d.drop(k);
    trams3d = now3d;
  }
  let trams3d = new Set<string>();
  const metroWant = new Map<string, LngLat>();   // the metro trains drawn in 3D, for their labels (syncLabels)
  const airportTrains = new Set<string>();   // metro trains known to run the airport service
  const tramWant = new Map<string, LngLat>();    // the trams drawn in 3D, the same
  const metroWay = new Map<string, boolean>();   // each metro train's way along its line's path (true: as drawn)

  // The user's hands on the map: a pointer down on it (a drag, a turn, a tilt about to start) or a wheel turned just
  // now. A camera move then (jumpTo) would stop their gesture (MapLibre stops its handlers), so a follow waits.
  let pointersDown = 0, wheelAt = 0;
  const handsOn = () => pointersDown > 0 || performance.now() - wheelAt < 400;
  function watchHands(m: MlMap) {
    const box = m.getCanvasContainer();
    // A primary pointer down means no other is: the count starts again (a lost pointerup cannot hold it above 0).
    box.addEventListener("pointerdown", e => { pointersDown = e.isPrimary ? 1 : pointersDown + 1; });
    const up = () => { pointersDown = Math.max(0, pointersDown - 1); };
    addEventListener("pointerup", up);
    addEventListener("pointercancel", up);
    addEventListener("touchend", e => { if (!e.touches.length) pointersDown = 0; }, { passive: true });
    box.addEventListener("wheel", () => { wheelAt = performance.now(); }, { passive: true });
  }

  // Focus: the vehicle picked (a bus or trolley, a tram, a train) stays in the middle of the map as it moves, the
  // camera gliding after it, until a drag; a picked one first brings the camera to it (close enough to see it). In 3D
  // a metro train under the street is followed by the dive below instead, and a chase rides behind its bus.
  type Focus = { key: string; follow: boolean; started: boolean };
  let focus: Focus | null = null, focusAt: LngLat | null = null;
  const followKey = $derived(app.selection?.kind === "vehicle" ? `${app.selection.line}/${app.selection.id}` : app.train ? `train/${app.train.id}` : null);
  $effect(() => {
    const k = followKey;
    untrack(() => { if (k !== focus?.key) { focus = k ? { key: k, follow: true, started: false } : null; focusAt = null; nextDue = 0; } });   // to it at the next frame
  });
  // In 2D the map stays north-up: no turning by drag, two fingers or keyboard, followed or not (a turn only
  // happens in 3D). Back from 3D it eases back to north.
  $effect(() => {
    const three = app.threeD, m = map;
    if (!m || !loaded || three) return;
    m.dragRotate.disable(); m.touchZoomRotate.disableRotation(); m.keyboard.disableRotation();
    if (Math.abs(m.getBearing()) > 0.5) m.easeTo({ bearing: 0, duration: 500 });
  });
  function focusFrame(m: MlMap) {
    // Where it is drawn; a vehicle the frame did not step (far off the view: culled) from the fleet itself.
    // In 3D only the vehicles near the view are in the fleet: one far off from its last fix (busOf).
    const f = focus, e = f ? fleet.entries.get(f.key) : undefined, vp = f && !e && !f.key.startsWith("train/") ? busOf(f.key).v : null;
    const at = focusAt ?? e?.mover.pos ?? e?.pos ?? (vp ? [vp.lon, vp.lat] as LngLat : null);
    if (!f?.follow || !at || app.chase || dive?.follow) return;
    if (!f.started) {
      f.started = true;
      // Close by: a glide; far off (out of the view): a flight there.
      const p = m.project(at), c = m.getCanvas(), near = p.x > -200 && p.y > -200 && p.x < c.clientWidth + 200 && p.y < c.clientHeight + 200;
      const opts = { center: at, zoom: Math.max(m.getZoom(), 16), duration: reducedMotion.matches ? 0 : near ? 700 : 1400, essential: true };
      if (near) m.easeTo(opts); else m.flyTo(opts);
      return;
    }
    if (m.isMoving() || handsOn()) return;
    const c = m.getCenter(), k = 0.2;
    const lng = c.lng + (at[0] - c.lng) * k, lat = c.lat + (at[1] - c.lat) * k;
    if (Math.abs(lng - c.lng) + Math.abs(lat - c.lat) < 1e-7) return;
    m.jumpTo({ center: [lng, lat] });
  }

  // Down with the metro: a metro train picked in 3D takes the camera under the street to its platform side, at a
  // standing person's eye level, looking straight along the train the way it runs (as from the platform), and keeps it
  // there as the train runs, until a drag; picked no more, the camera comes back up. The centre's elevation
  // (MapLibre's) is the train's depth.
  type Dive = { key: string; line: string; follow: boolean; started: boolean; heading: number | null };
  let dive: Dive | null = null;
  function diveFrame(d: Dive) {
    const m = map, at = scene3d.drawnAt(d.key);
    if (!m || !at || !d.follow) return;
    const elevation = -depthAt(d.line, at[0], at[1]) + 2.4;
    const beside = d.heading != null ? rightOf(at, d.heading, 4.6) : at;   // on the platform, by the train's right side
    if (!d.started) {
      d.started = true;
      m.setCenterClampedToGround(false);   // else MapLibre puts the centre back on the ground after a move
      lowCamera(m);
      m.flyTo({ center: beside, zoom: 19, pitch: 82, bearing: d.heading ?? m.getBearing(), elevation, duration: 1800, essential: true });
    } else if (!m.isMoving() && !handsOn()) m.jumpTo({ center: beside, elevation });
  }
  $effect(() => {
    const t = app.train, m = map;
    if (!m || !loaded) return;
    const b3 = app.bus3d;
    // Only a metro line's train (M1-M3): a tram is a STASY train too, but it runs on the street.
    const isMetro = (trip: string) => !!app.stasyTrains.find(v => v.trip === trip)?.line.startsWith("M");
    const picked = !app.threeD ? null : t?.kind === "metro" && untrack(() => isMetro(t.id)) ? `metro/${t.id}` : b3?.startsWith("metro/") ? b3 : null;
    // A metro train picked turns the metro mode on (once, as it is picked); the button turns it off again, and the
    // camera comes back up with it.
    untrack(() => { if (picked && picked !== lastPicked) app.under = true; lastPicked = picked; });
    const key = picked && app.under ? picked : null;
    untrack(() => {
      if (key && dive?.key !== key) {
        const line = app.stasyTrains.find(v => v.trip === key.slice(6))?.line ?? "";
        dive = { key, line, follow: true, started: false, heading: null };
      } else if (!key && dive) {
        dive = null;
        surface(m, app.threeD && app.under ? -18 : 0, Math.min(m.getPitch(), 65));
      }
    });
  });
  let lastPicked: string | null = null;
  // Under the street the camera may tilt further, nearly level (MapLibre allows 85°), to look along a tunnel.
  let maxPitchUp: number | null = null;
  function lowCamera(m: MlMap) {
    if (maxPitchUp == null) { maxPitchUp = m.getMaxPitch(); m.setMaxPitch(Math.max(maxPitchUp, 110)); }
  }
  // The camera to an elevation (0: back on the street, where MapLibre keeps it again, and tilts as before).
  function surface(m: MlMap, elevation: number, pitch: number) {
    m.easeTo({ elevation, pitch, duration: 900 });
    if (!elevation) m.once("moveend", () => {
      if (dive || (app.threeD && app.under)) return;
      m.setCenterClampedToGround(true);
      if (maxPitchUp != null) { m.setMaxPitch(maxPitchUp); maxPitchUp = null; }
    });
  }
  // «Υπόγεια» with no train picked: the camera a little under the street and tilted, to see along the tunnels.
  $effect(() => {
    const under = app.threeD && app.under, m = map;
    if (!m || !loaded) return;
    untrack(() => {
      if (dive) return;
      if (under) { m.setCenterClampedToGround(false); lowCamera(m); m.easeTo({ elevation: -18, pitch: Math.max(m.getPitch(), 74), duration: 1000 }); }
      else if (Math.abs(m.getCenterElevation()) > 0.5) surface(m, 0, m.getPitch());
    });
  });
  // The bearing (degrees from north) of the stretch of a line nearest a point, the way the line is drawn; null far off.
  function pathHeading(paths: [number, number][][], at: LngLat): number | null {
    const kx = 111320 * Math.cos((at[1] * Math.PI) / 180), ky = 110540;
    let best = 30, h: number | null = null;
    for (const p of paths) for (let i = 1; i < p.length; i++) {
      const ax = (p[i - 1][1] - at[0]) * kx, ay = (p[i - 1][0] - at[1]) * ky, bx = (p[i][1] - at[0]) * kx, by = (p[i][0] - at[1]) * ky;
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
      const d = Math.hypot(ax + dx * t, ay + dy * t);
      if (d < best) { best = d; h = (Math.atan2(dx, dy) * 180) / Math.PI; }
    }
    return h == null ? null : (h + 360) % 360;
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


  // Apple's base map in 2D: MapLibre's own base layers hidden (its canvas then clear) while Apple's map shows under it;
  // back as they were for 3D, without a token, or when Apple refuses it.
  let apple: AppleBase | null = null;
  let appleFailed = $state(false);
  let baseLayers: [string, string][] = [];
  let baseHidden = false;
  let baseGen = $state(0);
  function hideBase(m: MlMap, hide: boolean) {
    if (hide === baseHidden) return;
    baseHidden = hide;
    for (const [id, vis] of baseLayers) if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", hide ? "none" : vis as "visible" | "none");
  }
  $effect(() => {
    const m = map, on = !!apple && !appleFailed && !app.threeD && loaded, d = dark;
    void baseGen;
    if (!m || !apple) return;
    if (!on) { untrack(() => { hideBase(m, false); apple!.hide(); }); return; }
    untrack(() => {
      void apple!.show(d).then(ok => {
        if (!ok || app.threeD) return;
        hideBase(m, true);
        const c = m.getCanvas();
        apple!.sync(m.getCenter(), m.getZoom(), c.clientWidth, c.clientHeight);
      });
    });
  });

  // 3D: on or off, and its look (the theme, «Ρεαλιστική» or «Μινιατούρα»). While a style loads, addAll() adds it once the style is there.
  // Turned on (or restyled while on), it shows behind a loading screen: everything it needs is fetched first and kept
  // (prepare3d), then it is built, and the screen goes once its first full frame is drawn (scene3d.whenReady).
  let warmGen = 0;
  async function warm3d(m: MlMap, d: boolean, look: Look3D) {
    const gen = ++warmGen, live = () => gen === warmGen && app.threeD;
    app.load3d = { p: 0, label: "Μοντέλα" };
    await prepare3d((p, label) => { if (live()) app.load3d = { p, label }; });
    if (!live()) return;
    // The buildings and streets around (the base map's tiles), so the first view is whole.
    const at = m.getCenter().toArray() as LngLat;
    await prefetchTiles(m, at, 1.2, f => { if (live()) app.load3d = { p: PREPARED + (0.85 - PREPARED) * f, label: "Κτίρια" }; });
    if (!live()) return;
    app.load3d = { p: 0.85, label: "Σκιές και φως" };
    await scene3d.set(m, true, d, look);
    await scene3d.whenReady();
    if (gen !== warmGen) return;
    app.load3d = null;
    // Then, quietly, a wider ring of them (not on a metered or slow connection): moving about, blocks are already there.
    const net = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string; type?: string } }).connection;
    if (!net?.saveData && net?.type !== "cellular" && !/2g|3g/.test(net?.effectiveType ?? "")) void prefetchTiles(m, at, 4);
  }
  $effect(() => {
    const on = app.threeD, d = dark, m = map, look = app.look3d;
    if (m && on) untrack(() => void warm3d(m, d, look));
    else if (m) { warmGen++; app.load3d = null; void scene3d.set(m, false, d, look); }
    // At most 2× (a 3× screen would draw 2.25 times the pixels for little to see), in 2D too: smoother, cooler. In 3D
    // at most 1.5× (multisampled, the edges stay smooth): the shadows, extrusions and models fill every pixel.
    if (m) {
      const want = Math.min(devicePixelRatio || 1, on ? MAX_RATIO_3D : MAX_RATIO);
      if (m.getPixelRatio() !== want) m.setPixelRatio(want);
    }
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
    const vis = app.municipalOn ? "visible" : "none";
    if (loaded) for (const id of MUNI_LAYERS) map!.setLayoutProperty(id, "visibility", vis);
  });

  $effect(() => {
    const d = app.municipal;
    if (loaded) (map!.getSource("municipal") as GeoJSONSource).setData(d ? municipalFC(d) : EMPTY);
  });

  $effect(() => {
    const focus = !!app.muniFocus;
    if (!loaded) return;
    (map!.getSource("muni-focus") as GeoJSONSource).setData(muniFocusFC());
    map!.setPaintProperty("municipal-line", "line-opacity", focus ? 0.2 : 0.75);
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
    void roadsSeen; void app.threeD; void streetZoom;
    if (!loaded) return;
    const fc = onRoads(routesFC(drawn));
    (map!.getSource("routes") as GeoJSONSource).setData(fc);
    scene3d.setRoutes(app.threeD && streetZoom ? fc : null);   // the vehicles ride on the routes as drawn
  });

  $effect(() => {
    if (!loaded) return;
    const data = app.metro;
    (map!.getSource("metro") as GeoJSONSource).setData(data ? metroFC(data, [], app.metroStation) : EMPTY);
  });

  // The trip planner's start (A) and end (B), and below its plan and stops: only on the «Ταξίδι» tab, so another
  // tab's map is not left with an old trip on it.
  const tripShown = $derived(app.tab === "trip" || !!app.guide);
  $effect(() => {
    const ends = app.tripEnds, m = map;
    if (!ends || !m || !tripShown) return;
    const pins = ([["from", "A"], ["to", "B"]] as const).map(([k, label]) => {
      const el = document.createElement("div");
      el.className = "trip-end";
      el.innerHTML = `<i><b>${label}</b></i>`;
      return new Marker({ element: el, anchor: "bottom" }).setLngLat([ends[k][1], ends[k][0]]).addTo(m);
    });
    return () => pins.forEach(p => p.remove());
  });

  $effect(() => {
    const preview = app.start ? app.startPreview : null;   // «Πού πας;»: the route chosen there, until the planner opens
    if (loaded) (map!.getSource("trip-plan") as GeoJSONSource | undefined)?.setData(preview ?? (tripShown ? app.tripPlan ?? EMPTY : EMPTY));
  });

  // The guide's ring (the stop to wait at, until the bus is boarded) and the bus's lane to it.
  $effect(() => {
    const g = app.guide, leg = g?.legs[app.guideStep], lane = app.guideApproach;
    if (!loaded) return;
    const feats: GeoJSON.Feature[] = [];
    if (leg?.kind === "ride" && !app.guideOn) {
      feats.push({ type: "Feature", properties: { kind: "ring" }, geometry: { type: "Point", coordinates: [leg.board.at[1], leg.board.at[0]] } });
      if (lane && lane.length > 1) feats.push({ type: "Feature", properties: { kind: "approach" }, geometry: { type: "LineString", coordinates: lane.map(p => [p[1], p[0]]) } });
    } else if (leg?.kind === "walk" && g) {
      const next = g.legs[app.guideStep + 1];
      if (next?.kind === "ride") feats.push({ type: "Feature", properties: { kind: "ring" }, geometry: { type: "Point", coordinates: [next.board.at[1], next.board.at[0]] } });
    }
    (map!.getSource("guide") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: feats });
  });

  // The open line's changes (LineCard): at each stop with a station near, the stations' lines as badges (the
  // line-hubs layer); a tap opens that stop's card (its «Αλλαγές εδώ κοντά»). Not during the guide.
  function hubImage(badges: { label: string; color: string; round?: boolean }[], dark: boolean) {
    const R = 2, h = 26, pad = 4, gap = 3, bh = 18, c = document.createElement("canvas"), x = c.getContext("2d")!;
    x.font = `800 ${11 * R}px Inter, system-ui, sans-serif`;
    const ws = badges.map(b => Math.max(18, x.measureText(b.label).width / R + 8));
    const w = pad * 2 + ws.reduce((a, b) => a + b, 0) + gap * (badges.length - 1);
    c.width = Math.ceil(w * R) + 8; c.height = h * R + 8;
    x.scale(R, R); x.translate(2, 2);
    x.shadowColor = "rgba(0,0,0,.35)"; x.shadowBlur = 4; x.shadowOffsetY = 1;
    x.fillStyle = dark ? "#1b1f27" : "#ffffff";
    x.beginPath(); x.roundRect(0, 0, w, h, h / 2); x.fill();
    x.shadowColor = "transparent";
    let at = pad;
    badges.forEach((b, k) => {
      x.fillStyle = b.color;
      x.beginPath(); x.roundRect(at, (h - bh) / 2, ws[k], bh, b.round ? bh / 2 : 5); x.fill();
      x.fillStyle = "#ffffff"; x.font = "800 11px Inter, system-ui, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText(b.label, at + ws[k] / 2, h / 2 + 0.5);
      at += ws[k] + gap;
    });
    return x.getImageData(0, 0, c.width, c.height);
  }
  $effect(() => {
    const hubs = app.lineHubs, m = map, guide = app.guide;
    void baseGen;
    if (!m || !loaded) return;
    const src = m.getSource("line-hubs") as GeoJSONSource | undefined;
    if (!hubs.length || guide) { src?.setData(EMPTY); return; }
    const dark = untrack(() => styleDark);
    src?.setData({ type: "FeatureCollection", features: hubs.map(h => {
      const img = `hub-${dark ? "d" : "l"}-${h.badges.map(b => `${b.label}${b.color}${b.round ? "r" : ""}`).join("|")}`;
      if (!m.hasImage(img)) m.addImage(img, hubImage(h.badges, dark), { pixelRatio: 2 });
      return { type: "Feature" as const, properties: { img, id: h.id, name: h.name }, geometry: { type: "Point" as const, coordinates: h.at } };
    }) });
  });

  // A marker on whole pixels: MapLibre centres an element with translate(-50%), which on an odd width puts it on a
  // half pixel, and its text blurs. Its size is taken once, off screen, and the centring done in whole pixels.
  function crisp(el: HTMLElement, anchor: "center" | "bottom", gap = 0): Marker {
    // Measured as it will sit on the map: out of the flow (absolute), so it takes its own width, not the page's.
    el.style.cssText += ";visibility:hidden;position:absolute;left:0;top:0";
    document.body.append(el);
    const w = el.offsetWidth, h = el.offsetHeight;
    el.remove();
    el.style.visibility = el.style.position = el.style.left = el.style.top = "";
    return new Marker({ element: el, anchor: "top-left", offset: [-Math.round(w / 2), anchor === "center" ? -Math.round(h / 2) : -h - gap] });
  }

  // A picked timed trip (the planner): the map shows it alone. The city's vehicles are only those of its lines (the
  // frame and drawTrains read focusLines); the stops, stations and places go, until «Δείξε όλα» (app.planShowAll).
  const planFocus = $derived(!!app.tripPlan && app.tab === "trip" && !app.guide && !app.planShowAll);
  const focusLines = $derived.by(() => {
    if (!planFocus) return null;
    const ids = (app.tripPlan?.features ?? []).map(f => f.properties?.line).filter((l): l is string => typeof l === "string");
    return new Set(ids.map(l => l.slice(l.indexOf(":") + 1)));
  });
  const FOCUS_HIDE = ["bus-stop", "bus-stop-selected", "stops", "metro-station", "metro-station-glyph", "metro-label", "suburban-station",
    "suburban-station-glyph", "suburban-label", "municipal-line", "municipal-hit", "municipal-stop", "speed"];
  $effect(() => {
    const on = planFocus, m = map;
    void baseGen;
    if (!m || !loaded || !on) return;
    const was = untrack(() => FOCUS_HIDE.filter(id => m.getLayer(id)).map(id => [id, m.getLayoutProperty(id, "visibility") ?? "visible"] as const));
    for (const [id] of was) m.setLayoutProperty(id, "visibility", "none");
    nextDue = 0;   // the city layer now: its other lines go at once
    return () => { for (const [id, v] of was) if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", v as "visible" | "none"); nextDue = 0; };
  });
  // A pin's colour changed: the buses already on the map take it now.
  $effect(() => {
    void app.pins;
    untrack(() => { for (const d of doms.values()) if (d.el.dataset.line) paint(d.el, d.el.dataset.line); });
  });
  // The pins: stay put unless set «on top» while a trip or a card is open.
  $effect(() => {
    void baseGen;
    const m = map, pins = app.pins, hide = planFocus || app.stack.length > 0;
    if (!m || !loaded) return;
    const shape = (id: string) => { const d = app.statics[id]; return d ? Object.values(d.variants).map(v => smoothLine(v.shape.map(([a, b]) => [b, a] as [number, number]))) : null; };
    (m.getSource("pin-lines") as GeoJSONSource | undefined)?.setData(pinLinesFC(pins, shape, hide));
    (m.getSource("pin-stops") as GeoJSONSource | undefined)?.setData(pinStopsFC(pins, hide));
  });
  // Its words on the map: the line and minutes of each ride, where to get on, each change, the arrival.
  $effect(() => {
    const labels = app.planLabels, m = map;
    if (!m || !labels.length || !app.tripPlan || app.tab !== "trip" || app.guide) return;
    const marks = labels.map(l => {
      const el = document.createElement("div");
      el.setAttribute("aria-hidden", "true");
      if (l.kind === "leg") {
        el.className = "plan-leg";
        const b = document.createElement("b");
        b.textContent = l.label;
        b.style.background = l.color;
        b.style.color = l.text;
        el.append(b, durText(l.min));
      } else {
        el.className = `plan-pin ${l.kind}${l.ok === false ? " tight" : ""}`;
        // A change: the line left and the one taken, as their badges («Χ95 → Προαστιακός»), then where and how long.
        if (l.kind === "change" && l.lines?.length) {
          const row = document.createElement("span");
          row.className = "pc-lines";
          l.lines.forEach((b, k) => {
            if (k) { const a = document.createElement("i"); a.textContent = "→"; row.append(a); }
            const t = document.createElement("b");
            t.textContent = b.label;
            t.style.background = b.color;
            t.style.color = b.text;
            row.append(t);
          });
          el.append(row);
        }
        const n = document.createElement("b"), sub = document.createElement("small");
        n.textContent = l.kind === "change" ? `Αλλαγή στο ${titleCase(l.name.replace(/^Αλλαγή · /, ""))}` : titleCase(l.name);
        sub.textContent = l.sub;
        el.append(n, sub);
      }
      return crisp(el, l.kind === "leg" ? "center" : "bottom", 14).setLngLat(l.at).addTo(m);
    });
    return () => marks.forEach(k => k.remove());
  });

  // The guide's bus, where it is now: its line on a pulsing marker, over the city layer.
  let guideBusMarker: Marker | null = null;
  $effect(() => {
    const b = app.guideBus, m = map;
    if (!m || !b) { guideBusMarker?.remove(); guideBusMarker = null; return; }
    const c = app.lineColor(b.line);
    if (!guideBusMarker) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "guide-bus";
      guideBusMarker = new Marker({ element: el, anchor: "center" }).setLngLat([b.at[1], b.at[0]]).addTo(m);
    } else guideBusMarker.setLngLat([b.at[1], b.at[0]]);
    const el = guideBusMarker.getElement();
    el.textContent = b.line;
    el.title = `Το ${b.line}: η κάρτα του`;
    el.onclick = e => { e.stopPropagation(); app.push(busVehicleCard(b.line, b.vehicle)); };
    el.style.setProperty("--lb", c.bg);
    el.style.setProperty("--lf", c.fg);
  });

  // The picked trip's stops: get on, change, get off.
  $effect(() => {
    const stops = app.tripStops, m = map, sel = app.busStop != null ? app.stopIx?.s[app.busStop] : undefined;
    if (!stops.length || !m || !tripShown) return;
    // Not over the tapped stop: its pin is there, and the name is in its card. A stop a ride passes (mid) is a small
    // dot in the line's colour, its name beside it from zoom 15.5 on (the container's class, below), each one a
    // little after the one before along the route, so the route fills in.
    const pins = stops.filter(st => !sel || Math.hypot(st.at[0] - sel[1], st.at[1] - sel[2]) > 0.0002).map((st, k) => {
      const el = document.createElement("div");
      if (st.mid) {
        el.className = "trip-mid";
        el.style.setProperty("--lb", st.color ?? "#3b5bdb");
        el.style.setProperty("--i", String(Math.min(k, 40)));
        const dot = document.createElement("i"), name = document.createElement("span");
        name.textContent = titleCase(st.name);
        el.append(dot, name);
        return new Marker({ element: el, anchor: "left", offset: [-5, 0] }).setLngLat([st.at[1], st.at[0]]).addTo(m);
      }
      el.className = "trip-stop";
      el.textContent = titleCase(st.name);
      return new Marker({ element: el, anchor: "bottom", offset: [0, -6] }).setLngLat([st.at[1], st.at[0]]).addTo(m);
    });
    return () => pins.forEach(p => p.remove());
  });
  // The names of the route's stops show close in: the container says how close the map is.
  $effect(() => {
    const m = map;
    if (!m) return;
    const c = m.getContainer();
    const on = () => c.classList.toggle("near-stops", m.getZoom() >= 15.5);
    on();
    m.on("zoom", on);
    return () => { m.off("zoom", on); c.classList.remove("near-stops"); };
  });

  // New city data, or a change of the lines drawn in detail: hand the vehicles to the fleet.
  $effect(() => {
    const city = app.city, on = app.cityOn, own = app.cityExclude;
    untrack(() => {
      owned = own;
      fleet.city(on && city ? city.vehicles : [], own, app.serverMs() / 1000, cityRoute);
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
    // «Κοντά σου» with nothing selected: the lines of the nearest stops stay, the others dim.
    const near = !s && app.nearFocus ? app.nearFocus : null;
    const opacity: ExpressionSpecification = ["*", ["case", sel, 1, o], near ? ["case", ["in", ["get", "line"], ["literal", near]], 1, 0.22] : 1, ["case", ["get", "stale"], 0.3, 1], ["case", ["to-boolean", ["get", "rewind"]], 0.5, 1],
      ["case", ["to-boolean", ["get", "m3d"]], 0, 1]];
    m.setPaintProperty("city-dot", "icon-opacity", opacity);
    m.setPaintProperty("city-delay", "circle-opacity", opacity);
    m.setPaintProperty("city-delay", "circle-stroke-opacity", opacity);
    m.setPaintProperty("city-label", "text-opacity", opacity);
    m.setPaintProperty("city-heading", "icon-opacity", opacity);
    const filter = s && app.others === "hide" ? sel : null;
    m.setFilter("city-dot", filter);
    m.setFilter("city-delay", filter);
    m.setFilter("city-heading", filter ? ["all", ["has", "h"], filter] : ["has", "h"]);
    m.setFilter("city-label", filter);
    m.setFilter("city-selected", s?.kind === "vehicle" ? sel : ["boolean", false]);
    const vis = app.cityOn && !app.chase ? "visible" : "none";   // a chase shows only its own vehicle
    for (const id of ["city-dot", "city-delay", "city-label", "city-heading", "city-selected"]) m.setLayoutProperty(id, "visibility", vis);
  });

  $effect(() => {
    const ix = app.stopIx;
    if (loaded && ix) (map!.getSource("bus-stops") as GeoJSONSource | undefined)?.setData(busStopsFC(ix));
  });
  // 3D, close in: the flat stop icons give way to the stop models (scene3d) and their arrival screens (below).
  const HOLO_ZOOM = 17, HOLO_MAX = 4, HOLO_REACH_M = 320, HOLO_EVERY_MS = 30_000;
  $effect(() => {
    const on = app.threeD, m = map;
    if (!m || !loaded) return;
    for (const id of ["bus-stop", "bus-stop-selected"]) {
      const l = m.getLayer(id);
      if (l) m.setLayerZoomRange(id, l.minzoom ?? 0, on ? HOLO_ZOOM : 24);
    }
  });

  // The arrival screens: on the poles of the nearest stops to the view's centre, the next buses there (line, where
  // to, minutes) from the stop's /v2 board, drawn by scene3d as the OASA LED screen. Over each, an invisible button
  // opens the stop. Again after each move and every 30 s; none while following a bus.
  type Hit = { marker: Marker; el: HTMLButtonElement; name: string; at: number; pos: LngLat; rows: [string, string, string][] };
  const holos = new Map<string, Hit>();
  let holoGen = 0;
  const poleOf = (p: LngLat): LngLat => scene3d.roads?.kerb(p, 0.4)?.at ?? p;
  const pushBoards = () => scene3d.setBoards([...holos.values()].map(h => ({ at: h.pos, rows: h.rows })));
  async function refreshHolos() {
    const m = map, ix = app.stopIx, gen = ++holoGen;
    const want = new Map<string, { name: string; pos: LngLat }>();
    if (m && ix && app.threeD && m.getZoom() >= HOLO_ZOOM && !app.chase) {
      const c = m.getCenter(), kx = 111320 * Math.cos((c.lat * Math.PI) / 180), ky = 110540;
      const near: { d: number; s: (typeof ix.s)[number] }[] = [];
      for (const s of ix.s) {
        if (!s[3]) continue;
        const d = Math.hypot((s[2] - c.lng) * kx, (s[1] - c.lat) * ky);
        if (d <= HOLO_REACH_M) near.push({ d, s });
      }
      near.sort((a, b) => a.d - b.d);
      // Not two side by side (the two sides of a street, a stop and its twin): 60 m apart at least.
      const taken: LngLat[] = [];
      for (const { s } of near) {
        if (want.size >= HOLO_MAX) break;
        if (taken.some(t => Math.hypot((t[0] - s[2]) * kx, (t[1] - s[1]) * ky) < 60)) continue;
        taken.push([s[2], s[1]]);
        want.set(s[3]!, { name: titleCase(s[0]), pos: [s[2], s[1]] });
      }
    }
    let changed = false;
    for (const [id, h] of holos) if (!want.has(id)) { h.marker.remove(); holos.delete(id); changed = true; }
    for (const [id, w] of want) {
      let h = holos.get(id);
      if (!h) {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "board-hit";
        el.setAttribute("aria-label", `Στάση ${w.name}: οι επόμενες αφίξεις`);
        el.onclick = ev => { ev.stopPropagation(); app.open(busStopCard(id, w.name)); };
        h = { marker: new Marker({ element: el, anchor: "center", offset: [0, holoLift()] }).setLngLat(poleOf(w.pos)).addTo(m!), el, name: w.name, at: 0, pos: w.pos, rows: [] };
        holos.set(id, h);
        changed = true;
      } else h.marker.setLngLat(poleOf(w.pos));   // the roads may have loaded since
      if (Date.now() - h.at < HOLO_EVERY_MS - 1000) continue;
      h.at = Date.now();
      const hit = h;
      void fetchV2Stop(`oasa:${id}`).then(r => {
        if (gen !== holoGen && !holos.has(id)) return;
        const arr = (r.body as { arrivals?: V2Arrival[] } | null)?.arrivals ?? [];
        const nowS = app.serverNow / 1000;
        const rows = r.status === 200 ? stopRows(arr, nowS).filter(x => x.times.length).slice(0, 3) : [];
        // As the real screens write it: the line, the end in capitals without accents, the minutes.
        hit.rows = rows.map(x => {
          const min = Math.max(0, Math.round((x.times[0].at - nowS) / 60));
          const to = fold(placeNote(toward(x.headsign)).place).toLocaleUpperCase("el");
          return [x.line.replace(/^oasa:/, ""), to, min === 0 ? "ΤΩΡΑ" : `${min}'`];
        });
        pushBoards();
      });
    }
    if (changed) pushBoards();
  }
  // A marker sits on the ground: the click target is lifted by the screen height of the screen's middle, 2.2 m up,
  // which grows with the zoom and the tilt.
  function holoLift(): number {
    const m = map;
    if (!m) return -30;
    const c = m.getCenter(), mpp = (40075016.686 * Math.cos((c.lat * Math.PI) / 180)) / (512 * 2 ** m.getZoom());
    return -Math.round((2.2 / mpp) * Math.sin((m.getPitch() * Math.PI) / 180));
  }
  $effect(() => {
    void app.threeD; void app.chase; void app.stopIx;
    if (!map || !loaded) return;
    const m = map;
    untrack(() => void refreshHolos());
    const onMove = () => void refreshHolos();
    m.on("moveend", onMove);
    const lift = () => { if (holos.size) { const y = holoLift(); for (const h of holos.values()) h.marker.setOffset([0, y]); } };
    m.on("zoom", lift);
    m.on("pitch", lift);
    const t = setInterval(() => void refreshHolos(), HOLO_EVERY_MS);
    return () => { m.off("moveend", onMove); m.off("zoom", lift); m.off("pitch", lift); clearInterval(t); };
  });

  // The stops for 3D: built close in, as a pole with its sign and, on wide streets, a shelter (scene3d).
  $effect(() => {
    const ix = app.stopIx;
    if (ix) untrack(() => scene3d.setStops(ix.s.map(x => [x[2], x[1]] as LngLat)));
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

  // «Λάθος θέση;»: a blue pin the user drags to where the pole stands, from the stop's map position (the red
  // pin stays as the reference). The view comes close, above the bar of the stop card.
  const fixEl = document.createElement("div");
  fixEl.className = "fix-pin";
  fixEl.innerHTML = `<svg viewBox="0 0 24 32" width="34" height="45" aria-hidden="true"><path d="M12 31s10-11.2 10-19A10 10 0 0 0 2 12c0 7.8 10 19 10 19z" fill="#1c7ed6" stroke="#fff" stroke-width="2"/><circle cx="12" cy="12" r="3.6" fill="#fff"/></svg>`;
  const fixPin = new Marker({ element: fixEl, anchor: "bottom", draggable: true });
  fixPin.on("drag", () => { const p = fixPin.getLngLat(); app.stopFixAt = [p.lat, p.lng]; });
  let fixKey = "";
  $effect(() => {
    if (!loaded) return;
    const f = app.stopFix, key = f?.id ?? "";
    if (key === fixKey) return;
    fixKey = key;
    if (!f) { fixPin.remove(); return; }
    const at: LngLat = [f.from[1], f.from[0]];
    fixPin.setLngLat(at).addTo(map!);
    const bar = document.querySelector(".fixbar")?.getBoundingClientRect();
    const pad = { top: 70, left: 16, right: 16, bottom: bar && innerWidth < 720 ? innerHeight - bar.top + 24 : 70 };
    untrack(() => map!.easeTo({ center: at, zoom: Math.max(map!.getZoom(), 18), padding: pad, duration: reducedMotion.matches ? 0 : 600 }));
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
    void roadsSeen; void app.threeD; void streetZoom;
    const fc = onRoads(variantFC(line, h?.variant));
    (map!.getSource("highlight") as GeoJSONSource).setData(fc);
    hl = fc.features[0] ? { coords: fc.features[0].geometry.coordinates as LngLat[], color: String(fc.features[0].properties?.color ?? "#0072b2") } : null;
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

  // North: a needle that turns with the map (its red end points north); a tap turns the map back to north.
  const northCtl = document.createElement("div");
  northCtl.className = "maplibregl-ctrl maplibregl-ctrl-group north-ctl";
  const northBtn = document.createElement("button");
  northBtn.type = "button";
  northBtn.className = "north";
  northBtn.title = "Στρέψε τον χάρτη στον βορρά";
  northBtn.setAttribute("aria-label", "Στρέψε τον χάρτη στον βορρά");
  northBtn.innerHTML = '<svg class="needle" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M10 2.2 13.2 10H6.8z" fill="#e5484d"/><path d="M10 17.8 6.8 10h6.4z" fill="currentColor" opacity=".55"/></svg>';
  northBtn.onclick = () => map?.easeTo({ bearing: 0, duration: reducedMotion.matches ? 0 : 500 });
  northCtl.append(northBtn);
  const needleTo = (m: MlMap) => {
    const b = m.getBearing();
    (northBtn.firstElementChild as SVGElement).style.transform = `rotate(${-b}deg)`;
    northBtn.classList.toggle("turned", Math.abs(b) > 0.5);
  };

  // «Λεπτομέρειες» (a control left of the ⓘ, bottom right) opens the info sheet. The ⓘ stays MapLibre's: it shows the
  // map's credits (open at first, closed after CREDITS_MS or the first drag), which the licences want visible (#34).
  const infoCtl = document.createElement("div");
  infoCtl.className = "maplibregl-ctrl maplibregl-ctrl-group details-ctl";
  const infoBtn = document.createElement("button");
  infoBtn.type = "button";
  infoBtn.className = "details";
  infoBtn.textContent = "Λεπτομέρειες";
  infoBtn.setAttribute("aria-haspopup", "dialog");
  infoBtn.onclick = () => void openInfo();
  infoCtl.append(infoBtn);

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
{#if app.bus3d && app.threeD && !app.load3d}<Route3D {app} key={app.bus3d} />{/if}
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
  :global(.applemap) { position: absolute; inset: 0; pointer-events: none; }
  :global(.applemap[hidden]) { display: none; }
  :global(.fix-pin) { cursor: grab; touch-action: none; filter: drop-shadow(0 3px 4px rgb(0 0 0 / 0.4)); }
  :global(.stop-pin) { pointer-events: none; filter: drop-shadow(0 2px 3px rgb(0 0 0 / 0.35)); }
  :global(.stop-pin.drop svg) { animation: pin-drop 0.45s cubic-bezier(0.3, 1.6, 0.5, 1) both; transform-origin: 50% 100%; }
  @keyframes pin-drop { from { transform: translateY(-18px) scale(0.6); opacity: 0; } to { transform: none; opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { :global(.stop-pin.drop svg) { animation: none; } }
  :global(.segpop b) { font-size: 15px; }
  :global(.segpop div) { font-size: 12px; }
  .nogl { position: absolute; inset: auto 16px 16px; padding: 12px 14px; border-radius: 12px;
    background: var(--warn-bg); box-shadow: var(--shadow); }
</style>
