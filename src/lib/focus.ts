// What a tapped stop or vehicle does to the map: the open stop gets a pin, and the map moves to the
// stop or vehicle, closer when it is far out.

import type { LngLat } from "./glide";
import type { MetroData } from "./metro";
import type { SuburbanData } from "./suburban";
import type { TripIndex } from "./trip";

export const STOP_ZOOM = 16;
export const VEHICLE_ZOOM = 15;

export interface PinSource {
  busStop: number | null; stopIx: TripIndex | null;
  metroStation: string | null; metro: MetroData | null;
  railStation: string | null; suburban: SuburbanData | null;
}

// The point of the open bus stop, metro/tram station or suburban station; null: none, or its data is not in.
export function stopPin(p: PinSource): LngLat | null {
  if (p.busStop != null) {
    const s = p.stopIx?.s[p.busStop];
    return s ? [s[2], s[1]] : null;
  }
  if (p.metroStation) {
    const s = p.metro?.stations.find(s => s.name === p.metroStation);
    return s ? [s.lon, s.lat] : null;
  }
  if (p.railStation) {
    const s = p.suburban?.stations.find(s => s.id === p.railStation);
    return s ? [s.lon, s.lat] : null;
  }
  return null;
}

// The zoom to move to (at least min, never further out), or null when the point is in view at min or closer.
export function focusZoom(zoom: number, inView: boolean, min: number): number | null {
  if (inView && zoom >= min) return null;
  return Math.max(zoom, min);
}
