# UI spec web v2: one card stack, one marker, favourites, search

Status: **direction approved by Harold, 2026-10-29** (decisions in Part D). Web only (`athens-transit-map`); the app follows later
(requirement 17). Builds on `athens-transit-rt/docs/UI-SPEC-unified.md` (cards, freshness tag,
favourite repair rule) and uses its terms (`GLOSSARY.md`: Line, Stop, Vehicle, Run, Pattern,
Arrival, Favourite, Alert). Data: `/v2` (`CONTRACT.md`). Requirements: Harold's voice note of
2026-10-29, items 4-16.

Each item is marked **[web]** (client only), **[backend]** (needs an `athens-transit-rt`
change) or **[external]** (a third-party service).

Part A is the audit that this spec answers. Part B is the spec. Part C is the issues. Part D is the
decisions. Part E is what the app must take over (and what the web takes from the app).

---

## Part A. Audit (live page, 2026-10-29)

Method: `bus.haroldpoi.dev` and a local dev build on the live API, headless Chrome at 1440×900
and 390×844 (touch). Flows: metro train → station; suburban station; city bus → stop; line
picker. Screenshots were kept in the thread scratchpad, not in the repo.

| # | Sev | Problem | Evidence |
|---|---|---|---|
| 1 | P0 | **No navigation between cards.** Seven nullable selection fields (`selection`, `metroStation`, `railStation`, `busStop`, `train`, `railLine`, `tempLine`); every `select*()` nulls the others. Vehicle → stop → line loses the way back; there is no back button, and the browser Back leaves the page (only `history.replaceState`). | `src/lib/state.svelte.ts:301-420`, `:503-536`, `:631` |
| 2 | P0 | **Rail vehicles shout, and their colours lie.** Train dots are about 2× a bus dot at the same zoom and filled with the line colour; bus dots are filled with the delay colour. M1 green reads as "on time", M2 red as "late > 10′". Harold's screenshot shows it. | `src/lib/map/MapView.svelte:180` (trains 4/6.5/10 px) vs `:202-203` (buses 2.5/4.5/10 px) |
| 3 | P1 | **Six card components for three concepts.** `InfoCard`, `StopCard`, `StationCard`, `RailCard`, `TrainCard`, `RailLineCard`. A bus stop has a bell and no star; a metro station has neither; a metro train card lists the whole run (no "now", no bells, no line link); a bus vehicle card has bells. | `src/App.svelte:19-26`; screenshots of the station, train and bus cards |
| 4 | P1 | **Favourites are bus lines only**, a chip row, max 5 lines on the map; no favourite stops; metro/suburban cannot be starred. | `state.svelte.ts:117-119`, `selection.ts:3` |
| 5 | P1 | **Search finds bus lines only.** No stops, no metro/tram/suburban lines, no mode filter. Desktop placeholder is cut («π.χ. 040, Πει»). | `LinePicker.svelte`; picker screenshot |
| 6 | P1 | **Direction switch on the vehicle card** (Όλες / → A / → B). Choosing the other direction drops the vehicle and opens a route card. | `src/lib/ui/InfoCard.svelte:238` |
| 7 | P1 | **Vehicle card ETAs all «~5′»** for 8 stops in a row (021, GPS fix 5′07″ old). A bug, not a layout issue: own issue. | bus vehicle screenshot; `InfoCard.svelte:95` |
| 8 | P1 | **«⚠ Παλιό πρόγραμμα» still shows** on every page. Decided: drop (it comes from `/v1`). | `src/lib/ui/OldTimetable.svelte:18` |
| 9 | P2 | Map controls are 29×29 px on a phone (target 44). The «Έρχεται εφαρμογή» chip is clipped behind the control column at 390 px. | element sizes from the 390 px run; bus vehicle screenshot |
| 10 | P2 | Long durations: «πριν 5 λεπτά και 7 δευτερόλεπτα», «12 δευτερόλεπτα νωρίτερα». | `src/lib/format.ts:7-12` |
| 11 | P2 | Headsign case mixed on one card (`→ Πικροδάφνη` vs `→ ΕΛΛΗΝΙΚΟ`); M3 shows three headsign rows at Σύνταγμα for two directions. | station screenshot |
| 12 | P2 | Desktop panel: stats + legend sit open over the map at load. The whole card is `aria-live="polite"`, so a screen reader reads it again on every poll. | desktop screenshot; `InfoCard.svelte:170` |

