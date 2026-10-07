# Stop alerts (trip planner, phase 2) — plan, not built

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

For a vehicle on a serving variant with `next_stop_id`: `away = i − index(next_stop_id in variant)`,
taking the occurrence at or before `i` (loops pass a stop twice). Alert once when `0 < away ≤ N`.
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

## Recommendation

Build A first (it tests the rule with real buses), then B if alerts are used. Tests for both: repeated
stops and journeys, stale fixes, skipped threshold, missing ids, variant change, expiry, duplicate
evaluations (and for B: rejected pushes remove the subscription).
