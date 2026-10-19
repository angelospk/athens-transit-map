#!/usr/bin/env bash
# scripts/render.sh r1 -> out/r1-16x9.mp4, out/r1-9x16.mp4 (+ 2 fps sheets in frames/)
set -euo pipefail
tag=$1
cd "$(dirname "$0")/.."
mkdir -p out frames
for fmt in 16x9 9x16; do
  npx remotion render src/index.ts "film-$fmt" "out/$tag-$fmt.mp4" --concurrency=12 --crf=18 --audio-bitrate=256k --log=error
done
scripts/sheet.sh "out/$tag-16x9.mp4" "frames/$tag-16x9-2fps.png" 2 10 320
scripts/sheet.sh "out/$tag-9x16.mp4" "frames/$tag-9x16-2fps.png" 2 14 160
echo done
