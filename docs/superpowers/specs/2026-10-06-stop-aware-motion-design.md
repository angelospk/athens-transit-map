# Stop-aware motion

Asked by Harold on 2026-10-06, after `docs/research/realistic-motion.md`. Model chosen with the
motion lab (`lab/motion/`, results in its `program.md` log).

## What was wrong

- The guess stopped at the next stop (`capS`, and the backend `path` ends there) and its speed
  faded with a 60 s time constant. Real buses pass that stop well before the next fix (~66-100 s
  later), so the guess was behind in 75% of cases: median 190-240 m.
- A new fix (already 20-70 s old) put the target far ahead, and `chase` closed the gap with a 2.5 s
  time constant at up to +10 m/s: the "it runs after new data" burst.
- Vehicles without a measured speed (39% of the city) stood still.

## New model (`drive` in `src/lib/motion.ts`, pure)

- Mean speed, stops included, = `PACE` (0.85) × the measured speed. A bit slow on purpose: a late
  catch-up looks better than a backward correction (Harold: "a bit slower").
- The bus cruises, brakes at 1 m/s² into each stop ahead, waits `DWELL_S` (15 s), pulls away at
  1 m/s². The cruise speed is chosen so that cruise + one wait over the typical stop gap (mean of
  the next ≤ 4 gaps, else 400 m) gives the mean speed; at most 15 m/s. A stop too close to brake
  gently: brake harder.
- It stands at the end of its geometry and after `HORIZON_S` (180 s) from the fix.
- No measured speed: `NO_SPEED` (1.5 m/s), except a held first sample (ambiguous loop leg) and a
  vehicle measured standing (speed 0): those stand.
- Line markers (`predictS`): the route's stops beyond 15 m ahead of the fix. City layer
  (`pathPlan`): the backend `path`, its end as the last stop, plus `path_stops` (contract rev 4,
  optional) when the backend sends them.
- `chase`: `TAU_S` 2.5 → 10 s, `CATCH_MAX` 10 → 6 m/s. A gap closes calmly; a bus at 4 m/s shows
  at most 10 m/s (36 km/h) while catching up.

## Measured (lab, 2026-10-06 11:19-11:59, test split: data not used for tuning)

| | score | \|e\| p50 | bias | ahead > 50 m | jump p50 |
|---|---|---|---|---|---|
| before | 343 | 225 m | −222 m | 3% | 289 m |
| line markers (all stops) | 236 | 122 m | −52 m | 21% | 144 m |
| city, path to the next stop (backend rev 3) | 310 | 183 m | −159 m | 11% | 256 m |
| city, path to 3 stops (backend rev 4) | 239 | 122 m | −43 m | 22% | 147 m |

Trade-off: the guess is now ahead of the bus more often (21% vs 3% beyond 50 m), so there are a
few more small backward corrections; the median error halves.

## Verification

Unit tests (`drive`: mean speed, wait at stops, monotone, end/horizon, close stop; `predictS`;
`pathPlan` with stops; fleet: no speed moves slowly). The lab scores the shipped `drive` itself
(`SHIP` rows). Browser check with mock data.
