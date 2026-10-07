# Stop alerts (trip planner, phase 2)

Status 2026-10-07: option A built (`src/lib/alerts.ts`, `src/lib/alertWatch.svelte.ts`, `public/sw.js`).
Option C (Telegram) built 2026-10-08 (`bot/`, `src/lib/tglink.ts`; payload format in tglink.ts); B (Web Push) is not planned while C covers iPhones.

Goal: pick a stop near you; get a phone notification shortly before a bus that goes where you want
reaches it. Settings: how early (stops before, e.g. 3), which lines.

## What exists

- Planner (phase 1): for each line, the serving variants and the boarding stop (`TripVariant.from`,
  index into `public/trips.json`; `i` = its position in the variant).
- `GET /v1/lines/{id}` gives per vehicle `variant`, `trip_id`, `next_stop_id`, `delay_s`, `position_at`.
  `/v1/vehicles` (city) has no `next_stop_id` or `trip_id`: alerts need the per-line feeds.
- Backend (`athens-transit-rt`, Go, `~/services/atrt`): read-only GET API behind Cloudflare cache.
  No push, no POST endpoints, no subscription store. Polls OASA itself (watched lines every ~30 s).

## Rule (shared by both options)

For a vehicle on a serving variant with `next_stop_id` at position k: `left = i − k + 1` (stops to the
boarding stop, itself included). Alert once when `1 ≤ left ≤ N`. A next stop the variant passes twice
(loops) says nothing about which pass it is: no answer until the bus reaches another stop. The boarding
stop's name is checked against the static file, so an index from other GTFS data never alerts.
Identity of one approach: `trip_id` (fallback `vehicle id + variant + day`) + boarding stop. Suppress:
fix older than 90 s, unknown `next_stop_id`, variant not serving. A skipped threshold (away jumps 4 → 1)
still alerts. A variant change drops the pending alert. Each alert expires after its trip or 2 h.

## Option A — in the page (no backend work)

- Alert settings in the planner: boarding stop (default: the trip's), N (1–5, default 3), lines (default: the
  trip's). Stored in localStorage.
- While any alert is set, the planner's lines stay polled (the existing pollers).
- Notification: `ServiceWorkerRegistration.showNotification` (Android Chrome throws on `new Notification()`),
  so a minimal `public/sw.js` (notificationclick → focus the tab). Permission asked on the "alert me" tap.
- Limits: works while the page is open. Hidden tabs poll every 60 s and phones may freeze them; iOS shows web
  notifications only for an installed web app (needs a manifest). Say this in the UI.

Effort: about a day with tests. Good as a first step and for testing the rule.

## Option B — Web Push (real background)

Backend (new, contract rev 5, additive):
- VAPID key pair (secret on the home machine only), `GET /v1/push/key` (public key).
- `POST /v1/alerts` {subscription, line, variants, stop_id, occurrence, n, expires_at ≤ 2 h} → id;
  `DELETE /v1/alerts/{id}`. Not cached (Cloudflare bypass for POST/DELETE), CORS preflight, size limits,
  per-IP rate limit, max alerts per subscription.
- Store: in memory + small file in `/var/lib/atrt` (survives restarts); drop on expiry and on 404/410
  from the push service.
- A line with alerts counts as watched (~30 s polls). After each poll, the rule above; send with
  `webpush-go` (check its current API first).
Frontend: service worker with `push` handler, `PushManager.subscribe`, the same settings UI.

Effort: 2–3 days, plus privacy: a subscription endpoint is personal data; keep only what the alert needs.

## Option C — Telegram bot (no account)

Why: iPhone browsers show web notifications only for a Home Screen web app, and none with the screen
locked. Telegram delivers to the phone like any message.

- Flow: 🔔 in the planner → "Στο Telegram" opens `https://t.me/<bot>?start=<payload>`; the user taps Start;
  the bot answers with what it watches and buttons [Σταμάτα] [Απεγγραφή από όλα]. Identity = Telegram
  chat id. No account, no email.
- Payload (≤ 64 chars `[A-Za-z0-9_-]`, so ≤ 48 bytes before base64url): `v1|line|variant|i|n` plus the
  GTFS version day. Variant + position keep the planner's choice on loops; the bot checks them against
  the static file (name check as above) and rejects a link from other GTFS data.
- Service: a small bun service on the Oracle VPS (runs when the home machine is off; light). Telegram long
  polling (no inbound port). One paced poller per line with alerts, shared by all chats:
  `GET transit.haroldpoi.dev/v1/lines/{id}` at the contract's pace (this marks the line watched).
  Same rule (`src/lib/alerts.ts`, imported). Limits: alerts per chat (5), lines polled (20).
- State: one JSON file, written atomically (temp + rename): alerts with expiry, fired trip keys, Telegram
  update offset. Drop an alert at expiry, on Stop, and when Telegram says the chat blocked the bot (403).
- Messages (Greek): "🚌 Το 622 είναι 2 στάσεις πριν από ΑΓΟΡΑ (καθυστέρηση 3′)" + buttons.
- Needs from Harold: a bot made with @BotFather (name, token as a secret on the VPS), and one choice:
  one-off alerts (2 h) or also a repeating one ("weekdays 08:00–09:00").

Effort: about a day with tests, plus the deploy.

## Recommendation

Build A first (it tests the rule with real buses), then B if alerts are used. Tests for both: repeated
stops and journeys, stale fixes, skipped threshold, missing ids, variant change, expiry, duplicate
evaluations (and for B: rejected pushes remove the subscription).
