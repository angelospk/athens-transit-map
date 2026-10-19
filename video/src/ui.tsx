// Shared pieces: the capture player (camera + drawn cursor), kinetic words, plates, the bus pill.
import React from "react";
import { Easing, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion";
import { C, FONT, inOut, inn, out } from "./tokens";
import { capAt, Key, Seg, segLen } from "./timeline";
import city from "../public/cap/city.json";
import follow from "../public/cap/follow.json";
import vehicle from "../public/cap/vehicle.json";
import planner from "../public/cap/planner.json";

type Track = { x: number; y: number; c: number; b?: { x: number; y: number; w: number; h: number } }[];
export const CAPS: Record<string, { w: number; h: number; track: Track; marks: Record<string, number> }> =
  { city, follow, vehicle, planner } as never;

const CW = 2400, CH = 1350;

// Camera: piecewise eased interpolation between keys (t in scene frames, x/y focus in capture px, z zoom).
export function camAt(keys: Key[], f: number) {
  if (f <= keys[0].t) return keys[0];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1], b = keys[i];
    if (f <= b.t) {
      const p = inOut((f - a.t) / Math.max(1, b.t - a.t));
      return { t: f, x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p, z: a.z + (b.z - a.z) * p };
    }
  }
  return keys[keys.length - 1];
}

export type View = { s: number; tx: number; ty: number; cap: number; map: (x: number, y: number) => [number, number] };

export function viewAt(w: number, h: number, keys: Key[], segs: Seg[], f: number, breathe = true): View {
  const k0 = camAt(keys, f);
  // A slow breath on the zoom, so no hold is ever a still frame.
  const k = breathe ? { ...k0, z: k0.z * (1 + 0.012 * Math.sin(f / 45)) } : k0;
  // z is absolute: z = 1 is 0.8 px per capture px (the 16:9 full frame); never below cover.
  const s = Math.max(w / CW, h / CH, 0.8 * k.z);
  const tx = Math.min(0, Math.max(w - CW * s, w / 2 - k.x * s));
  const ty = Math.min(0, Math.max(h - CH * s, h / 2 - k.y * s));
  return { s, tx, ty, cap: capAt(segs, f), map: (x, y) => [tx + x * s, ty + y * s] };
}

const ARROW = "M0 0 L0 17 L4.6 12.6 L7.6 19.4 L10.4 18.2 L7.5 11.6 L13.4 11.6 Z";

