# Thessaloniki as a second city: data and design

Research only, 2026-11-03. No code changes. Harold decides the plan before any work starts.

Product rules (Harold): one site, two cities. Without location permission the page asks for the
city; with location it picks the nearest one. Each city has its own stops, lines, search index,
vehicles, favourites and alerts. Athens items never show in Thessaloniki, and the reverse.

## 0. Update 2026-11-04: a keyless live API exists (OSETH website)

Found through the open-source Astiko Android client (github.com/uw0s/astiko, `OseThApi.kt`), then
tested from the mini PC (Greek IP), about 6 requests, all HTTP 200:

- Base: `https://oseth.com.gr/{el|en}/telematics-api` (Drupal 10 site of OSETH). No key, no special
  headers. Every answer is `{"data": ..., "error": "", "status_code": 200}`.
- `GET /route?page=1&size=1000&language=el`: 255 routes; `id` (e.g. `22_7128_1_3`, the GTFS
  route id form), `shortName`, `longName`, `color`, `tripHeadsigns[{routeId, headsign, shapeId}]`.
- `GET /route/{routeId}/info?shapeId=&language=`: `shape{id, color, lineString (WKT)}`,
  `stops[{id, code, name, latitude, longitude, sequence}]`, **`vehicles[{id, latitude, longitude,
  bearing}]`** (live positions per route direction).
- `GET /stop/{stopId}/timetable?language=&date=dd/MM/yyyy HH:mm:ss`: **live arrivals**,
  `trips[{id, headsign, shapeId, route, arrivalTime, departureTime, delay, monitored,
  arrivalInMinutes, departureInMinutes, vehicle{id, latitude, longitude, bearing}|null}]`.
  `monitored:false, delay:0` was seen on a trip with a vehicle: the delay may not be reliable.
- `GET /stop/nearby?page&size&longitude&latitude&language`: `stops[{id, code, name, latitude,
  longitude, distance, routes[]}]`.
- Untested (from Astiko): `/stop?size=1000` (3,698 stops, 4 pages), `/stop/{id}/info`,
  `/route/{id}/timetable`.
- **No CORS headers** (`Access-Control-Allow-Origin` absent on GET and OPTIONS): the browser cannot
  call it from staseis.gr. It needs a server (an atrt instance or a thin proxy).
- **No all-vehicles endpoint**: the whole fleet means one `/route/{id}/info` per route direction
  (~255+ per sweep). At ~1 req/s that is over 4 minutes; poll only routes in view or in use, or
  read vehicles from stop timetables.
- No published terms or rate limit. Same caution as OASA: start at ~1 req/s.

The OSETH Bus app (Flutter, `libapp.so`) uses another host,
`https://telematics.oseth.com.gr/amco-telematics/api/` (`route/shortNames`, `stop/nearby`,
`trip/plan`, `server/time`), with `X-API-Key` + `X-OSETH-Client` and a login/token flow. The key is
not in the APK; the Azure gateway answers 403 to every probe. Not usable. Other app hosts:
`ticketing.oseth.com.gr`, `osm.oseth.com.gr/tile` (403).

This replaces B1's "no open live bus API" for planning: the website API is the first live source to
try. The OASTH telematics result is in section 0.1.

## 0.1 Update 2026-11-04: OASTH telematics works without a browser

Tested from the mini PC, about 20 requests at ~1 req/s, all HTTP 200 once authorised.

- The HTML pages of `telematics.oasth.gr` answer 403 to every client (headless and real Chrome,
  Firefox, laptop, oracle-vm). Only `/api/` answers. A browser bootstrap is neither possible nor
  needed.
- Auth (flow from the community client orestislef/oasth-flutter, `api.dart`; verified live):
  1. `GET /api/?act=webGetLangs` needs nothing and sets `PHPSESSID` (expires after 1 hour).
  2. `X-CSRF-TOKEN` is a SHA-256 of a fixed string from that client plus the date (YYYYMMDD,
     Europe/Athens); it changes at Greek midnight. The string is not copied here.
  3. Send the cookie, the token, a User-Agent and `Referer`/`Origin: https://telematics.oasth.gr`.
     Plain `fetch` from Bun works.
