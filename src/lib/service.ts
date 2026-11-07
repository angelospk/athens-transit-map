// Where we cannot show the service as it runs, said plainly so no one reads a timetable as live buses: the
// citybus.gr cities (City.service) and the municipal lines with no stops or no times.
import type { Service } from "./citybus";
import type { MunicipalRoute } from "./municipal";
import type { MuniTimetable } from "./muniTimes";

const TAG: Record<Service, string | null> = { live: null, partial: "λίγα live", timetable: "μόνο πρόγραμμα", gaps: "ελλιπές πρόγραμμα" };

// The city picker's small tag next to the name; none for live.
export const serviceTag = (s: Service) => TAG[s];

// The info line when the city is open; inName is «στη Δράμα».
export function serviceNote(s: Service, inName: string): string | null {
  const at = inName.charAt(0).toUpperCase() + inName.slice(1);
  if (s === "timetable") return `${at} τα λεωφορεία δεν στέλνουν θέση. Βλέπεις μόνο τις ώρες του προγράμματος.`;
  if (s === "partial") return `${at} μόνο μερικά λεωφορεία στέλνουν θέση. Οι υπόλοιπες ώρες είναι από το πρόγραμμα.`;
  if (s === "gaps") return `${at} το πρόγραμμα του citybus.gr είναι ελλιπές. Μπορεί να λείπουν δρομολόγια.`;
  return null;
}

export type MuniGaps = { stops: boolean; times: boolean };

// What a municipal route lacks: stops (OSM has none for it), times (no transcribed timetable of its municipality).
// No tables at all means not loaded yet (or failed): unknown, so not claimed.
export const muniGaps = (r: MunicipalRoute, tables: MuniTimetable[]): MuniGaps =>
  ({ stops: r.stops.length === 0, times: tables.length > 0 && !tables.some(t => t.municipality === r.municipality) });

export function muniGapNote(g: MuniGaps): string | null {
  const what = g.stops && g.times ? "στάσεις και ώρες" : g.stops ? "στάσεις" : g.times ? "ώρες" : null;
  return what && `Δεν έχουμε ακόμα ${what} για αυτή τη γραμμή. Δες τη σελίδα του δήμου.`;
}
