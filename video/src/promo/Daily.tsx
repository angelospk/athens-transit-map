// Daily announcement clip: a short 9:16 motion graphic with no captures, driven only by props.
// Render: bunx remotion render daily out.mp4 --props=daily.json
import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT, MONO, inOut, out } from "../tokens";
import { APP, ease } from "./kit";

export type DailyProps = {
  from?: string;        // old thing, struck out in the first beat (optional)
  title: string;        // the big word; text after the last "." is drawn in the accent
  sub: string;          // one line under the title
  chips?: string[];     // short pills, popped in one by one
  cta: string;          // last line
};

export const DAILY_FPS = 30;
export const DURATION_DAILY = 9 * DAILY_FPS;

const ROUTES = [
  { d: "M -80 420 C 260 360, 420 760, 1160 640", c: C.line[0] },
  { d: "M -60 1500 C 300 1300, 700 1720, 1160 1380", c: C.line[1] },
  { d: "M 180 -60 C 120 600, 980 1100, 860 1990", c: C.line[2] },
  { d: "M 1140 180 C 700 420, 520 1180, -80 1120", c: APP.accent },
];

const Routes: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill>
      <svg width={1080} height={1920} style={{ position: "absolute", opacity: 0.8 }}>
        {ROUTES.map((r, i) => {
          const p = ease(f, i * 8, 120 + i * 8, inOut);
          return <path key={i} d={r.d} pathLength={1} fill="none" stroke={r.c} strokeWidth={14} strokeLinecap="round"
            strokeDasharray="1 1" strokeDashoffset={1 - p} />;
        })}
      </svg>
      {ROUTES.map((r, i) => {
        const p = ((f * (0.0022 + i * 0.0004)) + i * 0.23) % 1;
        const vis = ease(f, 110 + i * 8, 130 + i * 8);
        return <div key={i} style={{
          position: "absolute", left: 0, top: 0, width: 34, height: 34, marginLeft: -17, marginTop: -17,
          borderRadius: 17, background: C.paper, border: `8px solid ${r.c}`, boxSizing: "border-box",
          offsetPath: `path("${r.d}")`, offsetDistance: `${p * 100}%`, offsetRotate: "0deg", opacity: vis,
        } as React.CSSProperties} />;
      })}
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 45%, rgba(17,17,19,0.85) 25%, rgba(17,17,19,0.25) 80%)" }} />
    </AbsoluteFill>
  );
};

const Pin: React.FC<{ f0: number }> = ({ f0 }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f - f0, fps, config: { damping: 11, stiffness: 140 } });
  const y = interpolate(s, [0, 1], [-900, 0]);
  const squash = 1 + 0.12 * Math.max(0, Math.sin(Math.min(1, (f - f0 - 8) / 10) * Math.PI)) * (f > f0 + 8 ? 1 : 0);
  return (
    <svg width={150} height={200} viewBox="0 0 60 80" style={{ transform: `translateY(${y}px) scale(${squash}, ${2 - squash})`, transformOrigin: "50% 100%", opacity: f >= f0 ? 1 : 0 }}>
      <path d="M30 78 C30 78 4 46 4 28 A26 26 0 0 1 56 28 C56 46 30 78 30 78 Z" fill={APP.delay.late3} />
      <circle cx="30" cy="28" r="10" fill="#fff" />
    </svg>
  );
};

export const Daily: React.FC<DailyProps> = ({ from, title, sub, chips = [], cta }) => {
  const f = useCurrentFrame();
  const t0 = from ? 50 : 0;                       // title beat starts after the strike-out
  const dot = title.lastIndexOf(".");
  const head = dot > 0 ? title.slice(0, dot) : title;
  const tail = dot > 0 ? title.slice(dot) : "";
  const fromOut = ease(f, 36, 56, inOut);
  const strike = ease(f, 16, 34, inOut);
  const titleIn = ease(f, t0 + 14, t0 + 38);
  const subIn = ease(f, t0 + 50, t0 + 72);
  const ctaIn = ease(f, DURATION_DAILY - 70, DURATION_DAILY - 46);
  const fade = 1 - ease(f, DURATION_DAILY - 8, DURATION_DAILY);
  const size = Math.min(170, Math.floor(1700 / Math.max(6, title.length)));
  return (
    <AbsoluteFill style={{ background: C.ink, fontFamily: FONT, color: C.paper, opacity: fade }}>
      <Routes />
      {from && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: 1 - fromOut, transform: `translateY(${fromOut * 80}px)` }}>
          <div style={{ position: "relative", fontFamily: MONO, fontSize: 84, color: C.muted }}>
            {from}
            <div style={{ position: "absolute", left: -10, top: "52%", height: 8, borderRadius: 4, background: APP.delay.late3, width: `calc(${strike * 100}% + 20px)` }} />
          </div>
        </AbsoluteFill>
      )}
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 600 }}>
        <Pin f0={t0} />
        <div style={{ marginTop: 40, fontSize: size, fontWeight: 800, letterSpacing: -4, display: "flex" }}>
          {[...head].map((ch, i) => {
            const p = ease(f, t0 + 14 + i * 2, t0 + 32 + i * 2);
            return <span key={i} style={{ opacity: p, transform: `translateY(${(1 - p) * 60}px)`, display: "inline-block" }}>{ch}</span>;
          })}
          <span style={{ color: APP.accent, opacity: titleIn, transform: `scale(${0.6 + 0.4 * titleIn})`, display: "inline-block" }}>{tail}</span>
        </div>
        <div style={{ marginTop: 36, fontSize: 54, fontWeight: 600, color: C.paper, opacity: subIn, transform: `translateY(${(1 - subIn) * 30}px)`, textAlign: "center", padding: "0 40px", lineHeight: 1.25 }}>
          {sub}
        </div>
        <div style={{ marginTop: 60, display: "flex", flexWrap: "wrap", gap: 22, justifyContent: "center", padding: "0 70px" }}>
          {chips.map((c, i) => {
            const p = ease(f, t0 + 84 + i * 7, t0 + 100 + i * 7, out);
            const col = [C.line[0], C.line[1], C.line[2], APP.accent, APP.delay.ontime][i % 5];
            return <div key={i} style={{ fontSize: 42, fontWeight: 600, padding: "14px 30px", borderRadius: 999, background: col, color: col === C.line[1] ? C.ink : "#fff",
              opacity: p, transform: `scale(${0.7 + 0.3 * p})` }}>{c}</div>;
          })}
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 260 }}>
        <div style={{ fontSize: 56, fontWeight: 600, color: C.paper, opacity: ctaIn, transform: `translateY(${(1 - ctaIn) * 24}px)` }}>{cta}</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const dailyDefaults: DailyProps = {
  from: "bus.haroldpoi.dev",
  title: "staseis.gr",
  sub: "Νέο όνομα, ίδιος χάρτης.",
  chips: ["Λεωφορεία", "Τρόλεϊ", "Μετρό", "Τραμ", "Προαστιακός"],
  cta: "Το παλιό link σε φέρνει εδώ.",
};
