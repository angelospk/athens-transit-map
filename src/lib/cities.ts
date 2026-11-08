// The cities the app knows, and how one is picked: ?city=, the last choice, or the user's location.
import { GTFS_PAGE } from "./sources";
import { CITYBUS, type CitybusSlug } from "./citybus";

export type CityId = "athens" | "thessaloniki" | CitybusSlug;

export interface City {
  id: CityId;
  name: string;
  center: [number, number];   // [lng, lat]
  zoom: number;
  radiusKm: number;           // a location fix this close to the centre is in the city
  ready: boolean;             // false: the city has no data in the app yet
  rail: boolean;              // metro, tram, Proastiakos, municipal buses and OASA alerts: Athens only
  agency: string;             // the bus operator, as the texts name it
  agencyThe: string;          // with its article, to start a sentence: «Ο ΟΑΣΑ», «Το ΚΤΕΛ»
  gtfsPage: string;           // its timetable (GTFS): on data.gov.gr, or citybus.gr
  gtfsHost: string;           // the site of gtfsPage, as the texts name it
  ns: string;                 // the /v2 id namespace of its buses: oasa:040, pat:101
  plan: boolean;              // the backend plans trips (/v2/plan)
  inName: string;             // «στην Αθήνα», with the article Greek needs
  box: { south: number; west: number; north: number; east: number };   // the area its vehicle tiles cover
  stats: boolean;             // the daily network stats (stats branch) are of this city
  alerts: boolean;            // stop alerts: the bot and web push watch this city
  telegram: boolean;          // and in Telegram (@oasa_bus_bot routes a link by its city prefix, web#56)
  hint: string;
}

// The citybus.gr cities: buses only, no trip planner yet, stop alerts by web push and Telegram (the bot
// watches all 28, web#55 and web#56).
const citybus = Object.fromEntries(CITYBUS.map(c => [c.slug, {
  id: c.slug, name: c.name, center: c.center, zoom: c.zoom, radiusKm: c.radiusKm, ready: true, rail: false,
  agency: "ΚΤΕΛ", agencyThe: "Το ΚΤΕΛ", gtfsPage: "https://citybus.gr/", gtfsHost: "citybus.gr", ns: c.code, plan: false,
  inName: c.inName, box: { south: c.box[0], west: c.box[1], north: c.box[2], east: c.box[3] },
  stats: false, alerts: true, telegram: true, hint: "Αστικό ΚΤΕΛ",
} satisfies City])) as Record<CitybusSlug, City>;

export const CITIES: Record<CityId, City> = {
  athens: { id: "athens", name: "Αθήνα", center: [23.73, 37.98], zoom: 11.5, radiusKm: 70, ready: true, rail: true,
    agency: "ΟΑΣΑ", agencyThe: "Ο ΟΑΣΑ", gtfsPage: GTFS_PAGE, gtfsHost: "data.gov.gr", ns: "oasa", plan: true,
    inName: "στην Αθήνα", box: { south: 37.5, west: 22.9, north: 38.5, east: 24.5 },
    stats: true, alerts: true, telegram: true, hint: "ΟΑΣΑ · Μετρό · Τραμ · Προαστιακός" },
  thessaloniki: { id: "thessaloniki", name: "Θεσσαλονίκη", center: [22.94, 40.63], zoom: 12, radiusKm: 40, ready: true, rail: false,
    agency: "ΟΣΕΘ", agencyThe: "Ο ΟΣΕΘ", gtfsPage: "https://data.gov.gr/dataset/42c9a7da-c86c-48b1-914c-f340e8bef00d", gtfsHost: "data.gov.gr",
    ns: "oasa", plan: true, inName: "στη Θεσσαλονίκη", box: { south: 40.3, west: 22.6, north: 41.0, east: 23.4 },
    stats: false, alerts: true, telegram: true, hint: "ΟΣΕΘ · λεωφορεία" },
  ...citybus,
};

// The picker's two big buttons; every other city is a chip under them.
export const MAIN_CITIES: CityId[] = ["athens", "thessaloniki"];

export const DEFAULT_CITY: CityId = "athens";

// The picker's chips: every city but the two big buttons, by Greek name, matched without accents or case
// by name or by its Latin id; q empty: all of them.
const plain = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export function findCities(q: string): CityId[] {
  const needle = plain(q.trim());
  return (Object.keys(CITIES) as CityId[])
    .filter(id => !MAIN_CITIES.includes(id))
    .sort((a, b) => CITIES[a].name.localeCompare(CITIES[b].name, "el"))
    .filter(id => !needle || plain(CITIES[id].name).includes(needle) || id.includes(needle));
}

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
