# Multimodal planning and the weekly schedule (research, 2026-10-29)

## 1. A ready-made multimodal planner

### Transitous (hosted MOTIS)

- Free public MOTIS 2 instance (`https://api.transitous.org/api/v5/plan`, `/api/v1/stoptimes`).
  Best effort, volunteer-run, for FOSS and non-profit use; ask before heavy use, send a
  descriptive User-Agent, cache results (https://transitous.org/api/).
- Probe on 2026-10-29: a plan Syntagma → Marousi at 10:00 local returned 0 itineraries,
  and `stoptimes` within 300 m of Syntagma returned none. Transitous has no Athens transit
  data now. The OASA GTFS on the Mobility Database is old (2016–2017 entries), and the
  current OASA GTFS expired on 2026-10-06.
- Verdict: not usable for Athens today. Usable only if someone adds a current Athens
  feed to the Transitous feed repository (JSON definitions in their Git repo).

### Self-hosted MOTIS 2 or OpenTripPlanner 2

- Both take GTFS + an OSM extract and answer multimodal plans (walk + bus + metro + tram +
  suburban, transfers, real walking paths instead of straight lines).
- MOTIS 2: one binary, small memory, GPU optional; good fit for the Thessaloniki VPS or the
  mini PC. OTP 2: Java, more memory (Attica OSM + GTFS: a few GB).
- Inputs needed: OASA bus GTFS (expired; would need the backend's daily schedule exported
  as GTFS), STASY metro/tram GTFS, Hellenic Train suburban GTFS, Attica OSM extract.
- GTFS-RT from the backend (vehicle positions, trip updates) could feed MOTIS for live plans.

### Recommendation

1. Short term: keep the in-app planner (buses, straight-line walking, radii up to 1.5 km).
2. Medium term: self-host MOTIS 2 next to the backend, fed by a GTFS that the backend builds
   from the OASA daily schedule (section 2) plus the STASY and suburban feeds. The app calls
   its `/plan` endpoint for "multimodal" trips and keeps its own planner as fallback.
3. Contribute the same feeds to Transitous later; then the hosted API works too.

## 2. The weekly schedule as the main source

Backend facts (athens-transit-rt):

- `telematics.DailySchedule` reads OASA `getDailySchedule`: first departures of a line for today only.
- `prefetchDaily` (`internal/server/prefetch.go`) fetches it for all lines every day from 03:00.
- `/v1/lines/{id}/schedule` answers with source `oasa-daily`, else `gtfs`.
- Comparisons (`stats/trips.go` `NewPlan`, `runStarts` in `starts.go`) use the GTFS plan. With the
  GTFS expired, they use the same weekday of the old feed and set the `Expired` flag
  (the app shows «Παλιό πρόγραμμα»).
- OASA also has `getSchedLines` / `getScheduleDaysMasterline` (per day type, start and end
  times): a weekly fetch is possible.

Proposal (for the backend v2 thread; not done here, the backend auto-deploys from main):

1. Archive each day's `oasa-daily` answer (per line, per date) in the backend store.
2. Fetch the week's day types once a week (`getScheduleDaysMasterline` + `getSchedLines`) so the
   plan for any date of the week is known before 03:00.
3. Make the daily/weekly OASA plan the primary plan for `NewPlan` and `runStarts`; GTFS only as a
   fallback when OASA has no answer for a line.
4. Store the source with each comparison result (`oasa-daily` / `oasa-weekly` / `gtfs` /
   `gtfs-expired`) so the stats can tell comparable days apart.
5. Export the same plan as GTFS (stops and shapes from the old feed) for MOTIS (section 1).
