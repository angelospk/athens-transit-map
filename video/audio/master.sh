#!/usr/bin/env bash
# Two-pass loudnorm to -14 LUFS (TP target -2.6 so AAC still ends <= -1 dBTP).
# Usage: audio/master.sh   -> audio/mix.wav, audio/music_norm.wav, public/mix.wav
set -euo pipefail
cd "$(dirname "$0")"
norm() {
  local in=$1 out=$2 j mi mtp mlra mth off
  j=$(ffmpeg -hide_banner -nostats -i "$in" -af loudnorm=I=-14:TP=-2.6:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
  read -r mi mtp mlra mth off <<<"$(echo "$j" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["input_i"],d["input_tp"],d["input_lra"],d["input_thresh"],d["target_offset"])')"
  ffmpeg -hide_banner -loglevel error -y -i "$in" -af "loudnorm=I=-14:TP=-2.6:LRA=11:measured_I=$mi:measured_TP=$mtp:measured_LRA=$mlra:measured_thresh=$mth:offset=$off:linear=true,aresample=48000" -c:a pcm_s16le "$out"
}
norm mix_raw.wav mix.wav
norm music.wav music_norm.wav
cp mix.wav ../public/mix.wav
for f in mix.wav music_norm.wav; do
  echo "== $f"; ffmpeg -hide_banner -nostats -i $f -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+(I:|Peak:)"
done
