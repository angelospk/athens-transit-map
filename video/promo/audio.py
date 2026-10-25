"""Music + sfx for a promo film → public/promo-<name>.wav (−14 LUFS) and out/promo-<name>-music.wav.

Usage: python3 promo/audio.py a|b   (after `bun scripts/promo-timing.ts`)
Music: promo/timing-<name>.json "music": the track from headFrom (its bar 0 on film frame 0) up to the splice frame,
then the track from tailFrom (a bar start, on the splice frame, chosen so the final hit lands on the end card), 60 ms equal-power
crossfade on the downbeat, 250 ms fade at the very end. The track (Pixabay Content License) is not in git.
Sfx are synthesized here (numpy), one per real on-screen event, each in its own band just above the music.
"""
import json
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
name = sys.argv[1]
T = json.loads((ROOT / f"promo/timing-{name}.json").read_text())
M = T["music"]
SR, FPS = 48000, T["fps"]
N = int(SR * T["durationInFrames"] / FPS)
rng = np.random.default_rng(7)


def load(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(np.float64)


track = load(ROOT / M["file"])
splice = int(SR * M["splice"] / FPS)
xf = int(0.06 * SR)
h0, t0 = int(M["headFrom"] * SR), int(M["tailFrom"] * SR)
# The crossfade ends on the splice frame, so the tail's downbeat (tailFrom) lands exactly on it.
head = track[h0:h0 + splice]
tail = track[t0 - xf:t0 + (N - splice)]
music = np.zeros((N, 2))
music[:splice - xf] = head[:splice - xf]
ramp = np.linspace(0, np.pi / 2, xf)[:, None]
music[splice - xf:splice] = head[splice - xf:splice] * np.cos(ramp) + tail[:xf] * np.sin(ramp)
rest = tail[xf:xf + N - splice]
music[splice:splice + len(rest)] = rest
fade = int(0.03 * SR)
music[:fade] *= np.linspace(0, 1, fade)[:, None]
end = int(0.25 * SR)
music[-end:] *= np.linspace(1, 0, end)[:, None] ** 2
# Stop-downs: the music drops out for 0.35 s before a frame (40 ms ramps), so the next hit lands in silence.
for sd in M.get("stopDowns", []):
    b, r = int(SR * sd / FPS), int(0.04 * SR)
    a = b - int(0.35 * SR)
    g = np.ones(N)
    # Ramps and the dip clipped to [0, N): a stop-down near either end of the film stays inside it.
    for lo, hi, ramp in ((a - r, a, np.linspace(1, 0.05, r)), (a, b, None), (b, b + r, np.linspace(0.05, 1, r))):
        i, j = max(0, lo), min(N, hi)
        if i < j:
            g[i:j] = 0.05 if ramp is None else ramp[i - lo:j - lo]
    music *= g[:, None]


def envlp(n, a, r):
    e = np.ones(n)
    a, r = max(1, int(a * SR)), max(1, int(r * SR))
    e[:a] = np.linspace(0, 1, a)
    e[-r:] *= np.exp(-np.linspace(0, 6, r))
    return e


def sine(f, dur, a=0.002, r=None):
    n = int(dur * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * f * t) * envlp(n, a, r or dur)


def noise_band(dur, lo, hi):
    n = int(dur * SR)
    x = rng.standard_normal(n)
    X = np.fft.rfft(x)
    fr = np.fft.rfftfreq(n, 1 / SR)
    X[(fr < lo) | (fr > hi)] = 0
    return np.fft.irfft(X, n)


def tap():   # soft high click, 2.4-6 kHz
    x = noise_band(0.035, 2400, 6000) * envlp(int(0.035 * SR), 0.001, 0.034)
    return x / np.max(np.abs(x)) * 0.45 + sine(1900, 0.035) * 0.12


def tick():   # keystroke, 4-9 kHz
    x = noise_band(0.02, 4000, 9000) * envlp(int(0.02 * SR), 0.0005, 0.019)
    return x / np.max(np.abs(x)) * 0.25


def pop():   # pitched blip for an API hit, 880 Hz → 1320 Hz
    n = int(0.12 * SR)
    t = np.arange(n) / SR
    f = 880 + 440 * np.minimum(1, t / 0.03)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * envlp(n, 0.002, 0.118) * 0.35


def whoosh():   # band-swept noise, 0.3 s, quiet
    n = int(0.3 * SR)
    x = noise_band(0.3, 900, 7000)
    e = np.sin(np.linspace(0, np.pi, n)) ** 2
    return x / np.max(np.abs(x)) * e * 0.12


def chime(notes=(1046.5, 1318.5, 1568.0), dur=0.9):
    out = np.zeros(int((dur + 0.1 * len(notes) + 0.1) * SR))
    for i, f in enumerate(notes):
        s = sine(f, dur, 0.004, dur) * 0.18
        h = sine(f * 2, dur * 0.6, 0.004, dur * 0.6) * 0.05
        s[:len(h)] += h
        o = int(i * 0.07 * SR)
        out[o:o + len(s)] += s
    return out


SFX = {"tap": tap, "tick": tick, "pop": pop, "whoosh": whoosh, "chime": chime, "end": lambda: chime((783.99, 1046.5, 1318.5, 1568.0), 1.4)}
# Promo B: earshot bank sounds (kind/member), rendered by promo/sfx.sh to out/sfx/<kind>__<member>.wav; each at a
# peak set by its role (hits loudest, keys and blips quietest), the same band above the music as the numpy sounds.
PEAK = {"cut_hit": 0.4, "mallet": 0.35, "notify": 0.4, "riser": 0.3, "swish": 0.22, "knock": 0.4, "ui_pop": 0.32, "drip": 0.25, "pro_typing_key": 0.2, "tap": 0.4}
LOWPASS = {"cut_hit": 1500}   # Hz
bank = {}


def earshot(k):
    if k not in bank:
        x = load(ROOT / "out/sfx" / (k.replace("/", "__") + ".wav")).mean(axis=1)
        if k.split("/")[0] in LOWPASS:   # the stats hits: softer, no click on top
            X = np.fft.rfft(x)
            X[np.fft.rfftfreq(len(x), 1 / SR) > LOWPASS[k.split("/")[0]]] = 0
            x = np.fft.irfft(X, len(x))
        bank[k] = x / np.max(np.abs(x)) * PEAK[k.split("/")[0]]
    return bank[k]


sfx = np.zeros(N)
for f, k in T["sfx"]:
    s = earshot(k) if "/" in k else SFX[k]()
    i = int(SR * f / FPS)
    j = min(N, i + len(s))
    sfx[i:j] += s[:j - i]
music *= 0.5 / np.max(np.abs(music))
mix = music + np.stack([sfx, sfx], 1) * 0.5


def write(path, x):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2), w.setsampwidth(2), w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())


(ROOT / "out").mkdir(exist_ok=True)
write(ROOT / f"out/promo-{name}-mix-raw.wav", mix)
write(ROOT / f"out/promo-{name}-music-raw.wav", music)


def norm(src, dst):
    j = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(src), "-af", "loudnorm=I=-14:TP=-2.6:LRA=11:print_format=json", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
    d = json.loads(j[j.rindex("{"):j.rindex("}") + 1])
    af = (f"loudnorm=I=-14:TP=-2.6:LRA=11:measured_I={d['input_i']}:measured_TP={d['input_tp']}:measured_LRA={d['input_lra']}:"
          f"measured_thresh={d['input_thresh']}:offset={d['target_offset']}:linear=true,aresample=48000")
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src), "-af", af, "-c:a", "pcm_s16le", str(dst)], check=True)


norm(ROOT / f"out/promo-{name}-mix-raw.wav", ROOT / f"public/promo-{name}.wav")
norm(ROOT / f"out/promo-{name}-music-raw.wav", ROOT / f"out/promo-{name}-music.wav")
print("ok", name, round(N / SR, 3), "s, splice at", round(M["splice"] / FPS, 3), "s,", len(T["sfx"]), "sfx")
