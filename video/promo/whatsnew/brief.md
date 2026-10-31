# Promo C — «Τι νέο» (2026-10-31)

Brief (from the orchestrator, Harold asleep; decisions logged here, no questions asked):

```
mode:       product
subject:    https://bus.haroldpoi.dev, releases v0.2.0–v0.2.3 + commits on main since 25/10
viewer:     Athens commuters who saw the launch film one week ago (Sun 25/10)
end state:  "it got a lot better in a week, let me open it"
length:     30.3 s, 9:16 1080x1920 (13 bars at 103 BPM); no 16:9 (not cheap: every scene is a phone take)
frame rate: 60 (UI)
brand:      app accent #0071e3, line pill colours, the v0.2.3 red stop pin; promo kit (src/promo/kit.tsx, src/ui.tsx)
facts:      promo/whatsnew/facts.json (only source for on-screen words)
assets:     live phone captures, capture/promo.mjs shots wstop wtrains wsearch wbell (390x844 CSS at 3x), stills wstills
sound:      music + light sfx (numpy, promo/audio.py), no voice; Greek captions only
autonomy:   unattended
toolchain:  Remotion 4.0.536 + Playwright 1.63 (same pipeline as promo A/B)
sign-off:   bus.haroldpoi.dev · «Δοκίμασέ το.» · «Βάλ’ το στην αρχική οθόνη, σαν εφαρμογή.»
```

## Decisions (choice — reason)

- **Same track as promo A** (SoulProdMusic «Corporate Upbeat Tech», Pixabay Content License, used before in A) —
  the viewer saw the launch with it; the same sound says "same product, a week on". Same head/tail splice as A
  (splice on the end card's downbeat, track bar 48 → final hit on the end card).
- **Signature object: the red stop pin** (new in v0.2.3). Drops in the hook, drops on the map in the real take,
  drops again on the end card over the URL.
- **Live data, no replay** — stop boards (/v1/stops) and trains are not in the backend's fix history, so the
  city replay of A/B cannot drive them. Captured on Sat 31/10 morning with whatever ran; the film does not
  claim counts.
- **Bell scene = a metro station** (rail alerts are the new part of v0.2.0). The full Chromium build (channel
  "chromium") is used for that take, because the headless shell answers Notification.permission "denied" and
  the sheet then shows «Αυτός ο browser δεν δίνει ειδοποιήσεις».
- **Telegram not on screen** — the rail sheet offers browser push only; Telegram (and its weekly repeat) is in the
  bus alert sheet. A caption over the rail sheet would mislead, so Telegram goes into the thread text and still 4.
- **Feedback (v0.2.1) not in the film** — 30 s holds 6 beats; Feedback is for the thread text.
- **PWA install as end-card caption only**: the manifest is older than 25/10 (commit 1e59cb8), so it is not
  called new; it is the call to action.
- **Metro/tram never called live**: the trains caption says «Προαστιακός: ζωντανά. Μετρό και τραμ: με το
  πρόγραμμα της ΣΤΑΣΥ.»

## Storyboard (bars of 2.33 s)

| bars | on screen | purpose | audio | exit |
|---|---|---|---|---|
| 0 | map at Syntagma, pin drops, «Μια εβδομάδα μετά. Τι νέο στον χάρτη.» | hook | pop | plate lifts, same take |
| 1–2 | finger taps a stop: map moves, red pin, card with minutes; «Ο χάρτης πάει εκεί. Κόκκινη πινέζα.» | v0.2.3 + stop card | tap, pop | cut on bar |
| 3 | «Απέναντι στάση» tapped | across | tap | cut |
| 4–5 | bus row → vehicle → «Γραμμή X ›» → line, Πίσω, Πίσω | card stack | taps | cut |
| 6–7 | metro card → zoom out → suburban station card («Επόμενοι συρμοί σε λεπτά. Μετρό, τραμ: πρόγραμμα ΣΤΑΣΥ.») | trains | — | cut |
| 8–10 | search «Σύνταγμα» (all modes), ★ two lines, favourites-only map | search + ★ | ticks, taps | cut |
| 10.5 | bell on metro → sheet «3′ πριν φτάσει» | rail alerts | tap | cut |
| 11.5–12 | pin drops on bus.haroldpoi.dev, «Δοκίμασέ το.», install line | sign-off | splice, pop, chime | end |
