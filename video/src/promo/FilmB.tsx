// Promo B, "Από μια ερώτηση σε API για όλη την πόλη": a story-led 16:9 film. A question, the prototype, the pipeline
// drawn as a diagram (ΟΑΣΑ → backend at 5 req/s with its history → cache → everyone), the scale, then the product in
// one phone window that stays on the same pixels while its captures change, the API, open data. 115 BPM, cuts on bars.
import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Plate, Pill, Words } from "../ui";
import { APP, C, FONT, MONO, PCAPS, PCap, PH, PW, ease, fit, grid, inOut, inn, out } from "./kit";
import api from "../../public/cap/p-api.json";

export const GB = grid(115);
export const SB = {
  q: [0, 2], proto: [2, 4], pipe: [4, 10], scale: [10, 12], live: [12, 13], late: [13, 14], speed: [14, 15], fav: [15, 16],
  plan: [16, 17], alert: [17, 18], pitch: [18, 19], api: [19, 22], open: [22, 23], end: [23, 24],
} as const;
export type SceneB = keyof typeof SB;
export const DURATION_B = GB.bar(24);
const W = 1920, H = 1080;
const BEAT = GB.beat, BAR = GB.beat * 4;
const len = (id: SceneB) => GB.bar(SB[id][1]) - GB.bar(SB[id][0]);
const M = (shot: string) => PCAPS[shot].marks;

// The phone window (screen px): same rect for every product scene.
const PHONE = { x: 1180, y: 70, w: 440, h: 940 };
const pz = PHONE.w / PW;

const Phone: React.FC<{ children: React.ReactNode; enter?: number; exit?: number }> = ({ children, enter = -1, exit = 1e9 }) => {
  const f = useCurrentFrame();
  const p = enter < 0 ? 1 : ease(f, enter, enter + 18);
  const q = ease(f, exit, exit + 14, inn);
  return (
    <div style={{ position: "absolute", left: PHONE.x - 14, top: PHONE.y - 14, width: PHONE.w + 28, height: PHONE.h + 28, borderRadius: 64,
      background: "#050506", boxShadow: "0 40px 90px rgba(0,0,0,.6), inset 0 0 0 2px rgba(255,255,255,.08)",
      opacity: p * (1 - q), transform: `translateY(${(1 - p) * 60 + q * -40}px) scale(${1 - 0.04 * q})` }}>
      <div style={{ position: "absolute", left: 14, top: 14, width: PHONE.w, height: PHONE.h, borderRadius: 50, overflow: "hidden" }}>{children}</div>
    </div>
  );
};

// Left-column headline (product scenes).
const Side: React.FC<{ at: number; until: number; a: string; b?: string; bc?: string; y?: number }> = ({ at, until, a, b, bc = C.muted, y = 330 }) => (
  <div style={{ position: "absolute", left: 140, top: y, width: 940 }}>
    <Words text={a} at={at} until={until} size={84} />
    {b && <Words text={b} at={at + BEAT} until={until} size={52} weight={600} color={bc} style={{ marginTop: 22 }} />}
  </div>
);

// ---------- q: the question ----------
const Q: React.FC = () => {
  const L = len("q");
  return (
    <div style={{ position: "absolute", left: 160, right: 160, top: 300 }}>
      <Words text="Κάποιος ρώτησε στο Twitter:" at={-40} until={L - 16} size={46} weight={600} color={C.muted} />
      <Words text="«Γιατί η Αθήνα δεν έχει | GTFS Realtime;»" at={-30} until={L - 16} size={112} stagger={4} style={{ marginTop: 30 }}
        colors={{ 5: "#7fb6ff", 6: "#7fb6ff" }} />
      <Words text="Ζωντανές θέσεις λεωφορείων, σε ανοιχτή μορφή, για κάθε εφαρμογή." at={BEAT * 4} until={L - 16} size={42} weight={600} color={C.muted} stagger={2} style={{ marginTop: 40 }} />
    </div>
  );
};

