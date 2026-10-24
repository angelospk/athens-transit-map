// Promo A, "Ζωντανά. Στο κινητό σου.": a fast 9:16 product montage. Real phone captures full-bleed, kinetic type on
// ink plates, every cut on a bar of the track (103 BPM). Timeline: SA (bars). Facts: promo/facts.json.
import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Plate, Pill, Words } from "../ui";
import { APP, C, Chip, FONT, MONO, PCAPS, PCap, PH, PW, ease, fit, grid, inOut, inn } from "./kit";

export const GA = grid(103);
// Scenes in bars [start, end).
export const SA = {
  hook: [0, 2], ring: [2, 4], late: [4, 6], fresh: [6, 7], speed: [7, 9], metro: [9, 10], fav: [10, 12],
  plan: [12, 14], alert: [14, 16], pitch: [16, 17], scale: [17, 18], api: [18, 20], open: [20, 21], end: [21, 22],
} as const;
export type SceneA = keyof typeof SA;
export const DURATION_A = GA.bar(22);
const W = 1080, H = 1920;
const len = (id: SceneA) => GA.bar(SA[id][1]) - GA.bar(SA[id][0]);
const BEAT = GA.beat;
const z0 = W / PW;   // cover zoom (full width)

const M = (shot: string) => PCAPS[shot].marks;

// Type block on an ink plate, anchored at top y (inside the 9:16 safe zone 260..1540).
const Head: React.FC<{ y: number; at: number; until: number; lines: { t: string; size: number; color?: string; weight?: number; at?: number }[]; origin?: string; x?: number; w?: number }> =
  ({ y, at, until, lines, origin = "0% 0%", x = 60, w }) => (
    <Plate at={at} until={until} origin={origin} style={{ left: x, top: y, maxWidth: W - 2 * x, boxSizing: "border-box", ...(w ? { width: w } : {}) }}>
      {lines.map((l, i) => <Words key={i} text={l.t} at={l.at ?? at + 4 + i * 10} until={until} size={l.size} color={l.color} weight={l.weight}
        style={i ? { marginTop: l.size * 0.18 } : undefined} />)}
    </Plate>
  );

const Tag: React.FC<{ text: string; at: number; until: number; y: number; x?: number }> = ({ text, at, until, y, x = 60 }) => {
  const f = useCurrentFrame();
  const p = ease(f, at, at + 12) * (1 - ease(f, until, until + 10, inn));
  return <div style={{ position: "absolute", left: x, top: y, padding: "10px 20px", borderRadius: 999, background: "rgba(17,17,19,.86)",
    color: C.paper, fontFamily: FONT, fontWeight: 700, fontSize: 44, opacity: p, transform: `translateY(${(1 - p) * 14}px)` }}>{text}</div>;
};

// ---------- hook + ring: the peak city, then the refresh ring (one continuous capture) ----------
const city = M("city");
const sp = M("speed"), fv = M("fav"), pl = M("plan");
// Capture segments per scene (used by the scenes and by scripts/promo-timing.ts for the sfx).
export const SEGS_A: Partial<Record<SceneA, { shot: string; segs: ReturnType<typeof fit>[] }>> = {
  hook: { shot: "city", segs: [fit(city.fast, city.slow, len("hook") + len("ring"))] },
  late: { shot: "city", segs: [fit(city.zoom - 10, city.menu - 4, len("late"))] },
  fresh: { shot: "city", segs: [fit(city.fresh - 34, city.close + 70, len("fresh"))] },
  speed: { shot: "speed", segs: [fit(sp.speed - 30, sp.closed + 20, 100), fit(sp.closed + 20, sp.zoomed + 90, len("speed") - 100)] },
  metro: { shot: "speed", segs: [fit(sp.metroShown - 6, sp.metroShown + 140, len("metro"))] },
  fav: { shot: "fav", segs: [fit(fv.star0 - 50, fv.star0 + 40, 130), fit(fv.quick - 50, fv.all + 110, len("fav") - 130)] },
  plan: { shot: "plan", segs: [fit(pl.open - 10, pl.toPick + 10, 170), fit(pl.toPick + 10, pl.unfold + 40, len("plan") - 170)] },
  alert: { shot: "plan", segs: [fit(pl.lead - 16, pl.tg + 60, len("alert"))] },
};
const HOOK_SEGS = SEGS_A.hook!.segs;
const RING_RECT = { x: 24, y: 36, w: 618, h: 162 };   // the panel (capture px), whose border is the ring

