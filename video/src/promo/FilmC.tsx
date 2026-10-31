// Promo C, «Τι νέο» (2026-10-31): a 30 s 9:16 cut of what changed in the week after the launch (v0.2.0–v0.2.3).
// Live phone captures (capture/promo.mjs w*), kinetic type on ink plates, cuts on bars of the launch film's track
// (103 BPM). The red stop pin (new in v0.2.3) is the carry-over: it drops in the hook, on the map, and on the end card.
// Facts: promo/whatsnew/facts.json. Timeline: SC (bars).
import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Plate, Words } from "../ui";
import { APP, C, FONT, PCAPS, PCap, PW, ease, fit, grid, inOut, inn, out } from "./kit";

export const GC = grid(103);
// Scenes in bars [start, end).
export const SC = { hook: [0, 1], stop: [1, 3], across: [3, 4], stack: [4, 6], trains: [6, 8], search: [8, 10.5], bell: [10.5, 11.5], end: [11.5, 13] } as const;
export type SceneC = keyof typeof SC;
export const DURATION_C = GC.bar(13);
const W = 1080, H = 1920;
const len = (id: SceneC) => GC.bar(SC[id][1]) - GC.bar(SC[id][0]);
const BEAT = GC.beat;
const PIN_RED = "#e5383b";

const M = (shot: string) => PCAPS[shot].marks as Record<string, number> & Record<string, unknown>;
const st = M("wstop"), tr = M("wtrains"), se = M("wsearch"), be = M("wbell");
const HOOK_STOP = len("hook") + len("stop");
// Cameras at cover zoom (full width). CY: bottom-aligned (whole card, the pin just above it, type above the pin);
// CT: top-aligned (the map and pin high, the sheet low).
const Z0 = W / PW, CY = 2532, CT = 0, PUSH = 1.035;

// Capture segments per scene (also read by scripts/promo-timing.ts for the sfx). hook+stop is one continuous take.
export const SEGS_C: Partial<Record<SceneC, { shot: string; segs: ReturnType<typeof fit>[] }>> = {
  hook: { shot: "wstop", segs: [fit(50, st.across - 4, HOOK_STOP)] },
  across: { shot: "wstop", segs: [fit(st.across - 4, st.row - 4, len("across"))] },
  // The line card's vehicle list stays «Φόρτωση…» on the paused clock: show it briefly, then the Back taps.
  stack: { shot: "wstop", segs: [fit(st.row - 4, st.vehicle + 20, 55), fit(st.lineTap - 30, st.back1 - 10, 100), fit(st.back1 - 6, st.home + 50, len("stack") - 155)] },
  trains: { shot: "wtrains", segs: [fit(tr.zoom - 50, tr.wide + 50, 120), fit(tr.subCard, tr.subCard + 160, len("trains") - 120)] },
  search: { shot: "wsearch", segs: [fit(se.type - 6, se.close + 10, 180), fit(se.fav - 20, se.favMap + 130, len("search") - 180)] },
  bell: { shot: "wbell", segs: [fit(be.bell - 24, be.sheet + 100, len("bell"))] },
};
// Type between the pin and the card. g: the take's pin tip and card/sheet top (CSS px, capture/promo.mjs geo()); the camera
// is at cover zoom, bottom- (CY) or top-aligned (CT). Below the pin if the plate fits above the card, else above the pin,
// else at the top of the safe area.
type Geo = { pin: [number, number] | null; top: number };
// Plate height: 30 px padding top and bottom, 1.12 line height, a line wraps when wider than the plate (≈0.56 em a glyph).
const plateH = (lines: Line[]) => 60 + lines.reduce((h, l, i) => h + Math.ceil(l.t.length * l.size * 0.56 / 884) * l.size * 1.12 + (i ? l.size * 0.2 : 0), 0);
export function slot(g: Geo, align: "bottom" | "top", lines: Line[]): number {
  const h = plateH(lines);
  if (!g.pin) return 250;
  // The camera pushes in from Z0 to Z0 * PUSH during the scene: the plate must clear the pin and the card at both ends.
  const at = (s: number) => {
    const ty = align === "bottom" ? H - 2532 * s : 0, sy = (y: number) => y * 3 * s + ty;
    const tip = sy(g.pin![1]);
    return { tip, head: tip - 37 * 3 * s, card: sy(g.top) };
  };
  const a = at(Z0), b = at(Z0 * PUSH);
  const below = Math.max(a.tip, b.tip) + 30, above = Math.min(a.head, b.head) - 30 - h;
  if (below + h <= Math.min(a.card, b.card) - 20 && below >= 250) return Math.round(below);
  if (above >= 250) return Math.round(above);
  return 250;
}
// Scene frame where a capture frame shows (scene-local), for overlays timed to the take.
const at = (segs: ReturnType<typeof fit>[], cap: number) => {
  let start = 0;
  for (const s of segs) {
    const l = Math.round((s.to - s.from) / s.rate);
    if (cap >= s.from && cap < s.to) return start + Math.round((cap - s.from) / s.rate);
    start += l;
  }
  return 0;
};