// ---------- proto: the starting point ----------
const Proto: React.FC = () => {
  const f = useCurrentFrame();
  const L = len("proto");
  const chip = ease(f, BEAT * 1.5, BEAT * 1.5 + 16) * (1 - ease(f, L - 16, L - 4, inn));
  return (
    <div style={{ position: "absolute", left: 160, right: 160, top: 260 }}>
      <Words text="Η αρχή: ένα πρωτότυπο σε Python," at={0} until={L - 16} size={84} />
      <Words text="από τον Φοίβο." at={BEAT * 0.6} until={L - 16} size={84} color="#ffd36b" style={{ marginTop: 10 }} />
      <div style={{ marginTop: 50, display: "inline-flex", gap: 18, alignItems: "center", padding: "20px 30px", borderRadius: 20, background: "#1c1c1f",
        border: "1px solid rgba(255,255,255,.12)", opacity: chip, transform: `translateY(${(1 - chip) * 20}px)` }}>
        <span style={{ fontFamily: MONO, fontSize: 44, color: C.paper }}>AUEB-BALab/athens-gtfs-realtime</span>
        <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 38, color: "#ffd36b" }}>Python · MIT</span>
      </div>
      <Words text="Από εκεί: ένα backend σε Go, για όλη την πόλη." at={BEAT * 4} until={L - 16} size={52} weight={600} color={C.muted} style={{ marginTop: 50 }} />
    </div>
  );
};

// ---------- pipe: the diagram, built in four steps ----------
type Box = { x: number; y: number; w: number; h: number };
const NODE = { oasa: { x: 90, y: 470, w: 420, h: 250 }, be: { x: 700, y: 470, w: 440, h: 250 }, cache: { x: 1290, y: 470, w: 380, h: 250 } };
const DB = { x: 790, y: 810, w: 260, h: 150 };
const Node: React.FC<{ b: Box; p: number; title: string; sub: string; accent: string; hot?: number }> = ({ b, p, title, sub, accent, hot = 0 }) => (
  <div style={{ position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h, borderRadius: 28, background: "#1c1c1f",
    border: `3px solid ${accent}`, boxShadow: `0 0 ${40 * hot}px ${accent}66, 0 20px 50px rgba(0,0,0,.45)`, boxSizing: "border-box", padding: "30px 34px",
    opacity: p, transform: `scale(${(0.85 + 0.15 * p) * (1 + 0.02 * hot)})` }}>
    <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 62, color: C.paper }}>{title}</div>
    <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 36, color: C.muted, marginTop: 12, lineHeight: 1.25, whiteSpace: "pre-line" }}>{sub}</div>
  </div>
);

