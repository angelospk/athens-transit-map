"""Synthesize the score + sfx from timing.json. Deterministic (seeded). No samples.

Usage: python3 audio/make_audio.py   (reads timing.json)
Output: audio/music.wav, sfx.wav, mix_raw.wav (48 kHz stereo, 16 bit).
Loudness normalisation is done afterwards by audio/master.sh (ffmpeg loudnorm).
"""
import json
import sys
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
T = json.loads((ROOT / "timing.json").read_text())
SFX_ONLY = "--sfx-only" in sys.argv   # the score comes from a licensed track (audio/mix_track.py)
OUT = ROOT / "audio"
LIFT = (T["lift"][0] / T["fps"], T["lift"][1] / T["fps"])
SR = 48000
FPS = T["fps"]
DUR = T["durationInFrames"] / FPS
N = int(SR * DUR)
BEAT = 60.0 / T["bpm"]
DROP = T["drop"] / FPS
END_LOGO = T["endLogo"] / FPS
rng = np.random.default_rng(7)


def f2s(frame):
    return frame / FPS


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def env(n, a, d, s, r, sus_len):
    """ADSR in samples; sus_len = samples held before release."""
    out = np.zeros(n)
    a, d, r = max(1, int(a * SR)), max(1, int(d * SR)), max(1, int(r * SR))
    sl = max(0, int(sus_len * SR) - a - d)
    seg = np.concatenate([
        np.linspace(0, 1, a, endpoint=False),
        np.linspace(1, s, d, endpoint=False),
        np.full(sl, s),
        np.linspace(s, 0, r),
    ])
    m = min(n, len(seg))
    out[:m] = seg[:m]
    return out


def lowpass(x, cutoff):
    """FFT brick-ish lowpass with soft knee (static)."""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 / np.sqrt(1 + (f / cutoff) ** 4)
    return np.fft.irfft(X, len(x))


def highpass(x, cutoff):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR) + 1e-9
    X *= 1 / np.sqrt(1 + (cutoff / f) ** 4)
    return np.fft.irfft(X, len(x))


def reverb(x, seconds=1.8, mix=0.25):
    ir_n = int(seconds * SR)
    t = np.arange(ir_n) / SR
    ir = rng.standard_normal(ir_n) * np.exp(-t * 6.0 / seconds)
    ir = lowpass(ir, 5000)
    ir /= np.sqrt(np.sum(ir ** 2))
    L = len(x) + ir_n
    nfft = 1 << (L - 1).bit_length()
    wet = np.fft.irfft(np.fft.rfft(x, nfft) * np.fft.rfft(ir, nfft), nfft)[: len(x)]
    return x * (1 - mix) + wet * mix * 3.0


def add(buf, sig, t0):
    i = int(round(t0 * SR))
    if i >= len(buf):
        return
    if i < 0:
        sig = sig[-i:]
        i = 0
    m = min(len(sig), len(buf) - i)
    buf[i:i + m] += sig[:m]


def saw(freq, n, detune=0.0):
    t = np.arange(n) / SR
    out = np.zeros(n)
    for dt in (-detune, 0.0, detune):
        ph = (t * freq * (1 + dt)) % 1.0
        out += 2 * ph - 1
    return out / 3


def tri(freq, n):
    t = np.arange(n) / SR
    ph = (t * freq) % 1.0
    return 4 * np.abs(ph - 0.5) - 1


# ---------- harmony: D major, I-vi-IV-V with sevenths, one chord per bar (2 s) ----------
CHORDS = [
    [50, 54, 57, 61],  # Dmaj7
    [47, 50, 54, 57],  # Bm7
    [43, 47, 50, 54],  # Gmaj7
    [45, 49, 52, 55],  # A7
]
BASS = [38, 35, 31, 33]
BAR = 4 * BEAT
n_bars = int(np.ceil(DUR / BAR))

pad = np.zeros(N)
bass = np.zeros(N)
pluck = np.zeros(N)
drums = np.zeros(N)
hats = np.zeros(N)