// Type block on an ink plate. Anchored by its top (y) or its bottom (bottom = distance from the frame's bottom).
type Line = { t: string; size: number; color?: string; weight?: number; at?: number };
const Head: React.FC<{ y?: number; bottom?: number; at: number; until: number; lines: Line[]; origin?: string }> =
  ({ y, bottom, at: a, until, lines, origin = "0% 0%" }) => (
    <Plate at={a} until={until} origin={origin} style={{ left: 60, maxWidth: W - 120, boxSizing: "border-box", ...(bottom != null ? { bottom } : { top: y }) }}>
      {lines.map((l, i) => <Words key={i} text={l.t} at={l.at ?? a + i * 10} until={until} size={l.size} color={l.color} weight={l.weight}
        style={i ? { marginTop: l.size * 0.2 } : undefined} />)}
    </Plate>
  );

// The app's stop pin (src/lib/map/MapView.svelte): red teardrop, white dot; drops with an overshoot.
const Pin: React.FC<{ x: number; y: number; size: number; at: number }> = ({ x, y, size, at: a }) => {
  const f = useCurrentFrame();
  const p = ease(f, a, a + 22, (t: number) => 1 - Math.pow(1 - t, 3) * Math.cos(t * 5.2));
  if (f < a) return null;
  return (
    <svg viewBox="0 0 24 32" width={size} height={size * 4 / 3} style={{ position: "absolute", left: x - size / 2, top: y - size * 4 / 3,
      transform: `translateY(${(1 - p) * -size * 1.4}px) scaleY(${0.85 + 0.15 * Math.min(1, p)})`, transformOrigin: "50% 100%", opacity: Math.min(1, (f - a) / 4),
      filter: "drop-shadow(0 6px 10px rgba(0,0,0,.35))" }}>
      <path d="M12 31s10-11.2 10-19A10 10 0 0 0 2 12c0 7.8 10 19 10 19z" fill={PIN_RED} stroke="#fff" strokeWidth={1.4} />
      <circle cx={12} cy={12} r={4} fill="#fff" />
    </svg>
  );
};

// ---------- hook + stop: one take. The map, «Μια εβδομάδα μετά», then a finger taps a stop: pin, card, minutes ----------
const L_STOP: Line[] = [
  { t: "Κόκκινη πινέζα.", size: 84, color: "#ff8a8c" },
  { t: "Σε πόσα λεπτά έρχεται κάθε γραμμή.", size: 46, color: C.paper, weight: 600 },
];
const L_ACROSS: Line[] = [{ t: "Και η απέναντι στάση.", size: 80 }, { t: "Ένα πάτημα.", size: 56, color: C.muted, weight: 600 }];
const L_BACK: Line[] = [{ t: "Και «Πίσω».", size: 96 }];
const L_SUB: Line[] = [{ t: "Επόμενοι συρμοί σε λεπτά.", size: 72, color: "#5fd27a" }, { t: "Μετρό, τραμ: πρόγραμμα ΣΤΑΣΥ.", size: 50, color: C.paper, weight: 700 }];
const L_BELL: Line[] = [{ t: "Ειδοποίηση πριν φτάσει.", size: 68 }, { t: "Τώρα και για μετρό, τραμ, Προαστιακό.", size: 54, color: "#7fb6ff", weight: 700 }];
const HookStop: React.FC = () => {
  const f = useCurrentFrame();
  const segs = SEGS_C.hook!.segs;
  const L = len("hook"), tap = at(segs, st.tap), card = at(segs, st.card);
  const keys = [
    { t: 0, x: PW / 2, y: 1150, z: 1.2 }, { t: L - 10, x: PW / 2, y: 1150, z: 1.05 },
    { t: tap + 10, x: PW / 2, y: CY, z: Z0 }, { t: HOOK_STOP, x: PW / 2, y: CY, z: Z0 * PUSH },
  ];
  return (
    <>
      <PCap shot="wstop" segs={segs} keys={keys} w={W} h={H} />
      <AbsoluteFill style={{ background: `rgba(17,17,19,${0.35 * (1 - ease(f, L - 20, L + 6))})` }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 380 }}>
        <div style={{ opacity: 1 - ease(f, L - 24, L - 4) }}><Pin x={W / 2} y={150} size={110} at={-12} /></div>
      </div>
      <Head y={600} at={-30} until={L - 12} origin="50% 0%" lines={[
        { t: "Μια εβδομάδα μετά.", size: 112, at: -30 },
        { t: "Τι νέο στον χάρτη.", size: 64, color: "#7fb6ff", weight: 700, at: 6 + BEAT },
      ]} />
      <Head y={1150} at={L - 4} until={tap + 4} lines={[{ t: "Πάτα μια στάση.", size: 104 }]} />
      <Head y={slot(st.geoCard as never, "bottom", L_STOP)} at={card + 16} until={HOOK_STOP - 12} lines={L_STOP.map((l, i) => ({ ...l, at: card + 16 + i * BEAT * 1.5 }))} />
    </>
  );
};

