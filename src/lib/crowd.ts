// What riders say about the bus they ride (the «Είμαι μέσα» of VehicleCard), sent to athens-transit-rt:
// - its position: with the rider's consent, the phone's location every 15 s while the ride lasts, so the server can
//   check and correct the bus's own (POST /v1/crowd/fix, contract rev 20);
// - how full it is: «Όχι γεμάτο», «Κάπως γεμάτο», «Γεμάτο» (POST /v1/crowd/load, rev 21), shown to others as the
//   bus's `occupancy`.
// Off unless VITE_CROWD_URL is set. Nothing names the rider: a random id per ride, no account, no history kept here.

export const CROWD_URL = (import.meta.env.VITE_CROWD_URL || "").replace(/\/+$/, "");
export const crowdOn = () => !!CROWD_URL && typeof navigator !== "undefined" && "geolocation" in navigator;
export const loadOn = () => !!CROWD_URL;

export type Load = "empty" | "some" | "full";
export const LOADS: { value: Load; label: string; level: 1 | 2 | 3 }[] = [
  { value: "empty", label: "Όχι γεμάτο", level: 1 },
  { value: "some", label: "Κάπως γεμάτο", level: 2 },
  { value: "full", label: "Γεμάτο", level: 3 },
];
export const loadLabel = (l: Load) => LOADS.find(x => x.value === l)?.label ?? "";

// How full the rider says the bus is; true when the server took it (false without the endpoint, or refused).
export async function sendLoad(ride: string, line: string, vehicle: string, level: Load): Promise<boolean> {
  if (!loadOn()) return false;
  try {
    const r = await fetch(`${CROWD_URL}/v1/crowd/load`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ride, line, vehicle, level }),
      keepalive: true, signal: AbortSignal.timeout(10_000),
    });
    return r.status === 204;
  } catch {
    return false;
  }
}

export const EVERY_MS = 15_000;
export const MAX_ACCURACY_M = 60;   // a coarser fix says nothing about which street the bus is on
export const MAX_GAP_M = 400;       // farther from where the bus says it is: not on this bus (or the bus is wrong; the server decides)

export interface CrowdFix { ride: string; line: string; vehicle: string; lat: number; lon: number; accuracy: number; speed: number | null; heading: number | null; at: number }

const R = 6_371_000;
export function metres(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// The fix to send, or null: too coarse, the bus's position unknown, or too far from the bus to be on it. bus: where the bus says it is ([lat, lon]).
export function crowdFix(ride: string, line: string, vehicle: string, p: Pick<GeolocationCoordinates, "latitude" | "longitude" | "accuracy" | "speed" | "heading">,
  atMs: number, bus: [number, number] | null): CrowdFix | null {
  if (!(p.accuracy <= MAX_ACCURACY_M)) return null;
  if (!bus || metres(bus, [p.latitude, p.longitude]) > MAX_GAP_M) return null;   // unknown bus position: nothing to check against
  const r5 = (x: number) => Math.round(x * 1e5) / 1e5;   // about 1 m: more is noise
  return { ride, line, vehicle, lat: r5(p.latitude), lon: r5(p.longitude), accuracy: Math.round(p.accuracy),
    speed: p.speed ?? null, heading: p.heading ?? null, at: Math.round(atMs / 1000) };
}

// Send the rider's position while the ride lasts; the returned function stops it. ride: the ride's id (the same for
// its fullness reports); bus(): where the bus is now.
export function shareRide(ride: string, line: string, vehicle: string, bus: () => [number, number] | null): () => void {
  if (!crowdOn()) return () => {};
  let last = 0;
  const watch = navigator.geolocation.watchPosition(pos => {
    const now = Date.now();
    if (now - last < EVERY_MS) return;
    const fix = crowdFix(ride, line, vehicle, pos.coords, pos.timestamp, bus());
    if (!fix) return;
    last = now;
    void fetch(`${CROWD_URL}/v1/crowd/fix`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(fix), keepalive: true })
      .catch(() => { /* best effort: the next fix tries again */ });
  }, () => {}, { enableHighAccuracy: true, maximumAge: 5_000 });
  return () => navigator.geolocation.clearWatch(watch);
}
