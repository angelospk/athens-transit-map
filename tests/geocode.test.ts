import { afterEach, describe, expect, it, vi } from "vitest";
import { geocode } from "../src/lib/trip";

const street = (name: string) => ({ type: "Feature", geometry: { type: "Point", coordinates: [23.73, 37.98] },
  properties: { name, osm_key: "highway", type: "street", city: "Αθήνα" } });

function stubFetch(answer: (q: string) => object[]) {
  const urls: URL[] = [];
  vi.stubGlobal("fetch", vi.fn(async (u: URL) => {
    urls.push(new URL(u));
    return { ok: true, json: async () => ({ features: answer(new URL(u).searchParams.get("q")!) }) };
  }));
  return urls;
}

afterEach(() => vi.unstubAllGlobals());

describe("geocode", () => {
  it("asks for places near a point when it has one", async () => {
    const urls = stubFetch(() => [street("Αμερικής")]);
    await geocode("Μασούτης", undefined, [37.96, 23.7]);
    expect(urls[0].searchParams.get("lat")).toBe("37.96");
    expect(urls[0].searchParams.get("lon")).toBe("23.7");
    expect(urls[0].searchParams.get("bbox")).toBe("23.35,37.65,24.15,38.25");
  });
  it("sends no point without one", async () => {
    const urls = stubFetch(() => [street("Αμερικής")]);
    await geocode("Σκλαβενίτης");
    expect(urls[0].searchParams.has("lat")).toBe(false);
  });
  it("finds the street when OpenStreetMap does not know the house number", async () => {
    const urls = stubFetch(q => (q === "Πανεπιστημίου" ? [street("Πανεπιστημίου")] : []));
    const r = await geocode("Πανεπιστημίου 30");
    expect(urls.map(u => u.searchParams.get("q"))).toEqual(["Πανεπιστημίου 30", "Πανεπιστημίου"]);
    expect(r.map(p => p.label)).toEqual(["Πανεπιστημίου"]);
  });
  it("asks once when the number is found, or when there is no number", async () => {
    let urls = stubFetch(() => []);
    await geocode("Κάτι άγνωστο");
    expect(urls).toHaveLength(1);
    urls = stubFetch(() => [street("Σταδίου 5")]);
    await geocode("Σταδίου 5");
    expect(urls).toHaveLength(1);
  });
  it("drops a number range or a spaced letter too", async () => {
    for (const q of ["Ακαδημίας 30-32", "Ακαδημίας 30 Α"]) {
      const urls = stubFetch(q => (q === "Ακαδημίας" ? [street("Ακαδημίας")] : []));
      await geocode(q);
      expect(urls.map(u => u.searchParams.get("q"))).toEqual([q, "Ακαδημίας"]);
    }
  });
  it("sends the point it caches by, so nearby points share one answer", async () => {
    const urls = stubFetch(() => [street("Αμερικής")]);
    await geocode("Βασιλόπουλος", undefined, [37.9612, 23.7461]);
    await geocode("Βασιλόπουλος", undefined, [37.9649, 23.7471]);
    expect(urls).toHaveLength(1);
    expect(urls[0].searchParams.get("lat")).toBe("37.96");
    expect(urls[0].searchParams.get("lon")).toBe("23.75");
  });
});
