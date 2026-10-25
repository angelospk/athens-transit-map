// A walking route in Google Maps to a stop, starting at the phone's point when it has one.
import type { Pt } from "./trip";

const coord = (p: Pt) => `${Number(p[0].toFixed(6))},${Number(p[1].toFixed(6))}`;

export function walkUrl(to: Pt, from?: Pt): string {
  const params = new URLSearchParams();
  if (from) params.set("origin", coord(from));
  params.set("destination", coord(to));
  params.set("travelmode", "walking");
  return `https://www.google.com/maps/dir/?api=1&${params}`;
}
