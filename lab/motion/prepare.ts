// Motion lab evaluator (lab/motion/program.md). Fixed: models.ts may change, this file may not.
// Replays recorded /v1/vehicles snapshots: for every fix A, each model predicts the vehicle's
// distance along its shape while A is the newest fix the map knows (from A's first fetch to the
// next fix's first fetch), and is scored against the true fixes in that window.
//   bun lab/motion/prepare.ts <dir with v_<unix>.json> [--split tune|test|all]

import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { projectCandidates, shapeLength, stopOffsets } from "../../src/lib/predict";
import type { LngLat } from "../../src/lib/glide";
import { MODELS, type Fix, type Run, type Ctx } from "./models";

const STATIC = "https://angelospk.github.io/athens-transit-rt/static/v1/lines/";
const MAX_GAP_S = 300;     // a longer gap between fixes starts a new run
const BACK_M = 30;         // GPS noise backwards
const MAX_V = 20;          // m/s
const TUNE_SHARE = 0.6;    // first 60 % of the time range tunes, the rest tests
const AHEAD_W = 1.5;       // ahead errors weigh more (they end in backward corrections)

interface Snap { at: number; vehicles: any[] }
interface LineFile { variants: Record<string, { shape: [number, number][]; stops: string[] }>; stops: Record<string, { lat: number; lon: number }> }
interface Route { shape: [number, number][]; stopS: number[]; endS: number }

const dir = process.argv[2];
const split = (process.argv.find(a => a.startsWith("--split="))?.slice(8) ?? "all") as "tune" | "test" | "all";
if (!dir) throw new Error("usage: bun lab/motion/prepare.ts <dir> [--split=tune|test|all]");

const snaps: Snap[] = readdirSync(dir).filter(f => /^v_\d+\.json$/.test(f)).sort().flatMap(f => {
  try { return [{ at: +f.slice(2, -5), vehicles: JSON.parse(readFileSync(join(dir, f), "utf8")).vehicles ?? [] }]; }
  catch { return []; }
});

// Static line files, cached next to the samples.
const cacheDir = join(dir, "..", "static");
mkdirSync(cacheDir, { recursive: true });
async function lineFile(id: string): Promise<LineFile | null> {
  const p = join(cacheDir, encodeURIComponent(id) + ".json");
  if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  const r = await fetch(STATIC + encodeURIComponent(id) + ".json");
  if (!r.ok) return null;
  const t = await r.text();
  writeFileSync(p, t);
  return JSON.parse(t);
}
const routes = new Map<string, Route | null>();
async function routeOf(line: string, variant: string): Promise<Route | null> {
  const k = line + "/" + variant;
  if (routes.has(k)) return routes.get(k)!;
  const f = await lineFile(line), v = f?.variants[variant];
  let r: Route | null = null;
  if (v && v.shape.length > 1) {
    const stops: LngLat[] = v.stops.map(id => f!.stops[id]).filter(Boolean).map(s => [s.lon, s.lat]);
    r = { shape: v.shape, stopS: stopOffsets(v.shape, stops), endS: shapeLength(v.shape) };
  }
  routes.set(k, r);
  return r;
}

// Every distinct fix per vehicle, with the time the map first saw it.
const seen = new Map<string, Map<number, { known: number; v: any }>>();
for (const sn of snaps) for (const v of sn.vehicles) {
  const k = v.line + "/" + v.id;
  const m = seen.get(k) ?? new Map();
  if (!m.has(v.position_at)) m.set(v.position_at, { known: sn.at, v });
  seen.set(k, m);
}

