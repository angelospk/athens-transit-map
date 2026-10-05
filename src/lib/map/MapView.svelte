<script lang="ts">
  import { Map as MlMap, Marker, NavigationControl, Popup, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
  import "maplibre-gl/dist/maplibre-gl.css";
  import workerUrl from "virtual:maplibre-worker";
  import { ageLabel, delayClass, isStalePos } from "../format";
  import { untrack } from "svelte";
  import { distanceM, Glider, JUMP_M, ScalarGlider, type LngLat } from "../glide";
  import { vehicleHeading } from "../heading";
  import { headingAt, pointAt, predictS, shapeLength, stopOffsets, updateTrack, type Route, type Track } from "../predict";
  import type { Variant } from "../types";
  import type { AppState } from "../state.svelte";
  import { bounds, routesFC, stopsFC, variantFC, type DrawnLine } from "./layers";

  setWorkerUrl(workerUrl);

  let { app }: { app: AppState } = $props();

  const DEFAULT_COLOR = "#3b5bdb";
  const DELAY_CLASSES = ["ontime", "late1", "late2", "late3", "none"];
  const STYLE = (dark: boolean) => `https://tiles.openfreemap.org/styles/${dark ? "dark" : "positron"}`;
  const EMPTY = { type: "FeatureCollection" as const, features: [] };

  let map = $state.raw<MlMap>();
  let loaded = $state(false);
  let failed = $state(false);

  // Vehicle markers live outside Svelte's reactivity: they are mutated every frame.
  interface Sample { pos: LngLat; at: number; variant: string | null }
  interface Entry {
    marker: Marker; el: HTMLButtonElement; glider: Glider; dir: HTMLElement; age: HTMLElement;
    sample: Sample; prev: LngLat | null; positionAt: number;
    // Predicted motion: the vehicle moves along its route between GPS updates (predict.ts).
    track: Track | null; route: Route | null; along: ScalarGlider;
  }
  const markers = new Map<string, Entry>();

  // Route geometry per variant, built once per static file.
  const routes = new WeakMap<Variant, Route>();
  function routeFor(line: string, variant: string | null): Route | null {
    const st = variant ? app.statics[line] : undefined;
    const v = variant ? st?.variants[variant] : undefined;
    if (!st || !v || v.shape.length < 2) return null;
    let r = routes.get(v);
    if (!r) {
      const known = v.stops.filter(id => st.stops[id]);
      r = { shape: v.shape, stopIds: known, endS: shapeLength(v.shape),
        stopS: stopOffsets(v.shape, known.map(id => [st.stops[id].lon, st.stops[id].lat] as LngLat)) };
      routes.set(v, r);
    }
    return r;
  }

  function setHeading(e: Entry, h: number | null) {
    e.dir.hidden = h == null;
    if (h == null) return;
    // Around the pill (an ellipse), pointing outwards.
    const rx = e.el.offsetWidth / 2 + 5, ry = 16, a = (h * Math.PI) / 180;
    e.dir.style.transform = `translate(${Math.sin(a) * rx}px, ${-Math.cos(a) * ry}px) rotate(${h}deg)`;
  }
  const LANE_PX = 3;   // each direction drawn to the right of its travel direction (two lanes)
  const key = (line: string, id: string) => `${line}/${id}`;

  const drawn: DrawnLine[] = $derived(
    app.selected.flatMap(id => {
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

  function addLayers(m: MlMap) {
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
    m.addLayer({ id: "stops", type: "circle", source: "stops",
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3, 16, 6], "circle-color": "#ffffff",
        "circle-stroke-color": ["get", "color"], "circle-stroke-width": 2 } });
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

    const popup = new Popup({ closeButton: false, offset: 10, maxWidth: "240px" });
    m.on("load", () => {
      addLayers(m);
      loaded = true;
    });
    m.on("click", e => {
      if ((e.originalEvent.target as Element | null)?.closest?.(".bus")) return;
      const stop = m.queryRenderedFeatures(e.point, { layers: ["stops"] })[0];
      if (stop) {
        popup.setLngLat((stop.geometry as GeoJSON.Point).coordinates as [number, number])
          .setText(String(stop.properties.name)).addTo(m);
        return;
      }
      const route = m.queryRenderedFeatures(e.point, { layers: ["routes-hit"] })[0];
      if (route) app.selectRoute(String(route.properties.line), String(route.properties.variant));
      else app.clearSelection();
    });
    for (const layer of ["routes-hit", "stops"]) {
      m.on("mouseenter", layer, () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", layer, () => (m.getCanvas().style.cursor = ""));
    }

    map = m;
    app.fit = fitTo;
    if (import.meta.env.DEV) Object.assign(window, { __map: m });
    return () => {
      app.fit = () => {};
      for (const { glider, along } of markers.values()) { glider.cancel(); along.cancel(); }
      markers.clear();
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
    const h = app.highlight;
    const line = h ? drawn.find(d => d.id === h.line) : undefined;
    (map!.getSource("highlight") as GeoJSONSource).setData(variantFC(line, h?.variant));
    (map!.getSource("stops") as GeoJSONSource).setData(stopsFC(line, h?.variant));
  });

  // Sync DOM markers with the vehicles of the chosen lines. Runs on new data, not every second.
  $effect(() => {
    const m = map;
    if (!m) return;
    const nowSec = untrack(() => app.serverNow) / 1000;
    const seen = new Set<string>();
    for (const { line, v, faded } of app.vehicles) {
      const k = key(line, v.id);
      const pos: LngLat = [v.lon, v.lat];
      seen.add(k);
      let entry = markers.get(k);
      const route = routeFor(line, v.variant);
      if (!entry) {
        const el = document.createElement("button");
        el.type = "button";
        el.onclick = ev => {
          ev.stopPropagation();
          app.selectVehicle(line, v.id);
        };
        const num = document.createElement("span");
        num.textContent = line;
        const dir = document.createElement("i");
        dir.className = "dir";
        const age = document.createElement("span");
        age.className = "age";
        el.append(num, dir, age);
        const marker = new Marker({ element: el, anchor: "center" }).setLngLat(pos).addTo(m);
        const glider = new Glider(pos, p => marker.setLngLat(p));
        const e: Entry = {
          marker, el, dir, age, glider, sample: { pos, at: v.position_at, variant: v.variant }, prev: null,
          positionAt: v.position_at, track: null, route: null,
          along: new ScalarGlider(0, s => {
            if (!e.route) return;
            const p = pointAt(e.route.shape, s);
            glider.pos = p;
            marker.setLngLat(p);
          }),
        };
        entry = e;
        markers.set(k, entry);
      } else if (v.position_at < entry.sample.at) {
        continue;   // older than the sample shown (reordered responses): change nothing
      }
      // Heading from GPS samples only (not the shown position); forget them on a new trip or a jump.
      const smp = entry.sample;
      if (smp.variant !== v.variant || distanceM(smp.pos, pos) > JUMP_M) entry.prev = null;
      else if (v.position_at > smp.at && (smp.pos[0] !== pos[0] || smp.pos[1] !== pos[1])) entry.prev = smp.pos;
      entry.sample = { pos, at: v.position_at, variant: v.variant };
      entry.positionAt = v.position_at;

      const before = entry.track;
      const track = route
        ? updateTrack(entry.track, { pos, at: v.position_at, key: `${v.variant}/${v.trip_id}`, nextStop: v.next_stop_id }, route, nowSec)
        : null;
      if (track && track === before && entry.route === route) {
        // The same sample again: keep predicting from it.
      } else if (track) {
        const target = predictS(track, nowSec);
        if (before && entry.route === route && before.key === track.key && Math.abs(target - entry.along.value) <= JUMP_M) {
          entry.glider.cancel();          // one animation owns the marker
          entry.along.to(target, 1500);   // correction, along the route
        } else {
          entry.along.cancel();
          entry.along.value = target;
          entry.glider.to(pointAt(route!.shape, target));   // entering route mode: a plain glide there
        }
      } else {
        entry.along.cancel();
        entry.glider.to(pos);
      }
      entry.track = track;
      entry.route = track ? route : null;

      // classList, not className: MapLibre positions the marker through its own classes.
      const cls = delayClass(v.delay_s);
      if (!entry.el.classList.contains(cls)) {
        entry.el.classList.remove(...DELAY_CLASSES);
        entry.el.classList.add("bus", cls);
      }
      entry.el.classList.toggle("faded", faded);
      setHeading(entry, track?.speed ? headingAt(route!.shape, entry.along.value) : vehicleHeading(v, route?.shape, entry.prev));
      entry.el.setAttribute("aria-label", `Γραμμή ${line}, όχημα ${v.id}`);
    }
    for (const [k, entry] of markers) {
      if (seen.has(k)) continue;
      entry.glider.cancel();
      entry.along.cancel();
      entry.marker.remove();
      markers.delete(k);
    }
  });

  // Every second: the position age on each marker, and the next predicted step along the route.
  $effect(() => {
    const now = app.serverNow / 1000;
    void app.vehicles;
    if (document.hidden) return;
    for (const e of markers.values()) {
      const age = now - e.positionAt;
      const label = ageLabel(age);
      if (e.age.textContent !== label) e.age.textContent = label;
      e.el.classList.toggle("stale", isStalePos(age));
      // A running correction (1.5 s) or plain glide finishes first; each 1 s step replaces the last.
      if (e.track?.speed && e.route && !e.glider.busy && !e.along.correcting) {
        e.along.to(predictS(e.track, now + 1), 1000, true);
        setHeading(e, headingAt(e.route.shape, e.along.value));
      }
    }
  });

  $effect(() => {
    const s = app.selection;
    const sel = s?.kind === "vehicle" ? key(s.line, s.id) : null;
    void app.vehicles;   // re-run when markers are created
    for (const [k, { el }] of markers) el.classList.toggle("selected", k === sel);
  });
</script>

<div class="map" {@attach setup}></div>
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