const Pipe: React.FC = () => {
  const f = useCurrentFrame();
  const L = len("pipe");
  const st = [0, 1, 3, 4].map(k => Math.round(k * BAR));   // oasa, rate, history, cache
  const pO = ease(f, 6, 24), pB = ease(f, st[1] + 12, st[1] + 30), pD = ease(f, st[2], st[2] + 20), pC = ease(f, st[3], st[3] + 20);
  const out1 = ease(f, L - 18, L - 4, inn);
  // OASA starts centred and big, moves to its place when the backend arrives.
  const mv = ease(f, st[1] - 24, st[1] + 8, inOut);
  const oasa = { x: 750 - (750 - NODE.oasa.x) * mv, y: NODE.oasa.y, w: NODE.oasa.w, h: NODE.oasa.h };
  // Requests: backend → OASA, 5 per second (every 12 frames), each answered.
  const dots: React.ReactNode[] = [];
  if (pB > 0) {
    for (let k = Math.floor((f - st[1]) / 12) - 8; k <= Math.floor((f - st[1]) / 12); k++) {
      const t0 = st[1] + k * 12, p = (f - t0) / 40;
      if (p < 0 || p > 1 || t0 < st[1]) continue;
      const go = p < 0.5, q = go ? p * 2 : (p - 0.5) * 2;
      const x1 = NODE.be.x, x0 = NODE.oasa.x + NODE.oasa.w;
      const x = go ? x1 - (x1 - x0) * q : x0 + (x1 - x0) * q, y = NODE.be.y + (go ? 95 : 155);
      dots.push(<div key={"r" + k} style={{ position: "absolute", left: x - 13, top: y - 13, width: 26, height: 26, borderRadius: 13,
        background: go ? "#7fb6ff" : "#5fd27a", opacity: pB }} />);
    }
  }
  // Cache fan-out: answers to many clients; client count grows, the request rate to OASA does not.
  const clients = pC > 0 ? Math.min(12, Math.floor(ease(f, st[3] + 10, st[3] + BAR * 1.2, inOut) * 12)) : 0;
  const fan: React.ReactNode[] = [];
  for (let i = 0; i < clients; i++) {
    const cx = 1720 + (i % 2) * 74, cy = 380 + Math.floor(i / 2) * 96;
    fan.push(<div key={i} style={{ position: "absolute", left: cx, top: cy, width: 50, height: 78, borderRadius: 10, border: "3px solid #c8c8cc",
      background: "#26262a", opacity: pC * (1 - out1) }} />);
    const ph = ((f + i * 7) % 40) / 40;
    const x0 = NODE.cache.x + NODE.cache.w, y0 = NODE.cache.y + NODE.cache.h / 2;
    fan.push(<div key={"d" + i} style={{ position: "absolute", left: x0 + (cx + 25 - x0) * ph - 8, top: y0 + (cy + 39 - y0) * ph - 8, width: 16, height: 16,
      borderRadius: 8, background: "#5fd27a", opacity: pC * (1 - out1) * (1 - ph) }} />);
  }
  const line = (x0: number, x1: number, y: number, p: number) => <div style={{ position: "absolute", left: x0, top: y - 3, width: (x1 - x0) * p, height: 6,
    background: "rgba(255,255,255,.18)", borderRadius: 2 }} />;
  const head = (k: number, a: string, b: string, bc = C.muted) => {
    const at = st[k] + 4, until = (k < 3 ? st[k + 1] : L) - 16;
    return <div key={k} style={{ position: "absolute", left: 140, top: 110, width: 1640 }}>
      <Words text={a} at={at} until={until} size={76} stagger={2} />
      <Words text={b} at={at + BEAT * 0.75} until={until} size={46} weight={600} color={bc} stagger={2} style={{ marginTop: 18 }} />
    </div>;
  };
  // 5 req/s counter.
  const ctr = pB * (1 - out1);
  return (
    <AbsoluteFill style={{ opacity: 1 - out1 }}>
      {head(0, "Η πηγή: ο server του ΟΑΣΑ.", "PHP. Απαντά μία γραμμή ανά αίτημα.")}
      {head(1, "Ευγενικά: 5 αιτήματα το δευτερόλεπτο.", "Ρωτάμε για κάθε γραμμή, με τη σειρά. Ποτέ πιο γρήγορα.", "#7fb6ff")}
      {head(2, "Κάθε θέση μένει στο ιστορικό.", "Από εκεί: τυπικές ταχύτητες και στατιστικά.")}
      {head(3, "Μία απάντηση, για όλους.", "Περισσότεροι χρήστες: κανένα επιπλέον αίτημα στον ΟΑΣΑ.", "#5fd27a")}
      {line(NODE.oasa.x + NODE.oasa.w, NODE.be.x, NODE.be.y + 125, pB)}
      {line(NODE.be.x + NODE.be.w, NODE.cache.x, NODE.be.y + 125, pC)}
      {dots}
      {fan}
      <Node b={oasa} p={pO} title="ΟΑΣΑ" sub={"server PHP\nμία γραμμή/αίτημα"} accent="#c8c8cc" hot={(1 - mv) * (0.5 + 0.5 * Math.sin(f / 8))} />
      <Node b={NODE.be} p={pB} title="Backend" sub={"Go · όριο 5/δευτ.\nθέσεις + πρόγραμμα"} accent="#7fb6ff" hot={0.5 + 0.5 * Math.sin(f / 6)} />
      <Node b={NODE.cache} p={pC} title="Cache" sub={"Cloudflare\nίδια απάντηση"} accent="#5fd27a" />
      {pD > 0 && <div style={{ position: "absolute", left: DB.x, top: DB.y, width: DB.w, height: DB.h, opacity: pD * (1 - out1), transform: `translateY(${(1 - pD) * 30}px)` }}>
        <svg width={DB.w} height={DB.h} viewBox="0 0 260 150">
          <ellipse cx="130" cy="28" rx="110" ry="22" fill="#26262a" stroke="#ffd36b" strokeWidth="3" />
          <path d="M20 28 V118 A110 22 0 0 0 240 118 V28" fill="#26262a" stroke="#ffd36b" strokeWidth="3" />
          {[0, 1, 2].map(i => <path key={i} d={`M20 ${58 + i * 28} A110 22 0 0 0 240 ${58 + i * 28}`} fill="none" stroke="#ffd36b" strokeWidth="2"
            opacity={ease(f, st[2] + 20 + i * 14, st[2] + 34 + i * 14)} />)}
        </svg>
        <div style={{ position: "absolute", left: 290, top: 44, fontFamily: FONT, fontWeight: 700, fontSize: 44, color: "#ffd36b", whiteSpace: "nowrap" }}>ιστορικό θέσεων</div>
      </div>}
      {pD > 0 && <div style={{ position: "absolute", left: NODE.be.x + NODE.be.w / 2 - 2, top: NODE.be.y + NODE.be.h, width: 4, height: DB.y - NODE.be.y - NODE.be.h + 6,
        background: "rgba(255,211,107,.5)", opacity: pD * (1 - out1) }} />}
      {ctr > 0 && <div style={{ position: "absolute", left: (NODE.oasa.x + NODE.oasa.w + NODE.be.x) / 2 - 150, width: 300, textAlign: "center", top: NODE.be.y - 96,
        fontFamily: MONO, fontWeight: 700, fontSize: 60, color: "#7fb6ff", opacity: ctr, transform: `scale(${1 + 0.06 * Math.max(0, Math.cos((f / 12) * Math.PI * 2))})` }}>5/δευτ.</div>}
      {clients > 0 && <div style={{ position: "absolute", left: 1500, top: 980, width: 400, textAlign: "right", fontFamily: FONT, fontWeight: 700, fontSize: 40, color: C.paper, opacity: pC * (1 - out1) }}>όποιος ρωτήσει</div>}
    </AbsoluteFill>
  );
};