const Across: React.FC = () => {
  const L = len("across"), segs = SEGS_C.across!.segs;
  return (
    <>
      <PCap shot="wstop" segs={segs} keys={[{ t: 0, x: PW / 2, y: CY, z: Z0 }, { t: L, x: PW / 2, y: CY, z: Z0 * PUSH }]} w={W} h={H} />
      <Head y={slot(st.geoAcross as never, "bottom", L_ACROSS)} at={30} until={L - 12} lines={L_ACROSS.map((l, i) => ({ ...l, at: 30 + i * BEAT * 0.6 }))} />
    </>
  );
};

const Stack: React.FC = () => {
  const L = len("stack"), segs = SEGS_C.stack!.segs;
  const b1 = at(segs, st.back1);
  const words = ["Στάση", "→ λεωφορείο", "→ γραμμή."];
  return (
    <>
      {/* On the line card the camera rises to the map and the card's head: its vehicle list read «Φόρτωση…» in the take. */}
      <PCap shot="wstop" segs={segs} keys={[{ t: 0, x: PW / 2, y: CY, z: Z0 }, { t: 84, x: PW / 2, y: CY, z: Z0 }, { t: 96, x: PW / 2, y: 800, z: 1.15 },
        { t: b1 + 14, x: PW / 2, y: 800, z: 1.18 }, { t: b1 + 26, x: PW / 2, y: CY, z: Z0 }, { t: L, x: PW / 2, y: CY, z: Z0 * PUSH }]} w={W} h={H} />
      <Plate at={4} until={b1 - 8} origin="0% 0%" style={{ left: 60, top: 250, maxWidth: W - 120, boxSizing: "border-box", padding: "26px 34px" }}>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {words.map((t, i) => <Words key={t} text={t} at={[4, at(segs, st.vehicle), at(segs, st.lineTap) + 20][i]} until={b1 - 8} size={58} color={i === 2 ? "#7fb6ff" : undefined} />)}
        </div>
      </Plate>
      <Head y={250} at={b1 - 4} until={L - 12} lines={L_BACK} />
    </>
  );
};

// ---------- trains: the metro station card (timetable), the map zooms out, the suburban station ----------
const Trains: React.FC = () => {
  const L = len("trains"), segs = SEGS_C.trains!.segs;
  return (
    <>
      <PCap shot="wtrains" segs={segs} keys={[{ t: 0, x: PW / 2, y: CY, z: Z0 }, { t: 50, x: PW / 2, y: 1300, z: Z0 }, { t: 120, x: PW / 2, y: 1300, z: Z0 * 1.05 },
        { t: 121, x: PW / 2, y: CT, z: Z0 }, { t: L, x: PW / 2, y: CT, z: Z0 * PUSH }]} w={W} h={H} />
      <Head y={260} at={4} until={114} lines={[
        { t: "Μετρό, τραμ, Προαστιακός.", size: 84 },
        { t: "Στον ίδιο χάρτη.", size: 84, color: "#7fb6ff", at: 4 + BEAT },
      ]} />
      <Head y={slot(tr.geoSub as never, "top", L_SUB)} at={124} until={L - 12} lines={L_SUB.map((l, k) => ({ ...l, at: 124 + k * BEAT }))} />
    </>
  );
};

