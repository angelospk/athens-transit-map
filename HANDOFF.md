# Στάσεις (athens-transit-map): redesign and 3D street mode, handoff

Base commit: `04ec628`. Nothing is committed or pushed. A push to `main` deploys bus.haroldpoi.dev, so ask first
(preview branch or `main`). AGENTS.md: commit to `main` after tests, typecheck and build pass; bump `version` and
publish a GitHub release («Τι νέο») for user-visible changes.

Status: 966 tests pass (`bun run test`), `svelte-check` 0 errors, `vite build` OK.
After unzipping: `bun install` (adds three 0.170.0 and @types/three).

## 1. Redesign (light and dark)

- `src/app.css`: new tokens (`--surface`, `--on-accent`, `--accent-bg`, `--warn-fg`, `--ok-bg`, `--bad-bg`, `--star`,
  `--ring`, `--shadow-sm`, `--radius`, `--radius-sm`, `--font`) in light and dark blocks; custom scrollbars; themed map
  controls; bus pill with a delay dot; 3D callout styles.
- `index.html`: Commissioner font (Greek-first); dark theme-color `#15181e`.
- Restyled: Panel, CardSheet, StopCard, VehicleCard, LineCard, LinePicker, HelpPop, FavsPanel, FeedbackForm,
  NearbyPanel, SearchModal, SlowLines, StopFixBar, TripPlanner.
- Map icons: the user's own icons for bus, trolley, metro and tram (`public/icons/*.png`), stations drawn as a disc
  plus a glyph, bus stops as an icon. Route lines get rounded corners (`smoothLine` in `layers.ts`).

## 2. 3D street mode (desktop first; phone is on hold)

- The 3D button in the rail (`app.threeD`, not kept across reloads). three.js loads on demand
  (`preloadThree` runs when the pointer is over the button).
- `src/lib/map/scene3d.ts` (class `Scene3D`): tilt, extruded buildings in 3 shades, sky and haze, a light; one
  MapLibre custom layer drawn with three.js: OASA Citaro bus models (`buildBus`, scale 1.3, the line's colour on the
  roof), trees, street lights (a pole, an arm and a head; light pools at night), rain (Open-Meteo; `?rain=1` or
  `?rain=0` forces it), headlights, soft shadows (PCFSoft, 2048).
- `src/lib/map/shaders.ts`: tree sway, rain, headlight beam, lamp cone.
- Trees: `scripts/trees.py` turns the Meta/WRI canopy height map into `public/trees/14/x/y.json` (67k trees, central
  Athens). Credited in the attribution.
- Chase: «Ακολούθησε σε 3D» on the VehicleCard (`app.setChase("line/id")`). The camera rides behind the bus (pitch 66),
  the map goes quiet (no other vehicles or icons), and the route already driven is dimmed (`line-gradient` step).
  Dragging or closing the card ends the chase; the mouse wheel sets the chase zoom.
- 3D callout above a bus: «040 | 3′».
- Zooms: streets and lamps from 15, trees from 15, bus models from 15.5, rain from 16.5.

## 3. Roads of Athens from OpenStreetMap (latest work)

- Why the roads changed shape on zoom: they were built from whatever basemap tiles were loaded. When the map is
  tilted, MapLibre loads lower-detail (simplified) tiles towards the horizon, so the mix of shapes changed with the
  zoom. Fixed by building our own road data, independent of the basemap tiles.
- `scripts/roads.py`: Overpass JSON → `src/data/athens-roads.json` (4.8 MB, 1.8 MB gzip, 42,710 ways).
  - Real carriageway width from `width`, else `lanes` × lane width by class, plus a parking strip; pavement by class.
  - Markings: lane lines (dashed by the app, 3 m painted and 6 m clear), centre line, yellow bus-lane line
    (`bus:lanes`), motorway edge lines, all cut back at junctions; 5,123 zebra crossings.
  - Full precision (1e-7°, ~1 cm), no simplification, delta-encoded.
  - Source data: the Overpass mirror `https://maps.mail.ru/osm/tools/overpass/api/interpreter` (overpass-api.de and
    Geofabrik are blocked from the cloud sandbox). The query is in the script's docstring. Area:
    37.93–38.06 N, 23.65–23.83 E.
- `src/lib/athensRoads.ts`: `decode()` (map features, carriageways, streets for lamps), `dashes()`, `zebra()`, `covers()`.
- Loaded once: the file is imported as a hashed Vite asset (`?url`), kept in Cache Storage (`athens-roads`), then
  fetched with `force-cache`. It goes into one GeoJSON source (`x3d-roads`, tolerance 0, maxzoom 18) and is never
  rebuilt.