Scores (impeccable audit, 0-4): accessibility 2, performance 3, theming 3 (tokens in
`app.css`, dark mode works), responsive 2, implementation integrity 2. **Total 12/20:
acceptable, significant work needed.** Integrity verdict: **fail on consistency**. The tokens
and copy are coherent; the card and marker layers were built per mode, so the same concept
looks and behaves differently per mode.

Good, keep: the bus StopCard (Harold likes it), the alert sheet, «απέναντι στάση», tapping a
line on a stop opens its vehicle, token-based dark mode, Greek copy tone.

---

## Part B. Spec

### B0. Icons: SVG only, no emoji [web, app]

Harold, 2026-10-29: no emoji anywhere in the UI, only SVG icons. One icon set (bus, trolley,
metro, tram, suburban, star, star-filled, bell, pin, search, back, close, check, warning),
`currentColor`, 16/20/24 px, `aria-hidden` with a text label beside or an `aria-label` on the
button. Today's emoji and symbol glyphs to replace:

| Where | Glyph |
|---|---|
| `TripPlanner.svelte:263`, `:353`, `:371` | 🚏 📍 🚇 ◎ ⌖ • |
| `Panel.svelte:233` | 🚌 |
| `InfoCard.svelte:183`, `LinePicker.svelte:144`, `:161`, `:192` | ★ ☆ |
| `StopCard.svelte:116-117`, `LinePicker.svelte:189` | ✓ |
| `OldTimetable.svelte:18` | ⚠ (the component goes anyway, B10) |

### B1. Card stack and navigation [web]

One `CardStack` component replaces the six cards and the seven selection fields.

```ts
type Card =
  | { kind: "vehicle"; id: string }           // Vehicle id (/v2)
  | { kind: "stop"; id: string }              // Stop id, any mode
  | { kind: "line"; id: string; run?: string; pattern?: string };
stack: Card[]   // top = last; [] = no card
```

Rules:
1. **Map tap on a vehicle / stop / line** replaces the stack with `[card]` (a fresh start).
2. **Tap inside a card** pushes: vehicle → its next stop (`stop`), vehicle → «Γραμμή ›» (`line`
   with `run`), stop → a line row (`vehicle` when a Vehicle is known, else `line`), line → a
   vehicle row (`vehicle`), line → a stop row (`stop`).
3. **No duplicates.** Pushing a card that is already in the stack truncates the stack to it
   (no endless vehicle → stop → vehicle loops). Max depth 6: push drops the oldest.
4. **Back**: header button «‹ <title of the card below>» pops one. Browser Back does the same:
   each push is one `history.pushState`; each pop is `history.back()`. Android back gesture
   works for free.
5. **Close**: × in the header and a map tap on empty map clear the whole stack (one
   `history.go(-n)`).
6. The map follows the top card: vehicle → follow it; stop → centre on it, its lines dimmed in;
   line → fit the chosen Pattern, its Vehicles highlighted, the others dimmed.
7. **Layout.** Phone (< 720 px): bottom sheet, three heights (peek 30 % / half 55 % / full),
   drag handle, keeps today's sheet logic (`sheet.ts`). Desktop: left column 380 px under the
   search bar, full height, map padding on the left. The card header is sticky: back, badge,
   title, star, ×.
8. Card change is a 160 ms cross-fade + 12 px slide (push from right, pop from left);
   `prefers-reduced-motion`: cross-fade only.
9. Only the arrival rows are `aria-live`, not the whole card (fixes audit 12).

### B2. The three cards (one structure, data per mode) [web, on /v2]

Shared header: Line badge (UI-SPEC-unified §0), title, **freshness**, star, ×. Freshness is one
short tag on the right: «38″» / «4′» (GPS age, muted; red over 90 s) or «πρόγραμμα» (estimate
or timetable). Never «Τελευταία ενημέρωση πριν 38 δευτερόλεπτα» (requirement 10).

