# Predicted motion along the route between updates

Approved by Harold on 2026-10-05 ("πάμε να κάνουμε και το ένα και το δύο").

## Why

Positions change every ~30 s. Between updates a bus stands still, then glides 200 m. Moving it
along its route at its recent speed makes the map feel live without more requests.

## Rule

For a vehicle with a known variant shape, keep its last two GPS samples as distance along the
shape (`s`, metres) and `position_at`.

- **Projection:** nearest point of the shape. If the vehicle is > 150 m from the shape: no
  prediction. Where the shape passes the same place more than once (loops, out-and-back), pick the
  candidate (within 20 m of the nearest) whose `s` is closest to, and preferably not behind, the
  previous `s`.
- **Speed:** `(s2 − s1) / (t2 − t1)`, only if `0 < t2 − t1 ≤ 120 s`, same variant, and
  `s2 ≥ s1 − 30 m`. Clamped to 0..20 m/s (72 km/h). Backwards → 0.
- **Predicted s at time t:** `s2 + speed · (t − t2)`, at most 90 s of extrapolation, never past the
  next stop (`next_stop_id` projected onto the shape) and never past the shape's end. Buses stop at
  stops, so they wait there for real data.
- No prediction when the GPS age is > 90 s (the marker is already "stale").
- **Display:** every second (the existing tick), each predicted marker moves linearly over 1 s to
  its predicted point. A new GPS sample glides (existing 1.5 s ease) to its new predicted point, so
  corrections are smooth. Teleport rule (> 1 km) unchanged. Hidden tab: no work.
- Heading uses the shape direction at the predicted point (existing `vehicleHeading`).
- The age label still shows the age of the real GPS position.

## Units

- `src/lib/predict.ts` (pure, tested): `projectOnShape(shape, pos, hint?)`, `pointAt(shape, s)`,
  `speedFrom(a, b)`, `predictS(track, nowSec)`.
- `Glider.to(target, ms?, linear?)`: optional duration and linear easing.
- `MapView`: keeps per-marker track state; the per-second effect moves predicted markers.

## Out of scope

Stop dwell times from the schedule, speed per road segment, prediction for vehicles without a shape.

## Verification

Unit tests: projection on straight/loop/out-and-back shapes, speed limits and resets, caps (next stop,
shape end, 90 s, stale). Browser check in mock mode (vehicles move each second, no jumps back when
data arrives) and on prod (real vehicles). Codex review, CodeRabbit, push.

## Changes after Codex plan review

All sample rules live in one pure reducer, `updateTrack(prev, sample, route, nowSec)`:

- **Acceptance:** a sample with `position_at <= prev.at` changes nothing (no marker move, no age
  change). A new trip key (`variant` + `trip_id`) starts a new track.
- **Ambiguity:** projection candidates are local minima within 20 m of the nearest. A first sample
  with candidates more than 50 m apart along the shape is held (no speed) until the next sample.
  Later samples pick the candidate with plausible progress: `s ≥ prev.s − 30 m` and
  `s − prev.s ≤ 20 m/s · dt + 100 m`, the smallest such. None plausible → new track.
- **Noise:** |Δs| < 20 m → speed 0 (standing). A sample older than 60 s on arrival gets no speed.
- **Stops:** stop occurrences are projected in order along the shape (`stopOffsets`). The cap is
  the first occurrence of `next_stop_id` at or ahead of the vehicle, never behind its accepted
  position. Without `next_stop_id`: the shape end. The marker waits at the cap until data moves it.
- **Clock:** extrapolation time is `clamp(now − at, 0, 90 s)`; future timestamps do not move it.
  After 90 s the predicted point stays where it is (no snap back).
- **Animation along the shape:** the marker animates `s` (not coordinates) and draws `pointAt(s)`,
  so it follows bends. One owner per marker: the 1 s prediction step and the 1.5 s correction both go
  through the same scalar glider; each call replaces the previous animation.
- **Heading** while predicted: the shape bearing at the shown `s` (`headingAt`).
- **Mock:** vehicles advance by elapsed time at ~8 m/s along the shape, with `next_stop_id` updated.
