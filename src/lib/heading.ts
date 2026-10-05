// Which way a vehicle is going, in degrees clockwise from north (the map never rotates).

import { distanceM, type LngLat } from "./glide";

const NEAR_ROUTE_M = 150;   // farther than this, the shape says nothing about the vehicle
const TIE_M = 20;           // segments this close to the nearest one are equally likely
const MIN_MOVE_M = 15;      // GPS jitter below this is not a movement

const rad = Math.PI / 180;

export function bearingDeg(a: LngLat, b: LngLat): number {
  const y = Math.sin((b[0] - a[0]) * rad) * Math.cos(b[1] * rad);
  const x = Math.cos(a[1] * rad) * Math.sin(b[1] * rad) - Math.sin(a[1] * rad) * Math.cos(b[1] * rad) * Math.cos((b[0] - a[0]) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

const angleDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

// Distance (m) from p to segment ab, on a local flat projection (fine at city scale).
function segmentDistanceM(p: LngLat, a: LngLat, b: LngLat): number {
  const kx = Math.cos(p[1] * rad);
  const ax = (a[0] - p[0]) * kx, ay = a[1] - p[1], bx = (b[0] - p[0]) * kx, by = b[1] - p[1];
  const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy) * 111_320;
}

export function vehicleHeading(
  v: { lon: number; lat: number; bearing: number | null },
  shape: [number, number][] | null | undefined,   // [lat, lon], in travel order
  prev: LngLat | null,                            // previous GPS sample of this vehicle
): number | null {
  if (v.bearing != null && Number.isFinite(v.bearing)) return v.bearing;
  const p: LngLat = [v.lon, v.lat];
  const moved = prev && distanceM(prev, p) >= MIN_MOVE_M ? bearingDeg(prev, p) : null;
  if (shape && shape.length > 1) {
    const segs = [];
    for (let i = 1; i < shape.length; i++) {
      const a: LngLat = [shape[i - 1][1], shape[i - 1][0]], b: LngLat = [shape[i][1], shape[i][0]];
      if (a[0] !== b[0] || a[1] !== b[1]) segs.push({ d: segmentDistanceM(p, a, b), h: bearingDeg(a, b) });
    }
    const min = Math.min(...segs.map(s => s.d));
    if (min <= NEAR_ROUTE_M) {
      const near = segs.filter(s => s.d <= min + TIE_M);
      if (moved == null) {
        // A route that runs both ways along this street: without movement we cannot tell.
        const h = segs.find(s => s.d === min)!.h;
        return near.some(s => angleDiff(s.h, h) > 90) ? null : h;
      }
      return near.reduce((best, s) => (angleDiff(s.h, moved) < angleDiff(best.h, moved) ? s : best)).h;
    }
  }
  return moved;
}