const Search: React.FC = () => {
  const L = len("search"), segs = SEGS_C.search!.segs;
  const a = 180;
  return (
    <>
      <PCap shot="wsearch" segs={segs} keys={[{ t: 0, x: PW / 2, y: 900, z: 1.0 }, { t: a - 4, x: PW / 2, y: 900, z: 1.05 }, { t: a, x: PW / 2, y: 0, z: Z0 }, { t: L, x: PW / 2, y: 0, z: Z0 * PUSH }]} w={W} h={H} />
      <Head y={1300} at={4} until={a - 10} lines={[
        { t: "Ψάξε γραμμή ή στάση.", size: 74 },
        { t: "Λεωφορείο, μετρό, τραμ, Προαστιακός.", size: 46, color: C.muted, weight: 600, at: 4 + BEAT },
      ]} />
      <Head y={1060} at={a + 4} until={L - 12} lines={[
        { t: "★ Κράτα τα δικά σου.", size: 76, color: "#ffc94d" },
        { t: "Μόνο αυτά στον χάρτη.", size: 56, color: C.paper, weight: 600, at: a + 4 + BEAT },
      ]} />
    </>
  );
};

const Bell: React.FC = () => {
  const L = len("bell"), segs = SEGS_C.bell!.segs;
  return (
    <>
      <PCap shot="wbell" segs={segs} keys={[{ t: 0, x: PW / 2, y: CY, z: Z0 }, { t: L, x: PW / 2, y: CY, z: Z0 * PUSH }]} w={W} h={H} />
      <Head y={slot(be.geoSheet as never, "bottom", L_BELL)} at={2} until={L - 10} lines={L_BELL.map((l, k) => ({ ...l, at: 2 + k * BEAT * 0.35 }))} />
    </>
  );
};

// ---------- end: the pin drops on the address ----------
const End: React.FC = () => {
  const f = useCurrentFrame();
  const L = len("end");
  return (
    <AbsoluteFill style={{ transform: `scale(${1 + 0.07 * ease(f, 0, L, (t: number) => t)}) translateY(${-14 * f / L}px)` }}>
      <div style={{ position: "absolute", left: 0, top: 0, transform: `translateY(${-8 * Math.sin(f / 18)}px)` }}><Pin x={W / 2} y={720} size={150} at={2} /></div>
      <div style={{ position: "absolute", left: 40, right: 40, top: 790 }}>
        <Words text="bus.haroldpoi.dev" at={8} size={100} align="center" stagger={0} />
        <Words text="Δοκίμασέ το." at={20} size={84} color="#5fd27a" align="center" stagger={2} style={{ marginTop: 22 }} />
        <Words text="Βάλ’ το στην αρχική οθόνη, | σαν εφαρμογή." at={20 + BEAT * 0.75} size={54} weight={600} color={C.paper} align="center" stagger={1} style={{ marginTop: 60 }} />
      </div>
    </AbsoluteFill>
  );
};

// The stop take, dark and slow, under the end card.
const EndBg: React.FC = () => {
  const L = len("end");
  return (
    <>
      <PCap shot="wstop" segs={[fit(30, st.move, L)]} keys={[{ t: 0, x: PW / 2, y: 1100, z: 1.1 }, { t: L, x: PW / 2, y: 1100, z: 1.2 }]} w={W} h={H} finger={false} style={{ filter: "blur(6px)" }} />
      <AbsoluteFill style={{ background: "rgba(17,17,19,.88)" }} />
    </>
  );
};

const EL: Record<SceneC, React.FC | null> = { hook: HookStop, stop: null, across: Across, stack: Stack, trains: Trains, search: Search, bell: Bell, end: End };

// Each cut: the new scene arrives 4 % large and settles in 12 frames (as promo A).
const Punch: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const f = useCurrentFrame();
  const s = 1 + 0.04 * (1 - ease(f, 0, 12, inOut));
  return <AbsoluteFill style={{ transform: `scale(${s})` }}>{children}</AbsoluteFill>;
};

export const FilmC: React.FC<{ audio?: string }> = ({ audio }) => (
  <AbsoluteFill style={{ background: C.ink, fontFamily: FONT }}>
    {(Object.keys(SC) as SceneC[]).map(id => {
      const El = EL[id];
      if (!El) return null;
      const from = GC.bar(SC[id][0]);
      const to = id === "hook" ? GC.bar(SC.stop[1]) : GC.bar(SC[id][1]);
      return <Sequence key={id} from={from} durationInFrames={to - from} name={id}><Punch>{id === "end" && <EndBg />}<El /></Punch></Sequence>;
    })}
    {audio && <Audio src={staticFile(audio)} />}
  </AbsoluteFill>
);
void APP; void out; void inn;