- Static acts need no auth: `webGetLines` (276 lines: `LineCode, LineID, LineIDGR, LineDescr,
  LineDescrEng`), `webGetRoutes&p1=LineCode` (`RouteCode, RouteDescr, RouteType, ...`).
- Live acts need cookie + token (else 401): `getBusLocation&p1=RouteCode` (`VEH_NO, CS_DATE,
  CS_LAT, CS_LNG, ROUTE_CODE`; positions 3-6 s old), `getStopArrivals&p1=StopCode` (`btime2`
  minutes, `route_code`, `veh_code`), `getStopNameAndXY`. Also `webGetStops&p1=RouteCode`
  (`StopCode, StopID, StopLat, StopLng, RouteStopOrder, ...`), `webGetRoutesDetailsAndStops`.
- CORS: none on data calls. A server is needed, as for the OSETH API.
- Id mapping with the OSETH GTFS (2026-10-27): GTFS `stop_id` = OASTH **StopID** (42 of 43 stops on
  the test route, median 0.4 m apart); `getStopArrivals` takes StopCode, mapped through
  `webGetStops`. Lines: OASTH `LineID` = GTFS `route_short_name` for 244 of 276; most of the rest
  differ only in Latin vs Greek letters (`02M`/`02Μ`, use `LineIDGR`). GTFS `route_id` has no
  OASTH RouteCode: match directions by stops.
- Risk: the token recipe is reverse-engineered and can change any day; OASTH terms not checked.

**Which live source:** the OSETH website API (section 0) is keyless and already speaks GTFS ids,
but has no fleet-wide call. OASTH has per-route vehicle positions (also per route only) and needs
the token recipe. Recommended: OSETH API first, OASTH as a fallback, both behind a Thessaloniki
atrt instance (or a thin proxy) on a Greek IP.

## 0.2 Web groundwork shipped 2026-11-04

`src/lib/cities.ts` lists the cities (Athens ready, Thessaloniki `ready: false`). `app.cityId` comes
from `?city=`, else localStorage `city`, else Athens. The first location fix of the page or of a
locate tap inside another city's radius switches the city. Without a location (off, denied,
unavailable), «Κοντά σου» shows a two-button city picker. A city that is not ready shows a note in
the status banner. No Thessaloniki data is loaded yet: setting `ready: true` waits for the backend.

## 0.3 Update 2026-11-05: backend merged, sources for the next steps