// ---------- scale: numbers + the real statistics screen ----------
const Count: React.FC<{ to: number; at: number; dur: number; size: number; color?: string; suffix?: string }> = ({ to, at, dur, size, color = C.paper, suffix = "" }) => {
  const f = useCurrentFrame();
  void f; void dur;
  const v = to;
  return <span style={{ fontFamily: FONT, fontWeight: 800, fontSize: size, color, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>{v.toLocaleString("el-GR")}{suffix}</span>;
};
const Scale: React.FC = () => {
  const f = useCurrentFrame();
  const L = len("scale");
  const o = 1 - ease(f, L - 14, L - 2, inn);
  const row = (at: number, el: React.ReactNode, label: string) => {
    const p = ease(f, at, at + 14);
    return <div style={{ opacity: p * o, transform: `translateY(${(1 - p) * 24}px)`, marginBottom: 40 }}>
      {el}<div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 40, color: C.muted, marginTop: 2 }}>{label}</div></div>;
  };
  return (
    <>
      <div style={{ position: "absolute", left: 140, top: 170 }}>
        {row(4, <Count to={279} at={4} dur={40} size={130} />, "γραμμές λεωφορείων και τρόλεϊ")}
        {row(BEAT * 2, <Count to={1000} at={BEAT * 2} dur={40} size={130} color="#7fb6ff" suffix="+" />, "οχήματα στην αιχμή, κάθε καθημερινή")}
        {row(BEAT * 4, <Count to={1251} at={BEAT * 4} dur={40} size={100} />, "διαφορετικά οχήματα σε μια μέρα (23/10)")}
      </div>
      <Phone enter={6}>
        <PCap shot="city" segs={[fit(0, 1, 1)]} still="cap/p-stats.png" w={PHONE.w} h={PHONE.h} finger={false}
          keys={[{ t: 0, x: 585, y: 1150, z: pz * 1.15 }, { t: L, x: 585, y: 1250, z: pz * 1.35 }]} />
      </Phone>
    </>
  );
};

