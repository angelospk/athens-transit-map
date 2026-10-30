# ETA accuracy lab

Measures how close the live arrival prediction (`at`) is to when the bus really passes the stop.
A pred is scored against the vehicle's GPS fixes: a fix inside 40 m of the stop, or the crossing of
the leg whose ends add up to about its length, is a pass. `error = predicted − actual` (negative = early).

```sh
bun lab/eta/sample.ts data/eta      # runs forever: 6 stops every 60 s, vehicles every 30 s
bun lab/eta/score.ts data/eta       # table + data/eta/report.json, all days
bun lab/eta/score.ts data/eta 2026-10-29 2026-10-30
bunx vitest run tests/eta-lab.test.ts
```

Buckets are by the real time to arrival (0-5′, 5-10′, 10-20′, 20′+), because the error grows
with the horizon. `phantom`: no pass within 90 min of the prediction. `unresolved`: the data
ends before the answer is known, so the first hour of a run is mostly this.

Caveats: the stop coordinates come from the API, not GTFS, and a fix is a GPS point up to 30 s
old, so a pass can be off by tens of seconds on its own. Vehicles predicted before the sampler
started have no fixes; a bus that passes with no fix nearby (a tunnel, a gap) reads as phantom.
