// Network access. With VITE_MOCK=1 every call is answered by mock.ts (left out of prod builds).

import { API_BASE, STATIC_BASE } from "./config";
import type { FetchResult } from "./poller";
import { SwrCache } from "./swr";
import { scheduleUrl } from "./timetable";
import { railMotionUrl, stasyVehiclesUrl, suburbanVehiclesUrl } from "./trains";
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
  const r = await getJSON(`${API_BASE}/v1/status`, AbortSignal.timeout(15_000));   // under the 60 s between calls
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

const isObj = (b: unknown): b is Record<string, unknown> => !!b && typeof b === "object" && !Array.isArray(b);

// A 200 with JSON of another shape (a proxy's error page, a captive portal) is a failure, not data.
async function staticJSON<T>(url: string, ok: (b: Record<string, unknown>) => boolean): Promise<T> {
  // A timeout: a stalled request would stay memoized (once), and every later load would wait on it.
  const r = await getJSON(url, AbortSignal.timeout(20_000));
  // status: a 404 means the file does not exist (an unknown line); 0 means offline.
  if (r.status !== 200 || !isObj(r.body)) throw Object.assign(new Error(`HTTP ${r.status}: ${url}`), { status: r.status });
  if (!ok(r.body)) throw new Error(`Unexpected shape: ${url}`);
  return r.body as T;
}

export const fetchLines = () =>
  once("lines", async (): Promise<LinesIndex> =>
    import.meta.env.VITE_MOCK === "1" ? (await import("./mock")).mockLines() : staticJSON(`${STATIC_BASE}/lines.json`, b => Array.isArray(b.lines) && b.lines.length > 0));

export const fetchLineStatic = (line: string) =>
  once("line:" + line, async (): Promise<LineStatic> =>
    import.meta.env.VITE_MOCK === "1" ? (await import("./mock")).mockLineStatic(line) : staticJSON(lineStaticUrl(line), b => isObj(b.variants) && isObj(b.stops)));

// The cards' data goes through one cache: a card opened again shows the last answer at once (peek)
// and asks again only past the server's cache time.
export const railCache = new SwrCache();
const railGet = (url: string, ttl: number, mock: () => Promise<FetchResult>) =>
  railCache.get(url, ttl, () => (import.meta.env.VITE_MOCK === "1" ? mock() : getJSON(url, AbortSignal.timeout(10_000))));

export async function fetchSchedule(line: string, signal?: AbortSignal): Promise<FetchResult> {
  if (import.meta.env.VITE_MOCK === "1") return (await import("./mock")).mockSchedule(line);
  return getJSON(scheduleUrl(line), signal);
}

// Trains on the map (trains.ts): the vehicles of both networks, and the run of a tapped train.
export async function fetchTrains(kind: "metro" | "suburban", signal?: AbortSignal): Promise<FetchResult> {
  if (import.meta.env.VITE_MOCK === "1") return (await import("./mock")).mockTrains(kind);
  return getJSON(kind === "metro" ? stasyVehiclesUrl : suburbanVehiclesUrl, signal);
}

// The metro/tram runs of /v2 with their knots (trains.ts railMotions); none in the mock.
export async function fetchRailMotion(signal?: AbortSignal): Promise<FetchResult | null> {
  return import.meta.env.VITE_MOCK === "1" ? null : getJSON(railMotionUrl, signal);
}

// A bus stop's lines and live arrivals (backend, cached 15 s), shared like the rail boards.
export const stopUrl = (id: string) => `${API_BASE}/v1/stops/${encodeURIComponent(id)}`;
export const fetchStop = (id: string) =>
  railGet(stopUrl(id), 15_000, async () => (await import("./mock")).mockStop(id));
export const peekStop = (id: string) => railCache.peek(stopUrl(id));
// A metro train's run, every station with its time (Route3D, the 3D ride along the track): the timetable's, so it
// is kept for 10 minutes.
const stasyTripUrl = (id: string) => `${API_BASE}/v1/rail/stasy/trips/${encodeURIComponent(id)}`;
export const fetchTrainRun = (_kind: "metro", id: string) =>
  railCache.get(stasyTripUrl(id), 600_000, () => getJSON(stasyTripUrl(id), AbortSignal.timeout(10_000)));

// The unified /v2 API (v2.ts) for the cards: a Line with its patterns, its vehicles now, a Stop board, a Run.
// A body without its main field (a source still warming up: `line: null`), or with a field of the wrong type,
// counts as a 503, so it is not cached and no card maps over a string. No mock: with VITE_MOCK=1 they answer
// as offline (status 0).
const v2Get = (path: string, ttl: number, ok: (b: Record<string, unknown>) => boolean) => {
  const url = `${API_BASE}/v2/${path}`;
  return railCache.get(url, ttl, async () => {
    if (import.meta.env.VITE_MOCK === "1") return { status: 0, body: null };
    const r = await getJSON(url, AbortSignal.timeout(10_000));
    return r.status === 200 && !(isObj(r.body) && ok(r.body)) ? { ...r, status: 503 } : r;
  });
};
const enc = encodeURIComponent;
const arr = (f: string) => (b: Record<string, unknown>) => Array.isArray(b[f]);
const optArr = (v: unknown) => v == null || Array.isArray(v);
const lineOk = (b: Record<string, unknown>) => isObj(b.line) && Array.isArray(b.patterns) && isObj(b.stops);
export const fetchV2Line = (id: string) => v2Get(`lines/${enc(id)}`, 3_600_000, lineOk);
export const fetchV2LineVehicles = (id: string) => v2Get(`lines/${enc(id)}/vehicles`, 10_000, arr("vehicles"));
// The last good answers, of any age: a line card opened again shows them at once, then asks again.
export const peekV2Line = (id: string) => railCache.peek(`${API_BASE}/v2/lines/${enc(id)}`);
export const peekV2LineVehicles = (id: string) => railCache.peek(`${API_BASE}/v2/lines/${enc(id)}/vehicles`);
export const fetchV2Stop = (id: string) =>
  v2Get(`stops/${enc(id)}`, 15_000, b => isObj(b.stop) && optArr(b.lines) && optArr(b.arrivals));
export const fetchV2Run = (id: string) => v2Get(`runs/${enc(id)}`, 15_000, b => isObj(b.run) && Array.isArray(b.run.stops));
// The search indexes (B8): every Line and every Stop of every mode.
export const fetchV2Lines = () => v2Get("lines", 3_600_000, arr("lines"));
export const fetchV2Stops = () => v2Get("stops", 3_600_000, arr("stops"));
// Service disruptions (disruptions.ts), cached 5 min by the server.
export const fetchV2Alerts = () => v2Get("alerts", 300_000, arr("alerts"));
