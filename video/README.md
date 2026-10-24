# Demo film

A 50 s Greek explainer of the live map, built in code: real frame-stepped captures of
https://bus.haroldpoi.dev (Playwright), a Remotion timeline, sfx synthesized in numpy. Music: "Calm Digital
Technology Background" by lvymusic ([Pixabay](https://pixabay.com/music/upbeat-calm-digital-technology-background-121521/),
Pixabay Content License); download it to `audio/track/` (path in `timing.json` → `music.file`), it is not in git.
Process notes: `brief.md` (decisions), `facts.json` (source of every on-screen line), `style-bible.md`,
`ledger.md` (render and critic rounds), `timing.json` (generated).

```bash
bun install
bunx playwright install --with-deps chromium   # browser + system libs for the capture (once; may ask for sudo)
bun run capture                      # ≈10 min: public/cap/*.mp4 + *.json (tracks) + api.json, from the live site
bun scripts/timing.ts                # timing.json (scene starts, sfx frames)
python3 audio/make_audio.py --sfx-only && python3 audio/mix_track.py && audio/master.sh   # track + sfx → public/mix.wav (−14 LUFS)
scripts/render.sh r1                 # out/r1-16x9.mp4, out/r1-9x16.mp4 (+ contact sheets in frames/)
scripts/deliver.sh r1                # out/athens-transit-{16x9,9x16}.mp4, music-only.wav, contact-sheet.png
```

The captures are not in git (≈100 MB); the committed `public/cap/*.json` are the cursor tracks and the API
answer of the capture used for the current cut. A new capture changes the data; re-check the camera keys in
`src/Film.tsx` (`BUS`, card rows, planner focus) against the new footage before rendering.

## Promo films (two drafts)

Two ~50 s marketing cuts from the same pipeline: A is a 9:16 product montage (`src/promo/FilmA.tsx`, 103 BPM), B
is a 16:9 origin story with a diagram and the API (`src/promo/FilmB.tsx`, 115 BPM). Process notes in `promo/`:
`brief.md`, `facts.json`, `ledger.md`, `HUMAN-CHECK.md`. Music (Pixabay Content License) goes in `audio/track/`
(paths in `promo/timing-*.json` → `music.file`); it is not in git. The city layer is replayed from the backend's
fix history, so the map shows a real weekday peak whatever time you capture.

```bash
docker cp atrt-atrt-1:/var/lib/atrt/history /tmp/hist/            # backend fix history (hourly CSV)
python3 capture/replay_extract.py /tmp/hist/history 1792476300   # capture/replay/fixes.csv.gz (Tue 20/10 09:05)
node --dns-result-order=ipv4first capture/promo.mjs city         # one shot: city speed fav plan stats (2-3 at a time)
bun scripts/promo-timing.ts                                      # promo/timing-{a,b}.json (scenes, sfx, music)
python3 promo/audio.py a && python3 promo/audio.py b             # public/promo-{a,b}.wav (−14 LUFS)
for c in a b; do bunx remotion render src/index.ts promo-$c out/$c-r1.mp4 --concurrency=14 --crf=18 --audio-bitrate=256k --log=error; done
scripts/promo-deliver.sh r1                                      # out/promo/: masters, -web, music-only, contact sheets
```
