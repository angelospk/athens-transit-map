// Pure helpers of the Apple Maps experiment (branch exp/apple-maps): no MapKit here, so they run in tests.

import type { View } from "../tiles";

export type MapProvider = "osm" | "apple";

// OSM (MapLibre) stays the default; `?map=apple` turns the experiment on.
export const mapProvider = (search: string): MapProvider =>
  new URLSearchParams(search).get("map") === "apple" ? "apple" : "osm";

export interface LatLon { lat: number; lon: number }

export const viewOf = (c: LatLon, span: LatLon): View =>
  ({ north: c.lat + span.lat / 2, south: c.lat - span.lat / 2, east: c.lon + span.lon / 2, west: c.lon - span.lon / 2 });

// Web-mercator zoom of a longitude span shown across `px` CSS pixels (256 px tiles).
export function spanZoom(lonDelta: number, px: number): number {
  if (!(lonDelta > 0) || !(px > 0)) return 0;
  return Math.log2((360 * px) / (256 * lonDelta));
}

const MIN_SPAN = 0.004;   // about 400 m: one point still gets a street-level view

// A centre and span that frame [[west, south], [east, north]], `pad` times as large.
export function regionFor([[w, s], [e, n]]: [[number, number], [number, number]], pad = 1.15): { center: LatLon; span: LatLon } {
  return {
    center: { lat: (s + n) / 2, lon: (w + e) / 2 },
    span: { lat: Math.max((n - s) * pad, MIN_SPAN), lon: Math.max((e - w) * pad, MIN_SPAN) },
  };
}

// Which annotations to add, keep (move) and remove.
export function diffKeys(prev: Set<string>, next: string[]) {
  const seen = new Set<string>(), added: string[] = [], kept: string[] = [];
  for (const k of next) {
    if (seen.has(k)) continue;
    seen.add(k);
    (prev.has(k) ? kept : added).push(k);
  }
  return { added, kept, removed: [...prev].filter(k => !seen.has(k)) };
}