- Layers, in order: `x3d-area`, `x3d-walk`, `x3d-path`, `x3d-kerb-a`, `x3d-road`, `x3d-mark`, all in real metres
  (`metres()` in `map3d.ts`).
- Inside Athens the basemap's own road lines are hidden from z15; outside they stay (the rest of the map is not
  modelled).
- `src/lib/roadSnap.ts`: `RoadIndex` built once for all of Athens, with `Road.bus` (where a bus drives: metres right
  of the centreline) and `lane()`. Routes (`snapLine`) and buses (`scene3d.place`) sit in the middle of the
  right-hand lane for their direction.
- Route matching (`snapLine`) is a Viterbi pass over the candidate roads of each point, not nearest-road-per-point.
  A route only moves from one way onto another that it joins in its direction of travel (`RoadIndex.drive`, using
  the OSM nodes the ways share, or one short link between them); anything else costs `JUMP`. This fixed the
  hairpin "V" at forks (Hilton junction on Vas. Sofias: the route went down the slip to Vas. Konstantinou and jumped
  back through a corner point behind it). Checked on 15 real OASA routes through there: 94 hairpins before, 1 after
  (line 220's own turnaround at its terminus). `corner()` also refuses a corner behind the route.
- Buses on drawn lines ride their snapped route (`Track`, `scene3d.setRoutes`), so they take the same forks as the
  painted line; other vehicles still use the nearest road. On the route a bus is turned as a real one turns: along
  the line from its rear axle to its front axle, 4 m back and on along the route (`Track.pose`), so it steers
  through a bend gradually (real routes: 99% of half-metre steps turn it under 1.5°). Its place on the route is
  kept per vehicle; a jump of where its position lands (OASA's shape cutting a corner) glides out over ~0.5 s.
- Streets no longer change width while zooming or towards the horizon. A width given per feature inside a zoom
  curve (`metres(["get","w"])`) is a "composite" expression: MapLibre works it out per tile, clamped to that
  tile's own zoom (`CompositeExpressionBinder`, maplibre-gl-shared 6.12 line ~15889). Old tiles shown while new ones
  load, and lower-zoom tiles towards the horizon of a tilted view, drew every street too narrow or too wide. Now
  each width has its own layer with a plain zoom curve (`streetLayers()` in scene3d.ts, `Widths` in
  athensRoads.ts: carriageways to 0.5 m, pavements to 1 m; 88 layers, markings 3). Checked in headless MapLibre:
  the frame right after a fast zoom-in had 33% less road than the settled frame before; now 0.0% of pixels differ.
- Trolley lines get their own model (`buildTrolley`): the ΗΛΠΑΠ livery (yellow, a blue-violet sweep across the
  lower front, lavender and blue bars low on the rear half of each side, dark glass, «ΕΛΛΗΝΙΚΗ ΒΙΟΜΗΧΑΝΙΑ
  ΟΧΗΜΑΤΩΝ» above the windows), a long roof fairing and two trolley poles 60 cm apart reaching 6.6 m back up to
  wire height. `upsert(key, pos, heading, color, kind, label)`: kind from `app.lineInfo.get(line).kind`.
- Trams in 3D (`buildTram`): STASY orange Citadis, five cars (33.6 m), shaped from extruded profiles (rounded roof
  edges, a raked windscreen with a black band and the display, black chin with oval lamps, orange lip and cap, flush
  glass doors, black bellows, rounded roof fairings), a cab at each end, a single-arm pantograph on the middle car, the line («T6», «T7») on the displays in orange LEDs. They come from the trains layer (`drawTrains`
  in MapView passes each tram to `scene3d.upsert(..., "tram", line)`; `trainsFC` now also carries `line`). Each
  car follows the track: Scene3D keeps the path the tram's front has driven (`tramTrail`, on the right-hand track,
  1.65 m from the line) and lays every car between two points that far back along it (`behind`), so the tram bends
  through curves; before it has moved, it lies straight behind its front. Tram positions are timetable estimates.
- Destination displays on bus and trolley (front, across the top of the windscreen; rear, in the back window):
  the line's number in dot-matrix LEDs, amber on a bus, green-yellow on a trolley (`Scene3D.sign()`, one material
  per kind and number). Only the number: the vehicle's destination is not passed to Scene3D yet.
- Zooming no longer changes a route's shape: the `routes` and `highlight` sources have `tolerance: 0` (MapLibre
  simplified them per tile zoom), snapped shapes are cached per road index, and crossing zoom 15 re-sends them.
