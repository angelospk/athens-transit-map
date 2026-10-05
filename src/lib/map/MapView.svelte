<script lang="ts">
  import { Map as MlMap, Marker, NavigationControl, Popup, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
  import "maplibre-gl/dist/maplibre-gl.css";
  import workerUrl from "virtual:maplibre-worker";
  import { delayClass } from "../format";
  import { Glider } from "../glide";
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
  const markers = new Map<string, { marker: Marker; el: HTMLButtonElement; glider: Glider }>();
  const key = (line: string, id: string) => `${line}/${id}`;

  const drawn: DrawnLine[] = $derived(
    app.selected.flatMap(id => {
      const data = app.statics[id];
      return data ? [{ id, color: app.lineInfo.get(id)?.color || DEFAULT_COLOR, data }] : [];
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

  function addLayers(m: MlMap) {
    m.addSource("routes", { type: "geojson", data: EMPTY });
    m.addSource("highlight", { type: "geojson", data: EMPTY });
    m.addSource("stops", { type: "geojson", data: EMPTY });
    m.addLayer({ id: "routes", type: "line", source: "routes",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.6 } });
    // Invisible, wide copy so thin lines are easy to hit with a finger.
    m.addLayer({ id: "routes-hit", type: "line", source: "routes", paint: { "line-width": 18, "line-opacity": 0 } });
    m.addLayer({ id: "highlight-casing", type: "line", source: "highlight",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#ffffff", "line-width": 10, "line-opacity": 0.9 } });
    m.addLayer({ id: "highlight", type: "line", source: "highlight",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": ["get", "color"], "line-width": 6 } });
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

  // Sync DOM markers with the vehicles of the chosen lines.
  $effect(() => {
    const m = map;
    if (!m) return;
    const seen = new Set<string>();
    for (const { line, v } of app.vehicles) {
      const k = key(line, v.id);
      seen.add(k);
      let entry = markers.get(k);
      if (!entry) {
        const el = document.createElement("button");
        el.type = "button";
        el.onclick = ev => {
          ev.stopPropagation();
          app.selectVehicle(line, v.id);
        };
        const marker = new Marker({ element: el, anchor: "center" }).setLngLat([v.lon, v.lat]).addTo(m);
        entry = { marker, el, glider: new Glider([v.lon, v.lat], p => marker.setLngLat(p)) };
        markers.set(k, entry);
      } else {
        entry.glider.to([v.lon, v.lat]);
      }
      // classList, not className: MapLibre positions the marker through its own classes.
      const cls = delayClass(v.delay_s);
      if (!entry.el.classList.contains(cls)) {
        entry.el.classList.remove(...DELAY_CLASSES);
        entry.el.classList.add("bus", cls);
      }
      entry.el.textContent = line;
      entry.el.setAttribute("aria-label", `Γραμμή ${line}, όχημα ${v.id}`);
    }
    for (const [k, entry] of markers) {
      if (seen.has(k)) continue;
      entry.glider.cancel();
      entry.marker.remove();
      markers.delete(k);
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
