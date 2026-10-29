// Favourite stops and lines of every mode (UI-SPEC-web-v2 B6), stored as localStorage `fav.v2`.
// Ids are /v2 ids ("oasa:040", "stasy:M3", "stasy:συνταγμα-metro"). The old `favorites` (bus line ids) move
// to `lines` once, when there is no `fav.v2` yet.

export type Place = "home" | "work";
export interface FavStop { id: string; name: string; lat: number; lon: number; place?: Place }
export interface FavLine { id: string; label: string }
export interface Favs { stops: FavStop[]; lines: FavLine[] }

export const emptyFavs = (): Favs => ({ stops: [], lines: [] });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function asStop(v: unknown): FavStop | null {
  if (!isObj(v) || typeof v.id !== "string" || typeof v.name !== "string" || typeof v.lat !== "number" || typeof v.lon !== "number") return null;
  const s: FavStop = { id: v.id, name: v.name, lat: v.lat, lon: v.lon };
  if (v.place === "home" || v.place === "work") s.place = v.place;
  return s;
}
const asLine = (v: unknown): FavLine | null =>
  isObj(v) && typeof v.id === "string" && typeof v.label === "string" ? { id: v.id, label: v.label } : null;

// raw: the parsed `fav.v2`; legacy: the parsed old `favorites`.
export function loadFavs(raw: unknown, legacy: unknown): Favs {
  if (isObj(raw)) {
    return {
      stops: (Array.isArray(raw.stops) ? raw.stops : []).map(asStop).filter((s): s is FavStop => !!s),
      lines: (Array.isArray(raw.lines) ? raw.lines : []).map(asLine).filter((l): l is FavLine => !!l),
    };
  }
  const old = Array.isArray(legacy) ? legacy.filter((x): x is string => typeof x === "string") : [];
  return { stops: [], lines: old.map(id => ({ id: `oasa:${id}`, label: id })) };
}

export const toggleStop = (f: Favs, s: FavStop): Favs =>
  ({ ...f, stops: f.stops.some(x => x.id === s.id) ? f.stops.filter(x => x.id !== s.id) : [...f.stops, s] });
export const toggleLine = (f: Favs, l: FavLine): Favs =>
  ({ ...f, lines: f.lines.some(x => x.id === l.id) ? f.lines.filter(x => x.id !== l.id) : [...f.lines, l] });

// One stop per place: giving it to a stop takes it from any other. null clears the stop's place.
export function setPlace(f: Favs, id: string, place: Place | null): Favs {
  return {
    ...f,
    stops: f.stops.map(s => {
      if (s.id === id) { const { place: _, ...rest } = s; return place ? { ...rest, place } : rest; }
      if (place && s.place === place) { const { place: _, ...rest } = s; return rest; }
      return s;
    }),
  };
}

export const busFavIds = (f: Favs) => f.lines.filter(l => l.id.startsWith("oasa:")).map(l => l.id.slice(5));

// The app's rule: in the morning (before 12:00) the home stop first and the work stop last; after, the other way.
export function orderStops(stops: FavStop[], hour: number): FavStop[] {
  const [first, last]: Place[] = hour < 12 ? ["home", "work"] : ["work", "home"];
  return [...stops.filter(s => s.place === first), ...stops.filter(s => s.place !== first && s.place !== last), ...stops.filter(s => s.place === last)];
}

const LATE_S = 180;
export function lineSummary(vehicles: { delay_s: number | null }[]): string {
  if (!vehicles.length) return "κανένα στον δρόμο";
  const late = vehicles.filter(v => (v.delay_s ?? 0) > LATE_S).length;
  const tail = !late ? "όλα στην ώρα τους" : late === 1 ? "1 αργεί" : `${late} αργούν`;
  return `${vehicles.length} στον δρόμο · ${tail}`;
}