// Runs: consecutive fixes on one variant, projected onto its shape with plausible progress.
const runs: Run[] = [];
for (const [veh, m] of seen) {
  let cur: Run | null = null;
  for (const at of [...m.keys()].sort((a, b) => a - b)) {
    const { known, v } = m.get(at)!;
    const route = v.variant ? await routeOf(v.line, v.variant) : null;
    if (!route) { cur = null; continue; }
    const cands = projectCandidates(route.shape, [v.lon, v.lat]).map(c => c.s);
    if (!cands.length) { cur = null; continue; }
    const prev = cur && cur.variant === v.variant ? cur.fixes[cur.fixes.length - 1] : null;
    let s: number | null = null;
    if (prev && at - prev.at <= MAX_GAP_S) {
      const ok = cands.filter(c => c >= prev.s - BACK_M && c - prev.s <= MAX_V * (at - prev.at) + 100);
      if (ok.length) s = ok.reduce((b, c) => (Math.abs(c - prev.s) < Math.abs(b - prev.s) ? c : b));
    }
    if (s == null) {
      if (cands[cands.length - 1] - cands[0] > 50) { cur = null; continue; }   // ambiguous start
      s = cands[0];
      cur = { veh, line: v.line, variant: v.variant, stopS: route.stopS, endS: route.endS, fixes: [] };
      runs.push(cur);
    }
    const fix: Fix = { at, known, s, speed: v.speed ?? null, delay: v.delay_s ?? null };
    cur!.fixes.push(fix);
  }
}

const t0 = snaps[0]?.at ?? 0, t1 = snaps[snaps.length - 1]?.at ?? 0, cut = t0 + TUNE_SHARE * (t1 - t0);
const inSplit = (t: number) => split === "all" || (split === "tune" ? t < cut : t >= cut);

// Peers: every run of the same variant, for models that learn from other vehicles.
const byVariant = new Map<string, Run[]>();
for (const r of runs) {
  const k = r.line + "/" + r.variant;
  byVariant.set(k, [...(byVariant.get(k) ?? []), r]);
}

interface Score { e: number[]; jump: number[] }
const scores = new Map<string, Score>(MODELS.map(m => [m.name, { e: [], jump: [] }]));
let cases = 0;
for (const run of runs) {
  const f = run.fixes;
  for (let i = 0; i + 1 < f.length; i++) {
    const A = f[i], B = f[i + 1];
    const from = A.known, to = B.known;
    if (to <= from || !inSplit(from)) continue;
    // True fixes inside the window when A is the newest known fix.
    const truth = f.slice(i + 1).filter(x => x.at >= from && x.at <= to);
    if (!truth.length) continue;
    cases++;
    const peers = (byVariant.get(run.line + "/" + run.variant) ?? []).filter(r => r !== run);
    // No look-ahead: peers carry only the fixes the map had seen by then.
    const ctx = (k: number): Ctx => {
      const now = f[k].known;
      return { run, hist: f.slice(0, k + 1), now, peers: peers.map(p => ({ ...p, fixes: p.fixes.filter(x => x.known <= now) })) };
    };
    for (const m of MODELS) {
      const sc = scores.get(m.name)!;
      const pa = m.predict(ctx(i));
      for (const x of truth) sc.e.push(pa(x.at) - x.s);
      // The visible correction when B arrives: old guess vs new guess at that moment.
      sc.jump.push(Math.abs(pa(to) - m.predict(ctx(i + 1))(to)));
    }
  }
}

const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const r0 = (x: number) => Math.round(x);
console.log(`snapshots ${snaps.length} (${new Date(t0 * 1000).toISOString()} .. ${new Date(t1 * 1000).toISOString()}), runs ${runs.length}, cases ${cases}, split ${split}`);
console.log("model".padEnd(30), "score", "|e|p50", "|e|p90", "bias", "ahead>50", "jump p50", "jump p90");
const rows = MODELS.map(m => {
  const { e, jump } = scores.get(m.name)!;
  const score = e.reduce((a, x) => a + (x > 0 ? AHEAD_W * x : -x), 0) / e.length;
  return { name: m.name, score, e, jump };
}).sort((a, b) => a.score - b.score);
for (const { name, score, e, jump } of rows) {
  const abs = e.map(Math.abs);
  console.log(name.padEnd(30), String(r0(score)).padStart(5), String(r0(q(abs, 0.5))).padStart(6), String(r0(q(abs, 0.9))).padStart(6),
    String(r0(q(e, 0.5))).padStart(4), (e.filter(x => x > 50).length / e.length).toFixed(2).padStart(8),
    String(r0(q(jump, 0.5))).padStart(8), String(r0(q(jump, 0.9))).padStart(8));
}
