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
with the horizon. A bus stays in a stop's list until it passes, so a pred's pass must come
before 5 min after the last time that bus was listed (a later pass is its next lap).
`phantom`: no pass seen in that window, which also counts a pass the GPS missed.
`unresolved`: the data ends before the answer is known.

A bus that waits inside 40 m for 2 min or more (a terminus) passes when it leaves, because
the prediction there is the departure. Termini are still noisy: a parked bus drifts in and
out of the 40 m circle, so score them apart (ΠΕΙΡΑΙΑΣ 10183 is one).

Caveats: the stop coordinates come from the API, not GTFS, and a fix is a GPS point up to 30 s
old, so a pass can be off by tens of seconds on its own. Vehicles predicted before the sampler
started have no fixes; a bus that passes with no fix nearby (a tunnel, a gap) reads as phantom.

## Weekly publish (web#27)

`lab/eta/publish.sh` scores the last 7 complete days without termini and pushes `v1/latest.json` to the
`eta` branch; the ⓘ sheet (`src/lib/eta-accuracy.ts`) reads it from raw.githubusercontent.com. Only the
buckets under 20′ are published. It runs from the mini PC as the systemd user timer `eta-publish`
(Mondays 06:00), from the `~/athens-transit-map` checkout.
