#!/usr/bin/env bash
# scripts/promo-deliver.sh r4 [a|b] → out/promo/athens-transit-promo-{a-9x16,b-16x9}.mp4 (master, exact length, faststart),
# *-web.mp4 (crf 23), music-only WAVs, contact sheets; prints size, duration, loudness.
set -euo pipefail
tag=$1
cd "$(dirname "$0")/.."
mkdir -p out/promo
for c in ${2:-a b}; do
  name=$([ $c = a ] && echo a-9x16 || echo b-16x9)
  secs=$(python3 -c "import json;t=json.load(open('promo/timing-$c.json'));print(t['durationInFrames']/t['fps'])")
  ffmpeg -hide_banner -loglevel error -y -i "out/$c-$tag.mp4" -c:v copy -af "atrim=end=$secs" -c:a aac -b:a 256k -t "$secs" -movflags +faststart "out/promo/athens-transit-promo-$name.mp4"
  ffmpeg -hide_banner -loglevel error -y -i "out/promo/athens-transit-promo-$name.mp4" -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart "out/promo/athens-transit-promo-$name-web.mp4"
  cp "out/promo-$c-music.wav" "out/promo/athens-transit-promo-$name-music-only.wav"
  n=$(python3 -c "print(18/$secs)")
  w=$([ $c = a ] && echo 270 || echo 480)
  ffmpeg -hide_banner -loglevel error -y -i "out/promo/athens-transit-promo-$name.mp4" -vf "fps=$n,scale=$w:-1,drawtext=text='%{pts\:hms}':x=8:y=8:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.55,tile=6x3:padding=6:color=white" -frames:v 1 "out/promo/contact-$name.png"
  ffmpeg -hide_banner -loglevel error -y -ss 1 -i "out/promo/athens-transit-promo-$name.mp4" -frames:v 1 -q:v 3 "out/promo/poster-$name.jpg"
  f="out/promo/athens-transit-promo-$name.mp4"
  echo "== $f $(du -h "$f" | cut -f1) web $(du -h "${f%.mp4}-web.mp4" | cut -f1)"
  ffprobe -v error -select_streams v -show_entries stream=width,height,r_frame_rate,nb_frames -of compact=p=0 "$f"
  ffprobe -v error -show_entries format=duration -of compact=p=0 "$f"
  ffmpeg -hide_banner -nostats -i "$f" -map 0:a -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+(I:|Peak:)"
done
