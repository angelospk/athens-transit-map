# Style bible

- **Colours (6 + content):** ink `#111113` (app dark bg), paper `#f5f5f7`, muted `#a1a1a6`, live green `#5fd27a`
  (text) / `#1a7f37` (pill ring, app `--ontime`), line blue `#0072B2` (Okabe-Ito slot 1, highlights). Line chips
  and the delay legend use the app's own colours as content (`src/lib/lineColors.ts`, `src/app.css`).
- **Type:** Inter 800 for statements, Inter 600 muted for the second half of a thought; JetBrains Mono for the API.
  Greek subsets bundled locally (fontsource). Words rise out of a mask, 3 frames apart; leave upward, fast.
- **Carrying object:** the bus pill (the favicon: "040" with a white gap and a green delay ring). It opens the film,
  becomes the city, returns as the real vehicle the camera dives into, and comes back out of the API JSON
  (`"line": "040"`) as the end mark.
- **Picture:** real frame-stepped captures of bus.haroldpoi.dev, never stills; a camera (eased zoom/pan) inside
  each capture; a drawn cursor with click ripples. Rounded windows (28 px) on the ink stage; ink plates (94 %)
  behind any type over the map.
- **Motion vocabulary:** out-expo arrivals, in-expo exits, inOut cubic camera; clip-path hand-offs between a
  window rect and the full frame; ring pulses on beats. 120 BPM: every scene starts on a beat (30 frames).
- **Style frames:** `frames/s16-*.jpg`, `frames/s9-*.jpg` (stills from the code).
