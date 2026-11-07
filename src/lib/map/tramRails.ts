// The tram's rails in 3D: its lines (metro.json, one per direction) are coarse polylines, a vertex every 50-100 m with
// sharp corners. Here they are rounded (corner cutting, a few metres off the drawn line at most) for the rails, and a
// tram is put onto them (snapTram), so the rails and the tram turn together. No map, no DOM.

import { stretchesNear } from "./pathIndex";

type LL = [number, number];   // [lat, lon]
export type LonLat = [number, number];

const KY = 110540;
const kx = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);

/** A path rounded at its corners: each pass cuts every corner `cut` metres (at most a quarter of a stretch) back
 *  along both stretches; three passes make a smooth curve. The ends stay. */
export function smoothPath(p: LL[], cut = 7, passes = 3): LL[] {
  let pts = p;
  for (let k = 0; k < passes && pts.length > 2; k++) {
    const out: LL[] = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], b = pts[i], c = pts[i + 1], X = kx(b[0]);
      const lab = Math.hypot((b[1] - a[1]) * X, (b[0] - a[0]) * KY), lbc = Math.hypot((c[1] - b[1]) * X, (c[0] - b[0]) * KY);
      if (!lab || !lbc) { out.push(b); continue; }
      const d1 = Math.min(cut, lab / 4) / lab, d2 = Math.min(cut, lbc / 4) / lbc;
      out.push([b[0] + (a[0] - b[0]) * d1, b[1] + (a[1] - b[1]) * d1], [b[0] + (c[0] - b[0]) * d2, b[1] + (c[1] - b[1]) * d2]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
    cut /= 2;
  }
  return pts;
}

/** A tram onto the nearest rails within 25 m: the point there and the rails' way (degrees from north), the way it
 *  goes (`h`, when known) or else the way the line is drawn. A line drawn the other way than the tram goes counts
 *  10 m farther, so where the two directions run close it keeps to its own. */
export function snapTram(paths: LonLat[][], at: LonLat, h: number | null): { pos: LonLat; heading: number } | null {
  const X = kx(at[1]);
  let best = 25, out: { pos: LonLat; heading: number } | null = null;
  for (const p of paths) for (const i of stretchesNear(p, at, 25)) {   // only the stretches near it, not the whole line
    const ax = (p[i - 1][0] - at[0]) * X, ay = (p[i - 1][1] - at[1]) * KY, bx = (p[i][0] - at[0]) * X, by = (p[i][1] - at[1]) * KY;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    if (!L2) continue;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2));
    const bearing = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    const back = h != null && Math.abs(((bearing - h + 540) % 360) - 180) > 90;
    const d = Math.hypot(ax + dx * t, ay + dy * t) + (back ? 10 : 0);
    if (d < best) {
      best = d;
      out = { pos: [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t], heading: back ? (bearing + 180) % 360 : bearing };
    }
  }
  return out;
}
