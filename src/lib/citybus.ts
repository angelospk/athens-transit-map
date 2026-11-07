// The 28 citybus.gr cities (web#54). One staseis-rt instance serves them all, one path per city code
// (https://staseis-rt.haroldpoi.dev/{code}/v2/..., list at /v1/cities); the web names a city by its slug
// (/patras/), as the bot does (bot/cities.ts). Centre, zoom, area and tile box come from each city's
// /v2/stops (2026-11-07): the centre is the median stop, the box the stops' extent padded by 0.03°.

export type CitybusSlug =
  | "agrinio" | "alexandroupoli" | "arta" | "veroia" | "volos" | "drama" | "heraklion" | "ioannina" | "kavala"
  | "kastoria" | "katerini" | "corfu" | "kozani" | "komotini" | "lamia" | "larissa" | "mesologgi" | "mitilini"
  | "naousa" | "xanthi" | "patras" | "ptolemaida" | "serres" | "chalkida" | "chania" | "chios" | "salamina"
  | "skiathos";

// How much of the service we can show: live (buses send GPS), partial (only some do), timetable (none does:
// the operator's timetable only) or gaps (citybus.gr's timetable is incomplete: live buses on no scheduled trip).
export type Service = "live" | "partial" | "timetable" | "gaps";

export interface CitybusCity {
  slug: CitybusSlug;
  code: string;                 // the backend's path prefix and id namespace: /pat/..., pat:101
  name: string;
  inName: string;               // "in the city", with the article Greek needs
  center: [number, number];     // [lng, lat]
  zoom: number;
  radiusKm: number;
  box: [number, number, number, number];   // south, west, north, east
  service: Service;
}

type Row = [CitybusSlug, string, string, string, [number, number], number, number, [number, number, number, number]];

const ROWS: Row[] = [
  ["agrinio", "agq", "Αγρίνιο", "στο Αγρίνιο", [21.415, 38.617], 12, 45, [38.49, 20.87, 38.81, 21.64]],
  ["alexandroupoli", "axd", "Αλεξανδρούπολη", "στην Αλεξανδρούπολη", [25.875, 40.855], 12, 24, [40.81, 25.65, 41.05, 26.08]],
  ["arta", "art", "Άρτα", "στην Άρτα", [20.983, 39.131], 12, 20, [38.99, 20.83, 39.21, 21.12]],
  ["veroia", "ver", "Βέροια", "στη Βέροια", [22.211, 40.538], 13, 14, [40.43, 22.12, 40.64, 22.35]],
  ["volos", "vol", "Βόλος", "στον Βόλο", [22.95, 39.367], 13, 15, [39.27, 22.86, 39.42, 23.09]],
  ["drama", "dra", "Δράμα", "στη Δράμα", [24.143, 41.147], 13, 13, [41.06, 24.04, 41.22, 24.26]],
  ["heraklion", "her", "Ηράκλειο", "στο Ηράκλειο", [25.135, 35.324], 13, 14, [35.21, 25.02, 35.37, 25.24]],
  ["ioannina", "ioa", "Ιωάννινα", "στα Ιωάννινα", [20.847, 39.65], 12, 20, [39.51, 20.69, 39.79, 21]],
  ["kavala", "kva", "Καβάλα", "στην Καβάλα", [24.404, 40.939], 13, 12, [40.89, 24.35, 40.98, 24.47]],
  ["kastoria", "kso", "Καστοριά", "στην Καστοριά", [21.258, 40.512], 13, 16, [40.45, 21.1, 40.6, 21.35]],
  ["katerini", "kat", "Κατερίνη", "στην Κατερίνη", [22.5, 40.27], 12, 17, [40.13, 22.37, 40.37, 22.63]],
  ["corfu", "cfu", "Κέρκυρα", "στην Κέρκυρα", [19.88, 39.614], 13, 16, [39.5, 19.77, 39.74, 19.96]],
  ["kozani", "kzi", "Κοζάνη", "στην Κοζάνη", [21.79, 40.292], 12, 20, [40.14, 21.67, 40.38, 21.94]],
  ["komotini", "kom", "Κομοτηνή", "στην Κομοτηνή", [25.401, 41.116], 12, 18, [40.97, 25.25, 41.21, 25.56]],
  ["lamia", "lam", "Λαμία", "στη Λαμία", [22.432, 38.894], 13, 15, [38.78, 22.32, 38.97, 22.54]],
  ["larissa", "lra", "Λάρισα", "στη Λάρισα", [22.421, 39.631], 13, 22, [39.53, 22.26, 39.8, 22.53]],
  ["mesologgi", "mes", "Μεσολόγγι", "στο Μεσολόγγι", [21.424, 38.394], 12, 24, [38.32, 21.2, 38.53, 21.62]],
  ["mitilini", "mjt", "Μυτιλήνη", "στη Μυτιλήνη", [26.543, 39.103], 12, 20, [38.98, 26.38, 39.21, 26.65]],
  ["naousa", "nao", "Νάουσα", "στη Νάουσα", [22.125, 40.635], 13, 17, [40.57, 21.99, 40.75, 22.28]],
  ["xanthi", "xan", "Ξάνθη", "στην Ξάνθη", [24.898, 41.124], 13, 12, [41.03, 24.82, 41.18, 24.98]],
  ["patras", "pat", "Πάτρα", "στην Πάτρα", [21.741, 38.23], 13, 18, [38.12, 21.6, 38.34, 21.87]],
  ["ptolemaida", "pto", "Πτολεμαΐδα", "στην Πτολεμαΐδα", [21.675, 40.515], 12, 20, [40.42, 21.51, 40.63, 21.88]],
  ["serres", "ser", "Σέρρες", "στις Σέρρες", [23.552, 41.087], 12, 16, [40.96, 23.42, 41.14, 23.68]],
  ["chalkida", "cha", "Χαλκίδα", "στη Χαλκίδα", [23.632, 38.459], 13, 17, [38.33, 23.49, 38.55, 23.73]],
  ["chania", "chq", "Χανιά", "στα Χανιά", [24.029, 35.507], 13, 12, [35.44, 23.92, 35.58, 24.12]],
  ["chios", "jkh", "Χίος", "στη Χίο", [26.132, 38.348], 13, 13, [38.27, 26.05, 38.45, 26.19]],
  ["salamina", "sal", "Σαλαμίνα", "στη Σαλαμίνα", [23.48, 37.958], 13, 14, [37.85, 23.39, 38.03, 23.57]],
  ["skiathos", "jsi", "Σκιάθος", "στη Σκιάθο", [23.455, 39.152], 13, 12, [39.11, 23.37, 39.22, 23.54]],
];

// Live buses against scheduled trips, measured 2026-11-07 (evening + baseline); revisit after the 7-day report
// of 2026-11-14. A code not listed is "live".
const SERVICE: Record<string, Service> = {
  dra: "timetable", pto: "timetable", cha: "timetable", kso: "timetable", nao: "timetable", jsi: "timetable",
  ver: "partial", ser: "partial", kom: "partial", kat: "partial", agq: "partial", mes: "partial", jkh: "partial",
  art: "gaps",
};

export const CITYBUS: CitybusCity[] = ROWS.map(([slug, code, name, inName, center, zoom, radiusKm, box]) =>
  ({ slug, code, name, inName, center, zoom, radiusKm, box, service: SERVICE[code] ?? "live" }));

// The public instance; VITE_API_BASE_CITYBUS points the web at another (staging).
export const CITYBUS_API = "https://staseis-rt.haroldpoi.dev";
