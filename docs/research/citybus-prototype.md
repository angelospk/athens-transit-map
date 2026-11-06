# citybus.gr prototype: Heraklion and Patras on staseis.gr (2026-11-06)

Follow-up to `greek-cities.md`. Harold asked for a working, low-load prototype on the mini PC for
1-2 cities, before any PR. This note says what runs, what it shows, what it cannot do, and what
needs a decision. Facts are tested on 2026-11-06 between 00:40 and 01:30 Athens time (night: few
buses), unless marked otherwise.

## 1. What runs now

| Part | Where | State |
|---|---|---|
| `citybus-bridge` (Bun, TypeScript) | `~/citybus-bridge` on the mini PC, local git d7cafae (not on GitHub) | user service `citybus-bridge`, `127.0.0.1:8102`, tailnet only: `https://minipc.tail11f3d4.ts.net:10446/<city>/...` |
| Web branch | `feat/citybus-cities` (on top of `feat/thessaloniki-live`, PR #44), worktree `~/atm-citybus` | pushed (bb96e98), no PR |
| Preview | build of that branch, `https://minipc.tail11f3d4.ts.net:10447/?city=heraklion` (or `?city=patras`) | tailnet only; needs Tailscale on the device |

The bridge speaks the athens-transit-rt contract (`/v1/status`, `/v1/vehicles/tiles`, `/v1/lines/{id}`,
`/v1/lines/{id}/schedule`, `/v1/stops/{id}`, `/v2/lines`, `/v2/stops`, `/v2/lines/{id}`,
`/v2/lines/{id}/vehicles`, `/v2/stops/{id}`, `/v2/runs/{id}`, `/static/v1/...`). So the web needs
no new data code: a citybus city is one more city with its own API base, as Thessaloniki in PR #44.
Adding a city on the platform is one line in the bridge (`CONFS` in `src/server.ts`: id, subdomain,
agency code) and one entry in the web (`src/lib/cities.ts`, `src/lib/tiles.ts`).

## 2. How the live part works

citybus.gr has no call that lists all buses. A stop board (`stops/live/{code}`) lists the buses on
their way to that stop, with their position and minutes to the stop. The bridge:

1. Picks "probe" stops: for each route one stop near the middle and one 2-3 stops before the end;
   one stop that serves several routes counts once. Heraklion: 55 probes for 97 routes. Patras: 61
   for 80.
2. Reads them in turn, forever, at one request per second for the whole process (both cities).
   One full turn took 115 s (Heraklion) and 128 s (Patras), because the two cities share the 1 req/s.
3. Keeps the newest sighting of each bus. Between sightings it moves the bus on along the route
   shape at the speed that "metres to the stop / seconds to the stop" gives (2-15 m/s), never past
   that stop. A bus moved more than 30 m from its last sighting is `position.kind: "estimate"`.
4. Puts user demand first: a stop card asks citybus.gr at once (then cached 15 s), and a line whose
   vehicles a user opens is "watched" for 10 min, so its probe stops are read before the rotation.

The positions in a board are real coordinates: on Heraklion stop 1235 the bus of line 01 moved from
35.33821,25.12943 to 35.33709,25.13079 in 60 s while its minutes went down (see `greek-cities.md`
2.1). The web marks them as approximate anyway, because a sighting can be up to ~2 min old.

## 3. What the web shows (headless Chromium, 390 px, 2026-11-06 01:10-01:30)

- City picker: Αθήνα, Θεσσαλονίκη, Ηράκλειο, Πάτρα. The two new cities say «Αστικό ΚΤΕΛ · θέσεις
  κατά προσέγγιση». They exist only in a build with `VITE_API_BASE_CITYBUS`; production is unchanged
  (test `tests/city-bases.test.ts`).
- Heraklion map: buses of the night line 01 as dots; line 01 selected: its routes and 2 buses
  moving. Search finds Heraklion lines and stops. Stop card «ΑΝΑΛΗΨΗ»: «01 → ΑΕΡΟΔΡΟΜΙΟ ~3′, μετά
  ~17′», the other 6 lines under «Χωρίς λεωφορείο κοντά τώρα», and the source line «Από τις αφίξεις
  του Αστικού ΚΤΕΛ (citybus.gr), κατά προσέγγιση». Vehicle card: «≈ θέση», «θέση και ώρες κατά
  προσέγγιση, από τις αφίξεις στις στάσεις», minutes to each of the next 8 stops, and no arrival-alert
  bells (alerts need the Athens stop index and the push service).
- Patras: the page, lines and stops load; no bus (no night service). Live data in Patras is not yet
  seen: check it in daytime (section 6).
- The page calls only the bridge for transit data (no call to transit.haroldpoi.dev).
- Daytime coverage, 2026-11-06 08:08 Athens: lines with a trip running by the timetable vs lines with
  a bus on the map. Heraklion: 12 of 15 lines seen, 34 buses (not seen: 91, 92, 93; line 50 one bus
  of 3). Patras: 19 of 21 lines seen, 49 buses (not seen: 606, 803). Cause, checked at 09:20:
  91, 92 and 93 (the red, blue and green centre lines) have no live row on any citybus.gr board,
  only timetable times, so they send no position. 50, 606 and 803 are school runs (only morning
  and noon trips); they had ended by 09:20, so whether they send positions is still open.

Timetable: the bridge has every trip of every route per weekday (`trips/route`), so stop cards also
show the scheduled runs that no live bus covers, `/v1/lines/{id}/schedule` gives the day's
departures, and `/v2/runs/{id}` gives a run's stop times. Trips after midnight (24:10) and the first
runs of tomorrow before midnight are handled.

Tests: bridge `bun test` 16/16 (model, loops, midnight, stale boards, motion cap, token sharing,
pacer, failed static answers; 4 of them fail on the code before the review fixes); web `bun run test` 963/963, `bun run check` 0 errors, `bun run build` OK. Codex review: two
rounds (section 8).

## 4. Load on citybus.gr

- Static data: about 2 requests per route plus 2 per city, once a day (Heraklion ~220, Patras ~190),
  cached on disk (`~/.local/state/citybus-bridge/<city>/static.json`, 57 and 75 MB of raw rows).
- Live: 1 request per second in all, about 3,600 per hour, whatever the number of users. More users
  add at most one request per opened stop per 15 s, inside the same 1 req/s queue.
- The page token: one page read per city per 6 h (and again on a 401).

## 5. Limits: what cannot be done (now)

| Limit | Why | Way out |
|---|---|---|
| Bus positions up to ~2 min old, moved by estimate | no fleet call; 1 req/s for 116 probe stops | e-analysis gives a fleet or per-line call (email, section 7), or a higher rate (their permission) |
| Heraklion 91, 92, 93: no live buses | citybus.gr itself has no live rows for them (timetable only) | none; the stop card shows their timetable |
| School runs (Heraklion 50, Patras 606, 803): not seen at 08:08 | not known: no GPS, or the runs did not run | check their boards during a school run (about 13:00). Checked at 13:10 on 2026-11-06: the Patras 606 school return run (route 6063, 13:00-13:26) had no vehicle on the map and only timetable rows (no live row) at the 3 stops still ahead (676, 6075, 484), so that school run sends no position to citybus.gr; Heraklion 50 had no run in progress (next at 13:30), and the Patras 803 run (route 8031) had ended at 13:09, so those two stay unchecked. Checked again on 2026-11-06: at 13:40 the two Heraklion 50 school runs in progress (route 3003, 13:30 and 13:31) had no vehicle on the map and only timetable rows at 3 stops still ahead (1409, 1416, 3004), while line 20 showed live rows at stop 1416, so that school run sends no position; at 14:25 the Patras 803 school return run (route 8033, 14:15) was on the map and had live rows at 3 stops still ahead (553, 556, 863), so that school run does send positions (its live ETA at 863 was 14:41 against 15:00 in the timetable). |
| No fleet numbers; the vehicle card shows a trip key (`#20261106_31018_…`) | citybus `vehicleCode` is a trip key | hide the id for citybus cities (small web change) |
| No delay («χωρίς δρομολόγιο») | live buses are not matched to timetable runs | match by route and time (bridge work, M) |
| Timetable per weekday only; no public holidays | the API has days 0-6, no dates | holiday table, as athens-transit-rt has |
| No stops on the map, an empty «Κοντά σου» list and no arrival alerts outside Athens; place search shows Athens places | these use Athens-only data (`trips.json`, Athens geocoding) | per-city stop index from `/v2/stops` (also needed for Thessaloniki, PR #44) |
| Agrinio and Mesolongi: no timetables; Trikala and Xanthi suburban: empty | data on citybus.gr | none |
| Rhodes, Kalamata | not on citybus.gr, no other source found | none |
| Heraklion lines 08 and 52 | no route in citybus.gr | none |

Every other city on citybus.gr (28 in `greek-cities.md` 2.3) works with the same code: add its line
to `CONFS` and its entry to `cities.ts`/`tiles.ts`. Each city costs ~2 req per route once a day,
and its probes share the same 1 req/s, so each new city makes the rotation of all cities slower.
With 1 req/s, 2-3 cities are the useful limit.

## 6. Waits for Harold (one place)

1. **Look at it yourself**: open the preview on a device with Tailscale, `?city=patras` and
   `?city=heraklion`, and select 2-3 busy lines. (The coverage numbers in section 3 are measured.)
2. **Send the email to e-analysis** (draft below), or decide not to ask. Public use without an answer
   is a risk: the API has no published terms (`greek-cities.md` 2.1).
3. **Decide the production path** after PR #44 is merged:
   - (a) deploy `citybus-bridge` as it is, as a small service (citybus.gr answers from the Oracle VPS
     in Germany too: HTTP 200 in 0.5 s, tested 2026-11-06), or
   - (b) port it into athens-transit-rt as a third city kind (Go, one binary, PR + review).
   (a) is faster; (b) keeps one backend.
4. **The bridge repo**: it lives only on the mini PC (`~/citybus-bridge`, local git). Say whether it
   becomes a GitHub repo, or goes into athens-transit-rt.

### Email draft (to info@e-analysis.eu; replace `<όνομα>`)

```text
Θέμα: staseis.gr: δεδομένα του citybus.gr για τα αστικά ΚΤΕΛ

Καλησπέρα σας,

Λέγομαι <όνομα> και φτιάχνω το staseis.gr, έναν χάρτη που δείχνει σε πραγματικό χρόνο τα λεωφορεία της Αθήνας και της Θεσσαλονίκης. Θα θέλαμε να προσθέσουμε και πόλεις που εξυπηρετεί το citybus.gr, πρώτα το Ηράκλειο και την Πάτρα.

Οι σελίδες στάσεων (π.χ. irakleio.citybus.gr) παίρνουν τα δεδομένα τους από το rest.citybus.gr. Έχουμε στήσει μια δοκιμαστική έκδοση, μόνο για εσωτερική χρήση, που διαβάζει από εκεί στάσεις, γραμμές, δρομολόγια και αφίξεις. Κάνει περίπου ένα αίτημα το δευτερόλεπτο συνολικά και κρατά cache. Πριν τη δείξουμε δημόσια, θέλουμε τη συγκατάθεσή σας.

Θα ήθελα να σας ρωτήσω:
1. Μπορούμε να χρησιμοποιούμε αυτά τα δεδομένα στο staseis.gr, με αναφορά στο citybus.gr και στο αντίστοιχο ΚΤΕΛ;
2. Υπάρχει επίσημο feed (GTFS ή GTFS-Realtime) ή κλειδί API που θα προτιμούσατε να χρησιμοποιούμε;
3. Υπάρχει κλήση που δίνει όλα τα οχήματα μιας πόλης; Τώρα ρωτάμε τις στάσεις μία μία, και αυτό φορτώνει περισσότερο τον server σας.
4. Υπάρχει όριο αιτημάτων που πρέπει να τηρούμε;

Αν σας είναι χρήσιμο, μπορούμε να σας στέλνουμε όσα μαθαίνουμε, για παράδειγμα στάσεις που οι χρήστες αναφέρουν σε λάθος θέση.

Ευχαριστώ πολύ,
<όνομα>
staseis.gr · github.com/angelospk
```

## 7. Later (not started)

- Match live buses to timetable runs: delays, run cards with live times, `next_stop` from the run.
- A per-city stop index for the map and «Κοντά σου» (shared with Thessaloniki).
- Decompile one citybus app (`gr.citybus.urbantransit.irakleio`) to look for a per-line or fleet
  call that the web pages do not use.
- Measure ETA accuracy against later sightings, as eta-lab does for Athens.
- Publish a GTFS per city (a community generator already exists: `greek-cities.md` 2.2), only after
  e-analysis agrees.

## 8. Review

- Codex round 1: REVISE, 13 important findings. Fixed 12. Declined 1: warming-up bodies without
  their main field; the web already treats such a body as a 503 and does not cache it (`v2Get` in
  `src/lib/api.ts`).
- Codex round 2 (last): 8 fixes confirmed, 4 not complete, 1 new regression. All 5 fixed after the
  round, with tests: the daily reload now waits 1 h after a failure and runs before the empty-probe
  wait; a bus on a route that passes a point twice takes the pass whose distance fits its minutes;
  arrivals due in the past are dropped; a failed trips/points answer keeps the old one and more than
  10% routes without a stop order fail the load. Not reviewed again (2-round cap).
- CodeRabbit, bridge: 2 minor findings, both fixed (DST-safe day starts; atomic `static.json`, an
  unreadable one is loaded again). Web: 1 major (no stop index outside Athens: «Κοντά σου» and bus
  alerts): bells hidden in citybus cities, the stop index stays a follow-up (section 5). 1 minor
  declined: the env-dependent test in `tests/city-bases.test.ts` (nit; CI sets no citybus env).
