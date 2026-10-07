<script lang="ts">
  import { Map as MlMap, Marker, NavigationControl, Popup, setWorkerUrl, type ExpressionSpecification, type GeoJSONSource } from "maplibre-gl";
  import "maplibre-gl/dist/maplibre-gl.css";
  import workerUrl from "virtual:maplibre-worker";
  import { ageLabel, isStalePos, passes } from "../format";
  import { untrack } from "svelte";
  import type { LngLat } from "../glide";
  import { vehicleHeading } from "../heading";
  import { metroFC } from "../metro";
  import { Locator, userPlan, type Fix, type LocState } from "../locate";
  import { Mover, planOnto } from "../motion";
  import { shapeLength, stopOffsets } from "../predict";
  import type { Variant } from "../types";
  import type { AppState } from "../state.svelte";
  import InfoSheet from "../ui/InfoSheet.svelte";
  import { Fleet, routeGeom, type FleetEntry, type RouteGeom } from "./fleet";
  import { bounds, routesFC, stopsFC, variantFC, type DrawnLine } from "./layers";

  setWorkerUrl(workerUrl);

  let { app }: { app: AppState } = $props();

  const DEFAULT_COLOR = "#3b5bdb";
  const DELAY_CLASSES = ["ontime", "late1", "late2", "late3", "none"];
  const STYLE = (dark: boolean) => `https://tiles.openfreemap.org/styles/${dark ? "dark" : "positron"}`;
  const EMPTY = { type: "FeatureCollection" as const, features: [] };
  const COS_LAT = Math.cos((37.98 * Math.PI) / 180);
  const M_PER_PX_Z0 = 156_543.03 * COS_LAT;   // metres per pixel at zoom 0, at Athens

  let map = $state.raw<MlMap>();
  let loaded = $state(false);
  let failed = $state(false);

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
      return data ? [{ id, color: app.lineInfo.get(id)?.color || DEFAULT_COLOR, data, visible: focus && new Set(focus) }] : [];
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

  // Metro, ISAP and tram, under everything else. A focused station's lines stay bright.
  function addMetroLayers(m: MlMap) {
    const on = (a: number, b: number): ExpressionSpecification => ["case", ["get", "on"], a, b];
    const byZoom = (stops: unknown[]) => ["interpolate", ["linear"], ["zoom"], ...stops] as ExpressionSpecification;
    m.addSource("metro", { type: "geojson", data: EMPTY });
    m.addLayer({ id: "metro-line", type: "line", source: "metro", filter: ["==", ["get", "kind"], "line"],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": ["get", "color"], "line-width": byZoom([10, 2, 14, 4, 17, 6]), "line-opacity": on(0.85, 0.15) } });
    m.addLayer({ id: "metro-station", type: "circle", source: "metro", filter: ["==", ["get", "kind"], "station"],
      paint: { "circle-radius": byZoom([10, 2.5, 14, ["case", ["get", "hub"], 6, 4.5], 17, ["case", ["get", "hub"], 9, 7]]),
        "circle-color": "#ffffff", "circle-stroke-color": ["case", ["get", "hub"], "#222222", ["get", "color"]],
        "circle-stroke-width": byZoom([10, 1, 14, 2]), "circle-opacity": on(1, 0.3), "circle-stroke-opacity": on(1, 0.3) } });
    m.addLayer({ id: "metro-label", type: "symbol", source: "metro", minzoom: 13,
      filter: ["all", ["==", ["get", "kind"], "station"], ["get", "on"]],
      layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": 11,
        "text-offset": [0, 1.1], "text-anchor": "top", "text-optional": true },
      paint: { "text-color": "#333333", "text-halo-color": "#ffffff", "text-halo-width": 1.5 } });
  }

  function addLayers(m: MlMap) {
    addMetroLayers(m);
    addCityLayers(m);
    // Trails of corrections (the route a vehicle glided along) and, with motion off, of moves to a
    // new fix. Always under the vehicle: city dots' trails under the dots, detailed lines' trails
    // over the route lines (their vehicles are DOM markers, above the map).
    m.addSource("trails", { type: "geojson", data: EMPTY });
    const trail = (id: string, dom: boolean, before?: string) => m.addLayer({ id, type: "line", source: "trails",
      filter: ["==", ["get", "dom"], dom], layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#0071e3",
        "line-width": 8, "line-opacity": ["*", 0.55, ["get", "alpha"]] } }, before);
    trail("trails-city", false, "city-dot");
    m.addImage("route-arrow", arrowImage(), { pixelRatio: 2 });
    m.addSource("routes", { type: "geojson", data: EMPTY });
    m.addSource("highlight", { type: "geojson", data: EMPTY });
    m.addSource("stops", { type: "geojson", data: EMPTY });
    m.addLayer({ id: "routes", type: "line", source: "routes",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.6, "line-offset": LANE_PX } });
    m.addLayer({ id: "route-arrows", type: "symbol", source: "routes",
      layout: { "symbol-placement": "line", "symbol-spacing": 120, "icon-image": "route-arrow",
        "icon-rotation-alignment": "map", "icon-keep-upright": false, "icon-offset": [0, LANE_PX],
        "icon-allow-overlap": false, "icon-ignore-placement": true } });
    // Invisible, wide copy so thin lines are easy to hit with a finger.
    m.addLayer({ id: "routes-hit", type: "line", source: "routes", paint: { "line-width": 18, "line-opacity": 0 } });
    m.addLayer({ id: "highlight-casing", type: "line", source: "highlight",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#ffffff", "line-width": 10, "line-opacity": 0.9, "line-offset": LANE_PX } });
    m.addLayer({ id: "highlight", type: "line", source: "highlight",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": ["get", "color"], "line-width": 6, "line-offset": LANE_PX } });
    m.addLayer({ id: "highlight-arrows", type: "symbol", source: "highlight",
      layout: { "symbol-placement": "line", "symbol-spacing": 80, "icon-image": "route-arrow",
        "icon-rotation-alignment": "map", "icon-keep-upright": false, "icon-offset": [0, LANE_PX],
        "icon-allow-overlap": true, "icon-ignore-placement": true } });
    trail("trails-line", true);
    m.addLayer({ id: "stops", type: "circle", source: "stops",
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3, 16, 6], "circle-color": "#ffffff",
        "circle-stroke-color": ["get", "color"], "circle-stroke-width": 2 } });
  }

  // The metro station under a click, with a finger-sized margin; the nearest if several.
  function nearestStation(m: MlMap, p: { x: number; y: number }) {
    if (m.getLayoutProperty("metro-station", "visibility") === "none") return null;
    const r = 10, hits = m.queryRenderedFeatures([[p.x - r, p.y - r], [p.x + r, p.y + r]], { layers: ["metro-station"] });
    const d = (f: (typeof hits)[number]) => {
      const q = m.project((f.geometry as GeoJSON.Point).coordinates as [number, number]);
      return Math.hypot(q.x - p.x, q.y - p.y);
    };
    return hits.reduce<(typeof hits)[number] | null>((b, f) => (!b || d(f) < d(b) ? f : b), null);
  }

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
    (m.getSource("me-acc") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection",
      features: [{ type: "Feature", properties: { acc: f.acc }, geometry: { type: "Point", coordinates: f.pos } }] });
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

  // One frame loop for every moving dot. It runs as often as needed for steps of under half a
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
      const shown = e.key === selKey || passes(only, e.cls, now - e.at);
      if (!shown && !dom) continue;
      const moved = still && !reduced && e.moved && now - e.moved.at < STILL_TRAIL_S ? e.moved : null;
      if (!dom && (!app.cityOn || (cull && (still
        ? !moved && cull(e.pos)
        : !e.mover.fixing && cull(e.mover.pos) && cull(e.mover.targetPos(now) ?? e.mover.pos))))) continue;
      let pos: LngLat, trail: { geom: LngLat[]; alpha: number } | null;
      if (still) {
        pos = e.pos;
        trail = moved && { geom: [moved.from, e.pos], alpha: 1 - (now - moved.at) / STILL_TRAIL_S };
      } else {
        e.mover.reduced = reduced;
        const r = e.mover.step(now);
        pos = r.pos;
        trail = r.trail;
        if (e.mover.fixing) fixing = true;
      }
      if (moved) fixing = true;
      // A trail is drawn like its vehicle: not for one filtered out, hidden or dimmed by a selection.
      const o = dom || !s || app.others === "normal" || e.key === selKey ? 1 : app.others === "dim" ? 0.22 : 0;
      if (trail && shown && o && trail.geom.length > 1)
        trails.push({ type: "Feature", geometry: { type: "LineString", coordinates: trail.geom }, properties: { alpha: trail.alpha * o, dom } });
      if (dom) drawDom(e, pos, still).wrap.classList.toggle("filtered", !shown);
      else {
        const h = headingOf(e, still);
        features.push({ type: "Feature", geometry: { type: "Point", coordinates: pos },
          properties: { line: e.line, id: e.id, cls: e.cls, stale: isStalePos(now - e.at), ...(h != null && { h }) } });
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
    if (trails.length || !trailsWereEmpty) {
      (m.getSource("trails") as GeoJSONSource).setData({ type: "FeatureCollection", features: trails });
      trailsWereEmpty = !trails.length;
    }
    if (me) {
      me.mover.reduced = reduced;
      const r = me.mover.step(Date.now() / 1000);
      me.marker.setLngLat(r.pos);
      if (me.mover.fixing) fixing = true;
      if (follow && !m.isMoving()) m.setCenter(r.pos);   // not during the fly-to or a gesture
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
      app.selectVehicle(e.line, e.id);
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
    const d: Dom = { marker, wrap, el, dir, age, width: el.offsetWidth, heading: null };
    doms.set(e.key, d);
    const s = app.selection;
    if (s?.kind === "vehicle" && s.line === e.line && s.id === e.id) { el.classList.add("selected"); wrap.classList.add("sel"); }
    updateAge(d, e, app.serverNow / 1000);
    return d;
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
        style: STYLE(matchMedia("(prefers-color-scheme: dark)").matches),
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
    m.touchZoomRotate.disableRotation();
    m.addControl(new NavigationControl({ showCompass: false }), "top-right");
    m.addControl({ onAdd: () => locateCtl, onRemove: () => locateCtl.remove() }, "top-right");
    // The credits stay on the map as before; the ⓘ opens the info sheet (it lists them too) instead of toggling them.
    // Capture + stopImmediatePropagation: MapLibre's own click handler must not run (it would collapse them).
    const credit = node.querySelector<HTMLElement>(".maplibregl-ctrl-attrib-button");
    if (credit) {
      credit.title = "Πηγές δεδομένων";
      credit.setAttribute("aria-label", "Πηγές δεδομένων");
      credit.setAttribute("aria-haspopup", "dialog");
      credit.addEventListener("click", e => { e.preventDefault(); e.stopImmediatePropagation(); infoOpen = true; }, true);
    }
    m.on("dragstart", () => (follow = false));   // only user gestures fire it

    const popup = new Popup({ closeButton: false, offset: 10, maxWidth: "240px" });
    m.on("load", () => {
      addLayers(m);
      m.addSource("me-acc", { type: "geojson", data: EMPTY });
      // Accuracy circle in map metres: px = metres · 2^zoom / metres-per-pixel at zoom 0.
      m.addLayer({ id: "me-acc", type: "circle", source: "me-acc",
        paint: { "circle-radius": ["interpolate", ["exponential", 2], ["zoom"],
          0, ["/", ["get", "acc"], M_PER_PX_Z0], 22, ["/", ["*", ["get", "acc"], 2 ** 22], M_PER_PX_Z0]],
        "circle-color": "#1a73e8", "circle-opacity": 0.12, "circle-stroke-color": "#1a73e8", "circle-stroke-opacity": 0.35,
        "circle-stroke-width": 1 } }, "city-dot");
      loaded = true;
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
    // One dispatcher: DOM marker (its own handler) → city vehicle → stop → route → empty map.
    m.on("click", e => {
      if ((e.originalEvent.target as Element | null)?.closest?.(".bus")) return;
      const city = nearestCity(m, e.point);
      if (city) {
        popup.remove();
        app.selectCityVehicle(String(city.properties.line), String(city.properties.id));
        return;
      }
      const stop = m.queryRenderedFeatures(e.point, { layers: ["stops"] })[0];
      if (stop) {
        popup.setLngLat((stop.geometry as GeoJSON.Point).coordinates as [number, number])
          .setText(String(stop.properties.name)).addTo(m);
        return;
      }
      const station = nearestStation(m, e.point);
      if (station) {
        const name = String(station.properties.name);
        app.metroStation = name;
        popup.setLngLat((station.geometry as GeoJSON.Point).coordinates as [number, number])
          .setText(`${name} · ${station.properties.lines}`).addTo(m);
        return;
      }
      const route = m.queryRenderedFeatures(e.point, { layers: ["routes-hit"] })[0];
      if (route) return app.selectRoute(String(route.properties.line), String(route.properties.variant));
      app.metroStation = null;
      app.clearSelection();
    });
    for (const layer of ["routes-hit", "stops", "city-dot", "metro-station"]) {
      m.on("mouseenter", layer, () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", layer, () => (m.getCanvas().style.cursor = ""));
    }

    map = m;
    app.fit = fitTo;
    if (import.meta.env.DEV) Object.assign(window, { __map: m, __fleet: fleet, __doms: doms });
    return () => {
      app.fit = () => {};
      disposed = true;
      cancelAnimationFrame(raf);
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

  $effect(() => {
    if (loaded) (map!.getSource("routes") as GeoJSONSource).setData(routesFC(drawn));
  });

  $effect(() => {
    if (!loaded) return;
    const m = map!, data = app.metro, on = app.metroOn;
    (m.getSource("metro") as GeoJSONSource).setData(on && data ? metroFC(data, app.metroStation) : EMPTY);
    for (const id of ["metro-line", "metro-station", "metro-label"]) m.setLayoutProperty(id, "visibility", on ? "visible" : "none");
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
    const sel: ExpressionSpecification = s?.kind === "vehicle"
      ? ["all", ["==", ["get", "line"], s.line], ["==", ["get", "id"], s.id]] : ["boolean", false];
    const o = !s || app.others === "normal" ? 1 : app.others === "dim" ? 0.22 : 1;
    const opacity: ExpressionSpecification = ["*", ["case", sel, 1, o], ["case", ["get", "stale"], 0.3, 1]];
    m.setPaintProperty("city-dot", "circle-opacity", opacity);
    m.setPaintProperty("city-dot", "circle-stroke-opacity", opacity);
    m.setPaintProperty("city-label", "text-opacity", opacity);
    m.setPaintProperty("city-heading", "icon-opacity", opacity);
    const filter = s && app.others === "hide" ? sel : null;
    m.setFilter("city-dot", filter);
    m.setFilter("city-heading", filter ? ["all", ["has", "h"], filter] : ["has", "h"]);
    m.setFilter("city-label", filter);
    m.setFilter("city-selected", sel);
    const vis = app.cityOn ? "visible" : "none";
    for (const id of ["city-dot", "city-label", "city-heading", "city-selected"]) m.setLayoutProperty(id, "visibility", vis);
  });

  $effect(() => {
    if (!loaded) return;
    const h = app.highlight;
    const line = h ? drawn.find(d => d.id === h.line) : undefined;
    (map!.getSource("highlight") as GeoJSONSource).setData(variantFC(line, h?.variant));
    (map!.getSource("stops") as GeoJSONSource).setData(stopsFC(line, h?.variant));
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
</script>

<div class="map" class:no-ages={!app.showAges && app.motion} {@attach setup}></div>
<InfoSheet bind:open={infoOpen} motion={app.motion} />
{#if failed}
  <div class="nogl" role="alert">
    Ο χάρτης δεν μπορεί να εμφανιστεί: ο browser δεν υποστηρίζει WebGL2. Δοκίμασε άλλον browser ή ενεργοποίησε την
    επιτάχυνση γραφικών.
  </div>
{/if}

<style>
  .map { position: absolute; inset: 0; }
  .nogl { position: absolute; inset: auto 16px 16px; padding: 12px 14px; border-radius: 12px;
    background: var(--warn-bg); box-shadow: var(--shadow); }
</style>
