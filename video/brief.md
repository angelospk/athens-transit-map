# Athens transit live map — explainer film

```
mode:       product / explainer hybrid (what the page does, step by step)
subject:    https://bus.haroldpoi.dev (this repo) + public API https://transit.haroldpoi.dev
viewer:     a recruiter (what was built, stack, API) and an Athens commuter (what it does for me)
end state:  knows the five things the page does; remembers bus.haroldpoi.dev
length:     50.0 s, 16:9 1920x1080 master + recomposed 9:16 1080x1920
frame rate: 60 (UI/product)
brand:      derived from the app: favicon pill (green "040" pill), Okabe-Ito line colours, delay colours (src/app.css)
facts:      facts.json (only source for on-screen words)
assets:     real frame-stepped captures of the live site (capture/capture.mjs), real API JSON
style:      ink background, the live map in rounded windows, kinetic Greek type on ink plates
sound:      music + sfx, no voice (Harold, 2026-10-20); music: "Calm Digital Technology Background" by lvymusic (Pixabay)
autonomy:   unattended (Full Send)
toolchain:  Remotion 4.0.536 + Playwright 1.63 capture + numpy sfx
sign-off:   bus.haroldpoi.dev
```

## Decisions log (choice — reason)

- Captures are real, not rebuilt UI — the brief asks for real screen captures of the live site. The skill's
  "no static slab" rule is met by frame-stepped *video* (Playwright fake clock, 1/60 s per screenshot), camera
  moves inside it, and a drawn cursor with click ripples.
- 1600x900 CSS at 1.5x (2400x1350) — UI text large enough after a 1.3–2.5x camera push.
- City shot sped up 4x after the zoom, tagged "×4" on screen — at real speed buses move ~1 px/s at city zoom.
- Captured near midnight (2026-10-19, ~215 vehicles). Night service is sparse; no vehicle count is claimed.
  `bun run capture` re-captures everything in one run (≈10 min) for a daytime version.
- Lines 040, Α1, Χ95 — all ran at capture time (Χ95 runs all night); 550 did not show at night.
- Planner: Σύνταγμα → Πειραιάς; the alert is shown but not armed (no push permission in headless).
- Text only, no voice (Harold's choice). Music: Harold picked "Calm Digital Technology Background" by lvymusic
  (https://pixabay.com/music/upbeat-calm-digital-technology-background-121521/, Pixabay Content License) over the
  first numpy score, which reused the Roomly film's synth. 72.0 BPM measured (one beat = 50 frames), so every
  scene starts on a beat; the track's opening runs to the api cut, then its ending (from 120.57 s) joins on a
  downbeat and its final hit lands on the end card. The MP3 is not in git (the license does not allow
  redistributing the music on its own). Sfx are still synthesized in numpy.
- "Δωρεάν" for the API — from Harold's brief ("the free public API"); README says "no key".
- No eye emoji (Harold, grilling 2026-10-13). The app's layers button is an eye line icon; never framed close.
- 9:16 recomposed from the same captures (camera crops to a tall window), not a crop of the 16:9 render.
