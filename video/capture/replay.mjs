// Replays the backend's recorded fixes (capture/replay/fixes.csv.gz, from capture/replay_extract.py) as the
// city layer's /v1/vehicles/tiles answers, so a capture can show a real weekday peak at any hour.
// Snapshot rule as the backend (docs/CONTRACT.md): one build every 30 s; each vehicle's newest fix, left out
// when older than 5 min. Entries carry the z 9 fields (no path), so vehicles stand between fixes.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";

export function loadReplay(dir) {
  const lines = gunzipSync(readFileSync(join(dir, "fixes.csv.gz"))).toString().trim().split(/\r?\n/);
  const head = lines[0].split(",");
  const ix = k => head.indexOf(k);
  const fixes = lines.slice(1).map(l => l.split(",")).map(c => ({
    t: +c[ix("fix_t")], line: c[ix("line")], route: c[ix("route_code")], veh: c[ix("veh")],
    lat: +c[ix("lat")] / 1e6, lon: +c[ix("lon")] / 1e6, delay: c[ix("delay_s")] === "" ? null : +c[ix("delay_s")],
  })).sort((a, b) => a.t - b.t);
  const byVeh = new Map();
  for (const f of fixes) { if (!byVeh.has(f.veh)) byVeh.set(f.veh, []); byVeh.get(f.veh).push(f); }

  const m = (a, b) => Math.hypot((b.lat - a.lat) * 111320, (b.lon - a.lon) * 111320 * Math.cos(a.lat * Math.PI / 180));
  const snap = now => {
    const updated = Math.floor(now / 30) * 30, vehicles = [];
    for (const [id, fs] of byVeh) {
      let k = -1;
      for (let i = 0; i < fs.length && fs[i].t <= updated; i++) k = i;
      if (k < 0 || fs[k].t < updated - 300) continue;
      const f = fs[k], p = fs[k - 1];
      // speed: null, as the contract says for a vehicle with no shape (the history has none; z 9 does not move by it).
      let bearing = null;
      if (p && f.t - p.t <= 300 && m(p, f) > 10)
        bearing = Math.round((Math.atan2((f.lon - p.lon) * Math.cos(f.lat * Math.PI / 180), f.lat - p.lat) * 180 / Math.PI + 360) % 360);
      vehicles.push({ line: f.line, id, lat: +f.lat.toFixed(5), lon: +f.lon.toFixed(5), bearing, position_at: f.t, variant: f.route, delay_s: f.delay, speed: null });
    }
    vehicles.sort((a, b) => (a.line < b.line ? -1 : a.line > b.line ? 1 : a.id < b.id ? -1 : 1));
    return { updated_at: updated, next_update_at: updated + 30, vehicles };
  };
  const tileOf = (v, z) => {
    const n = 2 ** z, r = v.lat * Math.PI / 180;
    return [Math.floor((v.lon + 180) / 360 * n), Math.floor((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2 * n)];
  };
  // Route handler body for a request URL at page time `now` (s), or null to pass through.
  const answer = (url, now) => {
    const u = new URL(url);
    const t = /^\/v1\/vehicles\/tiles\/(\d+)\/(\d+)\/(\d+)$/.exec(u.pathname);
    if (t) {
      const [z, x, y] = t.slice(1).map(Number), s = snap(now);
      return { ...s, vehicles: s.vehicles.filter(v => { const [a, b] = tileOf(v, z); return a === x && b === y; }) };
    }
    if (u.pathname === "/v1/vehicles") return snap(now);
    return null;
  };
  return { answer, snap, count: now => snap(now).vehicles.length };
}
