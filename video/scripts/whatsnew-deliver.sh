#!/usr/bin/env bash
# scripts/whatsnew-deliver.sh r1 → $OUT (default ~/athens-transit-video-local/out/whatsnew): the 9:16 master (crf 18, exact
# length, faststart), a web MP4 under 10 MB, the music-only WAV, an 18-frame contact sheet, a poster; prints size, length, loudness.
set -euo pipefail
tag=$1
cd "$(dirname "$0")/.."
OUT=${OUT:-$HOME/athens-transit-video-local/out/whatsnew}
mkdir -p "$OUT"
secs=$(python3 -c "import json;t=json.load(open('promo/timing-c.json'));print(t['durationInFrames']/t['fps'])")
m="$OUT/athens-transit-whatsnew-9x16.mp4"
# Audio from the mastered WAV (re-encoding the render's AAC overshot to +1.5 dBTP).
ffmpeg -hide_banner -loglevel error -y -i "out/c-$tag.mp4" -i public/promo-c.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -t "$secs" -movflags +faststart "$m"
# Web: 2-pass at a bitrate that lands near 8 MB for the film's length.
vb=$(python3 -c "print(int(8*8*1024/$secs - 256))")
ffmpeg -hide_banner -loglevel error -y -i "$m" -c:v libx264 -preset slow -b:v ${vb}k -pass 1 -passlogfile "out/c-web" -an -f null /dev/null
ffmpeg -hide_banner -loglevel error -y -i "$m" -c:v libx264 -preset slow -b:v ${vb}k -pass 2 -passlogfile "out/c-web" -pix_fmt yuv420p -c:a copy -movflags +faststart "${m%.mp4}-web.mp4"
cp out/promo-c-music.wav "$OUT/athens-transit-whatsnew-music-only.wav"
n=$(python3 -c "print(18/$secs)")
ffmpeg -hide_banner -loglevel error -y -i "$m" -vf "fps=$n,scale=270:-1,drawtext=text='%{pts\:hms}':x=8:y=8:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.55,tile=6x3:padding=6:color=white" -frames:v 1 "$OUT/contact-sheet.png"
ffmpeg -hide_banner -loglevel error -y -ss 1.2 -i "$m" -frames:v 1 -q:v 3 "$OUT/poster.jpg"
echo "== $m $(du -h "$m" | cut -f1) web $(du -h "${m%.mp4}-web.mp4" | cut -f1)"
ffprobe -v error -select_streams v -show_entries stream=width,height,r_frame_rate,nb_frames -of compact=p=0 "$m"
ffprobe -v error -show_entries format=duration -of compact=p=0 "$m"
ffmpeg -hide_banner -nostats -i "$m" -map 0:a -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+(I:|Peak:)"