- Close in (3D, from zoom 15): the route is painted 2.9 m wide (3.5 m with its white edges) and a lane centre is kept
  at least 1.95 m from the kerb (`KERB_GAP` in `roadSnap.ts`), so route and bus stay on the asphalt of an outside lane;
  the vehicle trails are hidden (they follow OASA's shapes, not the roads); motorways are drawn with square ends
  (`x3d-kerb-m`, `x3d-road-m`) so a wider way no longer bulges past a narrower one where the lane count changes.
- Known, not fixed yet (needs `scripts/roads.py` and a new Overpass download; the mail.ru mirror returned 504 on
  2026-11-05): on motorways a short way with one lane more (where a ramp joins) is widened on both sides of its
  centreline instead of on the right, and its lane lines are cut away entirely because both of its ends count as
  junctions. Lane lines should run on through a way split that is only a continuation.

## 4. The app redesign (0.3.0, from the mockup «Στάσεις: νέο UI»)

The web was rebuilt around four tabs (`TabBar.svelte`, `app.tab`, `app.setTab()`): **Τώρα**, **Χάρτης**,
**Ταξίδι**, **Ειδοποιήσεις**. A shared link (`?stop=`, `?line=`, `?vehicle=`) opens on the map tab.

- **Τώρα** (`NowPanel.svelte`, `src/lib/now.ts`): «Φύγε σε N′». It shows the next bus you can still catch from the nearest stop or a
  favourite stop, with the walk measured as the straight line × 1.25 at 80 m/min. A bar shows leave, walk, wait and bus. «Πάμε» opens the stop, and a bell
  reminds you when to leave. Below it are the favourite stops as tiles, the stops near you, and the notices for your lines. It asks /v2 every 30 s, at most 4 requests at a time.
- **Στάση** (`StopCard.svelte`): the buses still coming to the stop (within 4 stops), filter chips (Όλες / Δικές μου / each
  line), a custom «Πότε» menu, arrival tiles with «Μετά:», «Ταξίδι από εδώ» and «Λάθος θέση;».
- **Γραμμή** (`LineCard.svelte`, `src/lib/linediagram.ts`): a live diagram of the main pattern, with each vehicle
  placed before the stop it drives to and coloured by its delay. It also has numbers at a glance (running, average delay, how often a bus passes now), a direction
  switch, «Ακολούθησε σε 3D» and «Πρόγραμμα». Fixed along the way: the two directions' labels were swapped against /v2.
- **Ταξίδι** (`TripPlanner.svelte`, `scaledLegs`/`planTags`/`tightestChange` in `plan.ts`): option cards with tags
  (Γρηγορότερο, Λιγότερο περπάτημα, Χωρίς αλλαγή), legs drawn to scale, a warning when a change has under 2′ of slack
  (`RISK_MIN`), «Φύγε σε» 0/15/30/60′, and sorting.
- **Μέσα στο λεωφορείο** (`VehicleCard.svelte`, `app.ride`): «Είμαι μέσα». You then pick «Κάθοδος» at your stop. The card shows the stops left
  and when to press STOP, and vibrates one stop before (`app.rideBuzz`, plus a notification if allowed).
  «Στείλε πότε φτάνω» shares the bus link and your arrival time. The ride ends once the stop is behind the bus. It only
  works while the vehicle card is open, since the card is what follows the bus.
- **Ειδοποιήσεις** (`AlertsPanel.svelte`, `src/lib/routines.ts`): on a phone a page of its own, as in the mockup.
  - What is being watched now (stop, rail or ride alert), drawn as the notification it sends, with «Σταμάτα».
  - «Κάθε μέρα»: a stop and a line, with days, an hour and «Πότε» (leave time, 5′ before, only if something changes).
    While the page is open in that window, «Τώρα» plans from it and reminds by itself. Reminding with the page
    closed needs the backend (issue draft 3).
  - «Για τις γραμμές σου»: switches for strikes, route changes and a bus over 10′ late (`app.notifyPrefs`; they decide
    the strike banner, the notice pill on «Τώρα» and the late notice); the device permission; the notices of the day.
- **Ride bar** (`RideBar.svelte`): «↓» in the ride sheet (`app.minimizeRide()`) closes the card and stops the 3D
  follow so the map is free. While riding, the bus's line stays on the map (`detailLines`), and a bar of pills at
  the bottom centre shows live or not, the stops left with the arrival time, the buzz switch and 3D follow. Tapping
  the bar opens the card again.
- **«Πού πας;» first** (`StartScreen.svelte`, `app.start`): a plain visit (not a shared link) opens on two fields,
  from and to. Each takes «Η θέση μου», «Διάλεξε στον χάρτη» (a crosshair at the map's centre and «Εδώ»;
  `app.pickFor`, `app.mapCenter`) or typed text (stops, areas, a street with its number through the geocoder).
  «Βρες διαδρομή» opens Ταξίδι on its options; «Εξερεύνησε τον χάρτη» goes to the map. The «Πού πας;» pill of Τώρα
  opens it again. The start is filled with the user's location when the browser already allows it.
- **How full the bus is**: a rider picks «Όχι γεμάτο», «Κάπως γεμάτο» or «Γεμάτο» in the ride panel or from the ride
  bar's menu (`app.setRideLoad`). It goes to `POST /v1/crowd/load` (athens-transit-rt contract rev 21) where
  `VITE_CROWD_URL` is set. Others see `occupancy` on the bus card and the line card.
- **Mockup pass**:
  - «Τώρα» and «Ειδοποιήσεις» swap the line picker for a «Πού πας;» search pill and a layers button. On a phone they
    also hide the map's buttons (`data-home` on `<html>`).
  - The notice for «Τώρα» is an amber pill on the map.
  - Cards open with a round ‹ (`Back.svelte`); on a phone it replaces ×.
  - Names are in title case.
  - The line card shows «κάθε N′ τώρα» under its name, and the line's speed (`lineSpeed`).
  - Boarding a bus starts the 3D follow and keeps the sheet open.
- **Crowd positions** (`src/lib/crowd.ts`): off by default. It turns on only when built with `VITE_CROWD_URL`; while riding, with
  «Βοήθα με τη θέση σου» on, it sends a fix every 15 s. The endpoint does not exist yet: see
  `docs/rt-issue-drafts.md` (issue drafts for athens-transit-rt: crowd positions, and the delay history for «συνήθως +2′»).
- **Shared pieces**: `Dropdown.svelte` is the only dropdown (no native `<select>`), the tokens `--card` / `--card-border` are new, and so are
  new icons in `Icon.svelte`.
- **Release**: `package.json` is 0.3.0. The «Τι νέο» notes are in `docs/release-0.3.0.md` (`gh release create v0.3.0 --notes-file
  docs/release-0.3.0.md` after the push).
- **Not done**: the push to `main` (it deploys); a test on a real phone (vibration, share sheet, notifications);
  «Χωρίς σκάλες» in the planner (no data).

## Open items

- Not yet checked on screen: bus and route in the right-hand lane during a chase (unit-tested only; the test browser
  could not start a chase).
- Unanswered questions to the user:
  - Show only Athens, i.e. remove Thessaloniki?
  - The "Metal / Swift" request: the web app cannot use Metal or Swift; that would mean a separate native iOS app.
- Phone layout of the 3D mode is on hold ("desktop first").
- Possible next steps: real kerbs and road edges as polygons (`area:highway`), stop lines at traffic signals,
  turn arrows (`turn:lanes`), sidewalk widths from `sidewalk:*`, and coverage beyond the current area.

## Files of the 3D work (changed since 04ec628)

New: `scripts/roads.py`, `scripts/trees.py`, `src/data/athens-roads.json`, `src/lib/athensRoads.ts`,
`src/lib/roadSnap.ts`, `src/lib/map3d.ts`, `src/lib/map/scene3d.ts`, `src/lib/map/shaders.ts`, `public/icons/*`,
`public/trees/*`, `tests/athensRoads.test.ts`, `tests/map3d.test.ts`, `tests/roadSnap.test.ts`.

Changed: `index.html`, `package.json`, `bun.lock`, `src/app.css`, `src/lib/state.svelte.ts`, `src/lib/metro.ts`,
`src/lib/trains.ts`, `src/lib/map/MapView.svelte`, `src/lib/map/layers.ts`, `src/lib/ui/*.svelte` (14 files),
`tests/layers.test.ts`.

## Apple Maps in 2D (optional)

`src/lib/map/appleBase.ts`: with `VITE_MAPKIT_TOKEN` set, Apple's map (MapKit JS) is the base map in 2D. MapKit cannot
host our layers, so it sits under MapLibre: MapLibre's own base layers are hidden (its canvas is then clear) and the
Apple map is moved to MapLibre's centre and scale on every `move` (rotation and tilt are off in 2D). 3D shows
MapLibre's base map again (the modelled streets need it). A token Apple refuses, or MapKit failing to load, brings
our base map back. Make a token with `scripts/mapkit-token.mjs` (an Apple Developer key with MapKit JS); put it in
`.env.local`, and as the repository secret `VITE_MAPKIT_TOKEN` for the deploy. Free: 250,000 map views a day.
