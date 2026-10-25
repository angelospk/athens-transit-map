# Promo films — two drafts

Harold's brief (2026-10-25, condensed): marketing tone, fast, captions only (headlines and sub-headlines, kinetic
type that comes and goes), real captures, Greek. Show live positions, late vs on time, typical speed, favourites,
the refresh ring, the scale (real numbers), the origin story (a question on Twitter, Φοίβος's Python prototype, a
gentle 5 req/s backend in front of OASA's PHP server, the cache), the public API with a QR, filters, metro, the
planner and alerts (web push, Telegram, recurring), open data and open source.

```
mode:       A: product montage · B: launch-story / explainer (story first, product second)
subject:    https://bus.haroldpoi.dev + https://transit.haroldpoi.dev
viewer:     an Athens commuter (A); a developer, journalist or city person (B)
end state:  A: "I can set up my commute and know when to leave" · B: "there is an open, free API for the whole city"
length:     A 51.3 s 9:16 1080x1920 (22 bars at 103 BPM) · B 50.1 s 16:9 1920x1080 (24 bars at 115 BPM)
frame rate: 60 (UI)
brand:      from the app: accent #0071e3, delay colours, speed colours (src/app.css, src/lib/speed.ts), the bus pill
facts:      promo/facts.json (only source for on-screen words)
assets:     real phone captures (capture/promo.mjs, 390x844 CSS at 3x), the stats screen as a still
sound:      music + sfx, no voice
autonomy:   unattended (Full Send)
toolchain:  Remotion 4.0.536 + Playwright 1.63 capture + numpy sfx (same pipeline as the demo film)
sign-off:   bus.haroldpoi.dev (+ the API short link bus.haroldpoi.dev/api in B)
```

## Decisions (choice — reason)

- **Phone captures, not desktop** — Harold uses the map on an iPhone, and the app is phone-first. One set of
  captures serves both films: full-bleed in A, inside one phone window in B.
- **Peak city replayed from the backend's own history** — at capture time (Sun 00:45) only ~100 vehicles ran. The
  backend records every fix (`--history`); `capture/replay.mjs` answers the app's `/v1/vehicles/tiles` from the
  fixes of Tue 20/10 09:05 with the backend's snapshot rule (30 s builds, fixes ≤ 5 min old): the app itself then
  shows "1009 τώρα". The UI is the live site; only the city layer's data is the recorded peak. On screen:
  "Πραγματικά δεδομένα · Τρ 20/10, 09:05". Favourites and planner use the live (night) data.
- **Speed-ups are labelled** — the ring fills at 6× page time in the capture, shown at 3.5× (A) and 6× (B).
- **Stats as a still** — a modal `<dialog>` stalls Playwright screenshots on the paused clock (and at 3x even in real
  time with a short timeout); the camera moves over a still of the real screen (23/10: 1.251 vehicles, 279 lines,
  peak 1.026 at 08:00).
- **Numbers**: "1.000+ στην αιχμή" = busiest hour of each weekday 20–23/10 (1087, 1049, 1034, 1026 distinct
  vehicles); "279 γραμμές" and "1.251" = the 23/10 day file. No other counts.
- **No Google Maps walking link** — the brief mentions one, but the app does not have it (no `google.com/maps` in
  src/ or bot/); the planner shows walking metres. Not shown, not claimed.
- **Telegram** — no Telegram UI is drawn; the film quotes the bot's real recurring-alert text (bot/bot.ts) on a
  plate labelled "Telegram · @oasa_bus_bot". The planner part (Επανάληψη: τις καθημερινές, 07:30, Στο Telegram) is
  the real capture.
- **"07:30 AM"** — headless Chromium formats `<input type=time>` in 12 h even with `--lang=el-GR`; on an iPhone it
  shows 07:30. Left as captured.
- **Music** (both Pixabay Content License; MP3s not in git, see timing-*.json → music.file):
  A: "Corporate Upbeat Tech" by SoulProdMusic (https://pixabay.com/music/corporate-corporate-upbeat-tech-208855/),
  103.0 BPM measured; B: "Tech Corporate" by The_Mountain (https://pixabay.com/music/corporate-tech-corporate-593075/),
  115.0 BPM measured. New tracks, not the demo film's lvymusic track. Each film starts on a bar of its track and
  splices (60 ms, on a downbeat) to the track's last bars, so the final hit lands on the end card.
- **API QR = the short link bus.haroldpoi.dev/api** (Harold, 2026-10-25) — it redirects to the API reference
  (angelospk.github.io/athens-transit-rt). The QR is Harold's file (`public/promo-api-qr.svg`), on a white frame
  because the scene is dark; it stays on screen ≥ 2.5 s and decodes (jsQR) from the web encode at 390 px (A) and
  844 px (B) wide.

## A — "Ζωντανά. Στο κινητό σου." (9:16, bars of 2.33 s)

| bars | on screen | purpose | audio | exit |
|---|---|---|---|---|
| 0–1 | peak city full-bleed, "1.000+ λεωφορεία. Ζωντανά. Στο κινητό σου." | hook, scale | track bar 1 | camera dives to the panel |
| 2–3 | the panel's ring glows and fills; dots move at each fill; "Ο κύκλος γεμίζει…" | refresh = new positions | — | cut on bar |
| 4–5 | centre zoom, legend chips (app delay colours) "Ποιο αργεί; Με μια ματιά." | late vs on time | whoosh | cut |
| 6 | menu → "Μόνο με πρόσφατη θέση" "Παλιό σήμα; Κρύψ' το." | parameters | taps | cut |
| 7–8 | speed layer, legend 4–30 km/h, "Πού τρέχουν. Πού κολλάνε." 1,76 εκατ. μετρήσεις | typical speed | taps | cut |
| 9 | M3 track drawn "+ Μετρό, ΗΣΑΠ, τραμ." | metro toggle | — | cut |
| 10–11 | ☆ on 040 → new visit: ★ 040 A1 → Όλες, both lines on the map | favourites remembered | taps | cut |
| 12–13 | planner: Η θέση μου → Σύνταγμα, 4 lines + metro hint "Από εδώ. Ως εκεί." | trip planner | ticks, taps | cut |
| 14–15 | alert form: τις καθημερινές, 07:30, Στο Telegram; bot text plate | recurring alerts | taps | cut |
| 16 | ink: "Στήσε τη διαδρομή σου. Μάθε πότε να φύγεις." | the pitch | — | cut |
| 17 | stats screen still: "279 γραμμές. 1.000+ στην αιχμή." "5 αιτήματα το δευτερόλεπτο" | scale, gentle backend | — | cut |
| 18–19 | "Ένα δημόσιο API." endpoints one per half beat, then the QR on a white frame, «Ανοιχτό API · bus.haroldpoi.dev/api» (decodes 43.75–46.5 s) | API | pops, chime | cut |
| 20 | "Ανοιχτά δεδομένα. Ανοιχτός κώδικας. Δωρεάν." sources | open | splice to the track's end | cut |
| 21 | bus pill + bus.haroldpoi.dev | sign-off | final hit + chime | end |

## B — "Από μια ερώτηση, ένα API για όλη την πόλη" (16:9, bars of 2.09 s) — v2, 2026-10-25

Harold's notes on v1: story too long (ended at 20.9 s), the phone too small and zoomed so its text was unreadable,
black rings that look stuck (the metro hub stations), the stats screen with its yellow schedule note; wanted the
statistics shown fast one after another, a line selected and removed with its bus moving, the GitHub repos, a QR for
the site at the end, and sounds from earshot.

| bars | on screen | purpose |
|---|---|---|
| 0 | "Κάποιος ρώτησε στο Twitter: «Γιατί η Αθήνα δεν έχει GTFS Realtime;»" (no tweet shown) | the question |
| 1 | "Η αρχή: ένα πρωτότυπο σε Python, από τον Φοίβο." repo chip; "ένα backend σε Go" | the origin |
| 2–3 | diagram: ΟΑΣΑ node, backend, request dots exactly 5 per second | 5 req/s |
| 4 | history cylinder under the backend | own history → speeds, stats |
| 5–6 | cache node, clients multiply, the request rate does not | one answer for all (story ends 14.6 s) |
| 7–8 | four cards, one per two beats: 279 γραμμές / 1.000+; 1.026 on the road (chart); 1.051 / 655 weekdays vs weekends (chart); 11,9 km/h (chart) | scale, from the app's own statistics |
| 9–11 | one large phone (0.62 of the capture, fixed; the camera only pans): live + ring, late, typical speed | the product |
| 12–13 | trolley 11: pick → route → a bus → one direction → 8× motion → × back to the city | focus a line |
| 14–17 | favourites, planner, weekday 07:30 alert + Telegram | the product |
| 18 | "Στήσε τη διαδρομή σου. Μάθε πότε να φύγεις από το σπίτι." (a 0.35 s music stop-down before it) | pitch |
| 19–21 | terminal: real `/v1/lines/040` answer; endpoints on beats; QR «Ανοιχτό API · bus.haroldpoi.dev/api» (decodes 43.25–45.75 s) | API |
| 22 | open data, the two GitHub repos; the site's QR (bus.haroldpoi.dev) appears and stays to the end (46.25–50 s) | open |
| 23 | pill + bus.haroldpoi.dev + «API: bus.haroldpoi.dev/api» | sign-off |

Decisions (v2): captures `b*` with `stationsOn=false` (A keeps its own captures); trolley 11 for the focus because on a
Sunday morning it was one of the few lines with fresh fixes (040's were 3 min old and drew a stale warning); the
latest day's average-speed chart and the line ranking were left out (gaps, a 0,1 km/h low, only 2 ranked lines);
sounds from the earshot bank (`promo/sfx.sh`), placed by `scripts/promo-timing.ts`; `earshot critique`: launch-grade.

## Style (both)

Ink `#111113`, paper `#f5f5f7`, muted `#a1a1a6`, app accent `#0071e3` (light blue `#7fb6ff` on ink), live green
`#5fd27a`, the app's delay and speed colours as content. Inter 800/600, JetBrains Mono for the API (local
fontsource). Words rise out of a mask 3 frames apart and leave upward (`Words` in src/ui.tsx); ink plates behind any
type over the map. Out-expo arrivals, in-expo exits, a 1 % camera breath on every capture, a 4 % punch on each cut
in A, a fixed phone window in B.
