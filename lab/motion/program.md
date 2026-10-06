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
