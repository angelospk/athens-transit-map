// Network access. With VITE_MOCK=1 every call is answered by mock.ts (left out of prod builds).

import { API_BASE, STATIC_BASE } from "./config";
import type { FetchResult } from "./poller";
import { stasyUrl } from "./rail";
import { SwrCache } from "./swr";
import { scheduleUrl } from "./timetable";
import { suburbanUrl } from "./suburban";
import { railMotionUrl, stasyTripUrl, stasyVehiclesUrl, suburbanTrainUrl, suburbanVehiclesUrl } from "./trains";
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

// The rail cards' data goes through one cache: the map loads what is on screen while it rests
// (prefetch), and a card shows that at once (peek) and asks again only past the server's cache time.
export const railCache = new SwrCache();
const railGet = (url: string, ttl: number, mock: () => Promise<FetchResult>) =>
  railCache.get(url, ttl, () => (import.meta.env.VITE_MOCK === "1" ? mock() : getJSON(url, AbortSignal.timeout(10_000))));

export const fetchStasy = (name: string) =>
  railGet(stasyUrl(name), 30_000, async () => (await import("./mock")).mockStasy(name));
export const peekStasy = (name: string) => railCache.peek(stasyUrl(name));

export async function fetchSchedule(line: string, signal?: AbortSignal): Promise<FetchResult> {
  if (import.meta.env.VITE_MOCK === "1") return (await import("./mock")).mockSchedule(line);
  return getJSON(scheduleUrl(line), signal);
}

export const fetchSuburban = (id: string) =>
  railGet(suburbanUrl(id), 60_000, async () => (await import("./mock")).mockSuburban(id));
export const peekSuburban = (id: string) => railCache.peek(suburbanUrl(id));

// Trains on the map (trains.ts): the vehicles of both networks, and the run of a tapped train.
export async function fetchTrains(kind: "metro" | "suburban", signal?: AbortSignal): Promise<FetchResult> {
  if (import.meta.env.VITE_MOCK === "1") return (await import("./mock")).mockTrains(kind);
  return getJSON(kind === "metro" ? stasyVehiclesUrl : suburbanVehiclesUrl, signal);
}

// The metro/tram runs of /v2 with their knots (trains.ts railMotions); none in the mock.
export async function fetchRailMotion(signal?: AbortSignal): Promise<FetchResult | null> {
  return import.meta.env.VITE_MOCK === "1" ? null : getJSON(railMotionUrl, signal);
}

// A metro run is the timetable's (it changes once a day); a Proastiakos run carries its live delay.
const runUrl = (kind: "metro" | "suburban", id: string) => (kind === "metro" ? stasyTripUrl(id) : suburbanTrainUrl(id));
export const fetchTrainRun = (kind: "metro" | "suburban", id: string) =>
  railGet(runUrl(kind, id), kind === "metro" ? 600_000 : 30_000, async () => (await import("./mock")).mockTrainRun(kind, id));
// A bus stop's lines and live arrivals (backend, cached 15 s), shared like the rail boards.
export const stopUrl = (id: string) => `${API_BASE}/v1/stops/${encodeURIComponent(id)}`;
export const fetchStop = (id: string) =>
  railGet(stopUrl(id), 15_000, async () => (await import("./mock")).mockStop(id));
export const peekStop = (id: string) => railCache.peek(stopUrl(id));
export const peekTrainRun = (kind: "metro" | "suburban", id: string) => railCache.peek(runUrl(kind, id));
