# Ledger — render rounds

| round | change | before → after |
|---|---|---|
| test | 5 s clip (frames 1080–1380) end to end | pipeline works, 14 s render; found: empty dark frame before `ring` (follow window faded out), cursor covering the bus number |
| r1 | follow window no longer fades; ring hides the cursor (110–130), card shows it at the click; ring plate moved in | full render 16:9 + 9:16 in 3 min 10 s |
| critics on r1 | A (sound-off + director): story read correctly; flash at 28.5 s (planner reveal over empty ink), 2.3 s near-black API typing, holds up to 3.2 s, tiny badge on black 2.6–3.0 s, text exit smear 18 s, small legend/JSON/tech line, 9:16 plate in bottom zone, weak frame one. B (facts/sync/format): format, −14.1 LUFS / −1.9 dBTP, facts, sync (±1 f), contrast all pass; holds 3.2 s; cursor parked on "Εδώ"; silent highlights; 9:16 orphans | 2× "one more pass" |
| r2 | API 8 → 6 s (command types 1 char/frame, JSON from 0.9 s, slow push), end 6 → 4 s (film 54.5 → 50.5 s); planner starts full frame (card zooms out to the same wide map first); terminal visible from its first frame (planner shrinks into its rect); hook URL on frame one, pill holds big; legend 32 → 40 px; 9:16 text ≥ 290 px from top, plate ≥ 420 px from bottom; text blocks leave as one unit; nbsp against orphans; cursor fades after the bell hover; ripple gets a white halo | longest hold 3.2 s → 0.87 s (16:9), 1.35 s (9:16) |
| r3 | camera "breath" (±1.2 % zoom, 4.7 s period) on every capture except ring/card (their hand-off shares pixels) | holds > 0.5 s: 16:9 two (0.52, 0.77 s), 9:16 none |
| r4 | follow window wide zoom above cover (breath was clamped) | holds > 0.5 s: none in both formats |
| critic on r4 | 5/10 earlier items fixed; open: 9:16 "×4" tag in top zone, card/bell buttons in the bottom 380 px, cursor parked on "Εδώ", orphan "σου."/"δικό", empty plate for a few frames, "×4 ταχύτητα" not in facts.json | one more pass |
| r5 | 9:16 full-bleed captures stop at y 1640, windows end ≤ 1540; tag at y 260; "|" forced line breaks in `Words`; plates arrive with their words; cursor leaves after the scroll; "ταχύτητα" added to facts.json; hook tagline holds until the shrink | — |
| r6 | 16:9 follow column 56–60 px with hand breaks | holds > 0.5 s: none |
| critic on r6 | 6/7 fixed; open: empty plate sliding over the map at 40.3 s (16:9), "πάνε." alone, "Χωρίς κλειδί." off the headline baseline | one more pass |
| r7 | bell plate leaves before the window shrinks; nbsp "σε πάνε."; API headline + "Χωρίς κλειδί." on one baseline | holds > 0.5 s: none; −14.0 LUFS, −1.9 dBTP |
| scout on r7 | caption box outlived its text by 2 frames before the 1440 and 1710 cuts | one more pass |
| r8 (final) | plates leave together with their words; capture clock steps by rounded running target; empty-API guard | no freeze, no black; −14.0 LUFS, −1.9 dBTP; exits checked frame by frame |
| reviews (r8) | Codex REVISE → fixed (Playwright browser install documented, clock drift, empty API); CodeRabbit 2 minor → fixed (brief length, browser closed in `finally`, clear error when no 040 vehicle) | — |
| r9–r11 (music) | Harold: the numpy score sounded like the Roomly film. New music: lvymusic "Calm Digital Technology Background" (72.0 BPM measured). Picture re-timed to a 50-frame beat (50.5 → 50.0 s, every cut on a beat); head 0.57–40.57 s + track ending from 120.57 s, spliced on a downbeat at the api cut; final hit on the end card (frame 2750). Hook pulses made continuous (r9 had 0.8 s holds) | holds > 0.5 s: none; −14.0 LUFS |
