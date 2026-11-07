import { describe, expect, it } from "vitest";
import { CITIES, DEFAULT_CITY, findCities, isCityId, nearestCity, initialCity } from "../src/lib/cities";

describe("cities", () => {
  it("knows Athens, Thessaloniki and the 28 citybus.gr cities; Athens is the default and ready", () => {
    expect(Object.keys(CITIES)).toHaveLength(30);
    expect(Object.keys(CITIES).slice(0, 2)).toEqual(["athens", "thessaloniki"]);
    expect(DEFAULT_CITY).toBe("athens");
    expect(CITIES.athens.ready).toBe(true);
    for (const c of Object.values(CITIES)) {
      expect(c.center).toHaveLength(2);   // [lng, lat]
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.zoom).toBeGreaterThan(8);
    }
  });

  it("each city names its operator; stats are Athens only, stop alerts everywhere, Telegram Athens only", () => {
    expect(CITIES.athens.agency).toBe("ΟΑΣΑ");
    expect(CITIES.thessaloniki.agency).toBe("ΟΣΕΘ");   // OSETH is the authority; never «ΟΑΣΘ»
    expect(Object.values(CITIES).some(c => c.hint.includes("ΟΑΣΘ") || c.agency.includes("ΟΑΣΘ"))).toBe(false);
    expect(CITIES.athens.gtfsPage).toMatch(/^https:\/\/data\.gov\.gr\/dataset\//);
    expect(CITIES.thessaloniki.gtfsPage).toBe("https://data.gov.gr/dataset/42c9a7da-c86c-48b1-914c-f340e8bef00d");
    expect([CITIES.athens.stats, CITIES.athens.alerts]).toEqual([true, true]);
    expect([CITIES.thessaloniki.stats, CITIES.thessaloniki.alerts]).toEqual([false, true]);
    expect([CITIES.athens.telegram, CITIES.thessaloniki.telegram]).toEqual([true, false]);
  });

  it("isCityId accepts only known ids", () => {
    expect(isCityId("athens")).toBe(true);
    expect(isCityId("thessaloniki")).toBe(true);
    expect(isCityId("patras")).toBe(true);
    expect(isCityId("pat")).toBe(false);   // the backend code is not a web id
    expect(isCityId("patra")).toBe(false);
    expect(isCityId(null)).toBe(false);
    expect(isCityId(3)).toBe(false);
  });

  it("nearestCity: the city whose area holds the point; [lng, lat]", () => {
    expect(nearestCity([23.7275, 37.9838])).toBe("athens");      // Syntagma
    expect(nearestCity([23.94, 37.94])).toBe("athens");          // Athens airport
    expect(nearestCity([22.9444, 40.6401])).toBe("thessaloniki"); // Aristotelous
    expect(nearestCity([22.97, 40.52])).toBe("thessaloniki");     // Thessaloniki airport
  });

  it("nearestCity: the citybus.gr cities; the closest centre wins where areas overlap", () => {
    expect(nearestCity([21.7346, 38.2466])).toBe("patras");
    expect(nearestCity([25.1442, 35.3387])).toBe("heraklion");
    expect(nearestCity([22.42, 39.64])).toBe("larissa");
    expect(nearestCity([23.48, 37.96])).toBe("salamina");     // inside Athens' 70 km too
    expect(nearestCity([23.643, 37.942])).toBe("athens");     // Piraeus, 14 km from Salamina's centre
    expect(nearestCity([23.60, 38.46])).toBe("chalkida");
    expect(nearestCity([22.125, 40.635])).toBe("naousa");     // 15 km from Veroia
    expect(nearestCity([21.42, 38.37])).toBe("mesologgi");    // inside Agrinio's 45 km
  });

  it("nearestCity: null far from every city", () => {
    expect(nearestCity([22.0, 37.0])).toBeNull();   // Kalamata
    expect(nearestCity([27.43, 37.03])).toBeNull(); // Kos
  });

  it("a citybus.gr city: buses only, its code as id namespace, no planner, web push alerts, no Telegram", () => {
    const p = CITIES.patras;
    expect([p.id, p.name, p.ns, p.ready, p.rail, p.plan, p.stats, p.alerts, p.telegram])
      .toEqual(["patras", "Πάτρα", "pat", true, false, false, false, true, false]);
    expect(p.inName).toBe("στην Πάτρα");
    expect(CITIES.volos.inName).toBe("στον Βόλο");
    expect(p.agencyThe).toBe("Το ΚΤΕΛ");
    expect(p.gtfsHost).toBe("citybus.gr");
    const [lng, lat] = p.center;
    expect(p.box.south < lat && lat < p.box.north && p.box.west < lng && lng < p.box.east).toBe(true);
    expect([CITIES.athens.ns, CITIES.thessaloniki.ns]).toEqual(["oasa", "oasa"]);
    expect([CITIES.athens.plan, CITIES.thessaloniki.plan]).toEqual([true, true]);
    expect(CITIES.athens.agencyThe).toBe("Ο ΟΑΣΑ");
  });

  it("every citybus.gr city matches the bot's list (slug and code)", async () => {
    const { CITYBUS } = await import("../bot/cities");
    for (const c of CITYBUS) expect([c.slug, CITIES[c.slug as keyof typeof CITIES]?.ns]).toEqual([c.slug, c.code]);
    expect(Object.keys(CITIES).length - 2).toBe(CITYBUS.length);
  });

  it("findCities: the picker's chips, by Greek name, without accents or case, or by Latin slug", () => {
    const all = findCities("");
    expect(all).toHaveLength(28);   // not the two big buttons
    expect(all).not.toContain("athens");
    expect(all[0]).toBe("agrinio");                    // Greek alphabetical order: Αγρίνιο first
    expect(all.at(-1)).toBe("chios");                  // Χίος last
    expect(findCities("πατρα")).toEqual(["patras"]);
    expect(findCities("ΧΑΝ")).toEqual(["chania"]);
    expect(findCities("  ηρακ ")).toEqual(["heraklion"]);
    expect(findCities("corfu")).toEqual(["corfu"]);
    expect(findCities("zzz")).toEqual([]);
  });

  it("initialCity: ?city= wins, then the stored city, then the default", () => {
    expect(initialCity("?city=thessaloniki", "athens")).toBe("thessaloniki");
    expect(initialCity("?l=040&city=athens", "thessaloniki")).toBe("athens");
    expect(initialCity("", "thessaloniki")).toBe("thessaloniki");
    expect(initialCity("?city=patra", "thessaloniki")).toBe("thessaloniki");
    expect(initialCity("", "patra")).toBe("athens");
    expect(initialCity("", null)).toBe("athens");
  });
});
