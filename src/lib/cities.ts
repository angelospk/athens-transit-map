// The cities the app knows, and how one is picked: ?city=, the last choice, or the user's location.
import { GTFS_PAGE } from "./sources";

export type CityId = "athens" | "thessaloniki";

export interface City {
  id: CityId;
  name: string;
  center: [number, number];   // [lng, lat]
  zoom: number;
  radiusKm: number;           // a location fix this close to the centre is in the city
  ready: boolean;             // false: the city has no data in the app yet
  rail: boolean;              // metro, tram, Proastiakos, municipal buses and OASA alerts: Athens only
  agency: string;             // the bus operator, as the texts name it
  gtfsPage: string;           // its timetable (GTFS) on data.gov.gr
  stats: boolean;             // the daily network stats (stats branch) are of this city
  alerts: boolean;            // stop alerts: the bot and web push watch this city
  hint: string;
}

export const CITIES: Record<CityId, City> = {
  athens: { id: "athens", name: "Αθήνα", center: [23.73, 37.98], zoom: 11.5, radiusKm: 70, ready: true, rail: true,
    agency: "ΟΑΣΑ", gtfsPage: GTFS_PAGE, stats: true, alerts: true,
    hint: "ΟΑΣΑ · Μετρό · Τραμ · Προαστιακός" },
  thessaloniki: { id: "thessaloniki", name: "Θεσσαλονίκη", center: [22.94, 40.63], zoom: 12, radiusKm: 40, ready: true, rail: false,
    agency: "ΟΑΣΘ", gtfsPage: "https://data.gov.gr/dataset/42c9a7da-c86c-48b1-914c-f340e8bef00d", stats: false, alerts: false,
    hint: "ΟΑΣΘ · λεωφορεία" },
};

export const DEFAULT_CITY: CityId = "athens";

export const isCityId = (v: unknown): v is CityId => typeof v === "string" && Object.hasOwn(CITIES, v);

function km(a: [number, number], b: [number, number]): number {
  const r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// The closest city whose area holds pos ([lng, lat]); null far from all of them.
export function nearestCity(pos: [number, number]): CityId | null {
  let best: CityId | null = null, bestKm = Infinity;
  for (const c of Object.values(CITIES)) {
    const d = km(pos, c.center);
    if (d <= c.radiusKm && d < bestKm) { best = c.id; bestKm = d; }
  }
  return best;
}

export function initialCity(search: string, stored: unknown): CityId {
  const q = new URLSearchParams(search).get("city");
  if (isCityId(q)) return q;
  return isCityId(stored) ? stored : DEFAULT_CITY;
}