**Vehicle card** (requirement 8)
- Header: badge, `→ headsign`, freshness tag. Second line, small: delay (`+3′` / `−1′` /
  «στην ώρα του»), vehicle label `#1226` when known.
- **Next stops**: up to 8 rows `[time] [stop name] [bell]`; the first row bold. Tap the name →
  push `stop`. Bell → the alert sheet for this Stop + Line. `source: timetable` times in
  italic with one «πρόγραμμα» note above the list (not per row).
- Footer button «Γραμμή <label> ›» → push `line` (with `run`).
- **No direction switch** (remove `InfoCard.svelte:238`).

**Stop card** (requirement 9): today's web bus StopCard (`StopCard.svelte`, the app's
`stop_screen.dart` layout) stays as it is for buses. Changes are small and listed here; the
same card serves every mode.
- Header: mode icons, name, star (Favourite Stop), ×. Under the name: «Σπίτι · 22 γραμμές ·
  Απέναντι στάση 40 μ» (the place label from the app, B6).
- «Οι γραμμές μου · N / Όλες · N» split: only when the Stop has bus/trolley lines **and** the
  user has a favourite Line among them. Never for metro/tram/suburban stops. The ticked
  segment shows an SVG check, not «✓ ».
- **The other lines must be visibly there** (Harold, 2026-10-29). With «Οι γραμμές μου» on:
  - The header of the short list says how many: «Περνούν επίσης · 21 γραμμές» (today:
    «Περνούν επίσης», no count, max 4 rows).
  - Up to 4 short rows as today, then one full-width row «Όλες οι γραμμές της στάσης (22) ›»
    that switches the segment to «Όλες» (same words as the app's favourites screen).
  - In the peek height of the phone sheet, at least the «Περνούν επίσης · N» header shows
    above the fold, so the user sees that more exists without a scroll.
  - Lines with no bus near stay as chips («Χωρίς λεωφορείο κοντά τώρα:»).
- Rows grouped by Line + direction (Pattern `direction`, not headsign: Ελ. Βενιζέλος and
  Δημοτικό Θέατρο are one M3 row with the headsign of the next Arrival), up to 3 times, bell.
  Tap a row → push `vehicle` (first known Vehicle) else `line`.
- Platform chip «Αποβ. 2» for suburban.
- Footer: «Απέναντι στάση ›» (bus), «Κοντινές στάσεις» (other modes within 400 m).
- Headsigns: one case rule for all modes (title case from the Source; STASY upper case folded
  to title case client-side, as `→ Ελληνικό`).

**Line card** (requirement 10)
- Header: badge, name, star (Favourite Line), freshness.
- Direction segmented control: exactly two segments (Pattern `direction` 0/1), label = the
  most common headsign of that direction.
- **Vehicles now** of that direction: one row each `[label/#] [next stop] [delay] ›`, tap →
  push `vehicle` and focus the map.
- **Σήμερα**: today's runs, collapsed to one row «42 δρομολόγια · επόμενο 15:40 ›»; open =
  the day list (bus today; rail when the endpoint exists).
- Slot for the frequency summary (option B, `frequent.html`) when headway ≤ 20 min; phase 3/4.

### B3. One vehicle marker for all modes [web]

Requirement 4. Today: rail dots ≈ 2× bus dots and coloured like delay classes (audit 2).

- **Same size for every mode**: today's bus scale (2.5 px at z10, 4.5 at z13, 10 at z14, 13 at
  z17). Selected: +3 px and the accent ring.
- **Shape tells the mode family, discreetly**: road (bus, trolley) = circle; rail (metro, tram,
  suburban) = rounded square, 45° not rotated. At z ≥ 14 the label pill (`.bus` in `app.css`)
  takes over for all modes: rail pills get square ends (radius 3 px), buses keep round ends.
