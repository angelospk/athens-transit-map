// The film: eight scenes on one timeline (src/timeline.ts). Every value is a function of the frame.
import React from "react";
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import "./fonts";
import { C, FONT, Fmt, MONO, inOut, inn, out } from "./tokens";
import { DURATION, Key, SCENES, SEGS, SceneId, sceneAt } from "./timeline";
import { BellIcon, CAPS, Cap, Plate, Pill, Words, clamp } from "./ui";
import api from "../public/cap/api.json";

type R = { x: number; y: number; w: number; h: number };
const dims = (fmt: Fmt) => (fmt === "16x9" ? { W: 1920, H: 1080 } : { W: 1080, H: 1920 });

// Window rects used by the hand-offs (screen px).
const WIN: Record<Fmt, R> = { "16x9": { x: 580, y: 177, w: 1290, h: 726 }, "9x16": { x: 40, y: 700, w: 1000, h: 840 } };
const TERM: Record<Fmt, R> = { "16x9": { x: 230, y: 250, w: 1460, h: 730 }, "9x16": { x: 20, y: 620, w: 1040, h: 920 } };
const PLAN9: R = { x: 40, y: 620, w: 1000, h: 920 };
// 9:16 full-bleed captures stop above the bottom 380 px (platform UI).
const H9 = 1640;

// clip-path that grows or shrinks between a rect and the full frame (p = 0 → rect, 1 → full).
const inset = (r: R, W: number, H: number, p: number, round = 28) =>
  `inset(${r.y * (1 - p)}px ${(W - r.x - r.w) * (1 - p)}px ${(H - r.y - r.h) * (1 - p)}px ${r.x * (1 - p)}px round ${round * (1 - p)}px)`;

const ease = (f: number, a: number, b: number, e = out) => interpolate(f, [a, b], [0, 1], { ...clamp, easing: e });

// The ink stage: a slow, faint light that drifts, so holds never freeze.
const Stage: React.FC = () => {
  const f = useCurrentFrame();
  const x = 50 + 18 * Math.sin(f / 240), y = 40 + 12 * Math.cos(f / 300);
  return <AbsoluteFill style={{ background: `radial-gradient(1200px 900px at ${x}% ${y}%, #202024 0%, ${C.ink} 60%)` }} />;
};

const S = (id: SceneId) => ({ from: SCENES[id][0], durationInFrames: SCENES[id][1] - SCENES[id][0] });
const seg = (id: SceneId) => SEGS[id]!;
const local = (id: SceneId, mark: number) => sceneAt(seg(id).segs, mark) ?? 0;

// ---------- 1. hook: the pill, the promise ----------
const Hook: React.FC<{ fmt: Fmt }> = ({ fmt }) => {
  const f = useCurrentFrame();
  const { W, H } = dims(fmt);
  const v = fmt === "16x9";
  const cx = W / 2, cy0 = v ? 400 : 760;
  const shrink = ease(f, 164, 180, inn);
  const cy = cy0 + (H / 2 - cy0) * shrink;
  const sc = (v ? 3.2 : 3.4) * (1 - shrink * 0.55) * (1 + 0.012 * Math.sin(f / 9));
  return (
    <AbsoluteFill>
      {[30, 60, 90, 120].map(b => {
        const p = interpolate(f, [b, b + 40], [0, 1], clamp);
        if (p <= 0 || p >= 1) return null;
        return <div key={b} style={{ position: "absolute", left: cx - 120 - 260 * p, top: cy - 80 - 200 * p, width: 240 + 520 * p, height: 160 + 400 * p,
          borderRadius: 999, border: `3px solid ${C.delay[0]}`, opacity: (1 - p) * 0.8 }} />;
      })}
      <Pill scale={sc} ring={C.delay[0]} style={{ left: cx, top: cy }} />
      <div style={{ position: "absolute", left: 80, right: 80, top: v ? 560 : 950 }}>
        <Words text="Λεωφορεία και τρόλεϊ της Αθήνας." at={-30} until={154} size={v ? 78 : 84} align="center" />
        <div style={{ height: 14 }} />
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 22 }}>
          {f >= 28 && f < 168 && <div style={{ width: 26, height: 26, borderRadius: 13, background: "#2fb84f",
            opacity: ease(f, 28, 40) * (1 - ease(f, 154, 166)), transform: `scale(${1 + 0.25 * Math.max(0, Math.sin(((f - 30) / 30) * Math.PI))})` }} />}
          <Words text="Ζωντανά." at={30} until={154} size={v ? 78 : 84} color="#5fd27a" />
        </div>
        <div style={{ height: 22 }} />
        <Words text="bus.haroldpoi.dev" at={-30} until={154} size={v ? 34 : 40} weight={600} color={C.muted} align="center" stagger={0} />
      </div>
    </AbsoluteFill>
  );
};

