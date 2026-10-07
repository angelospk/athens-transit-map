# athens-transit-map

Ζωντανός χάρτης με τα λεωφορεία και τα τρόλεϊ του ΟΑΣΑ: **https://bus.haroldpoi.dev**

A live map of Athens (OASA) buses and trolleys. Every live vehicle of the city is on the map, coloured
by delay; click one to see its line and trip. Pick up to 5 lines to follow them in detail; each vehicle
shows its line number, coloured by delay. Click a vehicle for its delay, trip, next stop and GPS age; click a route
for its direction and stops. The chosen lines stay in the URL, so links can be shared
(`https://bus.haroldpoi.dev/?l=040,Α1`).

This is the frontend. Data comes from the backend
[`angelospk/athens-transit-rt`](https://github.com/angelospk/athens-transit-rt). The interface between
the two is fixed in [`docs/CONTRACT.md`](docs/CONTRACT.md); the backend owns it.
The UI follows the viewer of [foivospro/athens-gtfs-realtime](https://github.com/foivospro/athens-gtfs-realtime).

## Features

- City layer: every live vehicle from `GET /v1/vehicles` (one cached snapshot for all users, ~30 s),
  drawn by the GPU. Click a vehicle: its line is shown in detail until you click empty map or press Esc;
  the other vehicles stay, fade or hide (layers button). Off switch in the layers button.
- Vehicles move along their route between updates, at the speed the backend measured over their last
  fixes (`speed`, `path`), slowing down as the fix gets older. New data never makes them jump: a late
  vehicle speeds up a little, an early one slows down; one far off fades out and back in at the right
  place with a ring ("corrected"). One motion per vehicle, shared by the city layer and the chosen lines.
- Direction chips on the vehicle and route cards; ⇄ on the "μόνο → …" pill switches direction.
- Metro, ISAP and tram: stations always shown (from the STASY GTFS on
  [data.gov.gr](https://data.gov.gr/dataset/4e897a75-975a-4ce7-af65-f32ea01f93b9)), static (no live data exists).
  Pin a line in the layers menu or on a tapped station's card to draw its track. Rebuild
  `public/metro.json` with `bun scripts/metro.ts <unzipped GTFS dir>`, then `bun scripts/metro-osm.ts`:
  the feed has no shapes, so the tracks come from OpenStreetMap route relations (© OSM contributors, ODbL).
- Trip planner (🧭 in the panel): from where to where (my location, a stop name, or an address), and the
  map shows every line that goes there with no change, each in the right direction, with A and B pins (max 5
  lines; the list names the rest). Stop names come from `public/trips.json` (every stop and each variant's stop
  order); rebuild it with `bun scripts/trips.ts` when OASA publishes a new GTFS (the planner says when it is
  older than the line list). Addresses and areas with no stop of that name come from OpenStreetMap's
  [Nominatim](https://nominatim.org) (only on Enter, at most one request a second; `VITE_GEOCODE_URL` changes it).
  The planner, its index and its geocoder load on the first 🧭 tap, not with the map.
- Favourite lines: ☆ in the search list (or `*` on the active row); the ★ chips under the search show or
  hide each one, "Όλες" shows them all (up to 5).
- My location (button under the zoom): a blue dot with its accuracy, the map follows it until you drag.
  Polled every 5 s in a vehicle, 10 s walking, up to 30 s standing; paused while the tab is hidden.
- GPS age labels ("24″") are off by default; the eye button ("Κίνηση και ηλικία θέσης") turns them and motion on or off.
- Vehicles labelled with the line number, coloured by delay: up to 2′, 2–5′, 5–10′, over 10′, no trip.
- Route shapes in the line colour. Line picker with search (Greek, accent-insensitive; `a1` finds `Α1`, `40` finds `040`).
- Vehicle details: delay, trip ("00:35 ΠΕΙΡΑΙΑΣ → ΣΥΝΤΑΓΜΑ"), next stop, GPS age. The trip's route and stops are highlighted.
- Route details: direction, number of stops, vehicles on it now. Tap a stop for its name.
- Max 5 lines at once. Selection kept in the URL (`?l=…`).
- Banner from `/v1/status` (server problem, expired GTFS) and per-line staleness.
- Mobile first: compact panel and bottom sheet on phones. Light and dark map.

## Stack

Svelte 5 + Vite (static build), MapLibre GL JS 6 with [OpenFreeMap](https://openfreemap.org) vector
tiles (free, no key). GitHub Pages hosting. No backend of its own.
MapLibre's worker is built as a second entry (`vite.config.ts`), so it shares one chunk with the
main bundle: about 330 KB of JS gzip in total.

## Run locally

Needs [bun](https://bun.sh).

```bash
bun install
bun run dev:mock   # fixture data, no network calls to the backend
bun run dev        # real backend
bun run test       # unit tests (pacing rules, URL state, formatting, …)
bun run check      # svelte-check / TypeScript
bun run build      # static site in dist/
```

### Configuration (build-time env)

| Variable | Default | Meaning |
|---|---|---|
| `VITE_API_BASE` | `https://transit.haroldpoi.dev` | Live API (`/v1/lines/{id}`, `/v1/status`) |
| `VITE_STATIC_BASE` | `https://angelospk.github.io/athens-transit-rt/static/v1` | Static data (`lines.json`, `lines/{id}.json`) |
| `VITE_GEOCODE_URL` | `https://nominatim.openstreetmap.org/search` | Address search of the trip planner (Nominatim API) |
| `VITE_MOCK` | unset | `1` = answer every request from `src/fixtures/` (moving vehicles, 30 s cycle) |

Mock code and fixtures are not included in production builds.

## Request pacing

One request per chosen line: `GET /v1/lines/{id}`, plus `GET /v1/vehicles` for the city layer (same
pacing rules; turning the layer off stops it). A line opened by clicking a city vehicle is polled
like a chosen one until it is closed. All users share the cached copy at Cloudflare,
so the app never adds cache-busting parameters. The rules, from the contract
(`src/lib/schedule.ts`, `src/lib/poller.ts`, tests in `tests/`):

- Refetch a line at its `next_update_at` + 1–3 s random jitter.
- Never start two requests for a line less than 5 s apart (also across deselect/reselect).
- While the tab is hidden: at most one request per line every 60 s. Back in view, the line is fetched
  as soon as it is due again; visibility changes never bypass a backoff.
- `429`, `5xx`, network errors, timeouts (15 s): back off 10 s, 20 s, 40 s … up to 120 s.
- `503 warming_up`: retry after 10–12 s. `404`: stop and remove the line.
- At most one request in flight per line.

The app needs server time for pacing and for the "πριν N" ages when the device clock is wrong
(`ClockOffset`). It estimates the offset from `updated_at` / `next_update_at`
and, when the API exposes it ([backend issue #3](https://github.com/angelospk/athens-transit-rt/issues/3)),
the HTTP `Date` header as a lower bound (cached copies keep an old `Date`). It trusts the client clock unless the responses
prove otherwise, follows measured clock jumps, and clamps waits to the line's update interval so a
wrong clock cannot stop polling. Known gaps: without `Date`, if the feed has stopped, a new tab can show a
too-small age for about 30 s; a fast device clock and a stopped feed together cannot be told apart.

Static files (`lines.json`, `lines/{id}.json`) are fetched once per page load.

## Known limits

- The city layer can be up to ~2.5 min behind for lines nobody watches (backend polls them less often);
  clicking a vehicle fetches its line, which then refreshes every ~30 s.
- Upstream's "waiting at the terminus" state is not shown: the contract has no such field yet.

## Deploy

Push to `main` → GitHub Actions runs tests, type check and build, then deploys `dist/` to GitHub Pages.
`public/CNAME` sets the custom domain; DNS has `bus CNAME angelospk.github.io` (DNS only).

## License

MIT. Map data © OpenStreetMap contributors, tiles by OpenFreeMap / OpenMapTiles. Transit data: OASA.
