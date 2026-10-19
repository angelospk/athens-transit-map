# Demo film

A 50.5 s Greek explainer of the live map, built in code: real frame-stepped captures of
https://bus.haroldpoi.dev (Playwright), a Remotion timeline, and a score synthesized in numpy.
Process notes: `brief.md` (decisions), `facts.json` (source of every on-screen line), `style-bible.md`,
`ledger.md` (render and critic rounds), `timing.json` (generated).

```bash
bun install
bunx playwright install --with-deps chromium   # browser + system libs for the capture (once; may ask for sudo)
bun run capture                      # ≈10 min: public/cap/*.mp4 + *.json (tracks) + api.json, from the live site
bun scripts/timing.ts                # timing.json (scene starts, sfx frames)
python3 audio/make_audio.py && audio/master.sh   # score + sfx → public/mix.wav (−14 LUFS)
scripts/render.sh r1                 # out/r1-16x9.mp4, out/r1-9x16.mp4 (+ contact sheets in frames/)
scripts/deliver.sh r1                # out/athens-transit-{16x9,9x16}.mp4, music-only.wav, contact-sheet.png
```

The captures are not in git (≈100 MB); the committed `public/cap/*.json` are the cursor tracks and the API
answer of the capture used for the current cut. A new capture changes the data; re-check the camera keys in
`src/Film.tsx` (`BUS`, card rows, planner focus) against the new footage before rendering.