- **Fill**: bus = delay class (as today; that is the bus map's meaning). Rail = line colour,
  never a delay colour.
- **Hollow = timetable.** Metro and tram (position `estimate`) are hollow: a line-colour ring
  with a white 2 px centre, so they never read as a delay dot and say "from the timetable".
  Suburban (position `gps`) is a solid square in the line colour. No age label on an
  estimate ever; GPS age per B4.
- Legend rows: «● λεωφορείο (χρώμα = καθυστέρηση)», «■ προαστιακός (GPS)», «□ μετρό / τραμ
  (από πρόγραμμα)», drawn with the real SVG shapes.
- Decided (Harold, 2026-10-29): shape + hollow.

### B4. Position age: one global setting [web]

Requirement 5. Today «Ηλικία θέσης» is a bus-only checkbox tied to motion (`Panel.svelte:139`).

- One setting in the map menu: «Ηλικία θέσης: Ποτέ / Μόνο παλιές (> 90″) / Πάντα». Default
  «Μόνο παλιές». Applies to every GPS Vehicle (bus, trolley, suburban).
- Fade at 90 s, hide at 600 s, for all modes (UI-SPEC-unified §3).
- Estimates (metro, tram) never show an age; their card header shows «πρόγραμμα» and the
  legend says «Μετρό και τραμ: θέση από το πρόγραμμα, όχι GPS».

### B5. Two rail tracks [web; one small backend field recommended]

Requirement 6.
- Each rail Line is drawn as two parallel lines with MapLibre `line-offset` (±2 px at z12,
  ±3.5 px at z16), one per Pattern `direction` (0 right-hand, 1 left-hand of the shape's
  travel). Branch Patterns of the same direction share the same side. **Never more than two.**
- A rail Vehicle is drawn on the offset of its direction, so opposing trains pass side by side.
- The client gets a Vehicle's direction from `run → pattern → direction`. **[backend]**
  recommended: add `direction` (0/1) to the `/v2` Vehicle (additive; saves one `/v2/runs` call
  per train). Without it the client maps `headsign → direction` from `/v2/lines/{id}` Patterns.
- **[backend] check**: STASY Patterns must give Ελ. Βενιζέλος and Δημοτικό Θέατρο the same
  `direction`. Verify on `/v2/lines/stasy:M3` before building.

### B6. Favourites: stops and lines, every mode [web]

Requirements 12-13.
- Storage: `localStorage` `fav.v2 = { stops: FavStop[], lines: FavLine[] }`, shapes and repair
  rule as UI-SPEC-unified §4. Migrate today's `favorites` (bus line ids) once to `lines`.
- Star in the header of every Stop card and Line card. No star on a Vehicle card (a Vehicle
  is temporary).
- **★ button** (top bar, right of search) opens the **Favourites panel** (a card in the stack
  area, kind `favs`):
  - Layout from the app's `favs_screen.dart` (hybrid): **Stops first, then Lines**.
  - Stops: one block each: `[mode icon] Name` + place label («Σπίτι» / «Δουλειά», set in a
    small menu: «Είναι το σπίτι / Είναι η δουλειά / Ούτε τα δύο / Αφαίρεση»). Under it the
    user's lines at that Stop, one row each `[badge] → headsign   3′  μετά 11′`. Then the
    other lines in muted text, max 3, and the row «Όλες οι γραμμές εδώ (N) ›» → push `stop`
    with «Όλες» on. Lines with no bus near: one muted line «Χωρίς λεωφορείο κοντά τώρα: 025, 026».
  - Order: morning (before 12:00) the «Σπίτι» Stop first, afternoon the «Δουλειά» Stop first
    (the app's rule, with its one-line note «Πρωί: πρώτα η στάση του σπιτιού»).
  - Lines: one row each `[badge] name` + «3 στον δρόμο · όλα στην ώρα τους» / «1 αργεί»
    (the app's summary). Tap → push `line`.
  - Data: `GET /v2/stops/{id}` for each favourite Stop while the panel is open, every 30 s,
    at most 8 in flight; only visible rows poll.
  - Empty: «Πάτα ☆ σε μια στάση ή γραμμή για να μπει εδώ.»
- Bus Lines watched live keep today's cap of 5 (it protects the OASA budget); rail Lines have
  no cap.

### B7. Default view: favourites only [web]

Requirement 14.
- Decided (Harold, 2026-10-29): yes, it also hides the city bus layer.
- With ≥ 1 favourite Line, the map loads **only** those Lines (their Vehicles and shapes) and
  the favourite Stops. A pill under the search bar says it: «★ Μόνο αγαπημένα · 4 γραμμές ·
  Όλα». «Όλα» switches to all modes (city bus tiles + rail), and the pill becomes «Όλα · ★».
  The choice is stored.
- With no favourites: all, plus a one-time hint in the pill «Βάλε ☆ για να βλέπεις μόνο τις
  δικές σου».
- Side effect: fewer tile requests at load (good for the backend).

### B8. Search modal [web; places = external]

Requirements 15-16. One component replaces `LinePicker` and the search part of `Panel`.

- The search bar is a button «Αναζήτηση» (magnifier). Tap → modal: full screen on phone,
  560 px dialog on desktop. Input 16 px (no iOS zoom), autofocus, Esc / swipe down closes.
- Filter row 1 (kind): «Όλα · Γραμμές · Στάσεις · Μέρη».
- Filter row 2 (mode), chips with SVG icons and short labels: «Λεωφ.» (bus + trolley),
  «Μετρό», «Τραμ», «Προαστ.». Multi-select; none = all.
- Data: `/v2/lines` + `/v2/stops` index (loaded once, cached 1 h), matched on the client with
  accent- and case-folding («συνταγμα» = «ΣΥΝΤΑΓΜΑ»), Latin lookalikes (`selection.ts`),
  label prefix first. **[web]**
- Results grouped: Γραμμές (badge + name + star), Στάσεις (mode icons + name + area + lines),
  Μέρη. Max 5 per group, «Όλα τα N ›» opens the group.
- Empty query: favourites first, then the last 5 opened.
- Choosing a result closes the modal and replaces the stack with that card.
- **Places [external], Backlog** (Harold, 2026-10-29): until then the modal searches Lines and
  Stops only, and the «Μέρη» filter is not shown. Later: reuse the planner's `geocode()` (`src/lib/trip.ts:396-420`, Photon,
  `VITE_GEOCODE_URL`, already used by the app too: `lib/data/api.dart:25`). Debounce 300 ms,
  min 3 chars, biased to Attica, cached per query. A place row has «Οδηγίες εδώ ›» → trip
  planner with it as destination. Smaller than first thought: the geocoder is already wired.
  Geocoder: public Photon (Part D4).
- «Line picker» (requirement 15) = this modal opened with «Γραμμές» preselected.

### B9. Deep links [web; indexing = build]

Requirement 11.
- Decided (Harold, 2026-10-29): query params now; prerendered pages later (own Backlog issue).
- The top card is in the URL: `?stop=<StopId>`, `?line=<LineId>` (+ `&dir=0|1`),
  `?vehicle=<VehicleId>`. Ids are `/v2` ids, percent-encoded (`?stop=oasa%3A400012`).
- `?l=040,Α1` keeps working (today's multi-line link); it maps to «these Lines on the map».
- A `?vehicle=` that is gone (Run ended) opens its Line card with a note «Το όχημα δεν είναι
  πια σε δρομολόγιο».
- `<title>` and `<meta description>` follow the top card («Στάση Σύνταγμα · Μετρό M2, M3 ·
  Athens Transit»).
- **Google indexing** needs real HTML per Stop/Line: a build step that prerenders
  `/stop/<id>.html` and `/line/<id>.html` (name, lines, map link, canonical URL) plus
  `sitemap.xml` from the static `/v2` indexes. Not a backend change; a CI/build change.
  Phase 2 of this item.

### B10. Smaller fixes [web]

- Remove «⚠ Παλιό πρόγραμμα» (`OldTimetable.svelte`) once the web reads `/v2`.
- Durations: `5′07″`, `38″`, delay `+3′` / `−12″` (`format.ts`).
- Map controls 44×44 px on touch; the «Έρχεται εφαρμογή» chip moves into the ⓘ sheet.
- Desktop panel starts collapsed (stats behind ⓘ).

---

## Part C. Issues

Opened 2026-10-29 on the board (https://github.com/users/angelospk/projects/3). Order of work:

| # | Issue | Title | Status | Needs |
|---|---|---|---|---|
| 1 | web#10 | Card stack: vehicle → stop → line, back, history, query deep links (B1, B9 part 1) | Ready | |
| 2 | web#11 | Unified Vehicle / Stop / Line cards on /v2 (B2, B10 durations + old timetable) | Ready | 1 |
| 3 | web#12 | One vehicle marker, global position age, two rail tracks (B3-B5) | Ready | backend issue for the tracks |
| 4 | web#13 | Favourite stops and lines for all modes, ★ panel, favourites-only map (B6, B7) | Ready | 2 |
| 5 | web#14 | Search modal: lines and stops, kind/mode filters with SVG icons (B8 without places) | Ready | 1 |
| 6 | web#15 | SVG icons only, phone polish (B0, B10 rest, audit 9, 12) | Ready | |
| 7 | web#16 | Bug: vehicle card shows the same ETA for every next stop when the GPS fix is old (audit 7) | Ready | |
| 8 | rt#31 | `direction` on the /v2 Vehicle; one direction for M3 Ελ. Βενιζέλος and Δημ. Θέατρο (B5) | Ready | |
| 9 | rt#32 | Stats: publish only days from 2026-10-30 | Ready | |
| 10 | web#17 | Prerendered stop/line pages + sitemap for Google (B9 part 2) | Backlog | 1 |
| 11 | web#18 | Places in search via Photon (B8 places) | Backlog | 5 |

Web #10-#15 are sub-issues of web#4 (Phase 4). This table is the plan; the board is the state.

## Part D. Decisions (Harold, 2026-10-29)

| # | Question | Answer |
|---|---|---|
| 1 | Marker mode cue | Shape + hollow: rail is a square in the line colour; metro/tram hollow because they come from the timetable |
| 2 | Favourites-only map | Hides the city bus layer too; the ★ / «Όλα» toggle shows everything again |
| 3 | Deep links | Query params now; prerendered pages later (Backlog) |
| 4 | Geocoder | Later, public Photon (Backlog); search is Lines + Stops until then |

**D4. Geocoder notes** (checked 2026-10-29), kept for the Backlog issue:

| Option | Autocomplete allowed | Limit | Cost | Note |
|---|---|---|---|---|
| Photon public (`photon.komoot.io`) | yes | "be fair, extensive usage will be throttled", no SLA | free | already used by the web planner and the app |
| Nominatim public | no ("will get you banned") | 1 req/s | free | ruled out for search-as-you-type |
| Photon self-hosted (oracle-vm) | yes | none | VPS disk/RAM | fallback via `VITE_GEOCODE_URL`; size not measured |
| LocationIQ / Geoapify / MapTiler | yes | ~5000/day, ~3000/day, 100k/month (aggregator figures, not verified) | free tiers, key needed | a key in a client is public |

---

## Part E. Web ↔ app parity (for the app thread, requirement 17)

The app (`athens-transit-app`) should take these from this spec:

1. **No emoji, SVG icons only** (B0). Check the app's strings and icons too.
2. **One vehicle marker**: same size for every mode, circle = road, hollow rounded square = rail;
   estimate = 75 % opacity, no age (B3). Today the app draws buses as big grey dots.
3. **Position age** as one global setting, short form «12″» / «5′07″» (B4, B10). The app
   shows «ενημέρωση πριν 1"» in the stop sheet: same short rule.
4. **Two rail tracks**, one per Pattern `direction` (B5).
5. **Stop card**: «Περνούν επίσης · N γραμμές» with a count and «Όλες οι γραμμές της στάσης
   (N) ›»; no «Οι γραμμές μου» split on metro/tram/suburban stops; one row per direction
   (M3 Ελ. Βενιζέλος and Δημοτικό Θέατρο together) (B2).
6. **Vehicle card without a direction switch**; next stops each with a bell; «Γραμμή ›» (B2).
7. **Favourite stops and lines of every mode**, with the 5-line cap only for live bus lines (B6).
8. **Search filters** by kind (line / stop / place) and mode, with SVG mode icons (B8).
9. **Deep links** with the same ids (`?stop=`, `?line=`, `?vehicle=` on the web; app links to
   the same URLs) (B9).

The web takes these from the app: place labels «Σπίτι / Δουλειά» and the morning/afternoon
order, «Όλες οι γραμμές εδώ (N) ›», the line summary «N στον δρόμο · όλα στην ώρα τους», the
bottom sheet look of the stop card (B6, B2).
