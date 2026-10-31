# Promo C «Τι νέο» — ledger

Music: «Corporate Upbeat Tech» by SoulProdMusic (Pixabay Content License,
https://pixabay.com/music/corporate-corporate-upbeat-tech-208855/), file
`audio/track/soulprodmusic-corporate-upbeat-tech-208855.mp3`. **Used before**: it is promo A's track (launch film,
25/10). Head from track bar 1, splice (60 ms, on a half-bar downbeat) at 26.8 s to track bar 48.5, so the final hit
lands on the end card. Sfx: numpy (promo/audio.py): tap, keystroke ticks, a pop on each pin drop, the end chime.

| round | change | measured after |
|---|---|---|
| r0 (night take, 04:55) | first cut, 13 bars | critic 1: one more pass — captions too short (0.17 s/word on trains), captions under the safe area (search ~1665), «Πάτα μια στάση» on the pin, map never travels (same stop already centred), 3.1 s flagged by freezedetect, end card 4.7 s |
| r1–r3 (live take, 05:40) | tap after a wheel zoom-out at the pin's pixel → the map eases in to z16 and the pin drops; type placed between the pin and the card from the take's own geometry (capture marks `geo*`); cover zoom (no cut card edges); end card 3.5 s, iPhone line dropped; master audio from the WAV (re-encoding the render's AAC hit +1.5 dBTP) | stop caption cleared the pin (r3 frames 4–5.5 s) |
| r4 | caption sizes so no line wraps unplanned; «Και «Πίσω»» back at the top | critic 2: one more pass — suburban «ζωντανά» vs the card's «πρόγραμμα» note; «Πάτα μια στάση» over the pin; favourites beat 1.4 s; bell sub-line late; «Φόρτωση…» on the line card; freezes 6.3 s, 17.4 s |
| r5–r7 | suburban caption → «Επόμενοι συρμοί σε λεπτά.» (no live claim on screen); «Πάτα μια στάση» moved to y 1150; trains 2 bars, search 2.5 bars; bell sub-line with the title; line card cut to 1 s around the «Γραμμή ›» tap; 3.5 % push-in on every card scene; end card push + pin float | freezedetect (n 0.003, 0.5 s): one 0.65 s span at 10.4 s, where only the finger and the caption move (not a frozen picture); −14.0 LUFS, −2.4 dBTP master and web |

## Quality bar (r7)

- 1080x1920, 60/1 fps, 1817 frames, 30.283 s (13 bars at 103 BPM). Frame one: map, pin, «Μια εβδομάδα μετά.».
- Frozen: 0.65 s total flagged at the strict threshold (finger moving); ≤ 1 s per 30 s.
- Loudness −14.0 LUFS integrated, true peak −2.4 dBTP (master and web); sfx below the music peak (×0.5 mix).
- Type: white or tinted on ink plates (rgba 17,17,19,.94), contrast > 12:1; all type inside y 250–1540, x ≥ 60.
- Brand: accent #0071e3 and line colours come from the real UI; the pin is the app's own SVG and red (#e5383b).
- Cuts on bars (GC.bar), sfx at the capture's real tap frames (scripts/promo-timing.ts).
- Facts: every caption maps to facts.json; metro/tram only with «πρόγραμμα ΣΤΑΣΥ».
- Web MP4 8.0 MB (2-pass, audio copied from the master).
