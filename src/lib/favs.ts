// Favourite stops and lines of every mode (UI-SPEC-web-v2 B6), stored as localStorage `fav.v2`.
// Ids are /v2 ids ("oasa:040", "stasy:M3", "stasy:συνταγμα-metro"). The old `favorites` (bus line ids) move
// to `lines` once, when there is no `fav.v2` yet.

export interface FavStop { id: string; name: string; lat: number; lon: number }
export interface FavLine { id: string; label: string }
export interface Favs { stops: FavStop[]; lines: FavLine[] }

export const emptyFavs = (): Favs => ({ stops: [], lines: [] });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function asStop(v: unknown): FavStop | null {
  if (!isObj(v) || typeof v.id !== "string" || typeof v.name !== "string" || typeof v.lat !== "number" || typeof v.lon !== "number") return null;
  return { id: v.id, name: v.name, lat: v.lat, lon: v.lon };
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

export const busFavIds = (f: Favs) => f.lines.filter(l => l.id.startsWith("oasa:")).map(l => l.id.slice(5));

const LATE_S = 180;
export function lineSummary(vehicles: { delay_s: number | null }[]): string {
  if (!vehicles.length) return "κανένα στον δρόμο";
  const late = vehicles.filter(v => (v.delay_s ?? 0) > LATE_S).length;
  const tail = !late ? "όλα στην ώρα τους" : late === 1 ? "1 αργεί" : `${late} αργούν`;
  return `${vehicles.length} στον δρόμο · ${tail}`;
}
