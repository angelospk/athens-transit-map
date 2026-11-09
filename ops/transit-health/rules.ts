// Pure rules of the hourly feed health check: normalise a city's vehicles, judge its feed, keep the
// fires quiet until a code repeats persistRuns runs, and render the ntfy message and the log line. No IO
// here: main.ts fetches and stores, so tests can drive this with fixture bodies (tests/transit-health.test.ts).

export interface Sample {
  city: string;
  error: string | null;
  updatedAt: number | null;
  sources: { id: string; state: string }[];
  vehicles: { hasPosition: boolean; at: number | null; direction: number | null | undefined }[];
}

export interface Anomaly { code: string; detail: string }

export interface CityResult { city: string; count: number; anomalies: Anomaly[]; checked: string[] }

// detail is absent on recovered: the message line does not repeat it.
export interface Event { city: string; code: string; kind: "new" | "recovered"; detail?: string }

// Per city, per code: how many consecutive runs said yes / no, and whether it already fired.
export interface CodeState { hit: number; miss: number; active: boolean }
export type HealthState = Record<string, Record<string, CodeState>>;

export interface HealthConfig {
  maxAgeS: number;          // a position older than this counts as stale
  minSample: number;        // vehicles needed before the ratio rules speak
  maxNoPositionRatio: number;
  maxStaleRatio: number;
  maxNoDirectionRatio: number;
  feedOldS: number;         // the feed's own updated_at may lag this much
  serviceHours: [number, number];   // Europe/Athens, start inclusive, end exclusive
  persistRuns: number;      // runs before a code fires or recovers
  minVehicles: Record<string, number>;
  checkDirection: string[]; // cities where a missing direction is an anomaly
}

const HOUR = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", hour: "numeric", hourCycle: "h23" });
export function athensHour(date: Date): number {
  return Number(HOUR.format(date));
}

export function inService(hour: number, cfg: HealthConfig): boolean {
  const [start, end] = cfg.serviceHours;
  return start <= hour && hour < end;
}

// /v2/vehicles: a vehicle with a null position has no position yet (at null); a missing direction key is
// null (the backend omits it rather than sending a value). sources may be absent.
export function fromV2(city: string, body: any): Sample {
  const vehicles = (body?.vehicles ?? []).map((v: any) => ({
    hasPosition: v?.position != null,
    at: v?.position != null && typeof v.position.at === "number" ? v.position.at : null,
    direction: v?.direction === undefined ? null : v.direction,
  }));
  return {
    city,
    error: null,
    updatedAt: typeof body?.updated_at === "number" ? body.updated_at : null,
    sources: (body?.sources ?? []).map((s: any) => ({ id: s.id, state: s.state })),
    vehicles,
  };
}

// v1 tile bodies: a flat vehicle (lat/lon, no direction), the same vehicle in several tiles counted once
// (first wins). updatedAt is the newest tile's, so one lagging tile does not mark the city old.
export function fromTiles(city: string, bodies: any[]): Sample {
  const seen = new Set<string>();
  const vehicles: Sample["vehicles"] = [];
  let updatedAt: number | null = null;
  for (const body of bodies) {
    if (typeof body?.updated_at === "number" && (updatedAt === null || body.updated_at > updatedAt)) updatedAt = body.updated_at;
    for (const v of body?.vehicles ?? []) {
      const id = String(v?.id);
      if (seen.has(id)) continue;
      seen.add(id);
      vehicles.push({
        hasPosition: typeof v?.lat === "number" && typeof v?.lon === "number",
        at: typeof v?.position_at === "number" ? v.position_at : null,
        direction: undefined,
      });
    }
  }
  return { city, error: null, updatedAt, sources: [], vehicles };
}

const lngToX = (lng: number, z: number) => Math.floor(((lng + 180) / 360) * 2 ** z);
function latToY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

// Web-mercator tiles covering [south, west, north, east] at zoom z, x outer, y inner, both ascending.
export function tilesFor(box: [number, number, number, number], z = 9): [number, number][] {
  const [south, west, north, east] = box;
  const out: [number, number][] = [];
  const x0 = lngToX(west, z), x1 = lngToX(east, z);
  const y0 = latToY(north, z), y1 = latToY(south, z);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([x, y]);
  return out;
}

const ratio = (k: number, n: number) => (n === 0 ? 0 : k / n);

// At night only "error" is checked, so a feed that is quiet because nothing runs cannot fire empty/old/stale
// and cannot recover from them either. By day the ratio codes are checked only when the sample is big enough.