const HookRing: React.FC = () => {
  const f = useCurrentFrame();
  const L = len("hook");
  const keys = [
    { t: 0, x: PW / 2, y: 1300, z: z0 * 1.18 }, { t: L - 30, x: PW / 2, y: 1260, z: z0 },
    { t: L + 40, x: 333, y: 330, z: 1.55 }, { t: L + len("ring") - 40, x: 333, y: 340, z: 1.45 }, { t: L + len("ring"), x: 420, y: 700, z: 1.3 },
  ];
  const glow = ease(f, L + 30, L + 50) * (1 - ease(f, L + len("ring") - 30, L + len("ring") - 10, inn));
  return (
    <>
      <PCap shot="city" segs={HOOK_SEGS} keys={keys} w={W} h={H} finger={false} overlay={map => {
        if (glow <= 0) return null;
        const [x, y] = map(RING_RECT.x, RING_RECT.y), [x2, y2] = map(RING_RECT.x + RING_RECT.w, RING_RECT.y + RING_RECT.h);
        const pulse = 0.5 + 0.5 * Math.sin((f / BEAT) * Math.PI);
        return <div style={{ position: "absolute", left: x - 10, top: y - 10, width: x2 - x + 20, height: y2 - y + 20, borderRadius: 40,
          boxShadow: `0 0 0 ${8 + 6 * pulse}px rgba(0,113,227,${0.75 * glow}), 0 0 80px rgba(0,113,227,${0.7 * glow})`, opacity: glow }} />;
      }} />
      <Head y={300} at={-30} until={L - 14} lines={[
        { t: "1.000+", size: 210, color: "#fff", at: -30 },
        { t: "λεωφορεία.", size: 104, at: -24 },
        { t: "Ζωντανά. Στο κινητό σου.", size: 76, color: "#5fd27a", weight: 800, at: 40 },
      ]} />
      <Tag text="Πραγματικά δεδομένα · Τρ 20/10, 09:05" at={10} until={L - 14} y={1420} />
      <Head y={1080} at={L + 36} until={L + len("ring") - 24} origin="0% 0%" lines={[
        { t: "Η μπλε μπάρα γεμίζει…", size: 88 },
        { t: "…και κάθε λεωφορείο πάει στη νέα του θέση.", size: 58, color: C.muted, weight: 600, at: L + 36 + BEAT * 2 },
      ]} />
      <Tag text="×3,5 ταχύτητα" at={L + 30} until={L + len("ring") - 20} y={1480} />
    </>
  );
};

