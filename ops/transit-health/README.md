# transit-health

Hourly check of the bus feeds behind the map. It fetches every city, judges the feed, and sends one
ntfy message when something starts or stops — not every hour it stays broken.

## What it checks

- `athens` (`/v2/vehicles`), `thessaloniki` (`/v2/vehicles`), and every citybus.gr city of
  `src/lib/citybus.ts` (its z9 vehicle tiles).
- `error` — the fetch failed (non-200, network, bad JSON).
- `empty` — fewer vehicles than `minVehicles[city]`, during service hours only.
- `feed_old` — `updated_at` missing, or older than `feedOldS`.
- `source` — a /v2 source is `stale` or `down`.
- `no_position` — more than `maxNoPositionRatio` of vehicles have no position.
- `stale` — more than `maxStaleRatio` of positioned vehicles have a position older than `maxAgeS`.
- `no_direction` — more than `maxNoDirectionRatio` have no direction (only `checkDirection` cities).
  The ratio rules speak only when a city has at least `minSample` vehicles.
- Night (`serviceHours`) checks `error` only: a quiet feed there is normal, not a fault.

A code fires on its `persistRuns`-th consecutive bad run and recovers on its `persistRuns`-th clean one.
Thresholds live in `config.json`.

## Where it runs

The Oracle VPS, as a systemd **user** timer (`transit-health.timer`, hourly, 5 min random delay). It is
read-only: no database, no server. State and log: `~/.local/state/transit-health/` (`state.json`,
`health.log`). The ntfy topic lives only in `~/.config/transit-health/env` (`NTFY_TOPIC=...`, mode 600).

## Files

- `rules.ts` — pure rules (normalise, judge, persist, message). Tested by `tests/transit-health.test.ts`.
- `main.ts` — fetches, saves state, logs, posts. Built to `dist-health/transit-health.mjs`.
- `config.json` — thresholds.
- `transit-health.service`, `transit-health.timer` — the user units.
- `deploy.sh` — build, copy and install on `oracle-vm` (`ssh oracle-vm`); enables the timer only when
  the env file exists.

## Force a test

    node dist-health/transit-health.mjs --simulate patras:stale --state /tmp/x
    node dist-health/transit-health.mjs --simulate patras:stale --state /tmp/x

The first run is quiet (one hit), the second prints and posts the `new: patras/stale` message.
`--dry-run` prints the message without posting.
