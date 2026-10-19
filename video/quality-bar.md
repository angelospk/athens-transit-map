# Quality bar — final cut (r7)

| check | result |
|---|---|
| Duration, size, frame rate | 3030 frames = 50.500 s at 60 fps; 1920x1080 and 1080x1920 (ffprobe) |
| Frame one finished | pill + "Λεωφορεία και τρόλεϊ της Αθήνας." + URL on frame 0 |
| Frozen > 0.5 s | none in either format (`freezedetect n=0.001 d=0.5`) |
| Text contrast | plate text 15.8:1, muted 7.6:1, chips 5.25–9.0:1; legend rings 3.1–4.6:1 (non-text, ≥ 3:1) — critic B |
| Safe margins | 9:16 film text 260–1540 px; captures that carry actions end at 1540–1640 px — critic r6 |
| Brand colours | Okabe-Ito line colours and delay colours from the app's own source (`src/lib/lineColors.ts`, `src/app.css`) |
| Cuts and hits | scene starts on beats (multiples of 30 frames at 120 BPM); taps/pops within ±1 frame of the shown event — critic B |
| Loudness | −14.0 LUFS integrated, −1.9 dBTP true peak (AAC); music-only version at −14.0 LUFS |
| Sound-off read | critic A retold the story correctly from a silent 2 fps sheet |
| Facts | every film-added line traced to `facts.json` (critics B, r4, r6); no counts, ratings or people invented |
