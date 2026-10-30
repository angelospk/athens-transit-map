<script lang="ts">
  // Experiment (branch exp/apple-maps, `?map=apple`): the same app data on Apple's MapKit JS instead of MapLibre/OSM.
  // It draws the detailed lines, their stops, the live vehicles, Apple's POIs, an address search and one route.
  // Not ported: motion (glide), trails, metro and rail layers, speed layer, follow-me.
  /// <reference types="apple-mapkit-js-browser" />
  import { untrack } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import type { AppState } from "../state.svelte";
  import { resolveDark } from "../theme";
  import { cityKey } from "../city";
  import { busStopCard, busVehicleCard } from "../legacy";
  import { bounds, stopsFC, type DrawnLine } from "../map/layers";
  import { debounce } from "../debounce";
  import { loadMapKit, TOKEN_URL } from "./load";
  import { diffKeys, regionFor, spanZoom, viewOf } from "./logic";

  let { app }: { app: AppState } = $props();

  const ATHENS = { lat: 37.9838, lon: 23.7275 };
  const STOPS_MIN_ZOOM = 13.5;

  let host: HTMLDivElement;
  let map = $state.raw<mapkit.Map>();
  let problem = $state<string | null>(TOKEN_URL ? null : "nokey");
  let zoom = $state(12);

  const systemDark = new MediaQuery("(prefers-color-scheme: dark)");
  const dark = $derived(resolveDark(app.theme, systemDark.current));

  const drawn: DrawnLine[] = $derived(
    app.detailLines.flatMap(id => {
      const data = app.statics[id];
      const focus = app.focus[id];
      return data ? [{ id, color: app.lineColor(id).bg, data, visible: focus && new Set(focus) }] : [];
    }),
  );

  // A fit asked for before MapKit is ready (lines from the URL) is done once the map exists.
  let pendingFit: string[] | null = null;

  $effect(() => {
    if (!TOKEN_URL) return;
    let gone = false, m: mapkit.Map | undefined;
    app.fit = ids => void (pendingFit = ids);
    loadMapKit(TOKEN_URL, s => (problem = s)).then(mk => {
      if (gone) return;
      m = new mk.Map(host, {
        center: new mk.Coordinate(ATHENS.lat, ATHENS.lon),
        colorScheme: untrack(() => dark) ? mk.Map.ColorSchemes.Dark : mk.Map.ColorSchemes.Light,
        showsPointsOfInterest: true,
        showsMapTypeControl: false,
        showsCompass: mk.FeatureVisibility.Adaptive,
        isRotationEnabled: false,
        padding: new mk.Padding(70, 8, 8, 8),
      });
      m.region = new mk.CoordinateRegion(new mk.Coordinate(ATHENS.lat, ATHENS.lon), new mk.CoordinateSpan(0.12, 0.12));
      // Apple's own POIs (shops, cafés, stations) can be tapped: their place card is Apple's.
      const anyMk = mk as unknown as { MapFeatureType?: Record<string, string> };
      if (anyMk.MapFeatureType) (m as unknown as { selectableMapFeatures: string[] }).selectableMapFeatures =
        [anyMk.MapFeatureType.PointOfInterest];
      m.addEventListener("region-change-start", () => app.setCityMoving());
      m.addEventListener("region-change-end", () => report());
      map = m;
      report();
      app.fit = ids => {
        const b = bounds(drawn.filter(d => ids.includes(d.id)));
        if (b && map) { const r = regionFor(b); map.setRegionAnimated(region(r.center, r.span)); }
      };
      app.flyTo = ([lon, lat]) => map?.setRegionAnimated(region({ lat, lon }, { lat: 0.02, lon: 0.02 }));
      if (pendingFit) app.fit(pendingFit);
      pendingFit = null;
      if (import.meta.env.DEV) Object.assign(window, { __amap: m });
    }, (e: Error) => (problem = e.message));
    return () => {
      gone = true;
      app.fit = () => {};
      app.flyTo = () => {};
      suggest.cancel();
      routeGen++;
      map = undefined;
      m?.destroy();
    };
  });

  const region = (c: { lat: number; lon: number }, s: { lat: number; lon: number }) =>
    new mapkit.CoordinateRegion(new mapkit.Coordinate(c.lat, c.lon), new mapkit.CoordinateSpan(s.lat, s.lon));

  function report() {
    if (!map) return;
    const r = map.region;
    zoom = spanZoom(r.span.longitudeDelta, host.clientWidth);
    app.setCityView(viewOf({ lat: r.center.latitude, lon: r.center.longitude },
      { lat: r.span.latitudeDelta, lon: r.span.longitudeDelta }), zoom);
  }

  $effect(() => {
    const d = dark;
    if (map) map.colorScheme = d ? mapkit.Map.ColorSchemes.Dark : mapkit.Map.ColorSchemes.Light;
  });

  // ---- Vehicles: one DOM annotation each, moved in place on every refresh (no glide).
  const anns = new Map<string, mapkit.Annotation>();
  let stat = $state({ n: 0, ms: 0 });

  function vehicleEl(line: string, bg: string, fg: string) {
    const d = document.createElement("div");
    d.className = "ap-veh";
    d.textContent = line;
    d.style.background = bg;
    d.style.color = fg;
    return d;
  }

  $effect(() => {
    if (!map) return;
    // Keyed with the colour: a line that turns into a detail line gets its own colour, so its annotations are made again.
    const rows = new Map<string, { line: string; id: string; lat: number; lon: number; bg: string; fg: string }>();
    const put = (line: string, id: string, lat: number, lon: number) => {
      const { bg, fg } = app.lineColor(line);
      rows.set(`${cityKey({ line, id })}|${bg}|${fg}`, { line, id, lat, lon, bg, fg });
    };
    const own = app.cityExclude;   // detail lines: their vehicles come from app.vehicles, with the direction focus applied
    if (app.cityOn) for (const v of app.city?.vehicles ?? []) if (!own.has(v.line)) put(v.line, v.id, v.lat, v.lon);
    for (const { line, v } of app.vehicles) put(line, v.id, v.lat, v.lon);
    untrack(() => {
      const t0 = performance.now();
      const { added, kept, removed } = diffKeys(new Set(anns.keys()), [...rows.keys()]);
      map!.removeAnnotations(removed.map(k => anns.get(k)!));
      for (const k of removed) anns.delete(k);
      for (const k of kept) {
        const r = rows.get(k)!, a = anns.get(k)!;
        if (a.coordinate.latitude !== r.lat || a.coordinate.longitude !== r.lon) a.coordinate = new mapkit.Coordinate(r.lat, r.lon);
      }
      const fresh = added.map(k => {
        const r = rows.get(k)!;
        const a = new mapkit.Annotation(new mapkit.Coordinate(r.lat, r.lon), () => vehicleEl(r.line, r.bg, r.fg),
          { calloutEnabled: false, animates: false, anchorOffset: new DOMPoint(0, 0), displayPriority: 1000 });
        a.addEventListener("select", () => { a.selected = false; app.open(busVehicleCard(r.line, r.id)); });
        anns.set(k, a);
        return a;
      });
      map!.addAnnotations(fresh);
      stat = { n: anns.size, ms: Math.round(performance.now() - t0) };
    });
  });

  // ---- Lines (polylines) and their stops.
  let lineOverlays: mapkit.Overlay[] = [];
  let stopAnns: mapkit.Annotation[] = [];
  $effect(() => {
    if (!map) return;
    const lines = drawn;
    untrack(() => {
      map!.removeOverlays(lineOverlays);
      map!.removeAnnotations(stopAnns);
      lineOverlays = lines.flatMap(({ color, data, visible }) =>
        Object.entries(data.variants).filter(([v]) => !visible || visible.has(v)).map(([, v]) =>
          new mapkit.PolylineOverlay(v.shape.map(([lat, lon]) => new mapkit.Coordinate(lat, lon)),
            { style: new mapkit.Style({ strokeColor: color, lineWidth: 5, lineCap: "round", lineJoin: "round", strokeOpacity: 0.9 }) })));
      stopAnns = lines.flatMap(l => stopsFC(l, null, true).features.map(f => {
        const [lon, lat] = f.geometry.coordinates, { id, name } = f.properties as { id: string; name: string };
        const a = new mapkit.Annotation(new mapkit.Coordinate(lat, lon), () => {
          const d = document.createElement("div");
          d.className = "ap-stop";
          d.style.borderColor = l.color;
          return d;
        }, { title: name, calloutEnabled: false, displayPriority: 250, anchorOffset: new DOMPoint(0, 0) });
        a.addEventListener("select", () => { a.selected = false; app.open(busStopCard(id, name)); });
        a.visible = zoom >= STOPS_MIN_ZOOM;
        return a;
      }));
      map!.addOverlays(lineOverlays);
      map!.addAnnotations(stopAnns);
    });
  });
  $effect(() => {
    const show = zoom >= STOPS_MIN_ZOOM;
    for (const a of stopAnns) a.visible = show;
  });

  // ---- POIs, address search and one route.
  let poisOn = $state(true);
  $effect(() => {
    if (map) map.showsPointsOfInterest = poisOn;
  });

  let searchOpen = $state(false);
  let query = $state("");
  let hits = $state.raw<{ text: string; sub: string; result: mapkit.SearchAutocompleteResult }[]>([]);
  let place = $state.raw<{ name: string; at: mapkit.Coordinate } | null>(null);
  let routeInfo = $state<string | null>(null);
  let placeAnn: mapkit.MarkerAnnotation | null = null;
  let routeOverlay: mapkit.Overlay | null = null;
  let search: mapkit.Search | null = null;
  let routeGen = 0;   // only the newest route request may draw

  const suggest = debounce((q: string) => {
    if (!map || q.trim().length < 3) return void (hits = []);
    search ??= new mapkit.Search({ language: "el", region: map.region });
    search.autocomplete(q, (err, data) => {
      if (err || q !== query || !map) return;
      hits = data.results.slice(0, 5).map(r => ({ text: r.displayLines[0] ?? "", sub: r.displayLines.slice(1).join(", "), result: r }));
    }, { region: map.region, language: "el" });
  }, 300);

  function pick(h: (typeof hits)[number]) {
    hits = [];
    query = h.text;
    if (!map) return;
    search!.search(h.result, (err, data) => {
      const p = err ? undefined : data.places[0];
      if (!p || !map) return void (routeInfo = "Δεν βρέθηκε η θέση.");
      setPlace(p.name || h.text, p.coordinate);
    }, { coordinate: map.center, region: map.region, language: "el" });
  }

  function setPlace(name: string, at: mapkit.Coordinate) {
    clearRoute();
    if (placeAnn) map!.removeAnnotation(placeAnn);
    placeAnn = new mapkit.MarkerAnnotation(at, { title: name, color: "#e8590c", glyphText: "★" });
    map!.addAnnotation(placeAnn);
    map!.setRegionAnimated(region({ lat: at.latitude, lon: at.longitude }, { lat: 0.012, lon: 0.012 }));
    place = { name, at };
  }

  function clearRoute() {
    routeGen++;
    if (routeOverlay) map?.removeOverlay(routeOverlay);
    routeOverlay = null;
    routeInfo = null;
  }

  // From the user (when they allow it) or else the map's centre, to the picked place.
  function here(): Promise<mapkit.Coordinate> {
    const centre = () => map!.center;
    return new Promise(ok => {
      if (!navigator.geolocation) return ok(centre());
      navigator.geolocation.getCurrentPosition(p => ok(new mapkit.Coordinate(p.coords.latitude, p.coords.longitude)),
        () => ok(centre()), { timeout: 5000, maximumAge: 60_000 });
    });
  }

  async function route(walk: boolean) {
    if (!map || !place) return;
    clearRoute();
    const gen = routeGen;
    routeInfo = "…";
    const origin = await here();
    if (gen !== routeGen || !map) return;
    new mapkit.Directions({ language: "el" }).route({
      origin, destination: place.at,
      transportType: walk ? mapkit.Directions.Transport.Walking : mapkit.Directions.Transport.Automobile,
    }, (err, data) => {
      if (gen !== routeGen || !map) return;
      const r = err ? undefined : data.routes[0];
      if (!r) return void (routeInfo = "Δεν βρέθηκε διαδρομή.");
      r.polyline.style = new mapkit.Style({ strokeColor: walk ? "#1c7ed6" : "#7048e8", lineWidth: 6, lineDash: walk ? [2, 8] : [],
        lineCap: "round", strokeOpacity: 0.85 });
      routeOverlay = r.polyline;
      map.addOverlay(r.polyline);
      map.showItems([r.polyline], { animate: true, padding: new mapkit.Padding(90, 24, 160, 24) });
      routeInfo = `${walk ? "🚶" : "🚗"} ${Math.round(r.expectedTravelTime / 60)}′ · ${(r.distance / 1000).toFixed(1)} km`;
    });
  }

  function closeSearch() {
    searchOpen = false;
    hits = [];
  }

  const osmHref = () => {
    const u = new URL(location.href);
    u.searchParams.delete("map");
    return u.toString();
  };