export function evaluateCity(sample: Sample, cfg: HealthConfig, nowS: number, inServiceNow: boolean): CityResult {
  const count = sample.vehicles.length;
  if (sample.error !== null) {
    return { city: sample.city, count: 0, anomalies: [{ code: "error", detail: sample.error }], checked: ["error"] };
  }
  if (!inServiceNow) {
    return { city: sample.city, count, anomalies: [], checked: ["error"] };
  }
  const anomalies: Anomaly[] = [];
  const checked = ["error", "empty", "feed_old", "source"];   // ratio codes join below only when evaluated

  const min = cfg.minVehicles[sample.city];
  if (min !== undefined && count < min) anomalies.push({ code: "empty", detail: `${count} vehicles < ${min}` });

  if (sample.updatedAt === null) anomalies.push({ code: "feed_old", detail: "no updated_at" });
  else if (nowS - sample.updatedAt > cfg.feedOldS) anomalies.push({ code: "feed_old", detail: `updated ${nowS - sample.updatedAt}s ago` });

  const badSources = sample.sources.filter((s) => s.state === "stale" || s.state === "down");
  if (badSources.length > 0) anomalies.push({ code: "source", detail: badSources.map((s) => `${s.id}=${s.state}`).join(", ") });

  if (count >= cfg.minSample) {
    checked.push("no_position", "no_direction");
    const noPos = sample.vehicles.filter((v) => !v.hasPosition).length;
    if (ratio(noPos, count) > cfg.maxNoPositionRatio) anomalies.push({ code: "no_position", detail: `${noPos}/${count} without position` });

    const positioned = sample.vehicles.filter((v) => v.hasPosition && v.at !== null);
    if (positioned.length >= cfg.minSample) {
      checked.push("stale");
      const old = positioned.filter((v) => nowS - (v.at as number) > cfg.maxAgeS).length;
      if (ratio(old, positioned.length) > cfg.maxStaleRatio) anomalies.push({ code: "stale", detail: `${old}/${positioned.length} older than ${cfg.maxAgeS}s` });
    }

    if (cfg.checkDirection.includes(sample.city)) {
      const noDir = sample.vehicles.filter((v) => v.direction === null || v.direction === undefined).length;
      if (ratio(noDir, count) > cfg.maxNoDirectionRatio) anomalies.push({ code: "no_direction", detail: `${noDir}/${count} without direction` });
    }
  }

  return { city: sample.city, count, anomalies, checked };
}

// Fires a code on its persistRuns-th consecutive bad run and recovers it on its persistRuns-th clean one.
// A code a run did not check, and a city a run did not see, keep their state. Entries that are quiet and
// have nothing pending are dropped, so the file does not grow. prev is never mutated.
export function step(prev: HealthState, results: CityResult[], persistRuns: number): { state: HealthState; events: Event[] } {
  const state: HealthState = {};
  for (const [city, codes] of Object.entries(prev)) {
    state[city] = {};
    for (const [code, st] of Object.entries(codes)) state[city][code] = { ...st };
  }
  const events: Event[] = [];

  for (const r of results) {
    const city = (state[r.city] ??= {});
    const details = new Map(r.anomalies.map((a) => [a.code, a.detail]));
    for (const code of r.checked) {
      const st = (city[code] ??= { hit: 0, miss: 0, active: false });
      if (details.has(code)) {
        st.hit += 1;
        st.miss = 0;
        if (!st.active && st.hit >= persistRuns) {
          st.active = true;
          events.push({ city: r.city, code, kind: "new", detail: details.get(code)! });
        }
      } else {
        st.miss += 1;
        st.hit = 0;
        if (st.active && st.miss >= persistRuns) {
          st.active = false;
          events.push({ city: r.city, code, kind: "recovered" });
        }
      }
    }
  }

  for (const [city, codes] of Object.entries(state)) {
    for (const [code, st] of Object.entries(codes)) {
      if (!st.active && st.hit === 0) delete codes[code];
    }
    if (Object.keys(codes).length === 0) delete state[city];
  }
  return { state, events };
}

export function formatMessage(events: Event[]): { title: string; body: string } | null {
  if (events.length === 0) return null;
  const fresh = events.filter((e) => e.kind === "new").length;
  const recovered = events.length - fresh;
  const lines = events.map((e) => e.kind === "new" ? `🔴 ${e.city} ${e.code}: ${e.detail ?? ""}` : `🟢 ${e.city} ${e.code} recovered`);
  return { title: `Staseis: ${fresh} new, ${recovered} recovered`, body: lines.join("\n") };
}

export function logLine(iso: string, inServiceNow: boolean, results: CityResult[], events: Event[]): string {
  const part = (kind: Event["kind"]) => {
    const list = events.filter((e) => e.kind === kind).map((e) => `${e.city}/${e.code}`);
    return list.length === 0 ? "-" : list.join(",");
  };
  const cities = results.map((r) => {
    if (r.anomalies.some((a) => a.code === "error")) return `${r.city}=error`;
    const codes = r.anomalies.map((a) => a.code);
    return codes.length === 0 ? `${r.city}=${r.count}` : `${r.city}=${r.count}!${codes.join("+")}`;
  });
  return `${iso} ${inServiceNow ? "day" : "night"} ${cities.join(" ")} | new: ${part("new")} | recovered: ${part("recovered")}`;
}
