// Small geometry helpers shared by the motion code.

export type LngLat = [number, number];

export const JUMP_M = 1000;   // longer moves (new trip, GPS glitch) are not animated

export const ease = (k: number) => k * (2 - k);

export function distanceM(a: LngLat, b: LngLat): number {
  const rad = Math.PI / 180, R = 6_371_000;
  const dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

