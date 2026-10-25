#!/usr/bin/env bash
# promo/sfx.sh: render every earshot bank sound that promo/timing-b.json names (kind/member) to out/sfx/, then audit
# each take. earshot (MIT, https://github.com/Leonxlnx/earshot): EARSHOT=<path to its venv python>, default
# ~/tools/earshot/.venv/bin/python. The bank renders in code; no models, no network.
set -euo pipefail
cd "$(dirname "$0")/.."
PY=${EARSHOT:-$HOME/tools/earshot/.venv/bin/python}
mkdir -p out/sfx
for id in $(python3 -c "import json;print(' '.join(sorted({k for _, k in json.load(open('promo/timing-b.json'))['sfx'] if '/' in k})))"); do
  out="out/sfx/${id//\//__}.wav"
  "$PY" -m earshot sfx render "$id" -o "$out" >/dev/null
  res=$("$PY" -m earshot sfx check "$out" 2>&1)   # a failing audit stops the script (set -e)
  echo "$id: ${res%%$'\n'*}"
done
