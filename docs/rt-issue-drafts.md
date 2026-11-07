# Issue drafts for athens-transit-rt (from the web redesign)

Three features of the redesigned web need the backend. Each section below is one issue, ready to paste into
`gh issue create -R angelospk/athens-transit-rt`. Per AGENTS.md: an issue, a PR, a review, and Harold's approval
before a merge. Raise the load on OASA in small steps only (the first two add no OASA requests).

---

## 1. Crowd positions: riders confirm where their bus is (built: see the athens-transit-rt changes, contract rev 20)

**Why.** OASA positions are often late or off the road. A rider who taps «Είμαι μέσα» on a bus is a second, live
GPS on that bus. With a few riders we can tell a stale or wrong OASA fix from a real one, and show the bus where it
is.

**Web side (done, behind a flag).** `src/lib/crowd.ts` sends a fix every 15 s while the rider is on board and has
turned on «Βοήθα με τη θέση σου». It is off unless the web is built with `VITE_CROWD_URL`. The client already
drops fixes coarser than 60 m and fixes more than 400 m from where the bus says it is.

**Endpoint.** `POST /v1/crowd/fix`, JSON body:

```json
{ "ride": "uuid-per-ride", "line": "224", "vehicle": "12013", "lat": 37.97654, "lon": 23.74891,
  "accuracy": 10, "speed": 8.1, "heading": 90, "at": 1793906118 }
```

Answer `204`. `429` when a ride sends faster than every 10 s. No auth, no cookies, CORS for bus.haroldpoi.dev.

**Use.** For each vehicle, keep the fixes of the last 60 s. A vehicle with ≥2 rides that agree (within 50 m of
each other, after moving each fix along the route to the same time) gets a crowd position. In `/v2/lines/{id}/vehicles`
add `position.kind: "crowd"` (with `riders: n`) when the crowd position is newer than the OASA one, or when the
OASA one is more than 150 m off it. Keep the OASA fix in a separate field so the web can show both while we test.

**Anti-spoof.**
- A fix counts only when it is on the line's route (≤40 m from the shape) and its speed and heading fit the last fix of the
  same ride.
- One ride counts for one vehicle; a ride that jumps between vehicles is dropped.
- Rate limit per IP (e.g. 10 rides per hour). One ride alone never moves a bus; it needs two that agree.
- Fixes far from the OASA position for long (>3 min) with no second ride are logged, not used.

**Privacy.**
- No account and no device id. The ride id is random per ride and dies with it.
- Keep raw fixes in memory only, for 2 minutes. Store nothing on disk except daily counts (rides, fixes, corrections).
- Do not log IPs beyond the rate limiter's window.
- The web says this in the switch's text: «Ανώνυμα, μόνο όσο είσαι μέσα».

**Done when.** The endpoint is deployed behind a config flag. CONTRACT.md documents the new `position.kind`. A test
covers the agree/disagree rule. The web is built with `VITE_CROWD_URL` on a preview first.

---

## 2. Delay history: «συνήθως +3′» and connection risk

**Why.** The stop card and the trip planner want to say how late a line usually is at this hour, and how likely a
change is to be missed. Today we only have the live delay.

**Endpoint.** `GET /v2/lines/{id}/delays?stop={stop}&dow={0-6}&hour={0-23}` →
`{ "p50_s": 120, "p80_s": 300, "samples": 46 }` (null fields with fewer than 10 samples).

**Data.** From the delays the server already computes per trip and stop, kept as a histogram per
(line, stop, weekday/weekend, hour). That is a small table, about the size of the timetable. No new OASA requests.

**Web use.** Stop card: «συνήθως +2′» under a timetable time with no live data. Planner: a change is marked risky
when the first leg's p80 delay is more than the change's slack. Today it is marked risky at under 2 minutes of slack
(`RISK_MIN` in `src/lib/plan.ts`).

**Done when.** The endpoint is in CONTRACT.md, with a test of the histogram update and of the small-sample nulls.

---

## 3. «Κάθε μέρα»: routine reminders with the page closed (done in this repo: deploy the bot)

Not a backend issue any more. The push bot (`bot/`) already had recurring alerts for Telegram; it now takes them as
web push too, and the Ειδοποιήσεις page registers each routine as one (`src/lib/routinePush.ts`). The bot counts stops,
so «when to leave» becomes about walk ÷ 1.5′ stops before, and «5′ before» about 3 stops. «Only if something
changes» stays in the page.

**To do (a person):** deploy the bot (`bot/deploy.sh`) so push.haroldpoi.dev runs this version. A copy of the site on
another address (e.g. greekcaptain.github.io) also needs that origin in the bot's `ORIGINS`.