// ---------- late: delay colours at a glance ----------
const LEGEND: [string, string][] = [["στην ώρα του", APP.delay.ontime], ["2–5′", APP.delay.late1], ["5–10′", APP.delay.late2], ["10′+", APP.delay.late3]];
const Late: React.FC = () => {
  const f = useCurrentFrame();
  const L = len("late");
  const segs = SEGS_A.late!.segs;
  return (
    <>
      <PCap shot="city" segs={segs} keys={[{ t: 0, x: 600, y: 1350, z: 1.25 }, { t: L, x: 640, y: 1300, z: 1.6 }]} w={W} h={H} />
      <Head y={300} at={6} until={L - 14} lines={[{ t: "Ποιο αργεί;", size: 120 }, { t: "Με μια ματιά.", size: 72, color: C.muted, weight: 600, at: 6 + BEAT }]} />
      <Plate at={BEAT * 2} until={L - 14} origin="0% 100%" style={{ left: 60, top: 1070, padding: "30px 40px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "18px", width: 600 }}>
          {LEGEND.map(([t, c], i) => {
            const p = ease(f, BEAT * 2 + i * BEAT * 0.5, BEAT * 2 + i * BEAT * 0.5 + 14);
            return <div key={t} style={{ display: "flex", alignItems: "center", gap: 14, opacity: p, transform: `translateY(${(1 - p) * 18}px)`,
              fontFamily: FONT, fontWeight: 700, fontSize: 56, color: C.paper }}>
              <span style={{ width: 46, height: 46, borderRadius: 23, background: c, boxShadow: "0 0 0 4px #fff" }} />{t}</div>;
          })}
        </div>
      </Plate>
    </>
  );
};

// ---------- fresh: hide vehicles whose position is old ----------
const Fresh: React.FC = () => {
  const L = len("fresh");
  const segs = SEGS_A.fresh!.segs;
  return (
    <>
      <PCap shot="city" segs={segs} keys={[{ t: 0, x: 560, y: 1150, z: 1.15 }, { t: L, x: 560, y: 1100, z: 1.2 }]} w={W} h={H} />
      <Head y={1290} at={4} until={L - 12} origin="0% 100%" lines={[{ t: "Παλιό σήμα; Κρύψ'\u00a0το.", size: 80 },
        { t: "Μόνο με πρόσφατη θέση.", size: 52, color: C.muted, weight: 600, at: 4 + BEAT }]} />
    </>
  );
};

// ---------- speed: typical bus speed per road ----------
const Speed: React.FC = () => {
  const f = useCurrentFrame();
  const L = len("speed");
  const segs = SEGS_A.speed!.segs;
  return (
    <>
      <PCap shot="speed" segs={segs} keys={[{ t: 0, x: 600, y: 1700, z: 1.1 }, { t: 100, x: 600, y: 1300, z: 0.93 }, { t: L, x: 600, y: 1250, z: 1.5 }]} w={W} h={H} />
      <Head y={300} at={110} until={L - 14} lines={[
        { t: "Πού τρέχουν.", size: 110, color: "#7fd07a", at: 110 },
        { t: "Πού κολλάνε.", size: 110, color: "#ff6b5e", at: 110 + BEAT * 2 },
      ]} />
      <Plate at={110 + BEAT * 3} until={L - 14} origin="0% 100%" style={{ left: 60, top: 1300, padding: "28px 34px" }}>
        <div style={{ display: "flex", gap: 6 }}>
          {APP.speed.map(([v, c], i) => <div key={v} style={{ width: 132, height: 72, background: c, borderRadius: 12, display: "grid", placeItems: "center",
            fontFamily: FONT, fontWeight: 800, fontSize: 38, color: i === 3 || i === 2 ? "#222" : "#fff", opacity: ease(f, 110 + BEAT * 3 + i * 4, 110 + BEAT * 3 + i * 4 + 10) }}>{v}</div>)}
          
        </div>
        <Words text="km/h · από 1,76 εκατ. μετρήσεις GPS" at={110 + BEAT * 4} until={L - 14} size={48} weight={600} color={C.paper} style={{ marginTop: 18 }} />
      </Plate>
    </>
  );
};

const Metro: React.FC = () => {
  const L = len("metro");
  const segs = SEGS_A.metro!.segs;
  return (
    <>
      <PCap shot="speed" segs={segs} keys={[{ t: 0, x: 600, y: 1250, z: 1.0 }, { t: L, x: 600, y: 1250, z: 0.95 }]} w={W} h={H} finger={false} />
      <Head y={300} at={2} until={L - 12} lines={[{ t: "+ Μετρό, ΗΣΑΠ,\u00a0τραμ.", size: 80 }]} />
    </>
  );
};

// ---------- fav: star, and the next visit remembers ----------
const Fav: React.FC = () => {
  const L = len("fav");
  const a = 130;
  const segs = SEGS_A.fav!.segs;
  return (
    <>
      <PCap shot="fav" segs={segs} keys={[{ t: 0, x: 560, y: 400, z: 1.5 }, { t: a - 10, x: 640, y: 380, z: 1.6 }, { t: a + 10, x: 560, y: 420, z: 1.5 }, { t: L, x: 580, y: 800, z: 1.05 }]} w={W} h={H} />
      <Head y={1150} at={10} until={a - 10} origin="0% 100%" lines={[{ t: "☆ Πάτα αστέρι.", size: 96 }]} />
      <Head y={1150} at={a + 6} until={L - 12} origin="0% 100%" lines={[{ t: "Την επόμενη φορά,", size: 80 }, { t: "οι γραμμές σου σε περιμένουν.", size: 64, color: "#ffc94d", at: a + 6 + BEAT }]} />
    </>
  );
};

// ---------- plan: from here to there ----------
const Plan: React.FC = () => {
  const L = len("plan");
  const segs = SEGS_A.plan!.segs;
  return (
    <>
      <PCap shot="plan" segs={segs} keys={[{ t: 0, x: 420, y: 500, z: 1.5 }, { t: 160, x: 420, y: 420, z: 1.6 }, { t: 200, x: 600, y: 900, z: 0.95 }, { t: L, x: 600, y: 900, z: 1.0 }]} w={W} h={H} />
      <Head y={1220} at={10} until={150} origin="0% 100%" lines={[{ t: "Από εδώ.", size: 110 }, { t: "Ως εκεί.", size: 110, color: "#7fb6ff", at: 10 + BEAT * 2 }]} />
      <Head y={1220} at={200} until={L - 12} origin="0% 100%" lines={[{ t: "Ποιες γραμμές σε πάνε.", size: 80 },
        { t: "Ή: ο κοντινότερος σταθμός μετρό.", size: 48, color: C.muted, weight: 600, at: 200 + BEAT * 2 }]} />
    </>
  );
};

// ---------- alert: weekdays 07:30, on Telegram ----------
const Alert: React.FC = () => {
  const f = useCurrentFrame();
  const L = len("alert");
  const segs = SEGS_A.alert!.segs;
  const msg = ease(f, L - 120, L - 100);
  return (
    <>
      <PCap shot="plan" segs={segs} keys={[{ t: 0, x: 560, y: 1500, z: 1.25 }, { t: 120, x: 560, y: 1600, z: 1.35 }, { t: L, x: 560, y: 1300, z: 1.3 }]} w={W} h={H} />
      <Head y={300} at={8} until={L - 130} lines={[{ t: "Κάθε καθημερινή,", size: 84 }, { t: "07:30.", size: 150, color: "#7fb6ff", at: 8 + BEAT }]} />
      <Plate at={L - 120} until={L - 12} origin="50% 0%" style={{ left: 60, top: 300, width: 960, boxSizing: "border-box", padding: "30px 34px" }}>
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 44, color: APP.tg, opacity: msg }}>Telegram · @oasa_bus_bot</div>
        <Words text="🔁 Τις καθημερινές 07:30–08:30 θα σου γράφω όταν ένα λεωφορείο είναι 3 στάσεις πριν." at={L - 110} until={L - 12} size={58} weight={700} stagger={1}
          style={{ marginTop: 12 }} />
        <Words text="Και στον browser, με ειδοποίηση." at={L - 80} until={L - 12} size={50} weight={600} color={C.muted} style={{ marginTop: 18 }} />
      </Plate>
    </>
  );
};

