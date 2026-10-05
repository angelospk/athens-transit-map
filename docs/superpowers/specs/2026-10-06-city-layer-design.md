# City layer: every live vehicle, focus on click

Asked by Harold on 2026-10-06. Backend part: `athens-transit-rt` thread "/v1/vehicles".

## Why

Today the map shows only the 1-5 lines the user picks. Harold wants a layer with every live bus
of the city, cheap for the home server: one cached response, the same bytes for every client,
refreshed every ~30 s, with motion between refreshes.

## Data

- `GET /v1/vehicles` (contract rev 3): `{ updated_at, next_update_at, vehicles: CityVehicle[] }`.
  `CityVehicle`: `line, id, lat, lon, bearing, position_at, variant, delay_s, speed, path`.
  `speed`: smoothed along-route m/s from the backend's short per-vehicle history (null: unknown).
  `path`: route geometry ahead of the vehicle (`[lat, lon][]`, starts at the vehicle's projected
  point, ends at its next stop or ~1.5 km), or null.
- `/v1/lines/{id}` vehicles get the same `speed` and `path` (optional; old servers omit them).
- Polled with the existing `LinePoller` rules (next_update_at + jitter, ≥ 5 s gap, 60 s while
  hidden, backoff). `404` (old server): the layer is unavailable, the app works as before.
  The city request never marks lines as watched (backend rule).

## Motion (pure, `src/lib/city.ts`)

- Shown position at time t: walk `speed · clamp(t − position_at, 0, 150 s)` metres along `path`
  (capped at its end). No `path` or no `speed`: the GPS position.
- New data: the marker blends from the shown position to the new shown position over 1.5 s
  (no jump back). Moves > 1 km are not animated (existing `JUMP_M`).
- Rendering: one GeoJSON source, MapLibre circle + symbol layers (GPU, not DOM markers: ~1-2k
  vehicles). Positions are recomputed and `setData` is called ~4 times per second while the tab
  is visible and the layer is on; no work when hidden.
- Detailed lines (picked or focused) use the existing DOM markers; their vehicles are left out
  of the city layer so nothing is drawn twice. `predict.ts` uses the backend `speed` when present
  instead of its own two-sample speed (better history, same caps).

## Interaction

- Layer on by default. Look: small dots coloured by delay at city zoom; from zoom ~13.5 a disc
  with the line number.
- **Click a city vehicle → focus:** that vehicle is selected (info card from the city data at
  once), its line is shown in detail as a temporary extra line (routes, stops of its trip,
  DOM markers, line polling) without touching the 5-line selection or the URL. Other city
  vehicles are dimmed (setting, see below).
- **Click on empty map, Esc, or × → unfocus:** the temporary line is dropped, all vehicles show again.
  Clicking a picked line's vehicle works as today.
- Layers popover (button in the panel header): "Όλα τα λεωφορεία" on/off; "Στην επιλογή, τα άλλα:
  κανονικά / αχνά / κρυφά" (default αχνά). Stored in localStorage.

## GPS age ("ματάκι")

The per-marker GPS age labels ("24″") and the panel line "Ενημέρωση πριν …" go behind an eye
button in the panel header. Default off. Its popover explains what the numbers mean and shows the
time of the last update; the eye toggles the labels. Stored in localStorage.

## Units

- `src/lib/city.ts` (pure, tested): `alongPath(path, metres)`, `cityPosition(v, nowSec)`,
  `isCityLive(body)`, `cityFC(vehicles, positions, exclude)`.
- `LinePoller` gets an optional `validate` so the same pacing code polls `/v1/vehicles`.
- `AppState`: `city`, `cityOn`, `dimOthers`, `showAges`, `tempLine` (focused line not in the picks).
- `MapView`: city source + layers, animation loop, click handling (city vehicle → focus).
- `Panel`: header buttons (layers, eye) with popovers; city stats when no line is picked.
- Mock: `/v1/vehicles` built from the fixtures plus ~1500 synthetic vehicles on fixture shapes
  (performance check).

## Verification

Unit tests for `city.ts`, poller validate, temp-line focus/unfocus in state. Browser check in mock
mode (1500 vehicles move smoothly, click focus/unfocus, popovers, phone width) and on prod once the
backend is deployed. Codex review, CodeRabbit, push.
