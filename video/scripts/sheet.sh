#!/usr/bin/env bash
# Contact sheet: scripts/sheet.sh in.mp4 out.png [fps=2] [cols=6] [width=480] [start=0]
set -euo pipefail
in=$1; out=$2; fps=${3:-2}; cols=${4:-6}; w=${5:-480}; ss=${6:-0}
n=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$in")
rows=$(python3 -c "import math;print(math.ceil((float('$n')-$ss)*$fps/$cols))")
ffmpeg -hide_banner -loglevel error -y -ss "$ss" -i "$in" -vf "fps=$fps,scale=$w:-1,drawtext=text='%{pts\:hms}':x=6:y=6:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.6,tile=${cols}x${rows}:padding=4" -frames:v 1 "$out"
