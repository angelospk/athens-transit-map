// The cities the app knows, and how one is picked: ?city=, the last choice, or the user's location.

export type CityId = "athens" | "thessaloniki" | "heraklion" | "patras";

export interface City {
  id: CityId;
  name: string;
  center: [number, number];   // [lng, lat]
  zoom: number;
  radiusKm: number;           // a location fix this close to the centre is in the city
  ready: boolean;             // false: the city has no data in the app yet
  rail: boolean;              // metro, tram, Proastiakos, municipal buses and OASA alerts: Athens only
  hint: string;
  estimated?: boolean;        // bus positions come from stop arrival boards (citybus.gr), not from a GPS feed
}

// Cities on citybus.gr (docs/research/greek-cities.md), served by citybus-bridge. They exist only in a
// build that sets VITE_API_BASE_CITYBUS: without it they are not in CITIES, and ?city=heraklion is ignored.
export const CITYBUS: Record<"heraklion" | "patras", City> = {
  heraklion: { id: "heraklion", name: "Ηράκλειο", center: [25.135, 35.33], zoom: 13, radiusKm: 25, ready: true, rail: false,
    hint: "Αστικό ΚΤΕΛ · θέσεις κατά προσέγγιση", estimated: true },
  patras: { id: "patras", name: "Πάτρα", center: [21.74, 38.245], zoom: 13, radiusKm: 25, ready: true, rail: false,
    hint: "Αστικό ΚΤΕΛ · θέσεις κατά προσέγγιση", estimated: true },
};
const citybusOn = typeof import.meta.env !== "undefined" && !!import.meta.env.VITE_API_BASE_CITYBUS;

export const CITIES: Record<CityId, City> = {
  athens: { id: "athens", name: "Αθήνα", center: [23.73, 37.98], zoom: 11.5, radiusKm: 70, ready: true, rail: true,
    hint: "ΟΑΣΑ · Μετρό · Τραμ · Προαστιακός" },
  thessaloniki: { id: "thessaloniki", name: "Θεσσαλονίκη", center: [22.94, 40.63], zoom: 12, radiusKm: 40, ready: true, rail: false,
    hint: "ΟΑΣΘ · λεωφορεία" },
  ...(citybusOn ? CITYBUS : {}),
} as Record<CityId, City>;

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