// ---------- 2. city: all vehicles, colour = delay ----------
const LEGEND: [string, string][] = [["έως 2′", C.delay[0]], ["2–5′", C.delay[1]], ["5–10′", C.delay[2]], ["πάνω από 10′", C.delay[3]]];
const Legend: React.FC<{ at: number; until: number; size: number }> = ({ at, until, size }) => {
  const f = useCurrentFrame();
  return (
    <div style={{ display: "flex", gap: size * 0.6, flexWrap: "wrap", marginTop: size * 0.6 }}>
      {LEGEND.map(([t, c], i) => {
        const p = ease(f, at + i * 6, at + i * 6 + 16);
        const q = ease(f, until + i, until + i + 10, inn);
        return <div key={t} style={{ display: "flex", alignItems: "center", gap: size * 0.3, opacity: p * (1 - q), transform: `translateY(${(1 - p) * 20}px)`,
          fontFamily: FONT, fontWeight: 600, fontSize: size, color: C.paper }}>
          <span style={{ width: size * 0.75, height: size * 0.75, borderRadius: "50%", border: `${size * 0.16}px solid ${c}`, boxSizing: "border-box" }} />{t}
        </div>;
      })}
    </div>
  );
};

const City: React.FC<{ fmt: Fmt }> = ({ fmt }) => {
  const f = useCurrentFrame();
  const { W, H } = dims(fmt);
  const v = fmt === "16x9";
  const keys: Key[] = v ? [{ t: 0, x: 1230, y: 640, z: 1.0 }, { t: 360, x: 1230, y: 690, z: 1.12 }]
    : [{ t: 0, x: 1230, y: 640, z: 1.8 }, { t: 360, x: 1230, y: 690, z: 2.0 }];
  const r = 140 + ease(f, 0, 30) * Math.hypot(W, H) * 0.6;
  const shrink = ease(f, 336, 360, inOut);
  const fast = ease(f, 140, 156);
  return (
    <AbsoluteFill style={{ clipPath: shrink > 0 ? inset(WIN[fmt], W, H, 1 - shrink) : `circle(${r}px at 50% 50%)` }}>
      <Cap {...seg("city")} keys={keys} w={W} h={H} />
      {fast > 0 && <div style={{ position: "absolute", left: W / 2, top: v ? 44 : 260, transform: `translateX(-50%) scale(${0.8 + 0.2 * fast})`, opacity: fast * (1 - shrink),
        background: "rgba(17,17,19,.94)", color: C.paper, borderRadius: 999, padding: "10px 26px", fontFamily: FONT, fontWeight: 800, fontSize: 32 }}>
        ×4 <span style={{ fontWeight: 400, color: C.muted, fontSize: 26 }}>ταχύτητα</span></div>}
      <Plate at={60} until={322} style={v ? { left: 64, bottom: 64, width: 1000 } : { left: 50, right: 50, bottom: 420 }}>
        <Words text="Το χρώμα δείχνει την καθυστέρηση." at={64} until={322} size={v ? 58 : 62} />
        <Legend at={96} until={322} size={v ? 40 : 44} />
      </Plate>
    </AbsoluteFill>
  );
};