// ---------- product: one phone window, captures swap inside ----------
const city = M("city"), sp = M("speed"), fv = M("fav"), pl = M("plan");
export const SEGS_B: Partial<Record<SceneB, { shot: string; segs: ReturnType<typeof fit>[] }>> = {
  live: { shot: "city", segs: [fit(city.fast + 80, city.fast + 80 + len("live"), len("live"))] },
  late: { shot: "city", segs: [fit(city.zoom + 20, city.menu, len("late"))] },
  speed: { shot: "speed", segs: [fit(sp.zoomed - 40, sp.zoomed + 100, len("speed"))] },
  fav: { shot: "fav", segs: [fit(fv.quick - 30, fv.all + 120, len("fav"))] },
  plan: { shot: "plan", segs: [fit(pl.toPick - 50, pl.results + 100, len("plan"))] },
  alert: { shot: "plan", segs: [fit(pl.rep - 20, pl.tg + 40, len("alert"))] },
};
const Prod: React.FC<{ id: SceneB; shot: string; segs: ReturnType<typeof fit>[]; keys: { t: number; x: number; y: number; z: number }[]; a: string; b?: string; bc?: string;
  extra?: React.ReactNode; finger?: boolean; enter?: boolean }> = ({ id, shot, segs, keys, a, b, bc, extra, finger = true, enter }) => {
  const L = len(id);
  return (
    <>
      <Side at={2} until={L - 12} a={a} b={b} bc={bc} />
      {extra}
      <Phone enter={enter ? 0 : -1}>
        <PCap shot={shot} segs={segs} keys={keys.map(k => ({ ...k, z: k.z * pz }))} w={PHONE.w} h={PHONE.h} finger={finger} />
      </Phone>
    </>
  );
};
const LEGEND: [string, string][] = [["στην ώρα του", APP.delay.ontime], ["2–5′", APP.delay.late1], ["5–10′", APP.delay.late2], ["10′+", APP.delay.late3]];
const Legend: React.FC<{ at: number; until: number }> = ({ at, until }) => {
  const f = useCurrentFrame();
  return <div style={{ position: "absolute", left: 140, top: 640, display: "flex", gap: 34 }}>
    {LEGEND.map(([t, c], i) => {
      const p = ease(f, at + i * 6, at + i * 6 + 12) * (1 - ease(f, until, until + 10, inn));
      return <div key={t} style={{ display: "flex", alignItems: "center", gap: 14, opacity: p, fontFamily: FONT, fontWeight: 700, fontSize: 46, color: C.paper }}>
        <span style={{ width: 40, height: 40, borderRadius: 20, background: c, boxShadow: "0 0 0 4px #fff" }} />{t}</div>;
    })}
  </div>;
};
const SpeedBar: React.FC<{ at: number; until: number }> = ({ at, until }) => {
  const f = useCurrentFrame();
  const p = ease(f, at, at + 14) * (1 - ease(f, until, until + 10, inn));
  return <div style={{ position: "absolute", left: 140, top: 600, opacity: p }}>
    <div style={{ display: "flex", gap: 8 }}>
      {APP.speed.map(([v, c], i) => <div key={v} style={{ width: 140, height: 72, background: c, borderRadius: 12, display: "grid", placeItems: "center",
        fontFamily: FONT, fontWeight: 800, fontSize: 38, color: i === 2 || i === 3 ? "#222" : "#fff" }}>{v}</div>)}
    </div>
    <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 40, color: C.muted, marginTop: 18 }}>km/h · από 1,76 εκατ. μετρήσεις GPS</div>
  </div>;
};
const Tag: React.FC<{ text: string; until: number }> = ({ text, until }) => {  // labelled replay
  const f = useCurrentFrame();
  const p = ease(f, 6, 18) * (1 - ease(f, until, until + 10, inn));
  return <div style={{ position: "absolute", left: 140, top: 650, padding: "12px 24px", borderRadius: 999, background: "#1c1c1f", border: "1px solid rgba(255,255,255,.12)",
    fontFamily: FONT, fontWeight: 700, fontSize: 38, color: C.paper, opacity: p }}>{text}</div>;
};

