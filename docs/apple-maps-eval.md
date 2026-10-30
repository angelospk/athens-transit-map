# Apple Maps (MapKit JS) vs the current map: evaluation

Branch `exp/apple-maps`, 2026-10-30. Refs #25.

## Recommendation

Keep MapLibre + OpenFreeMap as the map of bus.haroldpoi.dev. Do not move to MapKit JS.

Reasons, strongest first:

1. **No traffic layer and no transit routing in MapKit JS.** The `Map` class has no traffic option. `Directions` in MapKit JS supports Automobile, Walking and Cycling only. Transit appears only in the Server API's `/v1/etas`, as a time estimate, not a route.
2. **Live vehicles cost more.** MapLibre draws ~1000 city vehicles in one WebGL symbol layer. MapKit JS has no data-driven layer: each vehicle is an annotation. Apple publishes no performance limit; one forum report says 2,000 `MarkerAnnotation`s took 5-10 s to add. Our motion (glide), trails and speed layer would all have to be rebuilt on DOM annotations.
3. **Licence.** Attachment 6 §1.2 of the Apple Developer Program License Agreement: "MapKit JS may not be used in Your website and/or application running on non-Apple hardware for the following commercial purposes: fleet management (including dispatch), asset tracking, …". A free rider app is probably not "commercial fleet management", but showing every bus's live position is close enough that Apple could object, and §2.7 lets Apple cap or revoke access at its discretion.
4. **Apple data stays on Apple maps.** §2.4: Map Data may be shown only on an Apple map. We cannot use Apple's search or geocoding with the MapLibre map, so a hybrid (MapLibre map + Apple search) is not allowed.
5. **Cost and lock-in.** It needs an Apple Developer Program membership (the quota is per team) and a signing key. OpenFreeMap and Photon need no account.