</script>

<div class="ap-map" bind:this={host}></div>

{#if problem}
  <div class="ap-problem" role="alert">
    <b>Apple Maps (πείραμα)</b>
    {#if problem === "nokey"}
      <p>Δεν υπάρχει MapKit token: λείπει το <code>VITE_MAPKIT_TOKEN_URL</code> (Worker <code>workers/mapkit-token</code>).</p>
    {:else}
      <p>Το MapKit JS απάντησε: {problem}</p>
    {/if}
    <a href={osmHref()}>Πίσω στον χάρτη OSM</a>
  </div>
{/if}

{#if map}
  <div class="ap-bar">
    <button class="ap-btn" aria-label="Αναζήτηση διεύθυνσης ή καταστήματος (Apple)" onclick={() => (searchOpen = !searchOpen)}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></svg>
    </button>
    <button class="ap-btn" class:off={!poisOn} aria-pressed={poisOn} onclick={() => (poisOn = !poisOn)}>POI</button>
    <span class="ap-stat" title="Οχήματα στον χάρτη · χρόνος της τελευταίας ενημέρωσης">{stat.n} οχ. · {stat.ms} ms</span>
  </div>
{/if}

{#if searchOpen && map}
  <div class="ap-search">
    <div class="row">
      <input type="search" placeholder="Διεύθυνση ή μαγαζί" bind:value={query} oninput={() => suggest(query)} autocomplete="off" />
      <button class="ap-btn" aria-label="Κλείσιμο" onclick={closeSearch}>×</button>
    </div>
    {#if hits.length}
      <ul>
        {#each hits as h}
          <li><button onclick={() => pick(h)}><b>{h.text}</b>{#if h.sub}<small>{h.sub}</small>{/if}</button></li>
        {/each}
      </ul>
    {/if}
    {#if place}
      <div class="row">
        <span class="name">{place.name}</span>
        <button onclick={() => route(true)}>🚶 Διαδρομή</button>
        <button onclick={() => route(false)}>🚗</button>
      </div>
    {/if}
    {#if routeInfo}<p class="info">{routeInfo}</p>{/if}
  </div>
{/if}

<style>
  .ap-map { position: absolute; inset: 0; }
  :global(.ap-veh) { min-width: 22px; padding: 1px 4px; border-radius: 9px; font: 700 10px/14px system-ui, sans-serif;
    text-align: center; transform: translate(-50%, -50%); box-shadow: 0 0 0 1.5px #fff, 0 1px 3px rgba(0,0,0,.35); cursor: pointer; }
  :global(.ap-stop) { width: 9px; height: 9px; border: 2.5px solid; border-radius: 50%; background: #fff; transform: translate(-50%, -50%);
    cursor: pointer; }
  .ap-problem { position: absolute; z-index: 6; left: 12px; right: 12px; top: 40%; max-width: 420px; margin: 0 auto; padding: 14px 16px;
    background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow); }
  .ap-problem p { margin: 6px 0 10px; font-size: 14px; }
  /* Above Apple's logo and legal link, which must stay visible (licence, Attachment 6 §2.1). */
  .ap-bar { position: absolute; z-index: 4; left: 8px; bottom: calc(52px + env(safe-area-inset-bottom)); display: flex; gap: 6px;
    align-items: center; }
  .ap-btn { display: grid; place-items: center; min-width: 40px; height: 40px; padding: 0 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--panel);
    color: var(--text); font: 600 15px system-ui, sans-serif; box-shadow: var(--shadow); cursor: pointer; }
  .ap-btn.off { color: var(--muted); text-decoration: line-through; }
  .ap-stat { padding: 3px 8px; border-radius: 8px; background: var(--panel); color: var(--muted); font-size: 11px; }
  .ap-search { position: absolute; z-index: 6; left: 8px; right: 8px; bottom: calc(100px + env(safe-area-inset-bottom)); max-width: 420px;
    padding: 8px; background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow); }
  .ap-search .row { display: flex; gap: 6px; align-items: center; }
  .ap-search input { flex: 1; min-width: 0; height: 40px; padding: 0 10px; font-size: 16px; border: 1px solid var(--border);
    border-radius: 10px; background: var(--bg, transparent); color: inherit; }
  .ap-search ul { list-style: none; margin: 6px 0 0; padding: 0; max-height: 40dvh; overflow: auto; }
  .ap-search li button { display: block; width: 100%; padding: 8px; border: 0; background: none; color: inherit; text-align: left;
    font-size: 14px; cursor: pointer; }
  .ap-search small { display: block; color: var(--muted); font-size: 12px; }
  .ap-search .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  .ap-search .row button:not(.ap-btn) { height: 36px; padding: 0 10px; border: 1px solid var(--border); border-radius: 10px;
    background: none; color: inherit; font-size: 14px; cursor: pointer; }
  .ap-search .info { margin: 6px 2px 0; font-size: 14px; }
</style>
