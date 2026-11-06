// «Δημοτικά»: the bus routes that municipalities run, from the backend's /v2/municipal (contract rev 17, data
// from OpenStreetMap, ODbL). No times and no live positions: a tap shows the municipality and links its own
// timetable page. Before the backend has the data (or on an older backend) the layer is not offered at all.
import { API_BASE } from "./config";
import { getJSON } from "./api";

export type MunicipalRoute = {
  id: string; ref: string | null; name: string; municipality: string; timetable_url: string | null;
  shape: [number, number][][]; stops: string[];
};
export type MunicipalStop = { name: string | null; lat: number; lon: number };
export type MunicipalData = { routes: MunicipalRoute[]; stops: Record<string, MunicipalStop>; attribution: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isPt = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every(n => typeof n === "number" && Number.isFinite(n));

function okRoute(r: unknown): r is MunicipalRoute {
  return isObj(r) && isStr(r.id) && isStr(r.name) && isStr(r.municipality) && (r.ref === null || isStr(r.ref)) &&
    (r.timetable_url === null || isStr(r.timetable_url)) && Array.isArray(r.stops) && r.stops.every(isStr) &&
    Array.isArray(r.shape) && r.shape.every(l => Array.isArray(l) && l.every(isPt));
}

// The body when it has routes; null for anything else (no data yet, an error, an older backend's 404).
export function parseMunicipal(body: unknown): MunicipalData | null {
  if (!isObj(body) || !Array.isArray(body.routes) || !isObj(body.stops)) return null;
  const routes = body.routes.filter(okRoute);
  if (!routes.length) return null;
  const stops: Record<string, MunicipalStop> = {};
  for (const [id, s] of Object.entries(body.stops)) {
    if (isObj(s) && typeof s.lat === "number" && typeof s.lon === "number") stops[id] = { name: isStr(s.name) ? s.name : null, lat: s.lat, lon: s.lon };
  }
  return { routes, stops, attribution: isStr(body.attribution) ? body.attribution : "© OpenStreetMap contributors (ODbL)" };
}

export async function loadMunicipal(): Promise<MunicipalData | null> {
  const r = await getJSON(`${API_BASE}/v2/municipal`);
  return r.status === 200 ? parseMunicipal(r.body) : null;
}

// One MultiLineString per route (kind "line") and one Point per stop (kind "stop"), in [lon, lat]. Properties:
// m (municipality), url (its timetable page, "" when unknown), title and rid (a route's) or sid, name, lines and rids
// (a stop's; rids comma-joined: map properties hold no arrays).
export function municipalFC(d: MunicipalData): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  const at = new Map<string, { m: string; url: string; lines: string[]; rids: string[] }>();
  for (const r of d.routes) {
    const url = r.timetable_url && /^https?:\/\//.test(r.timetable_url) ? r.timetable_url : "";   // only a web link in an href
    features.push({ type: "Feature", properties: { kind: "line", m: r.municipality, url, rid: r.id, title: r.ref ? `${r.ref} · ${r.name}` : r.name },
      geometry: { type: "MultiLineString", coordinates: r.shape.map(l => l.map(([lat, lon]) => [lon, lat])) } });
    for (const id of r.stops) {
      const s = at.get(id) ?? { m: r.municipality, url, lines: [], rids: [] };
      const label = r.ref ?? r.name;
      if (!s.lines.includes(label)) s.lines.push(label);
      if (!s.rids.includes(r.id)) s.rids.push(r.id);
      at.set(id, s);
    }
  }
  for (const [id, s] of at) {
    const stop = d.stops[id];
    if (!stop) continue;
    features.push({ type: "Feature", properties: { kind: "stop", sid: id, m: s.m, url: s.url, name: stop.name ?? "Στάση", lines: s.lines.join(", "), rids: s.rids.join(",") },
      geometry: { type: "Point", coordinates: [stop.lon, stop.lat] } });
  }
  return { type: "FeatureCollection", features };
}
