# Stop audit: where buses really stop (web#31)

Some OASA GTFS stops are 10-80 m away from where the pole stands. This lab measures, for each stop,
where buses halt near it in the recorded GPS history, and compares that with the GTFS position.
The measurement never moves a stop; it feeds the correction rule of «Λάθος θέση;» (below).

## Run

```
bun lab/stops/run.ts <history dir> [static cache dir]           # ~30 s, ~6 GB RAM for 3 weeks
OSM=<overpass bus stops json> bun lab/stops/run.ts <history dir>  # adds the OSM check
```

- History: the backend's `--history` hourly CSVs (fix time, line, vehicle, lat/lon, trip, shape, metres along).
  The 2026-10-06..2026-10-29 files are in the stopped mini PC volume `atrt_atrt-state` (`history/`); copy them
  out with `docker run --rm -v atrt_atrt-state:/s -v <dir>:/o alpine cp -r /s/history /o/`.
- Static: lines, variants (shapes) and stops from the backend's static files, cached in the cache dir.
  The history must be of the same GTFS version (the run counts `wrongVersion`).
- OSM bus stops (independent positions, mapped by hand; `ref` = GTFS stop id), one Overpass query:
  `[out:json];(node["highway"="bus_stop"](37.80,23.55,38.20,24.05);node["public_transport"="platform"]["bus"="yes"](37.80,23.55,38.20,24.05););out;`
  OSM data © OpenStreetMap contributors, ODbL.

Outputs (in git): `measured.csv` (every measured stop) and `suspect-stops.csv` (the suspects, OSM-confirmed first).
`DUMP=<id,id>` writes those stops' samples to `samples.json` next to the history dir, for a look by hand.

## Method

1. Each variant's stops are placed on its shape in route order (`projectStops`: least total distance with no
   stop before the one ahead of it; the nearest point alone puts a loop's first stop at the end).
2. Every fix is placed on its own variant's shape near the backend's metres-along. A fix counts for a stop
   when it falls in the stop's window: half the way to the stops before and after, 20-80 m (a stop on several variants: the narrowest). The other
   direction's twin stop, the far side of a loop, and the first and last stops (layovers) never count.
3. Density, not halts: fixes come every 27-229 s (p10-p90, median 61 s), so two fixes in one 20 s dwell are
   rare (a first try with "two fixes within 8 m" found ~3 halts per 1,200 passes). A bus that stops spends
   more time there, so its fixes pile up at the halt. At most 3 fixes per trip and stop: a broken-down bus
   must not outweigh a hundred passes.
4. `measure`: the peak of the samples' density (Gaussian, σ 5 m) in the window; `along` = mean of the samples
   within 12 m of the peak (+ = buses halt after the GTFS stop); the halt point = their median position.
   Confidence **high**: ≥15 samples in the peak, ≥40 % of the window, no other peak above half of it, and
   the even and the odd days put the peak within 10 m of each other. **medium**: ≥6 and no other peak
   above 0.8.
5. Fleet bias: the median `along` of high stops, +3.2 m (the GPS unit is not at the front door). Offsets
   are compared after it.
6. **Suspect**: high, the peak not within 10 m of the window's end (a queue beyond it), |along − bias| ≥ 20 m,
   and the density at the GTFS position below 35 % of the peak (buses do not halt where GTFS says).
7. OSM check of each suspect: `agrees` (the OSM stop is within 12 m of the GPS halt point), `gtfs` (OSM is
   within 10 m of the GTFS position), `other`, `none` (no OSM stop with that ref).

## Results (history 2026-10-06T09 to 2026-10-29T00, GTFS 2026-07-08)

- 9,912,559 fixes, 540 hours; 8,040 stops, 7,729 measured. Confidence: 1,632 high, 4,372 medium, 1,725 low.
- High stops, |along − bias|: median 12.4 m, p90 55 m; 914 ≥10 m, 608 ≥20 m, 431 ≥30 m.
- Check against OSM (671 high stops that have an OSM stop), metres along the route: the GPS peak is 4.3 m
  from OSM (median), the GTFS position 10.0 m. GPS nearer to OSM by 5+ m: 298 stops; GTFS nearer: 112.
- **532 suspects**: 125 OSM confirms (`agrees`), 32 OSM puts at the GTFS position (`gtfs`), 54 elsewhere, 321
  have no OSM stop.

### Hand check (satellite, Esri World Imagery, with GTFS, GPS and OSM marked), 10 suspects

| Stop | OSM | Verdict |
|---|---|---|
| 320019 ΜΑΝΟΥ (218) | agrees | GTFS on the parallel street one block north; real error |
| 420156 ΓΥΜΝΑΣΙΟ (730, 821) | agrees | GTFS inside a building block, 28 m back; real |
| 530078 ΔΡΑΓΑΤΣΑΝΙΟΥ (120, 171) | agrees | GTFS in a garden off the road, 51 m back; real |
| 160305 ΑΙΔΙΝΙΟΥ (205) | agrees | 24 m back on the same kerb; plausible |
| 130325 ΠΙΝΔΟΥ (755) | gtfs | GPS peak 22 m ahead mid-block; unclear |
| 530109 ΝΗΡΕΩΣ (162, Α1, Α2) | gtfs | GPS peak where the street meets the avenue: junction queue |
| 10883 4η ΛΑΚΑΣ (123) | none | junction |
| 820009 13η ΒΑΡΥΜΠΟΜΠΗΣ (503, 537) | none | junction with the main road |
| 190002 ΣΟΦΟΚΛΕΟΥΣ (862) | none | junction |
| 470091 ΠΕΡΡΑΙΒΟΥ (803) | other | junction at the end of the street |

So: the 125 OSM-confirmed suspects are the list worth sending on (4/4 checked look real). The other 407 are
mostly queues at junctions and stop signs; they need a human look (or user reports) before anyone trusts them.
A filter by distance to OSM junctions did not separate them (at 15 m it kept 67 % of `agrees` and 50 % of `gtfs`).

## Corrections

Nothing moves on its own. `scripts/stopfix.ts [feedback.csv]` proposes corrections; a person pastes the ones
they accept into `scripts/stop-corrections.json`, runs `bun scripts/trips.ts` and commits. The rule is
`decideCorrection` in `src/lib/stopfix.ts` (tests: `tests/stopfix.test.ts`):

- Reports: one per device per stop (the latest); none beyond 80 m from the stop.
- GPS alone moves a stop only for an OSM-confirmed suspect (`gpsFromAudit`), to the halt point, or to the
  reports within 20 m of it when there are any. Unconfirmed suspects count as medium: they cannot move a
  stop, but can refuse reports.
- Otherwise 3+ devices whose reports lie within 15 m of each other move it to their median, unless a
  high or medium GPS measurement puts the halts nearer the current position, or more than 30 m from them.
- Moves under 5 m are dropped.

Limits: the device id is made by the page, so one person can pose as several devices. Proposals based on
reports alone say so in their note and need a look on the satellite map before they are committed. The
Cloudflare Turnstile bot check (optional, `docs/feedback/README.md`) fills the Sheet's "Verified" column;
`sheetReportRows` reads it, and a proposal that rests on an unverified report is CHECK BY HAND too. It proves
a person, not three people, so reports alone stay CHECK BY HAND.

On 2026-11-04 the 125 OSM-confirmed suspects went into `scripts/stop-corrections.json` (basis `gps`, no
reports yet); the same list for OASA is `docs/stops-for-oasa.csv`.
