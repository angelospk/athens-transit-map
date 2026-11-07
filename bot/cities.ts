// The citybus.gr cities the bot watches (web push, and Telegram through bot/router.ts). One staseis-rt
// instance serves them all, one path per city code (/{code}/v1/..., /{code}/static/v1/...; its /v1/cities
// lists them). The map keys a city by its slug: the page's POST names it in `city`, and its stop index is
// trips-<slug>.json. In Telegram the code is the city's prefix (start=<code>_<payload>, <code>:b:<stop>).

export interface CitybusCity { slug: string; code: string; name: string }

export const CITYBUS: CitybusCity[] = ([
  ["agrinio", "agq", "Αγρίνιο"], ["alexandroupoli", "axd", "Αλεξανδρούπολη"], ["arta", "art", "Άρτα"], ["veroia", "ver", "Βέροια"],
  ["volos", "vol", "Βόλος"], ["drama", "dra", "Δράμα"], ["heraklion", "her", "Ηράκλειο"], ["ioannina", "ioa", "Ιωάννινα"],
  ["kavala", "kva", "Καβάλα"], ["kastoria", "kso", "Καστοριά"], ["katerini", "kat", "Κατερίνη"], ["corfu", "cfu", "Κέρκυρα"],
  ["kozani", "kzi", "Κοζάνη"], ["komotini", "kom", "Κομοτηνή"], ["lamia", "lam", "Λαμία"], ["larissa", "lra", "Λάρισα"],
  ["mesologgi", "mes", "Μεσολόγγι"], ["mitilini", "mjt", "Μυτιλήνη"], ["naousa", "nao", "Νάουσα"], ["xanthi", "xan", "Ξάνθη"],
  ["patras", "pat", "Πάτρα"], ["ptolemaida", "pto", "Πτολεμαΐδα"], ["serres", "ser", "Σέρρες"], ["chalkida", "cha", "Χαλκίδα"],
  ["chania", "chq", "Χανιά"], ["chios", "jkh", "Χίος"], ["salamina", "sal", "Σαλαμίνα"], ["skiathos", "jsi", "Σκιάθος"],
] as const).map(([slug, code, name]) => ({ slug, code, name }));

// Every city of @oasa_bus_bot, Athens first. Athens's links and buttons have no prefix (ath is accepted too).
export const TG_CITIES: CitybusCity[] = [
  { slug: "athens", code: "ath", name: "Αθήνα" }, { slug: "thessaloniki", code: "skg", name: "Θεσσαλονίκη" }, ...CITYBUS,
];
const strip = (s: string) => s.replace(/\/+$/, "");

export function citybusUrls(api: string, map: string, c: Pick<CitybusCity, "slug" | "code">) {
  const base = `${strip(api)}/${c.code}`;
  return { api: base, static: `${base}/static/v1`, trips: `${strip(map)}/trips-${c.slug}.json` };
}