What Apple would add: a better-looking base map with built-in dark mode (our `basemap.ts` repaints OpenFreeMap's dark style by hand), Apple's POI data with tap-to-open place cards, Look Around, and Apple's address autocomplete. If we want better POIs or addresses later, look for an OSM-compatible service first.

## Feature comparison

| Feature | Current (MapLibre GL 6 + OpenFreeMap + Photon) | MapKit JS 5/6 | Apple Maps Server API |
|---|---|---|---|
| Base map | OpenFreeMap `positron` / `dark` vector tiles, our own dark repaint | Apple map; `colorScheme` Light, Dark, Adaptive; types Standard, MutedStandard, Satellite, Hybrid | Snapshots only (static images) |
| Greek labels | OSM `name` (Greek) | `mapkit.init({ language: "el" })`; quality not checked (no key) | `lang` parameter |
| Traffic | None | **None** (no traffic overlay) | `/v1/etas` and `/v1/directions` return times; whether they use live traffic is not documented |
| Bus line polylines | GeoJSON line layers, data-driven colour, arrows | `PolylineOverlay` + `mapkit.Style`; works in the prototype | n/a |
| Stops | Symbol/circle layers by zoom | Annotations; `visible` toggled by zoom in the prototype | n/a |
| ~1000 moving vehicles | One WebGL symbol layer, glide per frame | One DOM annotation each; `coordinate` is settable; clustering via `clusteringIdentifier`; no official perf guidance | n/a |
| Directions | Own trip planner on OASA data (bus) | `Directions`: Automobile, Walking, Cycling. **No transit** | `/v1/directions`: Automobile, Walking, Cycling; `/v1/etas` adds Transit |
| Address search | Photon (komoot) | `Search` + `autocomplete`, `Geocoder` (lookup, reverseLookup); quality in Greek not checked | `/v1/search`, `/v1/searchAutocomplete`, `/v1/geocode`, `/v1/reverseGeocode` |
| Shops / POI | OSM POIs in the tiles, not tappable | `showsPointsOfInterest`, `pointOfInterestFilter` (categories incl. PublicTransport, Cafe, Pharmacy…), `PointsOfInterestSearch`, `selectableMapFeatures` + `PlaceDetail` | `/v1/search` with POI filters |
| Street imagery | None | `LookAround`, `LookAroundPreview` (Greece is on Apple's Look Around list; Athens coverage not checked) | n/a |
| Account / key | None | Apple Developer Program + MapKit key (.p8) or a dashboard token | Same key; a JWT is exchanged at `/v1/token` for a 30-minute access token |
| Browsers | Any WebGL2 browser | Apple lists current Safari (macOS, iOS), Chrome, Edge, Firefox. Brave is not named; it is Chromium | n/a |

## Quotas and cost

- MapKit JS: "a free daily limit of 250,000 map views and 25,000 service calls per Apple Developer Program membership. For additional capacity needs, contact us." ([developer.apple.com/maps/mapkitjs](https://developer.apple.com/maps/mapkitjs/))
- Server API: "up to 25,000 service calls per day per team between Apple Maps Server API and MapKit JS. If your app exceeds this quota, the service returns an HTTP 429 error (Too Many Requests)". So service calls are shared between the two APIs, and over the limit there is a 429, not a bill. ([Apple Maps Server API](https://developer.apple.com/documentation/applemapsserverapi))
- Not documented: whether map views are also shared with the Server API, and what MapKit JS does over its limit.
- Our use: one map view per page load; autocomplete and directions are service calls. 25,000 calls a day is enough for this site, but every search keystroke batch counts.

## Terms (Apple Developer Program License Agreement, Attachment 6)

- §1.2: no commercial fleet management, dispatch or asset tracking with MapKit JS on non-Apple hardware (see Recommendation 3).
- §2.1: keep Apple's logo and legal links visible. The prototype's buttons sit above them.
- §2.4: Map Data only on an Apple map (see Recommendation 4).
- §2.5: no caching, prefetching or storing of Map Data beyond temporary use.
- §2.2, §2.3: no bulk download, no derived database, no building another map service from it.
- Overlaying our own data (lines, stops, vehicles) is not restricted.

Source: [Apple Developer Program License Agreement](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/).

## What the branch builds

- `?map=apple` swaps `MapView` for `src/lib/apple/AppleMapView.svelte`. It is a separate chunk (3.6 KB gzip) loaded only with the flag; the default build changed by about 1 KB.
- MapKit JS 5 from Apple's CDN (`mk/5.x.x/mapkit.core.js`, libraries `full-map,services`), `language: "el"`, colour scheme from the app theme.
- Shown: the city vehicles and detail-line vehicles as DOM annotations (tap opens the normal vehicle card), the detail lines as polylines, their stops from zoom 13.5 (tap opens the stop card), Apple POIs on/off, address and shop search with autocomplete, and a walking or driving route from the user (or the map centre) to the result.
- Not ported: motion/glide, trails, metro and rail layers, speed layer, follow-me, framing on first load.
- `workers/mapkit-token`: a Cloudflare Worker that signs a 30-minute ES256 JWT (`iss` Team ID, `kid` Key ID, `origin` = the caller) for exact allowed origins only, with CORS for that origin. Tested with unit tests and in `wrangler dev` with a throwaway key (the JWT verified with OpenSSL). Not deployed: no key exists yet (#25).
- The Apple dashboard can also issue a static, domain-restricted MapKit JS token. Then the Worker is not needed: `VITE_MAPKIT_TOKEN_URL=data:text/plain,<token>`.

## What was seen without a key

With a fake token, MapKit JS 5.81.72 loads (35 requests to Apple's CDN), calls our token URL, and reports `Unauthorized`. It still draws its empty grid, and on it the prototype's own data works: 21-22 live vehicles as annotations (update in 0-4 ms), line 040 as a polyline, and a vehicle tap opens the vehicle card. Apple's tiles, POIs, search and directions need a real key, so the look of the Apple map and the quality of Greek search are not checked.

## How to try it

1. Get a key (#25), set the Worker secrets, deploy `workers/mapkit-token`.
2. `VITE_MAPKIT_TOKEN_URL=<worker url> bun run build`, serve `dist`, open `/?map=apple`.
3. The token works only from the origins in `wrangler.toml` (`ALLOWED_ORIGINS`).

## Open points

- Greek label and search quality, Look Around coverage in Athens: need a key.
- Annotation performance with ~1000 vehicles at once on an iPhone: need a key and a phone test.
- MapKit JS 6 is current (Promise-based services, `mk/x` URL). The prototype uses 5.x; the `@types/apple-mapkit-js-browser` types are for 5.x.
