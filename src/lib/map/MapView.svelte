<script lang="ts">
  import { Map as MlMap, Marker, NavigationControl, Popup, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
  import "maplibre-gl/dist/maplibre-gl.css";
  import workerUrl from "virtual:maplibre-worker";
  import { ageLabel, delayClass, isStalePos } from "../format";
  import { distanceM, Glider, JUMP_M, type LngLat } from "../glide";
  import { vehicleHeading } from "../heading";
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
  const markers = new Map<string, {
    marker: Marker; el: HTMLButtonElement; glider: Glider; dir: HTMLElement; age: HTMLElement;
    sample: Sample; prev: LngLat | null; positionAt: number;
  }>();
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
      for (const { glider } of markers.values()) glider.cancel();
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
    const seen = new Set<string>();
    for (const { line, v, faded } of app.vehicles) {
      const k = key(line, v.id);
      const pos: LngLat = [v.lon, v.lat];
      seen.add(k);
      let entry = markers.get(k);
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
        entry = { marker, el, dir, age, glider: new Glider(pos, p => marker.setLngLat(p)),
          sample: { pos, at: v.position_at, variant: v.variant }, prev: null, positionAt: v.position_at };
        markers.set(k, entry);
      } else {
        entry.glider.to(pos);
        // Heading from GPS samples only (not the gliding position); forget them on a new trip or a jump.
        const s = entry.sample;
        if (s.variant !== v.variant || distanceM(s.pos, pos) > JUMP_M) entry.prev = null;
        else if (v.position_at > s.at && (s.pos[0] !== pos[0] || s.pos[1] !== pos[1])) entry.prev = s.pos;
        if (v.position_at >= s.at) entry.sample = { pos, at: v.position_at, variant: v.variant };
      }
      entry.positionAt = v.position_at;
      // classList, not className: MapLibre positions the marker through its own classes.
      const cls = delayClass(v.delay_s);
      if (!entry.el.classList.contains(cls)) {
        entry.el.classList.remove(...DELAY_CLASSES);
        entry.el.classList.add("bus", cls);
      }
      entry.el.classList.toggle("faded", faded);
      const shape = v.variant ? app.statics[line]?.variants[v.variant]?.shape : null;
      const h = vehicleHeading(v, shape, entry.prev);
      entry.dir.hidden = h == null;
      if (h != null) {
        // Around the pill (an ellipse), pointing outwards.
        const rx = entry.el.offsetWidth / 2 + 5, ry = 16, a = (h * Math.PI) / 180;
        entry.dir.style.transform = `translate(${Math.sin(a) * rx}px, ${-Math.cos(a) * ry}px) rotate(${h}deg)`;
      }
      entry.el.setAttribute("aria-label", `Γραμμή ${line}, όχημα ${v.id}`);
    }
    for (const [k, entry] of markers) {
      if (seen.has(k)) continue;
      entry.glider.cancel();
      entry.marker.remove();
      markers.delete(k);
    }
  });

  // Position age on each marker, every second. Touches only text and one class.
  $effect(() => {
    const now = app.serverNow / 1000;
    void app.vehicles;
    if (document.hidden) return;
    for (const e of markers.values()) {
      const age = now - e.positionAt;
      const label = ageLabel(age);
      if (e.age.textContent !== label) e.age.textContent = label;
      e.el.classList.toggle("stale", isStalePos(age));
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
