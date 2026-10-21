# Motion lab: program

An autoresearch loop (after [karpathy/autoresearch](https://github.com/karpathy/autoresearch)) for
the question "where is the bus now, between two GPS fixes?". Background and data limits:
`docs/research/realistic-motion.md`.

## Files

- `prepare.ts`: the evaluator. **Do not change it** during a loop: a change to the scoring makes
  results incomparable. It replays recorded `/v1/vehicles` snapshots. For every fix A it asks each
  model for `s(t)` (metres along the shape) while A is the newest fix the map knows, and scores it
  against the true fixes in that window.
- `models.ts`: the candidates. **The only file an experiment changes.**
- Data: a directory of `v_<unix>.json` snapshots (`curl /v1/vehicles` every 30 s). Not in git.
- `history.ts`: turns the backend's fix history (`--history`, hourly gzip CSV) into such a directory,
  one hour or more at a time. It replays the backend's `speed` (motion.go) and a 25-55 s poll lag.
  Checked 2026-10-21: the same hour from the old sampler and from history scores 192 vs 192.
- `segspeed.ts`: the historical speed table (variant x 200 m bin x hour of week) for the SEG models,
  built from a time range of the history. Pass it as `SEG_TABLE=<file>`; without it SEG models are off.

## Metric

`score` = mean error per true fix, metres, where an error **ahead** of the bus counts 1.5× (it ends
in a backward correction, which looks worse than catching up). Lower is better. Also reported:
`|e|` p50/p90, `bias` (median signed error; negative = behind), `ahead>50` (share more than 50 m
ahead) and `jump` (how far the guess moves when the next fix arrives: the visible correction).

## Loop

1. Run `bun lab/motion/prepare.ts <dir> --split=tune`. Note the best score.
2. Add or change **one** idea in `models.ts` (a new model next to the old ones). Prefer ideas with
   a source (TheTransitClock, Swiftly, Geotab, papers) over invented ones; note the source in a
   comment.
3. Run the tune split again. Keep the idea if it beats the best score by ≥ 2 m; otherwise remove
   it and write one line in the log below.
4. Every few rounds, and before a decision, run `--split=test` once. Report test numbers only;
   never tune on them.
5. Stop when 3 rounds in a row give no gain, or when the data is used up.

## Constraints

- A model may use only what the map has at that moment: this run's fixes up to A, the shape and
  stops, and peers' fixes known by `now`. `prepare.ts` enforces this for peers.
- Simple wins: a model that needs a new backend field must beat the best simpler one clearly.
- Harold prefers cautious motion: with equal scores, take the one with lower `ahead>50`.

## Log

| Date | Data | Idea | Tune score | Kept |
|---|---|---|---|---|
| 2026-10-06 | 33 min, Tue 11:19-11:52 | baseline: today (decay 60 s, cap at next stop) | 255 | - |
| 2026-10-06 | same | constant 0.8 x speed, no cap (h 150 s, 1.5 m/s without speed) | 173 | yes |
| 2026-10-06 | same | stops: brake 1 m/s2, 15 s dwell, cruise keeps the mean speed | 170 | yes (same score, looks right) |
| 2026-10-06 | same | dwell 10 / 25 s; acceleration 0.6 m/s2 | 169-171 | no (noise) |
| 2026-10-06 | same | factor 0.8 / 0.9 / 1.0 | 170 / 167 / 171 | 0.85 (Harold: a bit slower) |
| 2026-10-06 | same | horizon 120 / 150 / 180 / 240 s | +5 / 0 / -0 / 0 | 180 |
| 2026-10-06 | same | path only to the next stop (today's backend) | +60 | backend must send more stops |
| 2026-10-06 | same | TheTransitClock LastVehicle: peers' speed over next 400 m (alone / 1:1 blend) | +100 / +2 | no |
| 2026-10-06 | same | scalar Kalman on speed, prior 3 ± 2 m/s | +50 | no |
| 2026-10-06 | same | own mean speed over 300 s instead of backend median slope | -2 | no (within noise; recheck with more data) |
| 2026-10-06 | 4 h, Tue 11:19-15:30 | min cruise 3/4/5/6/8 m/s, rest as longer waits at stops (Harold: "it does not stop at stops" on slow lines) | 194/199/211/227/266 vs 197; test 173 vs 173 | 3 m/s (same score, visible stops) |
| 2026-10-21 | history 2026-10-06..20 (`variant` = shape id; Codex review fixed route_code, `s_m` -1 rows); table from tune days 06-15, test 8 one-hour windows 16-20 | SEG: walk 200 m bins at their historical mean speed per hour of week (TheTransitClock / Swiftly historical average) | test 144 vs SHIP 204 | wins (proposed, not shipped) |
| 2026-10-21 | same | SEG all hours / SEG + own speed 1:1 | test 165 / 164 | no (hour of week and pure table are better) |
| 2026-10-21 | same | SEG mean speed of the next 180 s fed into `drive` (stops stay visible), pace 1 / 0.85 | test 184 / 184 | no: averaging loses most of the gain |

## Round 2026-10-21 (two weeks of history)

Test windows (local time, one hour each; table built only from 2026-10-06..15), score (lower is better):

| Window | today | SHIP (path to 3 stops) | SEG hour of week |
|---|---|---|---|
| Mon 08:00 rush | 223 | 170 | 123 |
| Tue 08:00 rush | 309 | 216 | 143 |
| Mon 12:00 | 238 | 166 | 115 |
| Fri 18:00 rush | 229 | 170 | 130 |
| Tue 18:00 rush | 231 | 167 | 132 |
| Sat 12:00 | 272 | 194 | 140 |
| Sun 12:00 | 431 | 254 | 173 |
| Mon 23:00 night | 519 | 294 | 195 |
| **mean** | **307** | **204** | **144** |

Mean over windows: SEG |e| p50 74 m vs 116 m, `jump` p50 77 vs 139 m, bias +6 vs -36 m, `ahead>50` 31% vs 24%.
The gain does not depend on the assumed poll lag: with 10 / 45 s instead of 25 s it is 61 / 71 m (Mon 08:00 and Sun 12:00).
The all-stops SHIP model scores the same (206), so the 3-stop path end is not the cause.
Fri 12:00 and Sat 00:00 were left out (1074 and 2108 cases: feed gaps); SEG also won there (235 vs 468, 229 vs 305).

- The shipped model holds out of sample: 204 over all windows, close to the 2026-10-06 tune score. It is
  weakest at night and on Sunday (fewer stops served, the measured speed is less typical).
- SEG wins in every window by 30-100 m, more than the 15-20 m stop rule. The gain is where along the
  route the bus is slow (lights, busy stops), not the mean speed: fed into `drive` as one speed it keeps only 20 m.
- Cost: SEG has no visible wait at stops (it slows down where buses slow down), and `ahead>50` rises from 24% to 30%.
- Data checks: 7.7 M history rows, one GTFS feed (2026-07-08) in all of them; 4.2% have `s_m` -1 (not on
  the shape) and are skipped. Backend `s_m` vs the lab's projection of the same fix: p50 1 m, p90 7 m.
- Reproduce (data in `/home/harold/motion-lab-data`, not in git):
  `bun lab/motion/segspeed.ts history 2026-10-06T09:00:00Z 2026-10-16T00:00:00Z r/seg_tune.json`, then per window
  `bun lab/motion/history.ts history r/t_<name> 2026-10-19T05:00:00Z 2026-10-19T06:00:00Z` and
  `SEG_TABLE=r/seg_tune.json bun lab/motion/prepare.ts r/t_<name>` (windows: `r/run.sh`; raw output: `r/test_results.txt`).
- To ship: the table (1.3 M keys, 34 MB as JSON) cannot go to the browser. The backend would build it
  from its own history and send per vehicle the expected time to each point of `path`/`path_beyond`
  (contract rev 5); the map walks that profile. Not started: Harold decides.

## Results

Shipped model, test split (2026-10-06 11:19-11:59, not used for tuning), line markers: median error 225 → 122 m,
`jump` p50 289 → 144 m, `ahead>50` 3% → 21%. A live browser reading (60 s, one run, not in the lab): 219 → 184 corrections.
Spec with all variants: `docs/superpowers/specs/2026-10-06-stop-aware-motion-design.md`.

- The big win was dropping the cap at the next stop: real buses pass it well before the next fix, so the old guess was behind in 75% of cases.
- Tuning of waits, factor and horizon moves the score by 2-5 m: noise at this data size. Ideas from transit systems (peer speed, Kalman) did not beat the simple model.
- The backend must send stops beyond the next one (`path_beyond`, rev 4): without it 343 → 310 instead of 343 → 239.
- Limit: one Tuesday, mostly 11:00-15:30. Rush hour, weekends and night are not measured. The backend now records history for a longer retune.
