# Other Greek cities: GTFS and live bus data (2026-11-06)

Research only. No code changes. Goal: find which Greek cities beyond Athens and Thessaloniki have
bus data that staseis.gr can use: (a) a static GTFS, or (b) live data on a public page or app.

Method (same as `thessaloniki.md`): catalog search, then the operators' apps and web pages, then
read-only probes from the mini PC (Greek IP) at about 1 request per second per host. The tests ran
on 2026-11-05 22:35-22:50 UTC (00:35-00:50 Athens time, so most cities had no buses running).
"Tested" below means that window. Grok search was not available (the CDP browser on the MacBook
did not answer); web search and direct probes were used instead.

## 1. Summary

- **No static GTFS exists for any city outside Athens and Thessaloniki.** Checked: data.gov.gr
  CKAN (`package_search?q=GTFS`: 7 datasets, all OASA, OASTH or OSETH), the National Access Point
  harvest on data.gov.gr (57 datasets: motorway, truck parking, KTEL long-distance XLSX, no urban
  bus), the Mobility Database catalog (`feeds_v2.csv`: 5 Greek feeds, Athens and TRAINOSE only,
  all inactive), and Transitland atlas (`feeds/data.gov.gr.dmfr.json`: OSETH, STASY, OASA only).
  Tested 2026-11-06.
- **One vendor platform covers about 28 cities with live data: citybus.gr by e-analysis.** Each
  urban KTEL has a site `https://<city>.citybus.gr/el/stops` and an app
  `gr.citybus.urbantransit.<city>` (iOS developer "Kostas Margaritis", id 1697101157). All sites
  call one REST API, `https://rest.citybus.gr/api/v1/...`, with a Bearer token that the page
  itself embeds. One adapter in atrt would serve every city on the platform. Details in section 2.
- Cities not on citybus.gr: **Rhodes** (municipal RODA; the "Rhodes Public Transport" app is an
  info guide, no live data found), **Kalamata** (municipal; a 2015 leaflet planned live tracking,
  no current service found). Both: no usable source.

## 2. The citybus.gr platform (e-analysis)