- **Backend.** rt PR #83 (`--city thessaloniki`) was merged on 2026-11-05 as 28f4e4d. The public Athens service runs with the default city, so it does not change. A Thessaloniki service is a second deployment with its own flags and state, and with `OASTH_TOKEN_SALT` in its env.
- **Unmapped stops (rt#86).** 334 of 3,713 GTFS stops have no OASTH arrival code. Meta loads a route's stops only when a bus runs on it: stop lists existed for 248 of 456 routes. Fix: fetch the stops of every route once per refresh, which is about 208 requests.
- **Lines OASTH vs OSETH.** The GTFS has 254 lines and OASTH has 276; 252 are in both. Only the GTFS has `79H` and `T1`. Only OASTH has 24 more, for example 01M, 06, 07, 70, 71, 81 and 86x. So OSETH adds almost no lines. It can still add **vehicles**: KTEL Thessaloniki and KTEL Serres run the 43 suburban lines for OSETH under an interim contract, from 16 Mar 2026 to 31 Dec 2026 ([powergame](https://www.powergame.gr/epichirisis/1318401/thessaloniki-bikan-oi-ypografes-stin-endiamesi-symvasi-ton-42-ekat-gia-tis-periastikes-leoforeiakes-grammes/)). In 2022, KTEL buses had no telematics ([Parliament question](https://www.hellenicparliament.gr/UserFiles/c0d5184d-7550-4265-8e0b-078e1bc7375a/12007005.pdf)). Not verified yet: compare the vehicles on the same routes in OSETH `/route/{id}/info` and OASTH `getBusLocation`.
- **No GTFS-RT feed** for Thessaloniki. Checked: data.gov.gr CKAN, Mobility Database, Transitland.
- **Newest GTFS, automatic.** Call `https://data.gov.gr/api/3/action/package_show?id=42c9a7da-c86c-48b1-914c-f340e8bef00d`. Each resource name holds `GTFS dd/mm/yyyy-dd/mm/yyyy`; take the slice that covers today. The resource id changes with every slice. Slices can have gaps or an empty `url`, so keep the last good file.
- **Metro: no GTFS.** We synthesize a frequency-based schedule, marked as scheduled, from the official table ([thessmetro.gr](https://www.thessmetro.gr/en/?p=654)). Hours: 05:15 to 00:30, and to 02:00 on Fri and Sat.

  | Section | Day | Headway to 07:30 | Headway after 07:30 |
  |---|---|---|---|
  | Trunk (New Railway Station to 25th Martiou) | Mon to Fri | 5:00 | 2:55 |
  | Trunk | Sat | 10:00 | 2:55 |
  | Trunk | Sun | 10:00 | 3:25 |
  | 25th Martiou to Mikra | Mon to Sat | 7:30 | 4:23 |
  | 25th Martiou to Mikra | Sun | 15:00 | 5:07 |
  | 25th Martiou to Nea Elvetia | Mon to Fri | 15:00 | 8:45 |
  | 25th Martiou to Nea Elvetia | Sat | 30:00 | 8:45 |
  | 25th Martiou to Nea Elvetia | Sun | 30:00 | 10:15 |

  Stations: New Railway Station, Dimokratias, Venizelou, Agias Sofias, Sintrivani, Panepistimio, Papafi, Efkleidis, Fleming, Analipsi and 25th Martiou. From 25th Martiou one branch goes to Voulgari and Nea Elvetia. The other goes to Nomarchia, Kalamaria, Aretsou, Nea Krini and Mikra; this branch opened on 27 Aug 2026. Mikra to New Railway Station takes about 24 to 26 minutes ([gocar](https://www.gocar.gr/news/feed/54662,Metro_8essalonikhs_Ti_wra_einai_egkainia.html)). The thessmetro.gr page has no date, so check the table before we use it.

## 0.4 Update 2026-11-05: follow-ups done or tracked

- **Public Athens atrt** runs 239f4e2 (includes the merge of #83). `atrt-deploy.timer` on the VPS pulls `:latest` every 10 min and restarts only on a new image.
- **rt#86, all stops get an arrival code:** PR rt#88. Live at `--rps 1`: 456 of 456 routes have a stop list, and 3,697 of 3,713 GTFS stops have an arrival code. The other 16 are on no OASTH route.
- **rt#87, GTFS from data.gov.gr:** PR rt#89. Without `--gtfs`, the server picks the CKAN slice for today and keeps it in its state dir. Live: slice 517f491b (27/10-15/11), 23,499 trips.
- **rt#92, OSETH as a second vehicle source:** measured on 16 lines. Suburban (KTEL) buses are in OASTH with the same ids. OSETH added 1 real bus out of about 50 and showed 2 frozen ones. Recommendation: do not merge yet; Harold decides.
- **rt#91, metro:** frequency-based GTFS in the backend, shown as scheduled. The thessmetro.gr table changed: Friday has its own row, and on Saturday before 07:30 the Mikra branch runs every 15:00 (the table above says 7:30).
- **rt#90, deploy** (human: abinop + angelospk). **web#40**, Thessaloniki in the web, waits for it. The web also needs Thessaloniki stops and lines: `STATIC_BASE` is an Athens-only build.

## 1. Data sources

Summary:

| | Schedule (static) | Live |
|---|---|---|
| Bus (OSETH authority, OASTH operator) | **Yes.** OSETH GTFS on data.gov.gr, 2-3 week slices, updated "as needed" | **Unofficial only.** OASTH telematics API needs a browser session + CSRF token |
| Metro (Line 1, THEMA / Elliniko Metro) | **No GTFS.** First/last train and headway from press releases only | **None** |

### 1.1 Bus static GTFS (usable today)

- Dataset: "Δεδομένα αστικών συγκοινωνιών Π.Ε. Θεσσαλονίκης", publisher ΟΣΕΘ ΑΕ.
  https://data.gov.gr/dataset/dedomena-astikon-sygkoinonion-p-e-thessalonikis
  (CKAN API: `https://data.gov.gr/api/3/action/package_show?id=dedomena-astikon-sygkoinonion-p-e-thessalonikis`).
- Each GTFS file is a separate CKAN resource with a validity window in its name, for example
  `GTFS 27/10/2026-15/11/2026` → `.../download/20261027_gtfs.zip` (10.7 MB). 14 slices since
  2026-03-05. Windows are 2-3 weeks. There is at least one gap (17/05-19/06/2026 has no file with a
  URL). Frequency: `AS_NEEDED`. Access rights: `PUBLIC`.
- **Licence: not stated** (`license_id: null` on the dataset). See blocker B3.
- Content of the 2026-10-27 slice (checked 2026-11-03): agency `OSETH`, `Europe/Athens`;
  386 routes (all `route_type 3`, one route per line and direction, e.g. `01A_5351_1_3`);
  3,713 stops (`stop_id` = `stop_code`, e.g. `1011` ΠΛΑΤΕΙΑ ΑΝΤΙΓΟΝΙΔΩΝ); 23,499 trips;
  761k stop_times; full `shapes.txt` (9 MB); service in `calendar_dates.txt` only (empty
  `calendar.txt`); English names in `translations.txt`; no metro.
- Second, older feed: ΟΑΣΘ organisation, "GTFS ... για τη χρήση των υπηρεσιών της Google",
  https://data.gov.gr/dataset/oasth-gtfs, one file from 2026-04-02, frequency `ANNUAL`, licence not
  stated. Stale; use the OSETH feed.
- Comparison with Athens: OASA publishes one long-lived `osy_gtfs.zip` that atrt checks by ETag
  (`athens-transit-rt/internal/upstreamgtfs/upstreamgtfs.go:18`). Thessaloniki needs a step that
  asks CKAN for the newest resource whose window covers today, and keeps the last good file when
  there is a gap.

### 1.2 Bus live data (the hard part)

- OASTH telematics: `https://telematics.oasth.gr/api/?act=<name>&p1=...` (acts seen in community
  code: `getStopArrivals`, `getBusLocation`, `webGetLines`, `webGetRoutes`, ...). Same act-style
  design as OASA telematics, but **not open**:
  - From the mini PC (Greek IP), 2026-11-03: `?act=webGetLines` and
    `?act=getStopArrivals&p1=1011` → `401 {"error":"Error, User not authorized!"}`.
    `https://telematics.oasth.gr/en/` → `403` for curl, also with a browser User-Agent (WAF).
  - Community clients load the page in a real browser, read `window.token` and the `PHPSESSID`
    cookie, then call the API with `Cookie: PHPSESSID=...`, `X-CSRF-Token: <token>`,
    `X-Requested-With: XMLHttpRequest`. The token is bound to its session.
    Source: https://github.com/rlutolli/oasth-tracker (README, `research_final_auth.py`, 2026-04).
  - No public documentation, no terms of use, no published rate limit.
  - OASA, by contrast, answers anonymous GETs (Greek IPs only) and atrt keeps a 6 req/s budget.
- OSETH Bus app (AMCO, `com.amco.city.thessaloniki`, iOS id 6748433667) replaces the OASTH app
  (the OASTH App Store listing says its app reaches end of life). It shows live buses and ETAs.
  Its backend API is unknown and undocumented. It may be a cleaner live source than the OASTH site,
  but finding out means inspecting app traffic: a separate, Harold-approved step.
  https://play.google.com/store/apps/details?id=com.amco.city.thessaloniki
- Older community source `feed.opendata.imet.gr:23577/itravel` (CERTH-IMET): connection timed out
  on 2026-11-03. Treat as dead.
- Libraries: `teogramm/oasth` (Kotlin/Java, Maven `xyz.teogramm:oasth`), docs
  https://oasth.readthedocs.io/ — wraps the same API; no HTTP details in the docs.
- No GTFS-Realtime feed found for Thessaloniki.

### 1.3 Metro

- No official GTFS and no live feed. thessalonikimetro.org (community page, checked 2026-10-29)
  states: no public interface, no GTFS-Realtime, no metro GTFS; frequency and run time are not
  published; operating hours come from an Elliniko Metro press release of 2026-08-26.
  https://thessalonikimetro.org/dromologia/
- A 2025 report says OSETH gave bus GTFS to Google and THEMA must give the metro GTFS separately; no
  sign that this happened. https://parallaximag.gr/thessaloniki-news/metro-thessalonikis-6-mines-meta-se-anamoni-gia-dyo-vasikes-ekkremotites
- Kalamaria branch reportedly opened 2026-08-27 (mapa-metro.com). **Unverified.**
- Prior art: https://github.com/Miqell24/thessaloniki-bus-map builds a synthetic metro feed from the
  OSM route relation (station order, no shapes) plus OSETH bus GTFS. Our Athens `scripts/metro-osm.ts`
  already uses Overpass the same way, with an Athens bbox.

### 1.4 Other ready-made sources

- data.gov.gr: the two GTFS datasets above. Nothing for metro.
- Transitland / Mobility Database: nothing found for OSETH or Thessaloniki metro in this search.
  **Not checked in depth.**
- Google Maps carries OSETH buses (GTFS given by OSETH). Not reusable data.

Search note: the Grok research CLI was down (debug browser did not start), so this used web search,
the data.gov.gr CKAN API, direct HTTP probes and GitHub code search.

## 2. Coupling to Athens

Line numbers from 2026-11-03 `main`. Difficulty: S = constant or path, M = one module, L = data
model or another service.

### 2.1 Web (`athens-transit-map`)

`src/lib/city.ts` is **not** about cities: it validates `/v1/vehicles/tiles` payloads ("city" = the
whole-map live vehicle layer). It exports `isCityLive` (`city.ts:6`), `cityKey` (`:12`),
`cleanCity` (`:18`), used by `tiles.ts:4` and `state.svelte.ts:6`. Rename it before a real `City`
type arrives, or the names will collide.

| Area | file:line | Assumes | Diff |
|---|---|---|---|
| API bases | `src/lib/config.ts:4-6` | one `API_BASE`, `STATIC_BASE`, `STATS_BASE` (build-time env) | M |
| API calls | `src/lib/api.ts:27-138` | every endpoint built on those bases | M |
| Rail | `trains.ts:26-30`, `rail.ts:13`, `suburban.ts:17`, `timetable.ts:12`, `rails.ts`, `metro.ts` | STASY metro/tram, Proastiakos | M (hide per city) |
| Stats | `stats.ts:3,18,67,175` | one `latest.json` | S |
| Static index | `public/trips.json`, `scripts/trips.ts:10,41`, `trip.ts:388`, `stops.ts:1` | one Athens stops/trips index, global cache | M |
| Metro data | `public/metro.json`, `scripts/metro.ts:77,81`, `scripts/metro-osm.ts:13,34` | STASY GTFS, Overpass bbox `rel(37.8,23.5,38.2,24.1)` | M |
| Suburban | `public/suburban.json`, `suburban.ts:20` | Attica rail, hand-copied | S (none for Thessaloniki) |
| Speed layer | `public/speed/segments.geojson`, `speed.ts:7,22,27` | Athens segments | M |
| Map | `map/MapView.svelte:717-718` (`center [23.73, 37.98]`, `zoom 11.5`), `:49` (`COS_LAT` 37.98) | Athens view | S |
| Vehicle tiles | `tiles.ts:14-15` | Attica `BOX`, fixed tile `RANGE` | M (pairs with backend `tileBox`) |
| Geocoder | `trip.ts:399,410` | Attica bbox | S |
| Locate | `locate.ts` | no "outside the city" check | S |
| Ids / favs | `favs.ts:2,29,37`, `legacy.ts:13-51`, `v2.ts:164` | `oasa:` / `stasy:` namespaces, OASA direction quirk | M |
| Search | `search.ts`, `finder.ts:7,17`, `ui/SearchModal.svelte:16` | one index; bus/metro/tram/suburban chips | M |
| Storage | `state.svelte.ts:97,157,490,606` and others: `fav.v2`, `favOnly`, `cityOn`, `pushAlert`, `railAlert`; `SearchModal.svelte:14` `recent.v2`; `push.ts:62-85` `pushStops` | unprefixed keys | M |
| Push | `push.ts:7,22-74` | one `PUSH_URL`; `/alerts` has no city | L |
| Telegram link | `tglink.ts:3-20` | payload indexes the one `trips.json`; 64-char limit | L |
| Alerts | `alerts.ts`, `alertWatch.svelte.ts`, `railAlerts.ts` | Athens index and STASY | M |
| Bot | `bot/main.ts:22,50,61,78-85`, `bot/bot.ts:32,82,417-458,624-638` | one `state.json`, one trips/API URL, `@oasa_bus_bot` text | L |
| Texts | `index.html:6-7`, `ui/Panel.svelte`, `InfoDialog.svelte:71`, `SourcesView.svelte:71-74`, `StatsView.svelte:101`, `Timetable.svelte:44` | ΟΑΣΑ / STASY wording | M |
| PWA | `public/manifest.webmanifest` | name "Λεωφορεία ΟΑΣΑ live", `scope "/"` | S |
| SEO | `scripts/seo.ts:8,60,109,127,157-158,243` | one site, one `/v2` fetch, one sitemap | M |
| Domain | `public/CNAME` (`staseis.gr`) | one Pages domain | S |
| Time zone | `vite.config.ts:11`, `format.ts:49,56` | `Europe/Athens` | none (same zone) |

City-neutral already: the `/v2` namespaced id model, `lineColors.ts`, `SwrCache`, `sw.js` (push only,
no caches), env overrides for the bases.

### 2.2 Backend (`athens-transit-rt`, read only here)

| file:line | Assumes | Diff |
|---|---|---|
| `internal/telematics/telematics.go:28-29, 208-345` | OASA base URL and `act=` client, OASA types | L (new OASTH client + session/token refresh) |
| `internal/telematics/telematics.go:36-58` | OASA `CS_DATE` format | M |
| `internal/telematics/pacer.go:13-14` | `DefaultRPS = MaxRPS = 6`, 10 min block pause | S |
| `internal/sched/sched.go:59-69` | poll tiers 30/60/150 s | S (injectable `DefaultConfig()`) |
| `internal/geo/geo.go:15` | global `cosLat0 = cos(37.98°)` | M (~3 % scale error at 40.6°; make a parameter) |
| `internal/gtfs/model.go:14` | global `Athens` time zone, used in ~15 places | S (same zone; rename only) |
| `internal/server/tiles.go:19` | `tileBox` Attica | S |
| `internal/stats/stats.go:25,42` | `TZ`, `FirstDay` | S |
| `internal/match/mapper.go` | OASA route code → GTFS shape | M (OASTH ids differ) |
| `internal/upstreamgtfs/upstreamgtfs.go:18`, `cmd/atrt/snapshot.go:24,50,65` | one fixed GTFS URL + ETag | M (CKAN "newest valid slice") |
| `internal/release/release.go:21-23` | release tag `gtfs-snapshot` | M (per-city tag) |
| `internal/server/v2_oasa.go:20,24` | namespace `oasa` | M (`oasth` namespace) |
| `internal/server/http.go:46-64`, `v2.go:111-121` | `/v1`, `/v2` routes, no city | M |
| `http.go:54-60`, `v2_stasy.go`, `v2_proastiakos.go`, `internal/rail/*`, `railgeo/stasy_stops.go` | Athens rail | L (switch off for Thessaloniki) |
| `internal/alerts/alerts.go:26-28` | oasa.gr and athenstransport.com alerts | M |
| `internal/server/mcp.go:25-27,53` | "Athens OASA" names | S |
| `cmd/atrt/serve.go:20-33`, `Dockerfile`, `compose.yaml:7-17`, `deploy/atrt.service` | flags, ports 8095/8096, volume `atrt-state` | S (second service) |
| `.github/workflows/gtfs.yml:14,47-65`, `stats.yml:8` | one snapshot, one stats API | M (matrix by city) |

State model: all live state hangs off one `App` (`server.New(Config)`); only `gtfs.Athens`,
`geo.cosLat0`, `tileBox` and package constants are global. State paths follow `--state`.

OASA load rules (rt): AGENTS.md "Raise the load on OASA in small steps only."; README.md:25-26
"one global request budget (default 6 req/s, max 6) ... A 403 or 429 from OASA stops every request
for 10 minutes"; README.md:206-207 "do not run two instances behind one address"; README.md:184
OASA answers Greek IPs only. OASTH is a different host, so its budget is separate, but the same
caution applies: start at ~1 req/s and raise in small steps.

## 3. Target design

Each point: recommendation, then the trade-off.

**3.1 City in URLs and API**
- Web: **path prefix.** Athens keeps `/` (old links keep working); Thessaloniki lives under
  `/thessaloniki/` (SEO pages `/thessaloniki/stop/...`). The app reads the city from the path.
  Trade-off: one origin means shared `localStorage`, one service worker, one push subscription and
  one PWA install, so storage keys need a prefix (3.2). A subdomain isolates storage for free, but
  GitHub Pages serves one custom domain per repo, so it needs a second Pages repo or another host.
  A query param (`?city=`) is the weakest: easy to lose, bad for SEO.
- API: **one base URL per city**, same response shapes (e.g. `https://thess.transit.haroldpoi.dev`,
  or a path on the existing tunnel). `config.ts` becomes a table `{ athens: {...}, thessaloniki:
  {...} }`. Ids get their own namespace (`oasth:`), so nothing can mix even by mistake.
  Trade-off: two backends to run and monitor, but zero change to the Athens API contract the app
  depends on.

**3.2 Per-city storage keys**
- Prefix city data: `<city>:fav.v2`, `<city>:favOnly`, `<city>:pushAlert`, `<city>:railAlert`,
  `<city>:recent.v2`, `<city>:pushStops`. Keep device settings global: `theme`, `locOn`, `geoLast`,
  `nearAsked`, plus a new global `city` (last chosen city).
- Migration: on first run, unprefixed keys move to `athens:`. Old keys stay one release for rollback.
- Trade-off: a one-time migration step and a test for it, against a subdomain split that would need
  none but loses shared settings.

**3.3 City picker at 390 px**
- First open, no location: a bottom sheet over the map with two full-width buttons,
  «Αθήνα» and «Θεσσαλονίκη», each with a one-line hint (e.g. «ΟΑΣΑ · Μετρό · Τραμ · Προαστιακός» /
  «ΟΑΣΘ · Μετρό»). One tap closes it and stores `city`.
- With location: nearest city centre wins (Athens 37.98, 23.73; Thessaloniki 40.64, 22.94). Over
  ~100 km from both: show the sheet.
- Switch later: a small city chip in the existing top bar (or in the ⓘ sheet), not a new floating
  control. Phone-first rule: nothing extra covers the map.
- Trade-off: the chip costs header space; hiding it in ⓘ keeps the map clean but makes switching
  harder to find. Recommend the chip only when the user has used both cities, ⓘ otherwise.

**3.4 Backend: one instance per city**
- Recommend a **second atrt instance** from the same image, with its own `--state`, ports, volume
  and pacer, on the Thessaloniki VPS (Greek IP, already runs atrt). Code work in rt: a city config
  (centre latitude for `geo`, `tileBox`, GTFS source, namespace), an OASTH telematics adapter
  behind the same interface, rail adapters switched off. All of it through an rt issue + PR.
- Trade-off: two processes (memory ~100-200 MB each, per `GOMEMLIMIT`/`mem_limit`) and two
  deploys, but separate failure and separate upstream budgets, and no city dimension in every
  route. Multi-city in one process would touch every route, id and global (`cosLat0`, time zone,
  tiles), with no user gain.
- Push bot: one process, `city` field in `/alerts` and in the Telegram payload (one prefix char).
  Trade-off: a payload format change against running a second bot.

## 4. Blockers and ways around them

**B1. No open live bus API.** OASTH needs a browser session + CSRF token behind a WAF; no terms, no
rate limit. Building on it risks a block or a legal complaint, and it can break any day.
- Around it: (a) ask OSETH/OASTH for official access (info@oseth.com.gr; OASA-style open API or
  GTFS-RT): Harold's action. (b) Ship **schedule-only first**: stops, lines, timetables and
  "next departures" from GTFS, clearly marked «πρόγραμμα, όχι live». (c) Only with Harold's yes:
  a headless-browser session refresher on the VPS at ~1 req/s, or a look at the OSETH Bus app API.

**B2. No metro data.** No GTFS, no live arrivals, headway unpublished.
- Around it: build a static metro file from OSM (as `scripts/metro-osm.ts` does for Athens) with
  stations, geometry, first/last train and a "every ~N min" note. No vehicles. Mark it
  «ενδεικτικά». Re-check THEMA/Google GTFS later.

**B3. GTFS licence unstated and short validity slices.** `license_id` is empty on both datasets;
slices last 2-3 weeks and had a gap (17/05-19/06/2026).
- Around it: ask OSETH for the licence in the same email as B1 (data.gov.gr datasets are meant
  for reuse, but **this is not confirmed**). Technically: a daily CKAN job picks the newest slice
  that covers today and keeps the last good snapshot through gaps.

**B4. Backend work in another repo.** atrt hard-codes Athens in a few globals and has no OASTH
client. Not a blocker, but rt changes need an issue, a PR and a review, and a merge deploys.
- Around it: schedule-only MVP can be static files (GitHub Actions builds `trips.json`-style files
  from OSETH GTFS), so the web can start before rt changes.

**B5. Id mapping, OASTH API ↔ OSETH GTFS (unverified).** GTFS `stop_id = stop_code` (e.g. `1011`)
looks like the OASTH stop code used by `getStopArrivals&p1=`, but line and route ids were not
compared. Matters only after B1.

## 5. Suggested order (for Harold to decide)

1. Decide B1: email OSETH (official access + licence) and/or accept the unofficial API risk.
2. Web groundwork without new data: city config table, prefixed storage + migration, picker sheet,
   rename `city.ts`.
3. Schedule-only Thessaloniki: static GTFS build, stops/lines/search/timetables, OSM metro file.
4. Live buses: second atrt instance with an OASTH adapter (rt issue + PR), once B1 is settled.
5. Alerts and Telegram per city.
