// Base URLs, overridable at build time (see README).
const strip = (s: string) => s.replace(/\/+$/, "");

export const API_BASE = strip(import.meta.env.VITE_API_BASE || "https://transit.haroldpoi.dev");
export const STATIC_BASE = strip(import.meta.env.VITE_STATIC_BASE || "https://angelospk.github.io/athens-transit-rt/static/v1");
export const STATS_BASE = strip(import.meta.env.VITE_STATS_BASE || "https://raw.githubusercontent.com/angelospk/athens-transit-rt/stats/v1");

// The promo video (played in the README on GitHub), linked from the "no connection to the server" banner.
// An empty VITE_DEMO_VIDEO_URL does not turn it off; set it to a different URL to change it.
export const DEMO_VIDEO_URL: string = import.meta.env.VITE_DEMO_VIDEO_URL || "https://github.com/angelospk/athens-transit-map#readme";