// ---------- pitch: the commute line, on ink ----------
const Pitch: React.FC = () => {
  const L = len("pitch");
  return (
    <AbsoluteFill style={{ justifyContent: "center" }}>
      <div style={{ position: "absolute", left: 70, right: 70, top: 640 }}>
        <Words text="Στήσε τη διαδρομή σου." at={0} until={L - 14} size={104} />
        <div style={{ height: 30 }} />
        <Words text="Μάθε πότε να φύγεις." at={BEAT * 1.5} until={L - 14} size={104} color="#5fd27a" />
      </div>
    </AbsoluteFill>
  );
};

// ---------- scale: the real statistics screen ----------
const Scale: React.FC = () => {
  const f = useCurrentFrame();
  const L = len("scale");
  return (
    <>
      <PCap shot="city" segs={[fit(0, 1, 1)]} still="cap/p-stats.png" keys={[{ t: 0, x: 585, y: 1300, z: 0.95 }, { t: L, x: 585, y: 1340, z: 1.05 }]} w={W} h={H} finger={false} />
      <Head y={300} at={2} until={L - 12} lines={[{ t: "279 γραμμές.", size: 100 }, { t: "1.000+ οχήματα στην αιχμή.", size: 64, color: "#7fb6ff", at: 2 + BEAT }]} />
      <Head y={1560} at={BEAT * 2} until={L - 12} origin="0% 100%" lines={[{ t: "5 αιτήματα/δευτ. στον ΟΑΣΑ. Ευγενικά.", size: 56, color: "#5fd27a" }]} />
    </>
  );
};

