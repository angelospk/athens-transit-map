// One city per page load: the service bases, the URL and the storage keys that belong to it.
// A city switch reloads the page (state.svelte.ts), because caches and URLs are built once at load.

import { isCityId, type CityId } from "./cities";

export interface BasesEnv {
  VITE_API_BASE?: string;
  VITE_STATIC_BASE?: string;
  VITE_API_BASE_THESSALONIKI?: string;
}

export interface Bases { api: string; static: string }

const strip = (s: string) => s.replace(/\/+$/, "");

// Athens keeps the app's own backend and the GTFS static files on GitHub Pages.
const ATHENS: Bases = { api: "https://transit.haroldpoi.dev", static: "https://angelospk.github.io/athens-transit-rt/static/v1" };
// Thessaloniki has its own instance, which also serves its static/v1; VITE_API_BASE is Athens only.
const THESSALONIKI_API = "https://transit-thess.haroldpoi.dev";

export function basesFor(city: CityId, env: BasesEnv): Bases {
  if (city === "thessaloniki") {
    const api = strip(env.VITE_API_BASE_THESSALONIKI || THESSALONIKI_API);
    return { api, static: `${api}/static/v1` };
  }
  return { api: strip(env.VITE_API_BASE || ATHENS.api), static: strip(env.VITE_STATIC_BASE || ATHENS.static) };
}

// A switch keeps the path and only ?city=: the old city's lines and cards mean nothing in the new one.
export function cityUrl(pathAndSearch: string, city: CityId): string {
  const path = pathAndSearch.split(/[?#]/)[0];
  return `${path}?city=${city}`;
}

// Athens keeps `fav.v2` (the favourites of the app so far); every other city gets its own list.
export const favKey = (city: CityId) => (city === "athens" ? "fav.v2" : `fav.v2.${city}`);

// The first location fix may switch to the city it lands in, unless the URL names one already
// (a hand pick or a shared link). An unknown ?city= does not count: the page ignores it.
export const autoCityOnFix = (search: string): boolean => !isCityId(new URLSearchParams(search).get("city"));
