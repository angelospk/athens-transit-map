# Natural motion, direction chips, my location

Asked by Harold on 2026-10-06.

## 1. Motion that never jumps (`src/lib/motion.ts`, pure)

What broke: DOM markers moved in 1 s linear steps started by a 1 s `setInterval` (stop-and-go
when the timer drifts, a pause after each 1.5 s correction); corrections slid backwards (looks like
reversing); the city layer drew at 1 Hz and blended in straight lines (cuts corners).

New model, the same for DOM markers, the city layer and the user's dot:

- A **plan**: a polyline (`geom`, lon/lat, with cumulative metres) and `target(t)`: metres along it
  where the vehicle should be at server time t. DOM markers on a line: the route shape and
  `predictS(track, t)`. City: the backend `path` and `speed · clamp(t − position_at, 0, 150 s)`.
- The shown position `s` **chases** the target each frame:
  - target ahead (`gap ≥ 0`): move at `v + min(gap / 2.5 s, 10 m/s)`, `v` = target speed. A late
    bus speeds up smoothly, at most +36 km/h, never overshoots.
  - target behind by at most `hold = clamp(8 s · v, 25 m, 80 m)`: slow down (`v · (1 − ahead/hold)`)
    and let the target catch up. Never moves backwards.
  - target behind by more, or ahead by more than 600 m: a **correction effect** (0.9 s): the marker
    dissolves where it is (fade, blur, grow), reappears at the right place (unblur) with a ring
    pulse. It says "we fixed this", instead of a fake reverse drive.
- New data for the same geometry keeps `s` (no reset). New geometry: project the shown point onto
  it; near it (≤ 30 m): continue from there, the small sideways offset fades over 1.2 s. Behind the
  new path's start: prepend the shown point to the path and chase. Otherwise: ≤ 40 m straight
  glide, else the correction effect. No geometry (no shape / no path): glide on the straight
  segment to the fix; with a known bearing, a fix more than 110° behind and > 25 m away is a
  correction effect.
- Frame loop (one `requestAnimationFrame` loop for everything): runs at the rate that keeps each
  step under ~0.35 px (`interval = 0.35 px · metres-per-pixel / 12 m/s`, 1/60 s..1 s), 30 fps while an
  effect runs (zoom ≥ 13). From zoom 13 the city source gets only vehicles in view. Hidden tab:
  no work; on return everything snaps to its target (no effect).
- Effects: DOM markers use a CSS keyframe class (`opacity`, `filter: blur`, `scale`; the ring is a
  `::after`), compositor-friendly, no Svelte component per marker. City: per-feature `fade` and
  `ring` properties drive `circle-blur`, opacity and radius, plus a ring layer.

## 2. Direction chips

- Vehicle card: a "Κατεύθυνση" chip row: Όλες / → A / → B, the vehicle's own direction marked.
  Picking the other direction shows that direction (route card for it).
- Panel pill "040: μόνο → A": a ⇄ button switches to the other direction when the line has two.

## 3. My location

- Button under the zoom control. Off → locate, fly to zoom ≥ 15.5, follow. Following → off.
  On but not following (user dragged the map) → recentre and follow.
- Adaptive polling with `getCurrentPosition` (high accuracy), pure rule `nextInterval`:
  ≥ 2 m/s: 5 s; ≥ 0.6 m/s: 10 s; standing: 15, 20, then 30 s; accuracy worse than 100 m: at most
  10 s. Speed from `coords.speed`, else from two fixes moved further than their accuracy.
  Hidden tab: paused. Denied: off, with a notice. Timeout/unavailable: retry in 30 s.
- The dot: a DOM marker (blue, white ring, heading cone when moving) and an accuracy circle (map
  metres). Between fixes it moves on at the measured speed and heading for at most 10 s, then waits;
  corrections chase like vehicles (backwards: the correction effect).
- Turned on before and permission still granted (Permissions API): starts again on load,
  without the fly-to.

## Verification

Unit tests: chase rules (ahead, hold, behind → effect, far → effect, no overshoot, hidden snap),
plan handoff (same geometry keeps s, new path projection, prepend, line fallback), effect phases,
`nextInterval`, locator polling (fake geolocation and timers: intervals, pause when hidden, denied),
user motion. Browser check with headless Chromium (mock data, fake geolocation). Codex review,
CodeRabbit, push.

## Changes during the work

- Harold saw a vehicle jump when he clicked it (the line's markers started from the raw fix, not
  from where the city layer showed it) and again on close. Now one `Mover` per vehicle is shared by
  both renderers (`src/lib/map/fleet.ts`); a fix already shown, or an older one, changes nothing.
- Backward corrections came from guessing too far ahead. The guess now slows down with the fix's age
  (`aheadM`: speed fading with a 60 s time constant), so corrections are mostly forwards.
- After Codex: a dot left ahead of a standing target waits 6 s, then is corrected; effects run on a
  child of the marker element; a running effect is not restarted; reduced motion snaps; a hidden tab
  snaps on return; geolocation is single-flight with a session token and backs off on errors.
- Measured in the browser: sideways offsets faded in 1.2 s gave flicks up to 50 m/s. They now fade
  with smoothstep at ≤ 5 m/s.