for b in range(n_bars):
    t0 = b * BAR
    if t0 >= END_LOGO + 0.01:
        break
    ch = CHORDS[b % 4]
    length = min(BAR, END_LOGO - t0) if t0 < END_LOGO else BAR
    n = int((length + 1.2) * SR)
    for m in ch:
        pad_note = saw(midi(m), n, 0.004) * env(n, 0.25, 0.4, 0.7, 1.0, length)
        add(pad, pad_note * 0.12, t0)
    # bass: root on beats, after the drop
    for k in range(4):
        tb = t0 + k * BEAT
        if tb < DROP or tb >= END_LOGO:
            continue
        nb = int(BEAT * 0.9 * SR)
        note = (np.sin(2 * np.pi * midi(BASS[b % 4]) * np.arange(nb) / SR)
                + 0.3 * tri(midi(BASS[b % 4]) * 2, nb))
        add(bass, note * env(nb, 0.005, 0.12, 0.6, 0.08, BEAT * 0.75) * 0.45, tb)
    # pluck arpeggio in 8ths from 1 bar before the drop (filtered in intro)
    arp = ch + [ch[1] + 12, ch[2] + 12, ch[3] + 12, ch[2] + 12]
    for k in range(8):
        tp = t0 + k * BEAT / 2
        if tp >= END_LOGO:
            continue
        npk = int(0.35 * SR)
        f = midi(arp[k] + 12)
        note = (tri(f, npk) * 0.6 + np.sin(2 * np.pi * f * 2 * np.arange(npk) / SR) * 0.25)
        note *= np.exp(-np.arange(npk) / SR * 11)
        add(pluck, note * 0.16, tp)

# final chord at END_LOGO, rings to the end
n = N - int(END_LOGO * SR)
for m in [50, 54, 57, 61, 66]:
    add(pad, saw(midi(m), n, 0.004) * env(n, 0.02, 0.5, 0.5, n / SR - 0.6, 0.6) * 0.13, END_LOGO)
    add(pluck, tri(midi(m + 12), n) * np.exp(-np.arange(n) / SR * 2.2) * 0.07, END_LOGO)

# drums after the drop: soft kick 4-on-floor, clap on 2 & 4, offbeat hats from start
beat_times = np.arange(0, DUR, BEAT)
for i, tb in enumerate(beat_times):
    if tb >= END_LOGO:
        break
    lifted = LIFT[0] <= tb < LIFT[1]
    if tb >= DROP and (lifted or i % 2 == 0):
        nk = int(0.35 * SR)
        tt = np.arange(nk) / SR
        freq = 48 + 90 * np.exp(-tt * 28)
        kick = np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-tt * 9)
        add(drums, kick * 0.8, tb)
        if i % 4 == 2 or (lifted and i % 2 == 1):
            nc = int(0.18 * SR)
            clap = highpass(rng.standard_normal(nc), 1200) * np.exp(-np.arange(nc) / SR * 22)
            add(drums, clap * 0.18, tb)
    nh = int(0.05 * SR)
    hat = highpass(rng.standard_normal(nh), 7000) * np.exp(-np.arange(nh) / SR * 70)
    add(hats, hat * (0.07 if LIFT[0] <= tb < LIFT[1] else 0.04), tb + BEAT / 2)

# intro: everything before the drop is muffled (lowpass) => tension, then opens
t = np.arange(N) / SR
pre = t < DROP
intro_pad = lowpass(pad, 700)
intro_pluck = lowpass(pluck, 1200)
pad = np.where(pre, intro_pad, pad)
pluck = np.where(pre, intro_pluck * 0.7, pluck)
# riser into the drop
nr = int(1.0 * SR)
riser = highpass(rng.standard_normal(nr), 2500) * np.linspace(0, 1, nr) ** 2 * 0.06
add(hats, riser, DROP - 1.0)

