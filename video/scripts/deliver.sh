#!/usr/bin/env bash
# scripts/deliver.sh r1 -> out/athens-transit-16x9.mp4, -9x16.mp4, out/music-only.wav, out/contact-sheet.png
# Audio re-encoded with an exact trim so the container duration equals the picture (AAC padding otherwise adds ~15 ms).
set -euo pipefail
tag=$1
cd "$(dirname "$0")/.."
secs=$(python3 -c "import json;t=json.load(open('timing.json'));print(t['durationInFrames']/t['fps'])")
for fmt in 16x9 9x16; do
  ffmpeg -hide_banner -loglevel error -y -i "out/$tag-$fmt.mp4" -c:v copy -af "atrim=end=$secs" -c:a aac -b:a 256k -t "$secs" -movflags +faststart "out/athens-transit-$fmt.mp4"
done
cp audio/music_norm.wav out/music-only.wav
fps=$(python3 -c "print(18/$secs)")
ffmpeg -hide_banner -loglevel error -y -i out/athens-transit-16x9.mp4 -vf "fps=$fps,scale=480:-1,drawtext=text='%{pts\:hms}':x=8:y=8:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.55,tile=6x3:padding=6:color=white" -frames:v 1 out/contact-sheet.png
for f in out/athens-transit-16x9.mp4 out/athens-transit-9x16.mp4; do
  echo "== $f $(du -h "$f" | cut -f1)"
  ffprobe -v error -select_streams v -show_entries stream=width,height,r_frame_rate,nb_frames -of compact=p=0 "$f"
  ffprobe -v error -show_entries format=duration -of compact=p=0 "$f"
  ffmpeg -hide_banner -nostats -i "$f" -map 0:a -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+(I:|Peak:)"
done