// ---------- api: bam bam bam, then the QR ----------
const ENDPOINTS: [string, string][] = [
  ["/v1/lines/040", "μια γραμμή, ζωντανά"],
  ["/v1/vehicles", "όλη η πόλη"],
  ["/v1/gtfs-rt/…", "GTFS-Realtime"],
  ["/v1/stats", "στατιστικά"],
];
// Scene frames of the endpoint hits and the QR (also read by scripts/promo-timing.ts).
export const API_A = { hits: [0, 1, 2, 3].map(i => Math.round(GA.beat * (1 + i * 0.5))), qr: Math.round(GA.beat * 3) };
const Api: React.FC = () => {
  const f = useCurrentFrame();
  const L = len("api");
  const q = API_A.qr;
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 70, right: 70, top: 300 }}>
        <Words text="Ένα δημόσιο API." at={0} until={L - 14} size={100} />
        <Words text="Χωρίς κλειδί. Για όποιον ρωτήσει." at={BEAT} until={L - 14} size={52} weight={600} color={C.muted} style={{ marginTop: 14 }} />
      </div>
      {ENDPOINTS.map(([e, d], i) => {
        const a = API_A.hits[i], off = q - 6;
        const p = ease(f, a, a + 8), x = ease(f, off, off + 10, inn);
        const hit = Math.max(0, 1 - (f - a) / 14);
        return <div key={e} style={{ position: "absolute", left: 70, top: 680 + i * 170, opacity: p * (1 - x), transform: `translateX(${(1 - p) * 80 - x * 60}px) scale(${1 + 0.06 * hit * p})`,
          transformOrigin: "0% 50%" }}>
          <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 64, color: C.paper }}>{e}</div>
          <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 46, color: C.muted, marginTop: 6 }}>{d}</div>
        </div>;
      })}
      {(() => {
        const p = ease(f, q, q + 16), x = ease(f, L - 14, L - 2, inn);
        const push = 1 + 0.06 * ease(f, q, L, (t: number) => t);
        return <div style={{ position: "absolute", left: (W - 780) / 2, top: 560, width: 780, opacity: p * (1 - x), transform: `scale(${(0.85 + 0.15 * p) * push})` }}>
          {/* QR of https://bus.haroldpoi.dev/api (short link to the API reference), on white so a phone can scan it */}
          <div style={{ padding: 36, background: "#fff", borderRadius: 40 }}><Img src={staticFile("promo-api-qr.svg")} style={{ display: "block", width: 708, height: 708 }} /></div>
          <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 56, color: C.paper, textAlign: "center", marginTop: 30 }}>Ανοιχτό API</div>
          <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 52, color: "#5fd27a", textAlign: "center", marginTop: 8 }}>bus.haroldpoi.dev/api</div>
        </div>;
      })()}
    </AbsoluteFill>
  );
};