pad = reverb(lowpass(pad, 3200), 2.2, 0.35)
pluck = reverb(pluck, 1.4, 0.3)
music = pad + bass + pluck + drums + hats
# fade the last 0.25 s so the film ends clean
fade = np.ones(N)
nf = int(0.25 * SR)
fade[-nf:] = np.linspace(1, 0, nf)
music *= fade

# ---------- sfx: only real on-screen events ----------
sfx = np.zeros(N)


def bell(f1, f2, dur=0.35, amp=0.25):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    s = np.sin(2 * np.pi * f1 * tt) + 0.5 * np.sin(2 * np.pi * f2 * tt)
    return s * np.exp(-tt * 14) * amp


def tap(amp=0.35):
    n = int(0.04 * SR)
    tt = np.arange(n) / SR
    click = highpass(rng.standard_normal(n), 3000) * np.exp(-tt * 400)
    body = np.sin(2 * np.pi * 1800 * tt) * np.exp(-tt * 120) * 0.4
    return (click + body) * amp


def pop(amp=0.3):
    n = int(0.08 * SR)
    tt = np.arange(n) / SR
    f = 700 + 900 * tt / 0.08
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 45) * amp


def whoosh(amp=0.16, dur=0.4):
    n = int(dur * SR)
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    seg = n // 8
    for k in range(8):  # stepped bandpass sweep up
        c = 600 * 2 ** (k * 0.5)
        part = highpass(lowpass(noise[k * seg:(k + 1) * seg + seg], c * 1.6), c)
        out[k * seg:k * seg + len(part)] += part[: n - k * seg]
    shape = np.sin(np.linspace(0, np.pi, n)) ** 2
    return out * shape * amp


def boom(amp=0.5):
    n = int(0.9 * SR)
    tt = np.arange(n) / SR
    f = 38 + 50 * np.exp(-tt * 10)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 4) * amp


def chime(notes, amp=0.12, dur=1.4):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    s = sum(np.sin(2 * np.pi * midi(m) * tt) * np.exp(-tt * (3 + i)) for i, m in enumerate(notes))
    return s * amp


KINDS = {
    "ping": lambda i: bell(1568 + 120 * (i % 2), 2350, amp=0.17),
    "tap": lambda i: tap(),
    "tick": lambda i: tap(0.12),
    "pop": lambda i: pop(),
    "boom": lambda i: boom(),
    "bell": lambda i: bell(2637, 3951, 0.25, 0.14),
    "chimeNotify": lambda i: chime([84, 88], 0.10, 0.9),
    "chimeSaved": lambda i: chime([77, 81, 84], 0.08, 1.0),
    "chimeBalance": lambda i: chime([81, 84, 88, 93], 0.06, 1.4),
    "chimeEnd": lambda i: chime([74, 81, 86, 90], 0.07, 1.3),
}
for i, (fr, kind) in enumerate(T["sfx"]):
    add(sfx, KINDS[kind](i), f2s(fr) + (0.02 if kind == "ping" else 0))
for fr in T["whoosh"]:
    add(sfx, whoosh(0.12), f2s(fr) - 0.22)
sfx = highpass(sfx, 180)  # keep sfx out of the bass range


def stereo(x, width=0.0):
    return np.stack([x, x], axis=1)


def write(path, x):
    x = np.clip(x, -1, 1)
    data = (x * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())


music_st = stereo(music)
# small width: pluck slightly right, hats slightly left
music_st[:, 0] += 0.15 * hats - 0.1 * pluck
music_st[:, 1] += -0.15 * hats + 0.1 * pluck
peak = np.max(np.abs(music_st))
music_st *= 0.5 / peak
sfx_st = stereo(sfx) * (0.5 / peak)
if SFX_ONLY:
    write(OUT / "sfx.wav", stereo(sfx / np.max(np.abs(sfx)) * 0.5))
    print("sfx only", N / SR, "s")
    sys.exit(0)
write(OUT / "music.wav", music_st)
write(OUT / "sfx.wav", sfx_st)
write(OUT / "mix_raw.wav", music_st + sfx_st)
print("ok", N / SR, "s")
