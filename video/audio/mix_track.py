"""Score from the licensed track + the synthesized sfx → audio/music.wav, mix_raw.wav (48 kHz stereo).

Usage: python3 audio/mix_track.py   (after `python3 audio/make_audio.py --sfx-only`; then audio/master.sh)
The track (Pixabay Content License) is not in git: put it at the path in timing.json "music.file".
"""
import json
import subprocess
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
T = json.loads((ROOT / "timing.json").read_text())
M = T["music"]
SR, FPS = 48000, T["fps"]
N = int(SR * T["durationInFrames"] / FPS)


def load(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(np.float64)


track = load(ROOT / M["file"])
splice = int(SR * M["splice"] / FPS)
xf = int(0.06 * SR)   # short equal-power crossfade on the downbeat
h0, t0 = int(M["headFrom"] * SR), int(M["tailFrom"] * SR)
head = track[h0:h0 + splice + xf]
tail = track[t0 - xf:t0 - xf + (N - splice) + xf]
music = np.zeros((N, 2))
music[:splice] = head[:splice]
ramp = np.linspace(0, np.pi / 2, xf)[:, None]
music[splice:splice + xf] = head[splice:splice + xf] * np.cos(ramp) + tail[:xf] * np.sin(ramp)
rest = tail[xf:xf + N - splice - xf]
music[splice + xf:splice + xf + len(rest)] = rest
fade = int(0.04 * SR)
music[:fade] *= np.linspace(0, 1, fade)[:, None]   # no click on frame 0

with wave.open(str(ROOT / "audio/sfx.wav")) as w:
    sfx = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").reshape(-1, 2) / 32768.0
sfx = np.pad(sfx, ((0, max(0, N - len(sfx))), (0, 0)))[:N]
music *= 0.5 / np.max(np.abs(music))
mix = music + sfx * 0.45   # sfx just above the music on real events, never over it


def write(path, x):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2), w.setsampwidth(2), w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())


write(ROOT / "audio/music.wav", music)
write(ROOT / "audio/mix_raw.wav", mix)
print("ok", N / SR, "s; splice at", M["splice"] / FPS, "s")
