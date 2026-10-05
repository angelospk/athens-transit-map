# athens-transit-map

Ζωντανός χάρτης με τα λεωφορεία και τα τρόλεϊ του ΟΑΣΑ: **https://bus.haroldpoi.dev**

A live map of Athens (OASA) buses and trolleys. Pick up to 5 lines; each vehicle shows its line
number, coloured by delay. Click a vehicle for its delay, trip, next stop and GPS age; click a route
for its direction and stops. The chosen lines stay in the URL, so links can be shared
(`https://bus.haroldpoi.dev/?l=040,Α1`).

This is the frontend. Data comes from the backend
[`angelospk/athens-transit-rt`](https://github.com/angelospk/athens-transit-rt). The interface between
the two is fixed in [`docs/CONTRACT.md`](docs/CONTRACT.md); the backend owns it.
The UI follows the viewer of [foivospro/athens-gtfs-realtime](https://github.com/foivospro/athens-gtfs-realtime).

## Features

- Vehicles labelled with the line number, coloured by delay: up to 2′, 2–5′, 5–10′, over 10′, no trip.
- Route shapes in the line colour. Line picker with search (Greek, accent-insensitive; `A1` finds `Α1`).
- Vehicle details: delay, trip ("00:35 ΠΕΙΡΑΙΑΣ → ΣΥΝΤΑΓΜΑ"), next stop, GPS age. The trip's route and stops are highlighted.
- Route details: direction, number of stops, vehicles on it now. Tap a stop for its name.
- Vehicles glide to new positions; "πριν 24 δευτερόλεπτα" counters tick every second.
- Max 5 lines at once. Selection kept in the URL (`?l=…`).
- Banner from `/v1/status` (server problem, expired GTFS) and per-line staleness.
- Mobile first: compact panel and bottom sheet on phones. Light and dark map.

## Stack

Svelte 5 + Vite (static build), MapLibre GL JS 6 with [OpenFreeMap](https://openfreemap.org) vector
tiles (free, no key). GitHub Pages hosting. No backend of its own.

## Run locally

Needs Node ≥ 22.12.

```bash
npm install
npm run dev:mock   # fixture data, no network calls to the backend
npm run dev        # real backend
npm test           # unit tests (pacing rules, URL state, formatting, …)
npm run check      # svelte-check / TypeScript
npm run build      # static site in dist/
```

### Configuration (build-time env)

| Variable | Default | Meaning |
|---|---|---|
| `VITE_API_BASE` | `https://transit.haroldpoi.dev` | Live API (`/v1/lines/{id}`, `/v1/status`) |
| `VITE_STATIC_BASE` | `https://angelospk.github.io/athens-transit-rt/static/v1` | Static data (`lines.json`, `lines/{id}.json`) |
| `VITE_MOCK` | unset | `1` = answer every request from `src/fixtures/` (moving vehicles, 30 s cycle) |

Mock code and fixtures are not included in production builds.

## Request pacing

One request per chosen line: `GET /v1/lines/{id}`. All users share the cached copy at Cloudflare,
so the app never adds cache-busting parameters. The rules, from the contract
(`src/lib/schedule.ts`, `src/lib/poller.ts`, tests in `tests/`):

- Refetch a line at its `next_update_at` + 1–3 s random jitter.
- Never start two requests for a line less than 5 s apart (also across deselect/reselect).
- While the tab is hidden: at most one request per line every 60 s. Back in view, the line is fetched
  as soon as it is due again; visibility changes never bypass a backoff.
- `429`, `5xx`, network errors, timeouts (15 s): back off 10 s, 20 s, 40 s … up to 120 s.
- `503 warming_up`: retry after 10–12 s. `404`: stop and remove the line.
- At most one request in flight per line.

The contract has no server clock, so the app estimates the client clock offset from `updated_at` /
`next_update_at` (`ClockOffset`). It assumes the client clock is right unless the responses prove
otherwise, and it clamps waits to the line's update interval so a wrong clock cannot stop polling.

Static files (`lines.json`, `lines/{id}.json`) are fetched once per page load.

## Known limits

- No "all lines" view: the live API is per line by design (max 5 per client).
- Upstream's "waiting at the terminus" state is not shown: the contract has no such field yet.

## Deploy

Push to `main` → GitHub Actions runs tests, type check and build, then deploys `dist/` to GitHub Pages.
`public/CNAME` sets the custom domain; DNS has `bus CNAME angelospk.github.io` (DNS only).

## License

MIT. Map data © OpenStreetMap contributors, tiles by OpenFreeMap / OpenMapTiles. Transit data: OASA.
