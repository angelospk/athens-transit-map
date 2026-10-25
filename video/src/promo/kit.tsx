// Shared pieces of the two promo films: the phone capture player (camera + finger), beat grids, colours, QR.
import React from "react";
import { Img, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion";
import { C, FONT, MONO, inOut, inn, out } from "../tokens";
import { capAt, Seg, segLen } from "../timeline";
import city from "../../public/cap/p-city.json";
import speed from "../../public/cap/p-speed.json";
import fav from "../../public/cap/p-fav.json";
import plan from "../../public/cap/p-plan.json";
import bcity from "../../public/cap/p-bcity.json";
import bspeed from "../../public/cap/p-bspeed.json";
import bfav from "../../public/cap/p-bfav.json";
import bplan from "../../public/cap/p-bplan.json";
import bfocus from "../../public/cap/p-bfocus.json";

export { C, FONT, MONO, inOut, inn, out };
export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const ease = (f: number, a: number, b: number, e = out) => interpolate(f, [a, b], [0, 1], { ...clamp, easing: e });

// App colours (src/app.css, src/lib/speed.ts in the repo root).
export const APP = {
  accent: "#0071e3",
  delay: { ontime: "#1a7f37", late1: "#a87c00", late2: "#d9480f", late3: "#c92a2a", none: "#6c757d" },
  speed: [[4, "#b2182b"], [8, "#ef6548"], [12, "#fdae61"], [16, "#d9ef8b"], [22, "#66bd63"], [30, "#2166ac"]] as [number, string][],
  tg: "#2aabee",
};

// A beat grid: frame of beat k (fractional tempo, rounded), and of bar n (4 beats).
export const grid = (bpm: number) => {
  const beat = 3600 / bpm;
  return { beat, b: (k: number) => Math.round(k * beat), bar: (n: number) => Math.round(n * 4 * beat) };
};

type Track = { x: number; y: number; c: number; d?: number; s?: number }[];
export const PCAPS: Record<string, { w: number; h: number; frames: number; track: Track; marks: Record<string, number> }> =
  { city, speed, fav, plan, bcity, bspeed, bfav, bplan, bfocus } as never;
export const PW = 1170, PH = 2532;   // phone capture px (390x844 CSS at 3x)

export type Key = { t: number; x: number; y: number; z: number };
export const fit = (from: number, to: number, len: number): Seg => ({ from, to, rate: (to - from) / len });

export function camAt(keys: Key[], f: number): Key {
  if (f <= keys[0].t) return keys[0];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1], b = keys[i];
    if (f <= b.t) {
      const p = inOut((f - a.t) / Math.max(1, b.t - a.t));
      return { t: f, x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p, z: a.z * Math.pow(b.z / a.z, p) };
    }
  }
  return keys[keys.length - 1];
}

