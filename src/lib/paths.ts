// Every city on its own path (web#47): /{city}/, /{city}/stop/{id}, /{city}/line/{id}. A stop or line card is a
// path, so a shared link is also its prerendered page (scripts/seo.ts writes the same paths). Vehicles and the
// line picks (?l=) stay in the query; old links (/?stop=, ?city=) still open.

import { cardFromQuery, cardQuery, type Card } from "./cards";
import { initialCity, isCityId, type CityId } from "./cities";

// An id's ":" become "-" in a path (oasa:040 -> oasa-040). A namespace has no "-", so the first "-" is the ":".
export const slug = (id: string) => id.replaceAll(":", "-");
export function unslug(s: string): string | null {
  const i = s.indexOf("-");
  return i > 0 && i < s.length - 1 ? `${s.slice(0, i)}:${s.slice(i + 1)}` : null;
}

const decode = (s: string) => { try { return decodeURIComponent(s); } catch { return null; } };

// The city a path names, and the stop or line card it opens. Also reads the prerendered file name (x.html).
export function parsePath(pathname: string): { city: CityId | null; card: Card | null } {
  const parts = pathname.split("/").filter(Boolean);
  const city = parts[0] ?? null;
  if (!isCityId(city)) return { city: null, card: null };
  const kind = parts[1], raw = parts[2];
  if ((kind !== "stop" && kind !== "line") || raw === undefined || parts.length > 3) return { city, card: null };
  const s = decode(raw.replace(/\.html$/, ""));
  const id = s === null ? null : unslug(s);
  return { city, card: id ? { kind, id } : null };
}

// The top card of a URL: the path's stop or line (a line keeps ?dir=), else the query (vehicles, old links).
export function cardFromUrl(pathname: string, search: string): Card | null {
  const { card } = parsePath(pathname);
  if (card?.kind === "line") {
    const dir = new URLSearchParams(search).get("dir");
    return dir === "0" || dir === "1" ? { ...card, dir: Number(dir) as 0 | 1 } : card;
  }
  return card ?? cardFromQuery(search);
}

// The URL of a city with its top card and line picks.
export function pageUrl(city: CityId, card: Card | null, picks: string[]): string {
  if (card?.kind === "stop" || card?.kind === "line") {
    const q = cardQuery(null, picks);
    const dir = card.kind === "line" && card.dir !== undefined ? `dir=${card.dir}` : "";
    const query = q && dir ? `${q}&${dir}` : q || (dir ? `?${dir}` : "");
    return `/${city}/${card.kind}/${encodeURIComponent(slug(card.id))}${query}`;
  }
  return `/${city}/${cardQuery(card, picks)}`;
}

// The city of a page load: the path, else ?city= (old links), else the last choice, else Athens.
export const pageCityOf = (pathname: string, search: string, stored: unknown): CityId =>
  parsePath(pathname).city ?? initialCity(search, stored);

// The URL names the city (a hand pick or a shared link): a location fix does not switch away from it.
export const cityInUrl = (pathname: string, search: string): boolean =>
  !!parsePath(pathname).city || isCityId(new URLSearchParams(search).get("city"));
