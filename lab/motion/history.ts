// Motion lab: turn the backend's fix history (hourly gzip CSV, `--history`) into the
// v_<unix>.json snapshots prepare.ts reads. Each fix goes into one snapshot: the first 30 s poll
// at least LAG_S after its GPS time (the 2026-10-06 sampler saw fixes 20/40/66 s late, p10/50/90).
// `speed` replays the backend's motion.go (Theil-Sen over the last 5 fixes, 300 s window).
//   bun lab/motion/history.ts <history dir> <out dir> <from ISO> <to ISO>

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const LAG_S = +(process.env.LAG_S ?? 25), POLL_S = 30, WARM_S = 600;

// route: the shape id, which the live API sends as `variant` (not route_code).
export interface Row { t: number; line: string; route: string; veh: string; lat: number; lon: number; s: number; delay: number | null }

// Rows of the hour files that touch [a, b), oldest first.
export function readRows(dir: string, a: number, b: number): Row[] {
  const rows: Row[] = [];
  for (const f of readdirSync(dir).filter(f => /^\d{4}-\d\d-\d\dT\d\d\.csv(\.gz)?$/.test(f)).sort()) {
    const h = Date.parse(f.slice(0, 13) + ":00:00Z") / 1000;
    if (h + 3600 <= a - 60 || h >= b + 60) continue;
    const raw = readFileSync(join(dir, f));
    const text = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
    for (const l of text.split("\n").slice(1)) {
      const c = l.split(",");
      if (c.length < 11 || c[9] === "" || +c[9] < 0) continue;   // -1: not on the shape
      const t = +c[0];
      if (t < a || t >= b) continue;
      rows.push({ t, line: c[1], route: c[8], veh: c[3], lat: +c[4] / 1e6, lon: +c[5] / 1e6, s: +c[9], delay: c[10] === "" ? null : +c[10] });
    }
  }
  return rows.sort((x, y) => x.t - y.t);
}

// internal/server/motion.go observe + speed.
interface Track { route: string; fx: { s: number; t: number }[] }
function speedOf(tracks: Map<string, Track>, r: Row): number | null {
  let tr = tracks.get(r.veh);
  const last = tr?.fx[tr.fx.length - 1];
  if (last && r.t <= last.t) return null;
  if (!tr || !last || tr.route !== r.route || !(r.s >= last.s - 30 && r.s - last.s <= 20 * (r.t - last.t) + 100)) {
    tr = { route: r.route, fx: [] };
    tracks.set(r.veh, tr);
  }
  if (tr.fx.length === 5) tr.fx.shift();
  tr.fx.push({ s: r.s, t: r.t });
  const n = tr.fx[tr.fx.length - 1];
  const fx = tr.fx.filter(f => n.t - f.t <= 300);
  if (fx.length < 2 || n.t - fx[0].t < 20) return null;
  if (Math.abs(n.s - fx[0].s) < 20) return 0;
  const sl: number[] = [];
  for (let i = 0; i < fx.length; i++) for (let j = i + 1; j < fx.length; j++) {
    const dt = fx[j].t - fx[i].t;
    if (dt >= 10) sl.push((fx[j].s - fx[i].s) / dt);
  }
  if (!sl.length) return null;
  sl.sort((a, b) => a - b);
  const m = sl.length % 2 ? sl[sl.length >> 1] : (sl[sl.length / 2 - 1] + sl[sl.length / 2]) / 2;
  return Math.round(Math.max(0, Math.min(20, m)) * 10) / 10;
}

if (import.meta.main) {
  const [hist, out, fromIso, toIso] = process.argv.slice(2);
  if (!toIso) throw new Error("usage: bun lab/motion/history.ts <history dir> <out dir> <from ISO> <to ISO>");
  const from = Date.parse(fromIso) / 1000, to = Date.parse(toIso) / 1000;
  const tracks = new Map<string, Track>();
  const snaps = new Map<number, any[]>();
  for (const r of readRows(hist, from - WARM_S, to)) {
    const speed = speedOf(tracks, r);
    if (r.t < from) continue;
    const at = Math.ceil((r.t + LAG_S) / POLL_S) * POLL_S;
    const v = { line: r.line, id: r.veh, lat: r.lat, lon: r.lon, position_at: r.t, variant: r.route, delay_s: r.delay, speed };
    snaps.set(at, [...(snaps.get(at) ?? []), v]);
  }
  mkdirSync(out, { recursive: true });
  for (let at = Math.ceil(from / POLL_S) * POLL_S; at < to + 120; at += POLL_S)
    writeFileSync(join(out, `v_${at}.json`), JSON.stringify({ vehicles: snaps.get(at) ?? [] }));
  console.log(`${out}: ${[...snaps.values()].reduce((a, v) => a + v.length, 0)} fixes`);
}