// The phone capture in a w x h box. keys: focus (capture px) and z (screen px per capture px); never below cover.
// Finger: a soft ring where the capture's finger is, pressed while it taps, a ripple after each tap.
export const PCap: React.FC<{
  shot: string; segs: Seg[]; keys: Key[]; w: number; h: number; finger?: boolean; still?: string; breath?: boolean;
  overlay?: (map: (x: number, y: number) => [number, number], s: number, cap: number) => React.ReactNode; style?: React.CSSProperties;
}> = ({ shot, segs, keys, w, h, finger = true, still, breath = true, overlay, style }) => {
  const f = useCurrentFrame();
  const k0 = camAt(keys, f);
  const k = { ...k0, z: k0.z * (breath ? 1 + 0.01 * Math.sin(f / 40) : 1) };   // a slow breath: no hold is a still frame (B: off, fixed scale)
  const s = Math.max(w / PW, h / PH, k.z);
  const tx = Math.min(0, Math.max(w - PW * s, w / 2 - k.x * s));
  const ty = Math.min(0, Math.max(h - PH * s, h / 2 - k.y * s));
  const map = (x: number, y: number): [number, number] => [tx + x * s, ty + y * s];
  const cap = still ? 0 : capAt(segs, f);
  let media: React.ReactNode;
  if (still) media = <Img src={staticFile(still)} style={{ position: "absolute", left: 0, top: 0, width: PW, height: PH }} />;
  else {
    let start = 0;
    media = segs.map((sg, i) => {
      const len = segLen(sg);
      const el = (
        <Sequence key={i} from={start} durationInFrames={i === segs.length - 1 ? 100000 : len} layout="none">
          <OffthreadVideo src={staticFile(`cap/p-${shot}.mp4`)} trimBefore={sg.from} playbackRate={sg.rate} muted
            style={{ position: "absolute", left: 0, top: 0, width: PW, height: PH }} />
        </Sequence>
      );
      start += len;
      return el;
    });
  }
  let touch: React.ReactNode = null;
  if (finger && !still) {
    const tr = PCAPS[shot].track, ci = Math.min(tr.length - 1, Math.round(cap)), t = tr[ci];
    let tap = -1;
    for (let i = ci; i >= Math.max(0, ci - 26); i--) if (tr[i].c) { tap = i; break; }
    const [x, y] = map(t.x, t.y);
    const r = Math.max(26, 30 * s * 1.2);
    // Fade the finger in/out over a few capture frames around its shown span.
    let vis = 0;
    for (let i = -6; i <= 6; i++) vis += tr[Math.max(0, Math.min(tr.length - 1, ci + i))].s ? 1 : 0;
    vis /= 13;
    const pressed = t.d ? 1 : 0;
    touch = (
      <>
        {tap >= 0 && (() => {
          const p = (cap - tap) / 26;
          return <div style={{ position: "absolute", left: x - r * (1 + 2 * p), top: y - r * (1 + 2 * p), width: 2 * r * (1 + 2 * p), height: 2 * r * (1 + 2 * p),
            borderRadius: "50%", border: `${4 * (1 - p) + 1}px solid ${APP.accent}`, boxShadow: "0 0 0 2px rgba(255,255,255,.8)", opacity: 1 - p }} />;
        })()}
        {vis > 0 && <div style={{ position: "absolute", left: x - r, top: y - r, width: 2 * r, height: 2 * r, borderRadius: "50%",
          background: `rgba(255,255,255,${0.35 + 0.3 * pressed})`, border: "3px solid rgba(255,255,255,.95)",
          boxShadow: "0 4px 18px rgba(0,0,0,.35), inset 0 0 0 2px rgba(0,0,0,.12)", opacity: vis, transform: `scale(${1 - 0.18 * pressed})` }} />}
      </>
    );
  }
  return (
    <div style={{ position: "absolute", width: w, height: h, overflow: "hidden", background: "#e9e9ea", ...style }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: PW, height: PH, transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${s})` }}>{media}</div>
      {overlay?.(map, s, cap)}
      {touch}
    </div>
  );
};

// Scene frame of a capture frame (first segment that shows it), for sfx and overlays.
export function sceneOf(segs: Seg[], cap: number): number | null {
  let start = 0;
  for (const s of segs) {
    const len = segLen(s);
    if (cap >= s.from && cap < s.to) return start + Math.round((cap - s.from) / s.rate);
    start += len;
  }
  return null;
}

// A chip in a line/delay colour.
export const Chip: React.FC<{ text: string; bg: string; fg?: string; size: number; style?: React.CSSProperties }> = ({ text, bg, fg = "#fff", size, style }) => (
  <span style={{ display: "inline-block", background: bg, color: fg, borderRadius: size * 0.5, padding: `${size * 0.12}em ${size * 0.025}em`,
    fontFamily: FONT, fontWeight: 800, fontSize: size, lineHeight: 1.15, paddingLeft: size * 0.45, paddingRight: size * 0.45, ...style }}>{text}</span>
);
