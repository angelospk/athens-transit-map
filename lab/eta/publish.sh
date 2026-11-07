#!/usr/bin/env bash
# Weekly: score the last 7 days and push v1/latest.json to the `eta` branch (web#27).
# The ⓘ sheet reads it from raw.githubusercontent.com, so no deploy is needed.
#   lab/eta/publish.sh [data dir]     (systemd user timer eta-publish on the mini PC)
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DATA="${1:-$HOME/eta-lab-data}"
BUN="${BUN:-$HOME/.bun/bin/bun}"
W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT
git clone -q --depth 1 --branch eta "$(git -C "$REPO" remote get-url origin)" "$W"
"$BUN" "$REPO/lab/eta/publish.ts" "$DATA" "$W/v1/latest.json"
cd "$W"
git add v1/latest.json
if git diff --cached --quiet; then exit 0; fi
git -c user.name="eta-lab" -c user.email="eta-lab@users.noreply.github.com" commit -qm "ETA accuracy $(date +%F)"
git push -q origin eta