// A capture clip in a box: the video segments, the camera, a drawn cursor with click ripples, and an overlay slot.
export const Cap: React.FC<{
  shot: string; segs: Seg[]; keys: Key[]; w: number; h: number; cursor?: boolean | ((f: number) => number);
  overlay?: (v: View, f: number) => React.ReactNode; style?: React.CSSProperties; breathe?: boolean;
}> = ({ shot, segs, keys, w, h, cursor = true, overlay, style, breathe = true }) => {
  const f = useCurrentFrame();
  const v = viewAt(w, h, keys, segs, f, breathe);
  const co = typeof cursor === "function" ? cursor(f) : cursor ? 1 : 0;
  const track = CAPS[shot].track;
  const ci = Math.min(track.length - 1, Math.round(v.cap));
  const t = track[ci];
  let start = 0;
  const vids = segs.map((s, i) => {
    const len = segLen(s);
    const el = (
      <Sequence key={i} from={start} durationInFrames={i === segs.length - 1 ? 100000 : len} layout="none">
        <OffthreadVideo src={staticFile(`cap/${shot}.mp4`)} trimBefore={s.from} playbackRate={s.rate} muted
          style={{ position: "absolute", left: 0, top: 0, width: CW, height: CH }} />
      </Sequence>
    );
    start += len;
    return el;
  });
  // Last click within 30 capture frames → ripple.
  let click = -1;
  for (let i = ci; i >= Math.max(0, ci - 30); i--) if (track[i].c) { click = i; break; }
  const [cx, cy] = v.map(t.x, t.y);
  const cs = Math.max(1.6, v.s * 1.5 * 1.25);
  return (
    <div style={{ position: "absolute", width: w, height: h, overflow: "hidden", background: "#e9e9ea", ...style }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: CW, height: CH, transformOrigin: "0 0",
        transform: `translate(${v.tx}px, ${v.ty}px) scale(${v.s})` }}>{vids}</div>
      {overlay?.(v, f)}
      {co > 0 && click >= 0 && (() => {
        const p = (v.cap - click) / 30;
        return <div style={{ position: "absolute", left: cx, top: cy, width: 0, height: 0 }}>
          <div style={{ position: "absolute", left: -60 * p * cs / 2 - 8, top: -60 * p * cs / 2 - 8, width: 60 * p * cs + 16, height: 60 * p * cs + 16,
            borderRadius: "50%", border: `${3 * (1 - p) + 1}px solid ${C.line[0]}`, boxShadow: "0 0 0 2px rgba(255,255,255,.85)", opacity: 1 - p }} />
        </div>;
      })()}
      {co > 0 && (
        <svg width={16 * cs} height={22 * cs} viewBox="-1.5 -1.5 16 22" style={{ position: "absolute", left: cx - 1.5 * cs, top: cy - 1.5 * cs,
          filter: "drop-shadow(0 2px 3px rgba(0,0,0,.35))", opacity: co }}>
          <path d={ARROW} fill="#111" stroke="#fff" strokeWidth={1.4} strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
};

// Kinetic words: each word rises out of a mask; all leave upward, fast.
export const Words: React.FC<{
  text: string; at: number; until?: number; size: number; weight?: number; color?: string;
  style?: React.CSSProperties; stagger?: number; colors?: Record<number, string>; align?: "left" | "center";
}> = ({ text, at, until = 1e9, size, weight = 800, color = C.paper, style, stagger = 3, colors = {}, align = "left" }) => {
  const f = useCurrentFrame();
  if (f < at - 1 || f > until + 20) return null;
  const words = text.split(" ");
  const pout = interpolate(f, [until, until + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: inn });
  return (
    <div style={{ fontFamily: FONT, fontSize: size, fontWeight: weight, color, lineHeight: 1.12, letterSpacing: "-0.02em",
      textAlign: align, opacity: 1 - pout, transform: `translateY(${-pout * 24}px)`, ...style }}>
      {words.map((w, i) => {
        if (w === "|") return <br key={i} />;
        const a = at + i * stagger;
        const pin = interpolate(f, [a, a + 20], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: out });
        return (
          <span key={i} style={{ display: "inline-block", overflow: "hidden", verticalAlign: "top", paddingBottom: "0.12em", marginBottom: "-0.12em" }}>
            <span style={{ display: "inline-block", transform: `translateY(${pin * 110}%)`, color: colors[i] ?? color }}>
              {w}{i < words.length - 1 && words[i + 1] !== "|" ? " " : ""}
            </span>
          </span>
        );
      })}
    </div>
  );
};

// Ink plate behind type over busy picture; scales in from its anchor corner, leaves with its words.
export const Plate: React.FC<{ at: number; until?: number; style?: React.CSSProperties; children: React.ReactNode; origin?: string }> =
  ({ at, until = 1e9, style, children, origin = "0% 100%" }) => {
    const f = useCurrentFrame();
    const p = interpolate(f, [at, at + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: out });
    const q = interpolate(f, [until, until + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: inn });
    if (p <= 0 || q >= 1) return null;
    return (
      <div style={{ position: "absolute", background: "rgba(17,17,19,.94)", borderRadius: 28, padding: "30px 38px",
        boxShadow: "0 18px 50px rgba(0,0,0,.35)", transformOrigin: origin, transform: `scale(${0.9 + 0.1 * p * (1 - q)})`,
        opacity: Math.min(p, 1 - q), ...style }}>{children}</div>
    );
  };

// The bus pill (the favicon / a followed vehicle): number, white gap, delay ring, dark hairline.
export const Pill: React.FC<{ text?: string; bg?: string; fg?: string; ring?: string; scale?: number; style?: React.CSSProperties }> =
  ({ text = "040", bg = C.line[0], fg = "#fff", ring = C.delay[0], scale = 1, style }) => (
    <div style={{ position: "absolute", width: 0, height: 0, ...style }}>
      <div style={{ position: "absolute", left: -34 * scale, top: -22 * scale, width: 68 * scale, height: 44 * scale,
        borderRadius: 22 * scale, background: bg, color: fg, border: `${4 * scale}px solid #fff`, boxSizing: "border-box",
        boxShadow: `0 0 0 ${6 * scale}px ${ring}, 0 0 0 ${8 * scale}px rgba(0,0,0,.5), 0 ${2 * scale}px ${10 * scale}px rgba(0,0,0,.35)`,
        fontFamily: FONT, fontWeight: 800, fontSize: 21 * scale, lineHeight: `${36 * scale}px`, textAlign: "center",
        letterSpacing: "-0.01em" }}>{text}</div>
    </div>
  );

export const BellIcon: React.FC<{ size: number; color?: string }> = ({ size, color = C.paper }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} style={{ verticalAlign: "-0.12em" }}>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" fill="none" stroke={color}
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export { Easing };
