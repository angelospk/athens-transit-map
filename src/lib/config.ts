// Base URLs, overridable at build time (see README). They belong to the city of this page load:
// a city switch reloads the page (state.svelte.ts), so one city is chosen per load.
import { pageCityOf } from "./paths";
import { basesFor } from "./cityBases";

const strip = (s: string) => s.replace(/\/+$/, "");

function storedCity(): unknown {
  try { return JSON.parse(localStorage.getItem("city") ?? "null"); } catch { return null; }
}

// The path (/{city}/...), else ?city=, else the last choice, else Athens. No browser (tests): Athens.
function cityFromPage() {
  return typeof location === "undefined" ? pageCityOf("/", "", null) : pageCityOf(location.pathname, location.search, storedCity());
}

// The city of this page load.
export const PAGE_CITY = cityFromPage();
const bases = basesFor(PAGE_CITY, import.meta.env);

export const API_BASE = bases.api;
export const STATIC_BASE = bases.static;
export const STATS_BASE = strip(import.meta.env.VITE_STATS_BASE || "https://raw.githubusercontent.com/angelospk/athens-transit-rt/stats/v1");

// The promo video (played in the README on GitHub), linked from the "no connection to the server" banner.
// An empty VITE_DEMO_VIDEO_URL does not turn it off; set it to a different URL to change it.
export const DEMO_VIDEO_URL: string = import.meta.env.VITE_DEMO_VIDEO_URL || "https://github.com/angelospk/athens-transit-map#readme";
