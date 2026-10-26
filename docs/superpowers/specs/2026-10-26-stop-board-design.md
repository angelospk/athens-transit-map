# Stop arrival board

Tap a bus stop to see the lines serving it, their directions, and the next arrivals.
The stop card replaces vehicle and metro-station cards, links stops of the same name
across the street, and opens a vehicle when its arrival is selected.

## Data sources

The board uses these sources in order:

1. OASA `getStopArrivals`, when `VITE_OASA_BASE` points to an arrivals proxy.
2. The proposed backend `GET /v1/stops/{stop_id}` endpoint, when OASA is disabled or fails.
3. Estimates from vehicle positions in the surrounding city tiles when the backend
   endpoint is unavailable.

An empty successful OASA response is authoritative: no estimate is substituted for it.
The card labels OASA predictions, loading, and fallback estimates separately. Mock mode
never calls OASA. An older backend's `404 not_found` disables further endpoint attempts
for that session; `404 unknown_stop` falls back for only that stop.

## Stop selection and static data

`trips.json` includes each stop's GTFS stop id as an optional fourth tuple element,
keeping older indexes readable. Every stop is drawn from zoom 15; the index starts
loading at zoom 14. A selected line's stop also opens the board. Same-name stops within
200 m are offered as opposite-side links.

A stop can serve more than the client's five-line polling limit (ΑΚΑΔΗΜΙΑ has 25), so
opening its board does not subscribe to all its live line feeds. The estimate uses a
3×3 area of z13 city tiles around the stop, plus any fresher line data already selected.

## OASA proxy and line mapping

OASA does not provide CORS headers. The Vite dev server and optional standalone Bun
proxy expose `/oasa/stops/{stop_id}`. Static production hosting requires a reachable
proxy configured through `VITE_OASA_BASE`; without it the existing backend supplies data.

The proxy accepts only GET requests with numeric stop ids and no query string. It caches
boards for 30 seconds, combines concurrent requests for a stop, and serializes upstream
requests with a 250 ms minimum gap. Upstream requests time out after six seconds;
failures are cached briefly. The client polls only while the card is open, backs off on
failure, and cancels requests on close or stop change.

OASA route codes and GTFS shape ids are different namespaces. `webRoutesForStop` supplies
the route-to-`LineID` mapping; an equal-looking GTFS id is never used to infer a line.
For example, OASA route **5205** belongs to line **130**, whose GTFS shape is **5514**.
Route metadata is cached for six hours and rechecked after five minutes if a new route
appears. Failed metadata requests are retried. Unmapped predictions remain visible under
their route codes instead of being discarded or assigned to a guessed line.

OASA route descriptions distinguish directions. When both the official metadata and
static serving patterns provide a single direction for a line, the card can show the
shorter static destination. OASA vehicle ids are matched to zero-padded map ids when
that vehicle is already loaded.

## Estimated arrivals

The page places vehicles on their serving variants, finds the next pass of the stop,
and walks `path_speeds` in 200 m steps. Beyond those steps it uses the line's daily cruise
speed, clamped to 2–8 m/s, or 3.5 m/s without statistics. Fixes older than five minutes,
vehicles more than 10 km ahead, and arrivals more than 30 seconds past are excluded.
A bus standing at its first stop with unknown departure is shown as `αφετηρία`.

`stopOffsets` uses ordered candidate matching instead of greedily snapping the first
stop to the end of a circular shape. The shared motion predictor also benefits from
this correction. Regression tests cover the loop and the stop-board source transitions.

## Proposed backend endpoint

The separate backend change adds `/v1/stops/{stop_id}` and contract revision 7. It uses
vehicles already held in memory and the timetable, adds no OASA requests, and does not
mark the stop's lines watched. Live rows use matched progress or a clear unmatched
position; timetable rows represent trips not yet departed and are omitted when the feed
is expired. The horizon is one hour, capped at three arrivals per line/variant.

The frontend remains compatible with a backend without this endpoint. Its checked-in
contract copy stays at revision 6 until the backend change lands upstream.

## Validation and limits

Tests cover stop selection, source priority, authoritative empty boards, aborts and late
responses, official route mapping, proxy caching and pacing, and geometric estimates.
OASA predictions were also checked in the browser, including route 5205 on line 130.

The page estimate only sees nearby tiles. Neither its estimates nor backend estimates
are OASA predictions; the card says so. Earlier comparison samples showed early bias
in computed ETAs, especially farther ahead, so evaluating their accuracy needs actual
stop-passing history rather than tuning to agreement with OASA.