Found through the App Store: the Patras app (id 6472811202) says "see in real time the departures
and the position of the buses". The same developer publishes 21 urban apps
(`gr.citybus.urbantransit.*`) and 11 suburban apps (`gr.grbus.suburbantransit.*`, for example
Rhodes, Larissa, Serres, Kos, Mykonos), all 2023-2024
([iTunes lookup](https://itunes.apple.com/lookup?id=1697101157&entity=software&country=gr)).
The Play listing links `patra.citybus.gr` and `www.astikopatras.gr`. The index page
`https://citybus.gr` (footer "Αστικά ΚΤΕΛ - e-analysis") lists 30 sites.

### 2.1 API (tested 2026-11-06)

- Base: `https://rest.citybus.gr/api/v1`. Server: Microsoft IIS (ASP.NET; errors are RFC 7807
  JSON).
- **Auth.** Every call needs `Authorization: Bearer <token>`. Without it: HTTP 401. The token is
  a JWT (HS256) written in clear text in the HTML of each `<city>.citybus.gr/el/stops` page, as
  `token = '...'`, next to `apiUrl` and `agencyCode`. Its only claim is `exp`, about 48 hours after
  the page was served. One token works for all agencies. So a server must fetch the stops page
  once a day and read the token from it. The token is not copied here.
- **CORS.** No `Access-Control-Allow-Origin` header on GET. OPTIONS answers 204 with no CORS
  headers. The browser cannot call it from staseis.gr: it needs a server (atrt or a proxy).
- **Rate limit.** No rate-limit headers seen. No `robots.txt` content and no published terms of
  use for the data. The privacy page (`/en/privacy`) is about the app account.
- Endpoints (from `/js/stops.js` of the site, plus `trips/route` from the community OpenAPI spec
  in section 2.2; all tested with HTTP 200 except as noted):

| Endpoint | Returns |
|---|---|
| `GET /{lang}/{agency}/stops` | `[{id, code, name, latitude, longitude, lineCodes[], routeCodes[], distance}]` |
| `GET /{lang}/{agency}/lines` | `[{id, code, name, color, textColor, borderColor, routes[{id, code, name, direction}]}]` |
| `GET /{lang}/{agency}/routes/{routeCode}/sequence` | `[{sequence, code}]`: ordered stop codes of one route |
| `GET /{agency}/lines/{lineCode}/points` | `[{routeCode, routePoints[{id, sequence, latitude, longitude}]}]`: route shapes (no `lang`) |
| `GET /{lang}/{agency}/trips/stop/{stopCode}/day/{day}` | scheduled times at one stop: `[{id, day, routeCode, routeName, lineCode, lineName, stopCode, stopName, tripTime "HH:MM", ...}]`; `day` 0-6, Sunday = 0 (5 gave Friday) |
| `GET /{lang}/{agency}/trips/route/{routeCode}` | all scheduled trips of one route: same row shape, one row per stop per trip, rows of one trip share `id`. Heraklion route 31018: 5,364 rows, 149 trip ids, days 0-6 |
| `GET /{lang}/{agency}/stops/live/{stopCode}` | **live**: `{vehicles[{lineCode, lineName, routeCode, routeName, latitude, longitude, departureMins, departureSeconds, vehicleCode, lineColor, ...}]}`; HTTP 404 when no bus is due |

- **Live data is real.** Heraklion (agency 110), stop 1235, polled 4 times 20 s apart at 00:43
  Athens time: one bus of line 01 moved from 35.33821,25.12943 to 35.33709,25.13079, and its
  countdown fell from 4:50 to 3:51. A second bus stayed still with a countdown of 28 to 27 minutes
  (it waits at the terminus). `vehicleCode` looks like a trip key
  (`<yyyymmdd>_<routeCode>_..._<n>`), not a fleet number.
- **Live data is per stop only.** The web site has no vehicles-per-line or whole-fleet call. To
  draw buses on the map we would poll the stops in view, or one stop near the start of each route,
  and de-duplicate by `vehicleCode`. The apps were not decompiled; they may have a per-line call.
- **Static data is enough to build a GTFS.** Stops, lines, routes with stop order, shapes, and
  whole trips per weekday (`trips/route`, one call per route) are all there. Per city that is
  about 1 call per line (shapes) plus 2 per route (stop order, trips): for Patras about 190
  calls, about 3 minutes at 1 req/s.
  The calendar is per weekday only: no dates, no holidays. Not tested: what the API returns on a
  public holiday.

### 2.2 Community clients that already use the API (GitHub search for `rest.citybus.gr`, 2026-11-06)

- [MartinLangbecker/citybus-gtfs-generator](https://github.com/MartinLangbecker/citybus-gtfs-generator):
  builds a GTFS zip per city from the API (26 cities; Agrinio and Mesolongi have no schedules),
  with an OpenAPI spec `citybus-api.yaml`. Its README: synthetic weekday calendar, no holidays, and
  "The CityBus.gr API has no published terms of use ... Do not redistribute generated feeds without
  confirming with the operators or platform provider (e-analysis, `info@e-analysis.eu`)".
- [ckagias/greek-citybus](https://github.com/ckagias/greek-citybus): Python library, live
  arrivals for 29 cities; scrapes token + `agencyCode` from `/el/stops`, caches them, refetches on
  401. Its docs list the risks: HTML change, token scheme change, upstream blocking.
- [gkarabayas/patrabus-plus](https://github.com/gkarabayas/patrabus-plus): Patras web app; a
  server route proxies `live`, `points`, `sequence`, `schedule`, caches live for 4 s, and treats a
  live 404 as "no vehicles".
- [Miqell24/volos-bus-map](https://github.com/Miqell24/volos-bus-map),
  [Miqell24/larisa-bus-map](https://github.com/Miqell24/larisa-bus-map): maps with GTFS written
  from the API and map-matched shapes.
- [uw0s/Astiko](https://github.com/uw0s/Astiko) (the client that showed us the OSETH API) also
  lists `rest.citybus.gr` for 24 cities.

So the method is known and in public use. None of them found a whole-fleet vehicles call.

### 2.3 Inventory per agency (tested 2026-11-06)

Counts from `/stops` and `/lines`; "routes" counts line directions and variants.

| Site | Agency | Stops | Lines | Routes |
|---|---|---|---|---|
| patra | 112 | 839 | 30 | 80 |
| agrinio | 130 | 832 | 14 | 98 |
| irakleio (Heraklion) | 110 | 533 | 26 | 97 |
| larisa | 102 | 531 | 21 | 85 |
| katerini | 118 | 508 | 17 | 112 |
| chalkida | 133 | 489 | 13 | 41 |
| lamia | 114 | 489 | 13 | 59 |
| chania | 120 | 484 | 14 | 50 |
| corfu | 101 | 478 | 13 | 53 |
| volos | 103 | 430 | 12 | 47 |
| ioannina | 106 | 429 | 16 | 163 |
| veroia | 129 | 429 | 52 | 24 |
| salamina | 113 | 420 | 9 | 41 |
| drama | 134 | 402 | 17 | 34 |
| serres | 117 | 396 | 26 | 35 |
| chios | 127 | 394 | 2 | 25 |
| arta | 125 | 351 | 9 | 57 |
| kozani | 121 | 351 | 16 | 64 |
| mitilini | 122 | 336 | 15 | 53 |
| alexandroupoli | 107 | 328 | 19 | 67 |
| naousa | 116 | 266 | 9 | 26 |
| komotini | 105 | 235 | 15 | 33 |
| kavala | 123 | 220 | 22 | 33 |
| kastoria | 115 | 209 | 18 | 47 |
| xanthi | 104 | 184 | 20 | 25 |
| ptolemaida | 128 | 182 | 12 | 44 |
| skiathos | 135 | 154 | 2 | 10 |
| mesologgi | 109 | 85 | 8 | 30 |
| trikala | 119 | 4 | 0 | 0 |
| yper-xanthi | 111 | 4 | 0 | 0 |

Trikala and the Xanthi suburban site are empty shells. Live arrivals were tested only in
Heraklion. Larissa (3 busiest stops) and Patras (busiest stop) gave 404 after midnight, which
matches "no bus due"; retest them in daytime before work starts.

## 3. Per city

Legend: GTFS = static GTFS feed. Live = live positions or arrivals. Effort: S = config on top of a
citybus adapter that already exists; M = the first citybus adapter, or a new single-city source;
L = no machine source (transcribe timetables or OCR). The first citybus city costs M; each next
one costs S.

| City | Operator | GTFS | Live source | Auth / CORS | Effort |
|---|---|---|---|---|---|
| Patras | Αστικό ΚΤΕΛ Αχαΐας (astikopatras.gr) | No | citybus.gr, agency 112; live not seen (night) | Bearer from page / no CORS | M then S |
| Heraklion | ΚΤΕΛ Αστικών Γραμμών Ηρακλείου | No | citybus.gr, agency 110; **live tested** | same | M then S |
| Larissa | Αστικό ΚΤΕΛ Λάρισας (ktelast-larisas.gr) | No | citybus.gr, agency 102; site says it has telematics ([ktelast-larisas.gr](https://ktelast-larisas.gr/en)); live not seen (night) | same | S |
| Volos | Αστικό ΚΤΕΛ Βόλου (astikovolou.gr) | No | citybus.gr, agency 103 | same | S |
| Ioannina | Αστικό ΚΤΕΛ Ιωαννίνων | No | citybus.gr, agency 106 | same | S |
| Chania | Chania urban buses (chaniabus) | No | citybus.gr, agency 120 | same | S |
| Corfu | Αστικό ΚΤΕΛ Κέρκυρας (blue buses) | No | citybus.gr, agency 101 | same | S |
| Kavala | Αστικό ΚΤΕΛ Καβάλας | No | citybus.gr, agency 123 | same | S |
| Serres | Αστικό ΚΤΕΛ Σερρών | No | citybus.gr, agency 117; also on Moovit ([moovit](https://moovitapp.com/index/en/public_transit-lines-Serres-5439-1159858)) | same | S |
| Katerini | Αστικό ΚΤΕΛ Κατερίνης | No | citybus.gr, agency 118 | same | S |
| Kozani | Αστικό ΚΤΕΛ Κοζάνης ([astikoktelkozanis.gr](https://astikoktelkozanis.gr/)) | No | citybus.gr, agency 121; QR codes at stops open live arrivals | same | S |
| Komotini | Αστικό ΚΤΕΛ Κομοτηνής | No | citybus.gr, agency 105 | same | S |
| Alexandroupoli | Αστικό ΚΤΕΛ Αλεξανδρούπολης (astikoktel.gr) | No | citybus.gr, agency 107 | same | S |
| Trikala | Αστικό ΚΤΕΛ Τρικάλων | No | citybus.gr agency 119 is empty (4 stops, 0 lines); a 2016 article announced an ETA app ([gocar](https://www.gocar.gr/news/feed/32953,Eykoloteres_ginontai_oi_metakinhseis_sta.html)), not checked | n/a | L |
| Rhodes | ΔΕΣ ΡΟΔΑ (municipal) + ΚΤΕΛ Ρόδου | No | none found for RODA: "Rhodes Public Transport" (Dotsoft, MOTIVATE project, [App Store](https://apps.apple.com/us/app/id1451318391)) is a guide; `mobility.rhodes.gr` and `rodabus.gr` pages show no API. KTEL Rhodes has a grbus suburban app (`gr.grbus.suburbantransit.rodos`), not probed | n/a | L |
| Kalamata | municipal urban buses | No | none found; a 2015 municipal leaflet planned live tracking ([kalamata.gr PDF](https://kalamata.gr/images/arthra/2015/03/02-5867/Φυλλάδιο_πληροφόρησης_v3.pdf)) | n/a | L |

Also on citybus.gr (not asked, same effort S): Agrinio, Lamia, Chalkida, Veroia, Drama, Arta,
Mytilene, Chios, Naousa, Kastoria, Xanthi, Ptolemaida, Salamina, Mesolongi, Skiathos.

Other sources found and not used:

- **3pi Information Systems** made "Iraklio City Bus" (iOS, last update 2016, "real-time location
  of buses", [App Store](https://apps.apple.com/lk/app/id1178592388)). Old; citybus.gr replaced
  it. 3pi now makes intercity KTEL e-ticket apps (Chalkidiki, Evros, Kozani, Preveza).
- **HERAKLION GO** (municipality of Heraklion, `com.ktel.goheraklion.android`, under 50 installs,
  [appgoblin](https://appgoblin.info/apps/com.ktel.goheraklion.android)). Not checked.
- **Moovit** lists some cities (for example Serres). It has no open feed for reuse.
- **NAP** `data-nap-gov-gr-information-about-transport-by-long-distance-buses-in-greece`: XLSX
  (2020, 2021, 2023) of intercity KTEL lines, not urban.
- Community clients: see section 2.2.

## 4. Shortlist: the 3 best next cities

All three use the same citybus.gr adapter, so the order is about users and data quality.

1. **Heraklion** (agency 110). Fourth largest municipality, many visitors, 533 stops and 26 lines. The only
   city where live data was seen working (moving bus, countdown). Best proof point for the adapter.
2. **Patras** (agency 112). Third largest municipality, the largest network on the platform (839 stops,
   30 lines, 80 routes). Live not yet seen: confirm in daytime first.
3. **Larissa** (agency 102). Fifth largest municipality, 531 stops, 21 lines; the operator states it runs
   telematics. Live not yet seen: confirm in daytime first.

After these, Volos, Ioannina, Chania and Corfu are config only (effort S each).

### Risks and open points

- The API is undocumented and not meant for third parties. The token is public (it is in the page
  HTML), but we have no permission. Before a public launch, ask e-analysis or the KTELs for a feed
  or for permission, and keep the load low (live calls only for stops on screen, cached for 15-20
  s on the server).
- No whole-fleet call: bus markers on the map need many per-stop calls, or a route-start stop per
  route. Decompiling one app (`gr.citybus.urbantransit.irakleio`) may show a per-line call; not
  done here.
- The schedule has weekdays only, no holiday calendar. Agrinio and Mesolongi have no schedules.
