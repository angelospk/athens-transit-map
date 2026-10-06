# Motion autoresearch: report

Results of the autoresearch-style lab (`lab/motion/`) for the question "where is the bus now, between two GPS
fixes?". Rules, metric and the full experiment log: `lab/motion/program.md`. Why the data limits what a guess can
do: `docs/research/realistic-motion.md`. The model that shipped: `docs/superpowers/specs/2026-10-06-stop-aware-motion-design.md`.

## Headline

| | Before | Now |
|---|---|---|
| Median distance from the true position (`\|e\|` p50) | 225 m | **122 m** |
| Size of the correction at each new fix (`jump` p50) | 289 m | **144 m** |
| Corrections in the browser (live, 60 s) | 219 | **184** |

The first two rows come from the test split (36 min, Tue 2026-10-06 11:19-11:59, never used for tuning), line
markers with all stops. The third row was measured live in a browser; it is not recorded in the lab or in git.

Trade-off: the guess is now ahead of the bus more often (21% of fixes more than 50 m ahead, was 3%). That means
a few more small backward corrections. The median error halves.

## Test split, all variants

| Variant | score | `\|e\|` p50 | bias | ahead > 50 m | `jump` p50 |
|---|---|---|---|---|---|
| before | 343 | 225 m | −222 m | 3% | 289 m |
| line markers (all stops) | 236 | 122 m | −52 m | 21% | 144 m |
| city layer, `path` to the next stop only (backend rev 3) | 310 | 183 m | −159 m | 11% | 256 m |
| city layer, `path` + `path_beyond` (backend rev 4) | 239 | 122 m | −43 m | 22% | 147 m |

`score` = mean error per true fix in metres; an error ahead of the bus counts 1.5×. Lower is better.

## What the experiments showed (tune split, score)

| Idea | Result | Kept |
|---|---|---|
| Old model: speed fades over 60 s, stops at the next stop | 255 | baseline |
| Constant 0.8 × speed, no cap at the next stop | 173 | yes |
| Brake 1 m/s², 15 s wait at stops, cruise keeps the mean speed | 170 | yes (same score, looks right) |
| Wait 10 / 25 s, acceleration 0.6 m/s² | 169-171 | no (noise) |
| Speed factor 0.8 / 0.9 / 1.0 | 170 / 167 / 171 | 0.85 (a bit slow on purpose) |
| Horizon 120 / 150 / 180 / 240 s | +5 / 0 / 0 / 0 | 180 s |
| `path` only to the next stop | +60 | no: the backend must send more stops |
| TheTransitClock LastVehicle (speed of peers ahead) | +100 alone, +2 blended | no |
| Scalar Kalman filter on speed | +50 | no |
| Own mean speed over 300 s instead of the backend median slope | −2 | no (inside noise) |
| Minimum cruise 3 / 4 / 5 / 6 / 8 m/s (4 h data) | 194 / 199 / 211 / 227 / 266 vs 197 | 3 m/s |

## Conclusions

1. The big win came from removing the stop at the next stop. Real buses pass that stop long before the next fix
   arrives (66-100 s later), so the old guess was behind in 75% of cases.
2. Fine tuning (waits, factor, horizon) moves the score by 2-5 m. That is noise at this data size.
3. Importing ideas from transit-prediction systems (peer speed, Kalman) did not beat the simple model.
4. The backend must send the stops beyond the next one (`path_beyond`, contract rev 4). Without them the gain
   drops from 343 → 239 to 343 → 310.

## Limits

- All data is from one Tuesday, mostly 11:00-15:30. Rush hour, weekends and night are not measured.
- Since 2026-10-06 the live backend records every fix (`--history`), so a longer retune is possible.
- The "corrections in the browser" row is a single live reading, not a controlled run.
