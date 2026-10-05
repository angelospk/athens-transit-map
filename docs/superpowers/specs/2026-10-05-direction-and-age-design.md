# Direction arrows, direction focus, per-vehicle position age

Approved by Harold on 2026-10-05 (options 1 + 2, age display "α": per vehicle).

## Why

At a stop you need to know which way a bus is going. Today an outbound and an inbound route
overlap on the same street and look identical, and a vehicle pill does not show its heading.
Users also cannot see how old each vehicle's GPS position is without opening its card.

## Data facts

- `variants[*].direction` is `0` for every 040 variant, so it cannot split directions.
  A direction is defined by the **last stop** of a variant (`variants[*].stops`, ordered).
- `bearing` is often `null` (all of line 2 in the fixtures). Shapes are ordered in travel direction.

## Features

1. **Arrows on routes.** A symbol layer (`symbol-placement: "line"`, spacing ~120 px) draws a
   canvas-generated arrow along each variant shape, pointing in travel direction. Every route line
   gets `line-offset: 3` (px, to the right of travel), and the arrows get the same offset via
   `icon-offset`, so outbound and inbound on one street show as two lanes.
2. **Vehicle heading.** A small triangle outside the pill points in the vehicle's heading.
   Heading, first that applies: finite `bearing`; else the bearing of the nearest segment of its
   variant shape if the vehicle is within 150 m of it (if several segments are within 20 m of the
   nearest, pick the one closest to the last movement, for circular routes); else the direction of
   the last movement if it moved ≥ 15 m; else no triangle.
3. **Direction focus.** Variants of a line are grouped by last stop ("→ ΣΥΝΤΑΓΜΑ"). If a line has
   ≥ 2 groups, the route card shows one button per group plus "Όλες". Focus hides the other groups'
   shapes and vehicles of that line; vehicles with `variant: null` stay, faded. The panel shows
   "040: μόνο → ΣΥΝΤΑΓΜΑ ×" to reset. Focus is cleared when the line is removed. Not in the URL
   (variant ids change with each GTFS).
4. **Position age per vehicle.** A small label under each pill: "24″" under 60 s, else "2′",
   from `serverNow − position_at` (clock-corrected), updated every second. Over 90 s the marker is
   faded (`stale`).

## Units (all pure, tested)

- `src/lib/heading.ts`: `bearingDeg(a, b)`, `vehicleHeading(v, shape, prev)`.
- `src/lib/format.ts`: `ageLabel(sec)`, `STALE_POS_S = 90`.
- `src/lib/directions.ts`: `directionGroups(lineStatic)`, `isHidden(vehicle, focusVariants)`.
- `src/lib/map/layers.ts`: `routesFC` gets an optional per-line set of visible variants.

MapView owns the arrow image, layers and marker DOM; AppState owns `focus`.

## Out of scope

Stops search/QR/arrivals (needs a backend `stops.json`), interpolation from history.

## Verification

Unit tests for the pure units above. Browser check (mock mode, 360×740 and desktop): arrows
visible and pointing along the route, two lanes on shared streets, heading triangles, age labels
tick, focus hides the other direction and resets. Then Codex review, CodeRabbit, push.

## Changes after Codex plan review

- Heading "last movement" uses the previous GPS sample (newer `position_at`, different
  position), not the gliding position; reset on variant change or a jump > 1 km. Where a route
  runs both ways along a street (near segments differ > 90°) and there is no movement: no triangle.
- Focus also drives the selection: a hidden vehicle has no card or highlight; a route selection
  moves to the focused direction. Focus is cleared on manual and on 404 removal. Variants missing
  from static data count as unknown (visible, dashed border), like `variant: null`.
- Arrow image registered as `route-arrow` (the OpenFreeMap style already has `arrow`), right-pointing,
  `icon-keep-upright: false`, `icon-size` 1 so `icon-offset` equals `line-offset` in px.
- Age labels have their own per-second effect that only touches text and the `stale` class; it never
  calls the glider. Stale is strictly `> 90 s`; minutes are floored.
- Group labels add the headsign when two directions end at stops with the same name.
- Rejected: a picker for overlapping route taps (focus covers it) and live theme switching (theme is
  chosen at load, as before).