const Live: React.FC = () => <Prod id="live" shot="city" segs={SEGS_B.live!.segs} enter
  keys={[{ t: 0, x: 585, y: 1266, z: 1.0 }, { t: len("live"), x: 600, y: 1200, z: 1.1 }]} finger={false}
  a="Ζωντανά. Όλη η πόλη." b="Ο κύκλος γεμίζει: νέες θέσεις." bc="#7fb6ff" extra={<Tag text="Πραγματικά δεδομένα · Τρ 20/10, 09:05 · ×6" until={len("live") - 12} />} />;
const Late: React.FC = () => <Prod id="late" shot="city" segs={SEGS_B.late!.segs}
  keys={[{ t: 0, x: 620, y: 1300, z: 1.5 }, { t: len("late"), x: 640, y: 1280, z: 1.75 }]}
  a="Ποιο αργεί, με μια ματιά." extra={<Legend at={BEAT} until={len("late") - 12} />} />;
const Speed: React.FC = () => <Prod id="speed" shot="speed" segs={SEGS_B.speed!.segs}
  keys={[{ t: 0, x: 600, y: 1300, z: 1.4 }, { t: len("speed"), x: 600, y: 1260, z: 1.6 }]} finger={false}
  a="Πού τρέχουν. Πού κολλάνε." extra={<SpeedBar at={BEAT} until={len("speed") - 12} />} />;
const Fav: React.FC = () => <Prod id="fav" shot="fav" segs={SEGS_B.fav!.segs}
  keys={[{ t: 0, x: 585, y: 500, z: 1.6 }, { t: len("fav"), x: 585, y: 900, z: 1.05 }]}
  a="Οι γραμμές σου, με ένα ☆." b="Σε περιμένουν την επόμενη φορά." bc="#ffd36b" />;
const Plan: React.FC = () => <Prod id="plan" shot="plan" segs={SEGS_B.plan!.segs}
  keys={[{ t: 0, x: 420, y: 450, z: 1.5 }, { t: 50, x: 500, y: 700, z: 1.2 }, { t: len("plan"), x: 585, y: 1100, z: 1.0 }]}
  a="Από εδώ ως εκεί:" b="ποιες γραμμές σε πάνε. Ή ο κοντινότερος σταθμός μετρό." bc="#7fb6ff" />;
const Alert: React.FC = () => <Prod id="alert" shot="plan" segs={SEGS_B.alert!.segs}
  keys={[{ t: 0, x: 585, y: 1500, z: 1.35 }, { t: len("alert"), x: 585, y: 1380, z: 1.25 }]}
  a="Κάθε καθημερινή, 07:30." b="Σου γράφει στο Telegram όταν έρχεται. Ή στον browser." bc={APP.tg} />;

const Pitch: React.FC = () => {
  const L = len("pitch");
  return (
    <div style={{ position: "absolute", left: 140, right: 140, top: 360 }}>
      <Words text="Στήσε τη διαδρομή σου." at={0} until={L - 14} size={110} />
      <Words text="Μάθε πότε να φύγεις από το σπίτι." at={BEAT * 1.2} until={L - 14} size={84} color="#5fd27a" style={{ marginTop: 26 }} />
    </div>
  );
};

