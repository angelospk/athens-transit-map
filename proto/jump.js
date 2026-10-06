// PROTOTYPE, throwaway: five ways to show a vehicle "jump". Each panel is a pure function of
// the loop time t, so window.__seek(t) can freeze any moment for screenshots.

const W = 440, H = 300, LOOP = 13, TJ = 5, M_PER_PX = 6;
const C = { ontime: "#1a7f37", late1: "#a87c00", late2: "#d9480f", accent: "#0071e3", muted: "#6e6e73" };

// Route of line 137 in canvas px; distance along it is "s".
const ROUTE = [[20, 255], [150, 255], [200, 215], [210, 140], [250, 95], [330, 85], [400, 40], [430, 30]];
const CUM = ROUTE.reduce((a, p, i) => (i ? [...a, a[i - 1] + Math.hypot(p[0] - ROUTE[i - 1][0], p[1] - ROUTE[i - 1][1])] : [0]), []);
const LEN = CUM[CUM.length - 1];

function at(s) {
  s = Math.max(0, Math.min(LEN, s));
  let i = 1;
  while (i < CUM.length - 1 && CUM[i] < s) i++;
  const [a, b] = [ROUTE[i - 1], ROUTE[i]], q = (s - CUM[i - 1]) / (CUM[i] - CUM[i - 1]);
  return { x: a[0] + (b[0] - a[0]) * q, y: a[1] + (b[1] - a[1]) * q, ang: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}
// Route points from s1 to s2 (either order), in that order.
function seg(s1, s2) {
  const lo = Math.min(s1, s2), hi = Math.max(s1, s2);
  const pts = [at(lo), ...ROUTE.filter((_, i) => CUM[i] > lo && CUM[i] < hi).map(([x, y]) => ({ x, y })), at(hi)];
  return s1 <= s2 ? pts : pts.reverse();
}

// The three buses. Stale ones show a guessed (predicted) position until the fix at TJ.
const BUSES = [
  { id: "live", s0: 0, v: 8, cls: "ontime", live: true },
  { id: "fwd", s0: 100, v: 6, cls: "late1", age0: 160, jump: 150, raw: 90 },   // 900 m ahead
  { id: "back", s0: 470, v: 6, cls: "ontime", age0: 230, jump: -110, raw: 380 }, // 650 m behind
];
const oldS = b => b.s0 + b.v * TJ;
const newS = (b, t) => oldS(b) + b.jump + b.v * (t - TJ);
const shownS = (b, t) => (b.live || t < TJ ? b.s0 + b.v * t : newS(b, t));
const age = (b, t) => (b.live ? 2 + (t * 1.3) % 9 : t < TJ ? b.age0 + t : 2 + (t - TJ));
const fmtAge = s => (s < 60 ? `πριν ${Math.floor(s)}″` : `πριν ${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);
// Without motion: the last recorded fix as it is. Live fixes every 3 s, seen 2 s late.
const FIX_EVERY = 3;
function lastFix(b, t) {
  if (!b.live && t < TJ) return { s: b.raw, at: -b.age0 };
  const t0 = b.live ? 0 : TJ, k = t0 + Math.floor((t - t0) / FIX_EVERY) * FIX_EVERY;
  return { s: b.live ? shownS(b, k) : newS(b, k), at: k - 2 };
}
const clamp = x => Math.max(0, Math.min(1, x));
const ease = x => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

// ---- drawing primitives ----

function background(g) {
  g.fillStyle = "#f2efe9"; g.fillRect(0, 0, W, H);
  g.strokeStyle = "#ffffff"; g.lineWidth = 6;
  for (const [x1, y1, x2, y2] of [[0, 180, 440, 160], [60, 0, 90, 300], [300, 0, 290, 300], [0, 120, 440, 140], [380, 0, 360, 300], [0, 40, 200, 30]]) {
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  }
  g.fillStyle = "#d8ecd0"; g.fillRect(320, 190, 90, 70);
  line(g, ROUTE.map(([x, y]) => ({ x, y })), "rgba(112,72,232,.55)", 5);
  for (let s = 30; s < LEN; s += 75) {
    const p = at(s);
    g.beginPath(); g.arc(p.x, p.y, 3.5, 0, 7); g.fillStyle = "#fff"; g.fill();
    g.strokeStyle = "#7048e8"; g.lineWidth = 1.5; g.stroke();
  }
}

function line(g, pts, color, width, dash = []) {
  g.save(); g.setLineDash(dash); g.lineCap = g.lineJoin = "round";
  g.strokeStyle = color; g.lineWidth = width;
  g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke();
  g.restore();
}

function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }

// The bus pill as in the app: line number on the delay colour, white border, age label below.
// o: { alpha, scale, blur, hollow (0..1), dashed, grey, ageText, ageColor }
function pill(g, p, b, o = {}) {
  const { alpha = 1, scale = 1, blur = 0, hollow = 0, dashed = false, grey = false, ageText, ageColor = "#1d1d1f", solidAge = false } = o;
  const col = grey ? "#9a9aa0" : C[b.cls];
  g.save(); g.globalAlpha = alpha; if (blur) g.filter = `blur(${blur}px)`;
  g.translate(p.x, p.y); g.scale(scale, scale);
  rr(g, -18, -11, 36, 22, 11);
  g.shadowColor = "rgba(0,0,0,.35)"; g.shadowBlur = 3; g.shadowOffsetY = 1;
  g.fillStyle = "#fff"; g.fill(); g.shadowColor = "transparent";
  if (hollow < 1) { g.globalAlpha = alpha * (1 - hollow); rr(g, -16, -9, 32, 18, 9); g.fillStyle = col; g.fill(); g.globalAlpha = alpha; }
  if (hollow > 0) { g.setLineDash(dashed ? [4, 3] : []); g.strokeStyle = col; g.lineWidth = 2; rr(g, -16, -9, 32, 18, 9); g.stroke(); g.setLineDash([]); }
  g.fillStyle = hollow > 0.5 ? col : "#fff";
  g.font = "700 11px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText("137", 0, 0.5);
  if (ageText) {
    if (solidAge) g.globalAlpha = 1;
    g.font = "600 10px system-ui, sans-serif";
    const w = g.measureText(ageText).width + 8;
    rr(g, -w / 2, 13, w, 14, 6); g.fillStyle = "rgba(255,255,255,.96)"; g.fill();
    g.fillStyle = ageColor; g.fillText(ageText, 0, 20.5);
  }
  g.restore();
}

function ring(g, p, scale, alpha, color = C.accent) {
  if (alpha <= 0) return;
  g.save(); g.globalAlpha = alpha; g.translate(p.x, p.y); g.scale(scale, scale);
  rr(g, -21, -14, 42, 28, 14); g.strokeStyle = color; g.lineWidth = 2 / scale; g.stroke(); g.restore();
}

function bubble(g, x, y, text, alpha, color = C.accent) {
  if (alpha <= 0) return;
  g.save(); g.globalAlpha = alpha; g.font = "700 11px system-ui, sans-serif";
  const w = g.measureText(text).width + 12;
  rr(g, x - w / 2, y - 10, w, 20, 10); g.fillStyle = color; g.fill();
  g.beginPath(); g.moveTo(x - 4, y + 9); g.lineTo(x + 4, y + 9); g.lineTo(x, y + 14); g.fill();
  g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, x, y + 0.5);
  g.restore();
}

function arrowHead(g, pts, color, alpha) {
  const b = pts[pts.length - 1], a = pts[pts.length - 2], ang = Math.atan2(b.y - a.y, b.x - a.x);
  g.save(); g.globalAlpha = alpha; g.translate(b.x, b.y); g.rotate(ang);
  g.beginPath(); g.moveTo(0, 0); g.lineTo(-11, -6); g.lineTo(-11, 6); g.closePath();
  g.fillStyle = color; g.fill(); g.restore();
}

// Shorten a polyline at its end by d px (so an arrow stops at the pill's edge).
function trimEnd(pts, d) {
  const out = pts.slice();
  while (out.length > 1 && d > 0) {
    const b = out[out.length - 1], a = out[out.length - 2], L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L > d) { out[out.length - 1] = { x: b.x - (b.x - a.x) * d / L, y: b.y - (b.y - a.y) * d / L }; break; }
    out.pop(); d -= L;
  }
  return out;
}

// ---- stale look ----

// Today: a stale pill (> 90 s) is only lighter, with an orange age label.
function todayLook(b, t) {
  const a = age(b, t);
  return a > 90 ? { alpha: 0.55, ageText: fmtAge(a), ageColor: C.late2 } : { ageText: fmtAge(a) };
}
// Proposed: much fainter than today, age label still readable.
const FAINT = 0.3;
const faintLook = a => (a > 90 ? { alpha: FAINT, solidAge: true, ageText: fmtAge(a), ageColor: C.late2 } : { ageText: fmtAge(a) });
function hollowLook(b, t) {
  return faintLook(age(b, t));
}

// ---- variants: each draws the two stale buses for time t ----

const VARIANTS = [
  {
    key: "A", caption: "Σήμερα: θολώνει και σβήνει, ξαναβγαίνει αλλού με μπλε δαχτυλίδι (0,9″).",
    draw(g, b, t, look) {
      const p = (t - TJ) / 0.9;
      if (p < 0 || p >= 1) return pill(g, at(shownS(b, t)), b, look(b, t));
      if (p < 0.45) {
        const q = p / 0.45;
        return pill(g, at(oldS(b)), b, { ...look(b, TJ - 0.01), alpha: 1 - 0.9 * q, blur: 4 * q, scale: 1 + 0.45 * q });
      }
      const q = (p - 0.45) / 0.55, pos = at(newS(b, t));
      pill(g, pos, b, { ...look(b, t), alpha: 0.1 + 0.9 * q, blur: 4 * (1 - q), scale: 0.75 + 0.25 * q });
      ring(g, pos, 0.8 + 1.2 * q, q < 0.2 ? q / 0.2 * 0.9 : 0.9 * (1 - q) / 0.8);
    },
  },
  {
    key: "B", caption: "Φάντασμα στην παλιά θέση και βέλος πάνω στη διαδρομή ως τη νέα· σβήνει σε 3″.",
    draw(g, b, t, look) {
      const p = (t - TJ) / 3;
      if (p < 0 || p >= 1) return pill(g, at(shownS(b, t)), b, look(b, t));
      const fade = p < 0.65 ? 1 : (1 - p) / 0.35, s1 = oldS(b), s2 = newS(b, t);
      const pts = trimEnd(seg(s1, s2), 22);
      g.save(); g.globalAlpha = fade; line(g, pts, C.accent, 3, [7, 5]); g.restore();
      arrowHead(g, pts, C.accent, fade);
      pill(g, at(s1), b, { hollow: 1, dashed: true, grey: true, alpha: 0.85 * fade });
      const mid = at((s1 + s2) / 2), d = Math.round(Math.abs(b.jump) * M_PER_PX / 50) * 50;
      bubble(g, mid.x, mid.y - 18, `${d} μ ${b.jump > 0 ? "μπροστά" : "πίσω"}`, fade);
      const pos = at(s2);
      pill(g, pos, b, look(b, t));
      ring(g, pos, 1 + p * 3, 0.9 * (1 - clamp(p * 3)));
    },
  },
  {
    key: "C", caption: "Γρήγορη ορατή ολίσθηση πάνω στη διαδρομή ως τη νέα θέση, με σύντομο ίχνος.",
    draw(g, b, t, look) {
      const GL = 1.2, FADE = 0.8, p = (t - TJ) / GL;
      if (p < 0 || p >= 1 + FADE / GL) return pill(g, at(shownS(b, t)), b, look(b, t));
      const s1 = oldS(b), s = p < 1 ? s1 + (newS(b, t) - s1) * ease(p) : newS(b, t);
      const alpha = p < 1 ? 0.55 : 0.55 * (1 - (t - TJ - GL) / FADE);
      line(g, seg(s1, s), `rgba(0,113,227,${alpha})`, 8);
      pill(g, at(s), b, p < 1 ? { ageText: "ενημέρωση…", ageColor: C.accent } : look(b, t));
    },
  },
  {
    key: "D", caption: "Η παλιά κουκκίδα μικραίνει και σβήνει· η νέα πάλλεται με ετικέτα «ενημερώθηκε».",
    draw(g, b, t, look) {
      const dt = t - TJ;
      if (dt < 0 || dt >= 3) return pill(g, at(shownS(b, t)), b, look(b, t));
      const q = clamp(dt / 1.2);
      if (q < 1) pill(g, at(oldS(b)), b, { grey: true, scale: 1 - 0.7 * q, alpha: 1 - q });
      const pos = at(newS(b, t)), beat = dt < 1.8 ? Math.sin((dt / 0.6) * Math.PI) ** 2 : 0;
      pill(g, pos, b, { ...look(b, t), scale: 1 + 0.2 * beat });
      if (dt < 1.8) ring(g, pos, 1 + ((dt % 0.6) / 0.6) * 0.9, 0.8 * (1 - (dt % 0.6) / 0.6));
      bubble(g, pos.x, pos.y - 26, "ενημερώθηκε", dt < 2.5 ? 1 : (3 - dt) / 0.5);
    },
  },
  {
    key: "E", caption: "Τα παλιά δεδομένα φαίνονται αχνά με την ηλικία τους· γίνονται έντονα μόλις έρθει νέα θέση.",
    stale: true,
    draw(g, b, t, look) {
      const dt = t - TJ;
      if (dt < 0 || dt >= 2) return pill(g, at(shownS(b, t)), b, look(b, t));
      const q = clamp(dt / 0.6);
      pill(g, at(oldS(b)), b, { grey: true, alpha: FAINT * (1 - clamp(dt / 1.5)) });
      pill(g, at(newS(b, t)), b, { alpha: FAINT + (1 - FAINT) * q, solidAge: true, scale: 1 + 0.15 * Math.sin(q * Math.PI),
        ageText: dt < 1.6 ? "μόλις τώρα" : fmtAge(age(b, t)), ageColor: C.ontime });
    },
  },
  {
    key: "F", caption: "Χωρίς κίνηση: μόνο η τελευταία καταγεγραμμένη θέση και πριν πόσο· ίχνος όταν αλλάζει.",
    raw: true,
    draw(g, b, t) {
      const f = lastFix(b, t), a = t - f.at, since = t - Math.max(0, f.at + 2);
      if (since < 1 && t >= 1) {   // a new fix arrived under a second ago: trail from the previous one
        const prev = lastFix(b, f.at + 2 - 0.001);
        line(g, seg(prev.s, f.s), `rgba(0,113,227,${0.55 * (1 - since)})`, 8);
      }
      pill(g, at(f.s), b, faintLook(a));
    },
  },
];

// ---- page wiring ----

const panels = VARIANTS.map(v => {
  const fig = document.createElement("figure"), cv = document.createElement("canvas");
  cv.width = W * 2; cv.height = H * 2;
  fig.append(cv);
  const cap = document.createElement("figcaption");
  cap.innerHTML = `<b>${v.key}</b>${v.caption}`;
  fig.append(cap);
  document.getElementById("grid").append(fig);
  return { v, g: cv.getContext("2d") };
});

const slow = document.getElementById("slow"), staleAll = document.getElementById("stale"), clock = document.getElementById("clock");

function render(t) {
  for (const { v, g } of panels) {
    g.setTransform(2, 0, 0, 2, 0, 0);
    background(g);
    const look = v.stale || staleAll.checked ? hollowLook : todayLook;
    for (const b of BUSES) b.live && !v.raw ? pill(g, at(shownS(b, t)), b, look(b, t)) : v.draw(g, b, t, look);
  }
  clock.textContent = `t = ${t.toFixed(1)} s · νέα θέση στα ${TJ} s`;
}

let frozen = null, last = 0, tPrev = 0;
function frame(now) {
  if (frozen == null) {
    tPrev = (tPrev + ((now - last) / 1000) * (slow.checked ? 0.33 : 1)) % LOOP;
    render(tPrev);
  }
  last = now;
  requestAnimationFrame(frame);
}
requestAnimationFrame(n => { last = n; frame(n); });
document.getElementById("replay").onclick = () => { frozen = null; tPrev = 0; };
staleAll.onchange = () => frozen != null && render(frozen);

// For screenshots: __seek(t) freezes at time t; __seek(null) resumes.
window.__seek = t => { frozen = t; if (t != null) render(t); };
