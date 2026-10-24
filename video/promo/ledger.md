# Promo films — ledger (render and critic rounds)

Each round: render both films, then a fresh critic (sonnet-scout, no prior context) reads them sound-off at
phone size (A at 390 px wide, B at 844 px), plus freezedetect, ebur128 and a fact check against `facts.json`.

| round | change | critic / measured |
|---|---|---|
| r0 | first cut of both storyboards on live night captures (~100 vehicles) | city looks empty; no scale |
| r1 | city layer replayed from the backend history (Tue 20/10 09:05, 1026 vehicles); CRLF fix in `replay.mjs` (all dots were grey) | dots now coloured; menu taps hit wrong rows; black ending |
| r2 | `press()` with real locator clicks, `closeMenu()`; moving dark map under pitch/API/open/end; 4 % punch on cuts (A) | freezes in B's text scenes; legends and plates too small at 390 px |
| r3 | drift (B), 1 % breath on every capture; larger legends and fonts; counters without count-up; diagram larger, node subs shortened | B frame 1 not finished; OASA/backend labels overlap; background shows the menu |
| r4 | B frame 1 finished; OASA/backend timing split; background seg range limited; pipe out of drift (pushed the fan-out off frame) | ring text unclear («Ο κύκλος…»); scale line weak |
| r5 | ring text «Η μπλε μπάρα γεμίζει…» + glow; «5 αιτήματα/δευτ. στον ΟΑΣΑ. Ευγενικά.»; API QR = bus.haroldpoi.dev/api (Harold's SVG, white frame) | freezedetect 0 / 0; −14.0 LUFS, peak −2.7 (A) / −2.3 (B) dBFS; QR decodes A 43.75–46.5 s, B 43.25–45.75 s |
| r6 | review fixes: music splice now lands the tail's downbeat on the splice frame (was 60 ms late); replay `speed` is null, as the contract says without a shape (no visual change at z 9); extractor makes its dir and keeps the old file on an empty run. Audio remixed and muxed onto the r5 picture | −14.0 LUFS both; peak −1.7 (A) / −2.5 (B) dBFS |

## Quality bar (r6 = r5 picture + r6 audio, delivered files in out/promo/)

- A: 1080x1920, 60 fps, 3076 frames, 51.27 s. B: 1920x1080, 60 fps, 3005 frames, 50.08 s.
- Loudness: −14.0 LUFS integrated both; peak ≤ −1.7 dBFS after AAC.
- No freezes (ffmpeg freezedetect, default noise, 0.5 s).
- QR: `https://bus.haroldpoi.dev/api` decoded by jsQR from the web encodes, sampled every 0.25 s.
- Every on-screen claim is in `facts.json` with its source.
- Known transition: in B the endpoint list leaves while the QR enters (14 frames, 0.23 s overlap).