// ---------- api: a real answer, the endpoints, the QR ----------
const v0 = (api as { line040: { vehicles: Record<string, unknown>[] } }).line040.vehicles[0];
const JSON_LINES = [
  "{", `  "line": "040",`, `  "vehicles": [{`, `    "id": "${v0.id}",`, `    "lat": ${v0.lat}, "lon": ${v0.lon},`,
  `    "trip_label": "${v0.trip_label}",`, `    "delay_s": ${v0.delay_s},`, `    "speed": ${v0.speed}`, "  }, …]", "}",
];
const EP: [string, string][] = [["/v1/lines/{id}", "μια γραμμή, ζωντανά"], ["/v1/vehicles", "όλη η πόλη"], ["/v1/gtfs-rt/vehicle_positions.pb", "GTFS-Realtime"], ["/v1/gtfs-rt/trip_updates.pb", "GTFS-Realtime"], ["/v1/stats", "στατιστικά"]];
export const API_B = { hits: [0, 1, 2, 3, 4].map(i => Math.round(GB.beat * (3 + i * 0.75))), qr: Math.round(GB.beat * 6.5), json: 60, type: 10 };
const Api: React.FC = () => {
  const f = useCurrentFrame();
  const L = len("api");
  const CMD = "$ curl transit.haroldpoi.dev/v1/lines/040";
  const typed = Math.max(0, Math.min(CMD.length, Math.floor((f - 10) * 1.2)));
  const qr = API_B.qr;
  const o = 1 - ease(f, L - 14, L - 2, inn);
  return (
    <AbsoluteFill style={{ opacity: o }}>
      <div style={{ position: "absolute", left: 140, top: 90 }}>
        <Words text="Ένα δημόσιο API. Χωρίς κλειδί." at={0} until={L - 14} size={72} />
      </div>
      <div style={{ position: "absolute", left: 140, top: 240, width: 900, height: 700, borderRadius: 28, background: "#0b0b0d", border: "1px solid rgba(255,255,255,.1)",
        padding: 40, boxSizing: "border-box", fontFamily: MONO, fontSize: 30, lineHeight: "46px", color: "#d6d6da", whiteSpace: "pre", overflow: "hidden" }}>
        <div><span style={{ color: "#5fd27a" }}>{CMD.slice(0, 1)}</span>{CMD.slice(1, typed)}{typed < CMD.length && <span style={{ background: "#d6d6da" }}> </span>}</div>
        <div style={{ height: 30 }} />
        {JSON_LINES.map((l, i) => {
          const p = ease(f, 60 + i * 3, 68 + i * 3);
          return <div key={i} style={{ opacity: p, transform: `translateX(${(1 - p) * 12}px)` }}>{l}</div>;
        })}
      </div>
      {EP.map(([e, d], i) => {
        const a = API_B.hits[i], x = ease(f, qr - 8, qr + 6, inn);
        const p = ease(f, a, a + 8), hit = Math.max(0, 1 - (f - a) / 12);
        return <div key={e} style={{ position: "absolute", left: 1110, top: 250 + i * 136, opacity: p * (1 - x), transform: `translateX(${(1 - p) * 60}px) scale(${1 + 0.05 * hit * p})`, transformOrigin: "0 50%" }}>
          <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: e.length > 24 ? 34 : 44, color: C.paper }}>{e}</div>
          <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 36, color: C.muted }}>{d}</div>
        </div>;
      })}
      {(() => {
        const p = ease(f, qr, qr + 16);
        return <div style={{ position: "absolute", left: 1180, top: 200, opacity: p, transform: `scale(${0.85 + 0.15 * p})`, transformOrigin: "50% 0" }}>
          {/* QR of https://bus.haroldpoi.dev/api (short link to the API reference), on white so a phone can scan it */}
          <div style={{ padding: 28, background: "#fff", borderRadius: 30, width: 520, boxSizing: "border-box" }}><Img src={staticFile("promo-api-qr.svg")} style={{ display: "block", width: 464, height: 464 }} /></div>
          <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 44, color: C.paper, marginTop: 22, width: 520, textAlign: "center" }}>Ανοιχτό API</div>
          <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 40, color: "#5fd27a", marginTop: 6, width: 520, textAlign: "center" }}>bus.haroldpoi.dev/api</div>
        </div>;
      })()}
    </AbsoluteFill>
  );
};

