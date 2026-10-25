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
| r7 | B v2 (Harold's notes): story 20.9 → 14.6 s; stats as four cards; large phone, pan only; no metro stations; focus scene (trolley 11); repos + site QR; earshot bank sounds | freezedetect 4 (three stats holds, the alert pan past the phone's end); earshot critique launch-grade 23/23, tip: one stop-down before 37.57 s |
| r8 | stats drift; every pan inside the phone (capture y 806–1725) | freezedetect 0; legible at 844 px wide |
| r9 | 0.35 s music stop-down before the pitch (r8 picture, new audio) | earshot critique launch-grade 23/23, stop-downs 1.2/min; −14.0 LUFS, peak −2.4 dBFS; QR API 43.25–45.75 s, site 46.25–50 s (jsQR at 844 px) |
| r10 | sound audit made strict (a failing `earshot sfx check` stops `promo/sfx.sh`); typing key → `pro_typing_key/tick` (the soft one cut its tail) | −14.0 LUFS, peak −2.4 dBFS |
| r11 | review fixes: focus taps kept inside their segments (the direction tap had dropped out), the 8× part plays at rate 1 (it was 20×), no breath zoom on B's phone, stop-downs clipped at the film's edges | freezedetect 0; Codex APPROVE (round 2); QRs decode |

## Quality bar (r6 = r5 picture + r6 audio, delivered files in out/promo/)

- A: 1080x1920, 60 fps, 3076 frames, 51.27 s. B: 1920x1080, 60 fps, 3005 frames, 50.08 s.
- Loudness: −14.0 LUFS integrated both; peak ≤ −1.7 dBFS after AAC.
- No freezes (ffmpeg freezedetect, default noise, 0.5 s).
- QR: `https://bus.haroldpoi.dev/api` decoded by jsQR from the web encodes, sampled every 0.25 s.
- Every on-screen claim is in `facts.json` with its source.
- Known transition: in B the endpoint list leaves while the QR enters (14 frames, 0.23 s overlap).
