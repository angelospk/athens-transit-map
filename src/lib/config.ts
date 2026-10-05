// Base URLs, overridable at build time (see README).
const strip = (s: string) => s.replace(/\/+$/, "");

export const API_BASE = strip(import.meta.env.VITE_API_BASE || "https://transit.haroldpoi.dev");
export const STATIC_BASE = strip(import.meta.env.VITE_STATIC_BASE || "https://angelospk.github.io/athens-transit-rt/static/v1");