// ---------- 3. follow: pick lines, each its own colour ----------
const LINES: [string, string, string][] = [["040", C.line[0], "#fff"], ["Α1", C.line[1], "#000"], ["Χ95", C.line[2], "#000"]];
const Chip: React.FC<{ t: string; bg: string; fg: string; size: number; p: number }> = ({ t, bg, fg, size, p }) => (
  <div style={{ background: bg, color: fg, borderRadius: 999, padding: `${size * 0.18}px ${size * 0.55}px`, fontFamily: FONT, fontWeight: 800,
    fontSize: size, opacity: p, transform: `scale(${0.6 + 0.4 * p}) translateY(${(1 - p) * 16}px)` }}>{t}</div>
);

const Follow: React.FC<{ fmt: Fmt }> = ({ fmt }) => {
  const f = useCurrentFrame();
  const { W, H } = dims(fmt);
  const v = fmt === "16x9";
  const win = WIN[fmt];
  const m = CAPS.follow.marks;
  const enters = [m.enter0, m.enter1, m.enter2].map(x => local("follow", x));
  const P = { x: 420, y: 230, z: v ? 1.5 : 1.6 }, wide = { x: 1200, y: 675, z: 0.72 }, drift = { x: 1260, y: 700, z: 0.8 };
  const k = (t: number, a: { x: number; y: number; z: number }) => ({ t, ...a });
  const keys: Key[] = [k(0, P), k(enters[0] - 4, P), k(enters[0] + 40, wide), k(enters[1] - 44, drift), k(enters[1] - 30, P), k(enters[1] - 2, P),
    k(enters[1] + 46, wide), k(enters[2] - 44, drift), k(enters[2] - 30, P), k(enters[2] - 2, P), k(enters[2] + 50, wide), k(570, { x: 1280, y: 690, z: 0.86 })];
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: win.x, top: win.y, width: win.w, height: win.h, borderRadius: 28, overflow: "hidden",
        boxShadow: "0 30px 80px rgba(0,0,0,.5)" }}>
        <Cap {...seg("follow")} keys={keys} w={win.w} h={win.h} />
      </div>
      <div style={v ? { position: "absolute", left: 90, top: 300, width: 460 } : { position: "absolute", left: 60, right: 60, top: 300 }}>
        <Words text={v ? "Διάλεξε τις | γραμμές σου." : "Διάλεξε | τις γραμμές σου."} at={12} until={196} size={v ? 60 : 84} />
      </div>
      <div style={v ? { position: "absolute", left: 90, top: 280, width: 470 } : { position: "absolute", left: 60, right: 60, top: 290 }}>
        <Words text="Έως 5 γραμμές," at={214} until={540} size={v ? 56 : 72} />
        <Words text={v ? "η καθεμιά με | δικό της χρώμα." : "η καθεμιά | με δικό της χρώμα."} at={226} until={540} size={v ? 56 : 72} weight={600} color={C.muted} />
        <div style={{ display: "flex", gap: 16, marginTop: 34 }}>
          {LINES.map(([t, bg, fg], i) => {
            const at = Math.max(enters[i] + 8, 244 + i * 6);
            return <Chip key={t} t={t} bg={bg} fg={fg} size={v ? 36 : 42} p={ease(f, at, at + 16) * (1 - ease(f, 540 + i, 552 + i, inn))} />;
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------- 4. ring: dive into one vehicle ----------
const BUS = { x: 1209, y: 877 };
const Ring: React.FC<{ fmt: Fmt }> = ({ fmt }) => {
  const f = useCurrentFrame();
  const { W, H } = dims(fmt);
  const v = fmt === "16x9";
  const keys: Key[] = [{ t: 0, x: 1200, y: 675, z: v ? 1.0 : 1.78 }, { t: 130, x: BUS.x, y: BUS.y, z: v ? 1.25 : 1.9 }, { t: 205, x: BUS.x, y: BUS.y, z: 3.0 },
    { t: 330, x: BUS.x, y: BUS.y, z: 3.3 }];
  const grow = ease(f, 0, 26, inOut);
  return (
    <AbsoluteFill style={{ clipPath: grow < 1 ? inset(WIN[fmt], W, H, grow) : undefined }}>
      <Cap {...seg("ring")} keys={keys} w={W} h={v ? H : H9} breathe={false} cursor={fr => 1 - ease(fr, 110, 130)} overlay={(vw, fr) => {
        if (fr < 196) return null;
        const [x, y] = vw.map(BUS.x, BUS.y);
        return [0, 30, 60, 90].map(d => {
          const p = interpolate(fr, [205 + d, 245 + d], [0, 1], clamp);
          if (p <= 0 || p >= 1) return null;
          const rw = 110 * vw.s * (1 + p * 0.9), rh = 76 * vw.s * (1 + p * 0.9);
          return <div key={d} style={{ position: "absolute", left: x - rw / 2, top: y - rh / 2, width: rw, height: rh, borderRadius: 999,
            border: `4px solid ${C.delay[0]}`, opacity: 1 - p }} />;
        });
      }} />
      <Plate at={212} until={316} origin="0% 50%" style={v ? { left: 1110, top: 330, width: 680 } : { left: 60, right: 60, top: 1060 }}>
        <Words text="Ο αριθμός: η γραμμή." at={214} until={316} size={v ? 50 : 58} />
        <div style={{ height: 10 }} />
        <Words text="Το δαχτυλίδι: | η καθυστέρηση." at={236} until={316} size={v ? 50 : 58} />
        <Legend at={262} until={316} size={v ? 28 : 32} />
      </Plate>
    </AbsoluteFill>
  );
};

// ---------- 5. card: what the vehicle tells you ----------
const ROWS = [{ y0: 1015, y1: 1080 }, { y0: 1080, y1: 1116 }, { y0: 1114, y1: 1152 }];
const Card: React.FC<{ fmt: Fmt }> = ({ fmt }) => {
  const f = useCurrentFrame();
  const { W, H } = dims(fmt);
  const v = fmt === "16x9";
  const keys: Key[] = [{ t: 0, x: BUS.x, y: BUS.y, z: 3.3 }, { t: 42, x: 290, y: 1130, z: v ? 2.0 : 2.4 }, { t: 236, x: 290, y: 1130, z: v ? 2.12 : 2.5 },
    { t: 270, x: 1200, y: 675, z: v ? 1.0 : 1.8 }];
  const lines = ["Πόσο αργεί.", "Πού πάει.", "Επόμενη στάση."];
  const at = [56, 86, 116];
  return (
    <AbsoluteFill>
      <Cap {...seg("card")} keys={keys} w={W} h={v ? H : H9} breathe={false} cursor={fr => ease(fr, 0, 5)} overlay={(vw, fr) => ROWS.map((r, i) => {
        const p = ease(fr, at[i] - 4, at[i] + 12) * (1 - ease(fr, 252, 266, inn));
        if (p <= 0) return null;
        const [x0, y0] = vw.map(30, r.y0), [x1, y1] = vw.map(522, r.y1);
        return <div key={i} style={{ position: "absolute", left: x0, top: y0, width: (x1 - x0) * (0.4 + 0.6 * p), height: y1 - y0, borderRadius: 12,
          border: `3px solid ${C.line[0]}`, background: "rgba(0,114,178,.10)", opacity: p }} />;
      })} />
      <Plate at={52} until={254} origin="0% 50%" style={v ? { left: 1010, top: 330, width: 760 } : { left: 60, right: 60, top: 290 }}>
        {lines.map((t, i) => <Words key={t} text={t} at={at[i]} until={254} size={v ? 64 : 72} />)}
      </Plate>
    </AbsoluteFill>
  );
};

// ---------- 6. planner + bell ----------
const Planner: React.FC<{ fmt: Fmt }> = ({ fmt }) => {
  const f = useCurrentFrame();
  const { W, H } = dims(fmt);
  const v = fmt === "16x9";
  const m = CAPS.planner.marks;
  const res = local("planner", m.results), al = local("planner", m.alert), sc = local("planner", m.scrolled);
  const keys: Key[] = v
    ? [{ t: 0, x: 1200, y: 675, z: 1.0 }, { t: 22, x: 1200, y: 675, z: 1.0 }, { t: 72, x: 2050, y: 420, z: 1.9 }, { t: res - 16, x: 2050, y: 420, z: 1.9 },
      { t: res + 30, x: 1750, y: 640, z: 1.45 }, { t: al - 30, x: 1800, y: 660, z: 1.6 }, { t: al + 6, x: 2050, y: 900, z: 1.9 }, { t: sc + 10, x: 2050, y: 1010, z: 1.9 },
      { t: 720, x: 2060, y: 1030, z: 2.0 }]
    : [{ t: 0, x: 1900, y: 400, z: 0.9 }, { t: 22, x: 1900, y: 400, z: 0.9 }, { t: 72, x: 2065, y: 420, z: 2.4 }, { t: res - 16, x: 2065, y: 420, z: 2.4 },
      { t: res + 30, x: 1700, y: 680, z: 1.4 }, { t: al - 30, x: 1760, y: 720, z: 1.55 }, { t: al + 6, x: 2065, y: 900, z: 2.4 }, { t: sc + 10, x: 2065, y: 1010, z: 2.4 },
      { t: 720, x: 2065, y: 1030, z: 2.45 }];
  const box = v ? { x: 0, y: 0, w: W, h: H } : PLAN9;
  const reveal = ease(f, 0, 22, out);
  const leave = ease(f, 696, 720, inOut);
  const clip = leave > 0 ? inset(TERM[fmt], W, H, 1 - leave) : undefined;
  const tx = v ? { left: 70, top: 300, width: 700 } : { left: 60, right: 60, top: 290 };
  return (
    <AbsoluteFill style={{ clipPath: clip }}>
      <div style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, borderRadius: v ? 0 : 28, overflow: "hidden",
        transform: v ? undefined : `translateY(${(1 - reveal) * 80}px)` }}>
        <Cap {...seg("planner")} keys={keys} w={box.w} h={box.h} cursor={fr => 1 - ease(fr, local("planner", CAPS.planner.marks.scrolled) + 4, local("planner", CAPS.planner.marks.scrolled) + 20)} />
      </div>
      {(() => {
        const content = <>
          <Words text="Από το Α στο Β:" at={v ? 84 : 20} until={res - 20} size={v ? 64 : 72} />
          <Words text="ποιες γραμμές σε πάνε." at={v ? 98 : 32} until={res - 20} size={v ? 64 : 72} weight={600} color={C.muted} />
        </>;
        return v ? <Plate at={80} until={res - 20} style={tx}>{content}</Plate> : <div style={{ position: "absolute", ...tx }}>{content}</div>;
      })()}
      {(() => {
        const content = <Words text="Και με μία αλλαγή." at={res + 34} until={al - 30} size={v ? 64 : 72} />;
        return v ? <Plate at={res + 30} until={al - 30} style={tx}>{content}</Plate> : <div style={{ position: "absolute", ...tx }}>{content}</div>;
      })()}
      {(() => {
        const bp = ease(f, al - 2, al + 14);
        const content = <>
          <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
            <div style={{ opacity: bp * (1 - ease(f, 676, 688, inn)), transform: `rotate(${Math.sin((f - al) / 3) * 14 * Math.max(0, 1 - (f - al) / 40)}deg)`, transformOrigin: "50% 10%" }}>
              <BellIcon size={v ? 64 : 72} /></div>
            <Words text="Ειδοποίηση 1–5 στάσεις πριν." at={al + 4} until={676} size={v ? 64 : 72} />
          </div>
          <Words text="Εδώ ή στο Telegram." at={sc + 20} size={v ? 64 : 72} weight={600} color={C.muted} style={{ marginTop: 8 }} until={676} />
        </>;
        return v ? <Plate at={al} until={672} style={tx}>{content}</Plate> : <div style={{ position: "absolute", ...tx }}>{content}</div>;
      })()}
    </AbsoluteFill>
  );
};

// ---------- 7. API: the same data, for anyone ----------
const veh = (api.line.body.vehicles[0] ?? {}) as Record<string, unknown>;   // capture.mjs never saves an empty answer
const more = Math.max(0, api.line.body.vehicles.length - 1);
const CMD = "$ curl transit.haroldpoi.dev/v1/lines/040";
const J = (k: string, val: unknown, comma = true) => `    "${k}": ${JSON.stringify(val)}${comma ? "," : ""}`;
const JSON_LINES = [
  "{",
  `  "line": "040",`,
  `  "updated_at": ${api.line.body.updated_at},`,
  `  "vehicles": [`,
  "  {",
  J("id", veh.id), J("lat", veh.lat), J("lon", veh.lon), J("trip_label", veh.trip_label), J("delay_s", veh.delay_s),
  J("next_stop_id", veh.next_stop_id), J("speed", veh.speed, false),
  `  }${more > 0 ? ", " + Array(more).fill("{ … }").join(", ") : ""}`,
  "  ]",
  "}",
];
import { API_T } from "./apiTiming";
const HL = [8, 9];   // trip_label, delay_s
const Api: React.FC<{ fmt: Fmt }> = ({ fmt }) => {
  const f = useCurrentFrame();
  const { W } = dims(fmt);
  const v = fmt === "16x9";
  const t = TERM[fmt];
  const fs = v ? 28 : 28, lh = fs * 1.5, pad = v ? 44 : 30, cw = fs * 0.6;
  const typed = Math.max(0, Math.min(CMD.length, f - API_T.type));
  const fly = ease(f, API_T.fly[0], API_T.fly[1], inOut);
  const fade = ease(f, 300, 326, inn);
  const push = 1 + 0.035 * interpolate(f, [0, 300], [0, 1], clamp);
  // The "040" token of the second JSON line becomes the pill of the end card. Its place, with the push applied.
  const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
  const tx0 = t.x + pad + cw * 12.5, ty0 = t.y + pad + lh * 3 + lh / 2;
  const tokX = cx + (tx0 - cx) * push, tokY = cy + (ty0 - cy) * push;
  const endX = W / 2, endY = v ? 400 : 760, endS = v ? 3.2 : 3.4;
  const tokP = ease(f, API_T.token - 30, API_T.token - 14);
  const pillOn = f >= API_T.fly[0];
  return (
    <AbsoluteFill>
      <div style={v ? { position: "absolute", left: t.x, top: 90 } : { position: "absolute", left: 60, right: 60, top: 290 }}>
        <div style={{ opacity: 1 - fade, display: v ? "flex" : "block", alignItems: "baseline", gap: 28 }}>
          <Words text="Δωρεάν δημόσιο API." at={6} until={290} size={v ? 70 : 80} />
          <Words text="Χωρίς κλειδί." at={18} until={290} size={v ? 70 : 80} color={C.muted} weight={600} />
        </div>
      </div>
      <div style={{ position: "absolute", left: t.x, top: t.y, width: t.w, height: t.h, borderRadius: 28, background: "#0b0b0d",
        border: "1px solid rgba(255,255,255,.09)", boxShadow: "0 30px 80px rgba(0,0,0,.5)", padding: pad, boxSizing: "border-box",
        fontFamily: MONO, fontSize: fs, lineHeight: `${lh}px`, color: "#d6d6da", whiteSpace: "pre", overflow: "hidden",
        opacity: 1 - fade, transform: `scale(${push - fade * 0.04})` }}>
        <div><span style={{ color: "#5fd27a" }}>{CMD.slice(0, Math.min(1, typed))}</span>{CMD.slice(1, typed)}
          {typed < CMD.length && <span style={{ background: "#d6d6da" }}> </span>}</div>
        <div style={{ height: lh }} />
        {JSON_LINES.map((l, i) => {
          const a = API_T.json + i * 3;
          const p = ease(f, a, a + 8);
          const hi = HL.indexOf(i);
          const hl = hi >= 0 ? ease(f, API_T.hl[hi], API_T.hl[hi] + 14) : 0;
          return <div key={i} style={{ opacity: p, transform: `translateX(${(1 - p) * 12}px)`, background: `rgba(0,114,178,${0.32 * hl})`,
            borderRadius: 6, margin: "0 -8px", padding: "0 8px", color: hl ? "#fff" : undefined }}>
            {i === 1 ? <>{"  \"line\": \""}<span style={{ opacity: pillOn ? 0 : 1, background: `rgba(26,127,55,${0.6 * tokP})`, color: tokP ? "#fff" : undefined,
              borderRadius: 6, boxShadow: `0 0 0 ${4 * tokP}px rgba(26,127,55,${0.6 * tokP})` }}>040</span>{"\","}</> : l}
          </div>;
        })}
      </div>
      {pillOn && (
        <Pill scale={0.62 + (endS - 0.62) * fly} ring={C.delay[0]}
          style={{ left: tokX + (endX - tokX) * fly, top: tokY + (endY - tokY) * fly }} />
      )}
    </AbsoluteFill>
  );
};

// ---------- 8. end: the address ----------
const End: React.FC<{ fmt: Fmt }> = ({ fmt }) => {
  const f = useCurrentFrame();
  const { W } = dims(fmt);
  const v = fmt === "16x9";
  const cy = v ? 400 : 760;
  const p = interpolate(f, [4, 44], [0, 1], clamp);
  const push = 1 + 0.03 * (f / 240);
  return (
    <AbsoluteFill style={{ transform: `scale(${push})` }}>
      {p > 0 && p < 1 && <div style={{ position: "absolute", left: W / 2 - 120 - 260 * p, top: cy - 80 - 200 * p, width: 240 + 520 * p, height: 160 + 400 * p,
        borderRadius: 999, border: `3px solid ${C.delay[0]}`, opacity: (1 - p) * 0.8 }} />}
      <Pill scale={(v ? 3.2 : 3.4) * (1 + 0.012 * Math.sin(f / 12))} ring={C.delay[0]} style={{ left: W / 2, top: cy }} />
      <div style={{ position: "absolute", left: 40, right: 40, top: v ? 560 : 950 }}>
        <Words text="bus.haroldpoi.dev" at={8} size={v ? 104 : 96} align="center" stagger={0} />
        <div style={{ height: 28 }} />
        <Words text={v ? "Svelte 5 · MapLibre · Go · ανοιχτός κώδικας (MIT)" : "Svelte 5 · MapLibre · Go · ανοιχτός κώδικας (MIT)"} at={30}
          size={v ? 38 : 42} weight={600} color={C.muted} align="center" stagger={2} />
      </div>
    </AbsoluteFill>
  );
};

const SCENE_EL: Record<SceneId, React.FC<{ fmt: Fmt }>> = { hook: Hook, city: City, follow: Follow, ring: Ring, card: Card, planner: Planner, api: Api, end: End };

export const Film: React.FC<{ fmt: Fmt; audio?: string }> = ({ fmt, audio }) => (
  <AbsoluteFill style={{ background: C.ink }}>
    <Stage />
    {(Object.keys(SCENES) as SceneId[]).map(id => {
      const El = SCENE_EL[id];
      return <Sequence key={id} {...S(id)} name={id}><El fmt={fmt} /></Sequence>;
    })}
    {audio && <Audio src={staticFile(audio)} />}
  </AbsoluteFill>
);

export { DURATION };