const Open: React.FC = () => {
  const L = len("open");
  return (
    <div style={{ position: "absolute", left: 140, right: 140, top: 270 }}>
      <Words text="Ανοιχτά δεδομένα. Ανοιχτός κώδικας." at={0} until={L - 12} size={92} />
      <Words text="Ελεύθερο να το χρησιμοποιήσεις. Και να το κάνεις καλύτερο." at={BEAT} until={L - 12} size={56} weight={600} color="#5fd27a" style={{ marginTop: 30 }} />
      <Words text="GTFS ΟΑΣΑ & ΣΤΑΣΥ (data.gov.gr) · OpenStreetMap · άδεια MIT" at={BEAT * 2} until={L - 12} size={42} weight={600} color={C.muted} stagger={1} style={{ marginTop: 50 }} />
    </div>
  );
};

const End: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ transform: `scale(${1 + 0.03 * (f / len("end"))})` }}>
      <Pill scale={3.2 * (1 + 0.015 * Math.sin(f / 10))} ring={APP.delay.ontime} style={{ left: W / 2, top: 380 }} />
      <div style={{ position: "absolute", left: 40, right: 40, top: 540 }}>
        <Words text="bus.haroldpoi.dev" at={6} size={104} align="center" stagger={0} />
        <Words text="API: bus.haroldpoi.dev/api" at={22} size={58} weight={600} color={C.muted} align="center" stagger={0} style={{ marginTop: 26 }} />
      </div>
    </AbsoluteFill>
  );
};

const EL: Record<SceneB, React.FC> = { q: Q, proto: Proto, pipe: Pipe, scale: Scale, live: Live, late: Late, speed: Speed, fav: Fav, plan: Plan,
  alert: Alert, pitch: Pitch, api: Api, open: Open, end: End };

// The ink stage: a faint light that drifts, so type-only holds never freeze.
const Stage: React.FC = () => {
  const f = useCurrentFrame();
  const x = 50 + 18 * Math.sin(f / 240), y = 40 + 12 * Math.cos(f / 300);
  return <AbsoluteFill style={{ background: `radial-gradient(1300px 900px at ${x}% ${y}%, #202024 0%, ${C.ink} 62%)` }} />;
};

// Type-only scenes drift (3 % push), so no hold is a still frame.
const DRIFT = new Set<SceneB>(["q", "proto", "pitch", "api", "open", "end", "scale"]);
const Drift: React.FC<{ id: SceneB; children: React.ReactNode }> = ({ id, children }) => {
  const f = useCurrentFrame();
  if (!DRIFT.has(id)) return <>{children}</>;
  const t = f / len(id);
  return <AbsoluteFill style={{ transform: `scale(${1 + 0.035 * t}) translateY(${-10 * t}px)` }}>{children}</AbsoluteFill>;
};

export const FilmB: React.FC<{ audio?: string }> = ({ audio }) => (
  <AbsoluteFill style={{ background: C.ink }}>
    <Stage />
    {(Object.keys(SB) as SceneB[]).map(id => {
      const El = EL[id];
      const from = GB.bar(SB[id][0]);
      return <Sequence key={id} from={from} durationInFrames={GB.bar(SB[id][1]) - from} name={id}><Drift id={id}><El /></Drift></Sequence>;
    })}
    {audio && <Audio src={staticFile(audio)} />}
  </AbsoluteFill>
);
void PH; void out; void Plate;
