// Motion lab: historical speed per route segment and hour of week (TheTransitClock / Swiftly
// style), from the backend's fix history. Every pair of consecutive fixes of a vehicle on one
// variant spreads its distance and time over the 200 m bins it covers; standing time stays in
// its bin (no forward progress), so waits at stops and lights are part of the mean speed (ds / dt).
// Key: `<variant>:<bin>:<day type>:<local hour>` (day type 0 weekday, 1 Saturday, 2 Sunday) and
// `<variant>:<bin>:*` over all hours. Value: [metres, seconds].
//   bun lab/motion/segspeed.ts <history dir> <from ISO> <to ISO> <out.json>

import { writeFileSync } from "node:fs";
import { readRows, type Row } from "./history";

export const BIN_M = 200;
export const ATHENS_OFFSET_S = 3 * 3600;   // EEST; the data ends before 2026-10-25
export const hourKey = (t: number) => {
  const d = new Date((t + ATHENS_OFFSET_S) * 1000), w = d.getUTCDay();
  return `${w === 6 ? 1 : w === 0 ? 2 : 0}:${d.getUTCHours()}`;
};

if (import.meta.main) {
  const [hist, fromIso, toIso, out] = process.argv.slice(2);
  if (!out) throw new Error("usage: bun lab/motion/segspeed.ts <history dir> <from ISO> <to ISO> <out.json>");
  const from = Date.parse(fromIso) / 1000, to = Date.parse(toIso) / 1000;
  const table: Record<string, [number, number]> = {};
  const add = (k: string, ds: number, dt: number) => { const c = (table[k] ??= [0, 0]); c[0] += ds; c[1] += dt; };
  const prev = new Map<string, Row>();
  let pairs = 0;
  for (let a = from; a < to; a += 86400) {
    for (const r of readRows(hist, a, Math.min(a + 86400, to))) {
      const p = prev.get(r.veh);
      prev.set(r.veh, r);
      if (!p || p.route !== r.route) continue;
      const dt = r.t - p.t, ds = r.s - p.s;
      if (dt < 10 || dt > 300 || ds < -30 || ds > 20 * dt + 100) continue;
      pairs++;
      const hk = hourKey(p.t);
      const put = (bin: number, ds: number, dt: number) => { add(`${r.route}:${bin}:${hk}`, ds, dt); add(`${r.route}:${bin}:*`, ds, dt); };
      if (ds <= 0) { put(Math.floor(p.s / BIN_M), 0, dt); continue; }
      for (let b = Math.floor(p.s / BIN_M); b * BIN_M < r.s; b++) {
        const ov = Math.min(r.s, (b + 1) * BIN_M) - Math.max(p.s, b * BIN_M);
        if (ov > 0) put(b, ov, (dt * ov) / ds);
      }
    }
  }
  for (const k in table) table[k] = [Math.round(table[k][0]), Math.round(table[k][1])];
  writeFileSync(out, JSON.stringify(table));
  console.log(`${out}: ${pairs} pairs, ${Object.keys(table).length} keys`);
}