const Open: React.FC = () => {
  const L = len("open");
  return (
    <div style={{ position: "absolute", left: 70, right: 70, top: 560 }}>
      <Words text="Ανοιχτά δεδομένα." at={0} until={L - 12} size={96} />
      <Words text="Ανοιχτός κώδικας." at={BEAT * 0.8} until={L - 12} size={96} style={{ marginTop: 16 }} />
      <Words text="Δωρεάν. Πάρ' το, κάν' το καλύτερο." at={BEAT * 1.6} until={L - 12} size={60} color="#5fd27a" style={{ marginTop: 30 }} />
      <Words text="GTFS ΟΑΣΑ & ΣΤΑΣΥ · OpenStreetMap · MIT" at={BEAT * 2.2} until={L - 12} size={44} weight={600} color={C.muted} stagger={1} style={{ marginTop: 40 }} />
    </div>
  );
};

const End: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ transform: `scale(${1 + 0.03 * (f / len("end"))})` }}>
      <Pill scale={3.4 * (1 + 0.015 * Math.sin(f / 10))} ring={APP.delay.ontime} style={{ left: W / 2, top: 760 }} />
      <div style={{ position: "absolute", left: 40, right: 40, top: 950 }}>
        <Words text="bus.haroldpoi.dev" at={6} size={100} align="center" stagger={0} />
        <Words text="Δωρεάν · χωρίς λογαριασμό | ανοιχτός κώδικας" at={24} size={50} weight={600} color={C.muted} align="center" stagger={1} style={{ marginTop: 26 }} />
      </div>
    </AbsoluteFill>
  );
};

// The peak city, dark and slowly moving, under the type-only scenes (so the ending stays inside the product).
const BG = new Set<SceneA>(["pitch", "api", "open", "end"]);
const MapBg: React.FC<{ id: SceneA }> = ({ id }) => {
  const L = len(id), k = Object.keys(SA).indexOf(id);
  const segs = [fit(city.fast + 40 * (k % 3), city.fast + 40 * (k % 3) + 200, L)];   // before the zoom and the menu
  return (
    <>
      <PCap shot="city" segs={segs} keys={[{ t: 0, x: 585 + 60 * (k % 2 ? 1 : -1), y: 1260, z: 1.0 }, { t: L, x: 585, y: 1240, z: 1.12 }]} w={W} h={H} finger={false} />
      <AbsoluteFill style={{ background: "rgba(17,17,19,.82)" }} />
    </>
  );
};

const EL: Record<SceneA, React.FC | null> = { hook: HookRing, ring: null, late: Late, fresh: Fresh, speed: Speed, metro: Metro, fav: Fav, plan: Plan,
  alert: Alert, pitch: Pitch, scale: Scale, api: Api, open: Open, end: End };

// A short white flash-free punch on each cut: the new scene arrives 4 % large and settles in 10 frames.
const Punch: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const f = useCurrentFrame();
  const s = 1 + 0.04 * (1 - ease(f, 0, 12, inOut));
  return <AbsoluteFill style={{ transform: `scale(${s})` }}>{children}</AbsoluteFill>;
};

export const FilmA: React.FC<{ audio?: string }> = ({ audio }) => (
  <AbsoluteFill style={{ background: C.ink }}>
    {(Object.keys(SA) as SceneA[]).map(id => {
      const El = EL[id];
      if (!El) return null;
      const from = GA.bar(SA[id][0]);
      const to = id === "hook" ? GA.bar(SA.ring[1]) : GA.bar(SA[id][1]);
      return <Sequence key={id} from={from} durationInFrames={to - from} name={id}><Punch>{BG.has(id) && <MapBg id={id} />}<El /></Punch></Sequence>;
    })}
    {audio && <Audio src={staticFile(audio)} />}
  </AbsoluteFill>
);
void PH;
