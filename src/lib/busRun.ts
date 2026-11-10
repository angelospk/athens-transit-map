// The run of a bus on its card: when it left, the stops it has passed, and times as minutes from now.

// A citybus.gr vehicle code names a trip slot, not a bus: "20261110_4_0100000_17_20" is the 17:20 run of
// route 4 on 2026-11-10 (staseis-rt#141). A device id or a fleet number has no such form.
const RUN_CODE = /^\d{8}_.+_(\d\d)_(\d\d)$/;
const LABEL_TIME = /^(\d\d):(\d\d)\b/;

const clock = (h: string, m: string) => (+h < 30 && +m < 60 ? `${h}:${m}` : null);

// The departure of the vehicle's run, "17:20": from the backend's trip label ("17:20 Α → Β"), else from a
// citybus.gr vehicle code; null when neither names one.
export function runTime(v: { id: string; trip_label: string | null }): string | null {
  const l = v.trip_label ? LABEL_TIME.exec(v.trip_label) : null;
  if (l) return `${l[1]}:${l[2]}`;
  const c = RUN_CODE.exec(v.id);
  return c ? clock(c[1], c[2]) : null;
}

// The variant's stops before index `before` (the vehicle's next stop), in order; a stop the table does
// not know is left out, as in upcomingStops.
export function passedStops(
  variant: { stops: string[] },
  stops: Record<string, { name: string }>,
  before: number,
): { id: string; name: string; i: number }[] {
  return variant.stops.slice(0, Math.max(0, before)).flatMap((id, i) => (stops[id] ? [{ id, name: stops[id].name, i }] : []));
}

// «τώρα», else whole minutes from now, also past an hour: the card of a vehicle counts down, it shows no clock.
export function minutesText(at: number, nowMs: number): string {
  const m = Math.round((at * 1000 - nowMs) / 60_000);
  return m <= 0 ? "τώρα" : `${m}′`;
}
