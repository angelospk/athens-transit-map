// The arithmetic of the 3D mode (map/scene3d.ts), kept apart from MapLibre and three.js so it can be tested.

export type LngLat = [number, number];
export const TREE_TILE_Z = 14;   // the tree tiles of scripts/trees.py

/** The web-mercator tile [x, y] of a point at zoom z. */
export function tileOf([lon, lat]: LngLat, z = TREE_TILE_Z): [number, number] {
  const n = 2 ** z;
  return [Math.floor(((lon + 180) / 360) * n), Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n)];
}

/** The tiles ("x/y") that cover a view. */
export function tilesIn(west: number, south: number, east: number, north: number, z = TREE_TILE_Z): string[] {
  const [x0, y0] = tileOf([west, north], z), [x1, y1] = tileOf([east, south], z);
  const out: string[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(`${x}/${y}`);
  return out;
}

/** The model's yaw in radians, counter-clockwise from east: the bus is built along +x; a heading is clockwise from north. */
export const yaw = (headingDeg: number) => ((90 - headingDeg) * Math.PI) / 180;

// MapLibre's world is 512 px wide at zoom 0: metres per pixel at a latitude and zoom.
export const metresPerPixel = (lat: number, z: number) => (2 * Math.PI * 6378137 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** z);

/** A line width (or circle radius) of `m` metres at every zoom, at least `minPx` pixels: stops at each whole zoom from
 *  12 to 24, joined exponentially, so between stops the size stays exactly `m` metres. `m` may be a per-feature
 *  expression giving metres (a road's width by its class), multiplied at each stop (no minimum then). */
export function metres(m: number | unknown[], lat: number, minPx = 0): unknown[] {
  const stops: unknown[] = [];
  for (let z = 12; z <= 24; z++) {
    const k = 1 / metresPerPixel(lat, z);
    stops.push(z, typeof m === "number" ? Math.max(minPx, m * k) : ["*", k, m]);
  }
  return ["interpolate", ["exponential", 2], ["zoom"], ...stops];
}
