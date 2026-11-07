// The citybus.gr cities the bot watches for web push (no Telegram: the bot's /list, /stop and buttons
// know only Athens). One staseis-rt instance serves them all, one path per city code (/{code}/v1/...,
// /{code}/static/v1/...; its /v1/cities lists them). The map keys a city by its slug: the page's
// POST names it in `city`, and its stop index is trips-<slug>.json.

export interface CitybusCity { slug: string; code: string }

export const CITYBUS: CitybusCity[] = ([
  ["agrinio", "agq"], ["alexandroupoli", "axd"], ["arta", "art"], ["veroia", "ver"], ["volos", "vol"],
  ["drama", "dra"], ["heraklion", "her"], ["ioannina", "ioa"], ["kavala", "kva"], ["kastoria", "kso"],
  ["katerini", "kat"], ["corfu", "cfu"], ["kozani", "kzi"], ["komotini", "kom"], ["lamia", "lam"],
  ["larissa", "lra"], ["mesologgi", "mes"], ["mitilini", "mjt"], ["naousa", "nao"], ["xanthi", "xan"],
  ["patras", "pat"], ["ptolemaida", "pto"], ["serres", "ser"], ["chalkida", "cha"], ["chania", "chq"],
  ["chios", "jkh"], ["salamina", "sal"], ["skiathos", "jsi"],
] as const).map(([slug, code]) => ({ slug, code }));

const strip = (s: string) => s.replace(/\/+$/, "");

export function citybusUrls(api: string, map: string, c: CitybusCity) {
  const base = `${strip(api)}/${c.code}`;
  return { api: base, static: `${base}/static/v1`, trips: `${strip(map)}/trips-${c.slug}.json` };
}
