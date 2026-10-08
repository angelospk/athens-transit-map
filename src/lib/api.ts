// Network access. With VITE_MOCK=1 every call is answered by mock.ts (left out of prod builds).

import { API_BASE, STATIC_BASE } from "./config";
import type { FetchResult } from "./poller";
import { loadTiles, tileKey, tileOf, tileUrlPath, type CityTiles, type Tile } from "./tiles";
import type { CityLive, LineStatic, LinesIndex, Status } from "./types";

// No cache-busting: all users should share the Cloudflare / browser cache.
export async function getJSON(url: string, signal?: AbortSignal): Promise<FetchResult> {
  try {
    const r = await fetch(url, { signal });
    let body: unknown = null;
    try { body = await r.json(); } catch { /* Cloudflare error pages are HTML; keep the status */ }
    // Server time, if the API exposes it (Access-Control-Expose-Headers: Date).
    const date = Date.parse(r.headers.get("Date") ?? "");
    return Number.isFinite(date) ? { status: r.status, body, date } : { status: r.status, body };
  } catch {
    return { status: 0, body: null };
  }
}

export const lineUrl = (line: string) => `${API_BASE}/v1/lines/${encodeURIComponent(line)}`;
export const lineStaticUrl = (line: string) => `${STATIC_BASE}/lines/${encodeURIComponent(line)}.json`;

export async function fetchLine(line: string, signal: AbortSignal): Promise<FetchResult> {
  if (import.meta.env.VITE_MOCK === "1") return (await import("./mock")).mockLine(line);
  return getJSON(lineUrl(line), signal);
}

export const tileUrl = (t: Tile) => `${API_BASE}${tileUrlPath(t)}`;

export async function fetchTile(t: Tile, signal?: AbortSignal): Promise<FetchResult> {
  if (import.meta.env.VITE_MOCK === "1") {
    const r = await (await import("./mock")).mockCity();   // the mock city, cut into the tile
    const b = r.body as CityLive;
    return { ...r, body: { ...b, vehicles: b.vehicles.filter(v => tileKey(tileOf(v.lat, v.lon, t.z)) === tileKey(t)) } };
  }
  return getJSON(tileUrl(t), signal);
}

// The city layer: the tiles of the current view (tiles.ts), refreshed all together.
export const fetchCity = (tiles: CityTiles) => (_: string, signal: AbortSignal) =>
  loadTiles(tiles, tiles.tiles, fetchTile, signal);

export async function fetchStatus(): Promise<Status | null> {
  if (import.meta.env.VITE_MOCK === "1") return (await import("./mock")).mockStatus();
  const r = await getJSON(`${API_BASE}/v1/status`);
  return r.status === 200 && r.body && typeof r.body === "object" ? (r.body as Status) : null;
}

// Static files change only with a new GTFS: fetch each once per page load.
const memo = new Map<string, Promise<unknown>>();
function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  let p = memo.get(key) as Promise<T> | undefined;
  if (!p) {
    p = load();
    memo.set(key, p);
    p.catch(() => memo.delete(key));
  }
  return p;
}

async function staticJSON<T>(url: string): Promise<T> {
  const r = await getJSON(url);
  if (r.status !== 200 || !r.body) throw new Error(`HTTP ${r.status}: ${url}`);
  return r.body as T;
}

export const fetchLines = () =>
  once("lines", async (): Promise<LinesIndex> =>
    import.meta.env.VITE_MOCK === "1" ? (await import("./mock")).mockLines() : staticJSON(`${STATIC_BASE}/lines.json`));

export const fetchLineStatic = (line: string) =>
  once("line:" + line, async (): Promise<LineStatic> =>
    import.meta.env.VITE_MOCK === "1" ? (await import("./mock")).mockLineStatic(line) : staticJSON(lineStaticUrl(line)));
