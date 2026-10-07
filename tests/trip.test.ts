import { describe, expect, it } from "vitest";
import { findTrips, parsePhoton, places, searchPlaces, suggest, type Place, type Pt, type TripIndex } from "../src/lib/trip";

// ~111 m per 0.001° of latitude: stops on a north-south street, 0.001° apart.
const at = (k: number): Pt => [38 + k * 0.001, 23.7];

function index(lines: Record<string, Record<string, number[]>>, names?: string[]): TripIndex {
  const n = Math.max(...Object.values(lines).flatMap(v => Object.values(v).flat())) + 1;
  return { v: "t", s: Array.from({ length: n }, (_, k) => [names?.[k] ?? `S${k}`, ...at(k)]), l: lines };
}

describe("findTrips", () => {
  const ix = index({
    A: { up: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], down: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0] },
    B: { up: [0, 1, 2, 3, 4, 5] },          // never near stop 10
    C: { x: [20, 21, 22, 10, 9] },          // reaches stop 10 from elsewhere
  });

  it("finds the variants that pass near the origin and then near the destination", () => {
    const r = findTrips(ix, [at(0)], [at(10)], 300);
    expect(r.map(t => t.line)).toEqual(["A"]);
    expect(r[0].variants.map(v => v.id)).toEqual(["up"]);
    expect(r[0].variants[0]).toMatchObject({ from: 0, to: 10 });
  });

  it("boards at the nearest stop, not the first one in reach, and alights at the nearest one", () => {
    const [t] = findTrips(ix, [at(2)], [at(8)], 300);
    expect(t.variants[0]).toMatchObject({ id: "up", from: 2, to: 8, walk: 0, stops: 6 });
  });

  it("finds nothing when the ends are too close to need a bus", () => {
    expect(findTrips(ix, [at(0)], [at(1)], 300)).toEqual([]);
  });

  it("uses a line's repeated stop at the occurrence that gives a trip (loops)", () => {
    const loop = index({ L: { v: [0, 1, 2, 3, 4, 5, 6, 0, 7, 8, 9, 10] } });   // starts and passes 0 again
    const [t] = findTrips(loop, [at(0)], [at(10)], 50);
    expect(t.variants[0]).toMatchObject({ i: 7, j: 11, stops: 4 });   // the later boarding: fewer stops
  });

  it("ranks lines by walking, then stops, then id, deterministically", () => {
    const two = index({ Z: { v: [0, 5, 10] }, Y: { v: [0, 10] }, X: { v: [1, 10] } });
    expect(findTrips(two, [at(0)], [at(10)], 300).map(t => t.line)).toEqual(["Y", "Z", "X"]);
  });

  it("leaves out lines missing from the current line list", () => {
    expect(findTrips(ix, [at(0)], [at(10)], 300, new Set(["B"]))).toEqual([]);
  });
});

describe("places and searchPlaces", () => {
  // Two ΕΚΚΛΗΣΙΑ stops 5 km apart; three ΑΜΠΕΛΟΚΗΠΟΙ stops each 500 m apart (a chain).
  const ix: TripIndex = {
    v: "t",
    s: [["ΕΚΚΛΗΣΙΑ", 38, 23.7], ["ΕΚΚΛΗΣΙΑ", 38.045, 23.7], ["ΑΜΠΕΛΟΚΗΠΟΙ", 37.98, 23.76], ["ΑΜΠΕΛΟΚΗΠΟΙ", 37.9845, 23.76],
      ["ΑΜΠΕΛΟΚΗΠΟΙ", 37.989, 23.76], ["ΣΤ. ΑΜΠΕΛΟΚΗΠΟΙ", 37.987, 23.757], ["ΔΙΑΣΤΑΥΡΩΣΗ", 38, 23.8], ["ΠΛ. ΑΓ. ΓΕΩΡΓΙΟΥ", 38, 23.9]],
    l: { "040": { a: [0, 2, 3] }, "550": { a: [1, 4, 5] }, "Α1": { a: [6, 7] } },
  };
  const ps = places(ix);

  it("keeps same-name stops far apart as separate places, with their lines as a hint", () => {
    const e = ps.filter(p => p.label === "ΕΚΚΛΗΣΙΑ");
    expect(e.map(p => p.lines)).toEqual([["040"], ["550"]]);
  });

  it("does not chain clusters: a stop is grouped only near the cluster's first stop", () => {
    const a = ps.filter(p => p.label === "ΑΜΠΕΛΟΚΗΠΟΙ");
    expect(a.map(p => p.pts.length)).toEqual([2, 1]);
  });

  it("gives the same places for any stop order", () => {
    const rev: TripIndex = { ...ix, s: [...ix.s].reverse(), l: { x: { a: ix.s.map((_, k) => ix.s.length - 1 - k) } } };
    const shape = (list: typeof ps) => list.map(p => `${p.label} ${p.pts.length}`).sort();
    expect(shape(places(rev))).toEqual(shape(ps));
  });

  it("matches at word starts, ignoring case, accents and final sigma", () => {
    const labels = (q: string) => searchPlaces(ps, q).map(p => p.label);
    expect(labels("Αμπελόκηποι")[0]).toBe("ΑΜΠΕΛΟΚΗΠΟΙ");
    expect(labels("αμπελ")).toContain("ΣΤ. ΑΜΠΕΛΟΚΗΠΟΙ");
    expect(labels("ταυρ")).toEqual([]);                  // not ΔΙΑΣΤΑΥΡΩΣΗ
    expect(labels("γεωργιου")).toEqual(["ΠΛ. ΑΓ. ΓΕΩΡΓΙΟΥ"]);
    expect(labels("αγ. γεωρ")).toEqual(["ΠΛ. ΑΓ. ΓΕΩΡΓΙΟΥ"]);
    expect(labels("εκκλησιας")).toEqual([]);
    expect(labels("  ")).toEqual([]);
  });
});

describe("parsePhoton", () => {
  const f = (properties: object, coordinates: unknown = [23.69, 37.97]) => ({ type: "Feature", geometry: { type: "Point", coordinates }, properties });
  it("reads areas, streets and places as [lat, lon], and skips bus stops and broken features", () => {
    const r = parsePhoton({ features: [
      f({ name: "Ταύρος", osm_key: "place", osm_value: "suburb", city: "Δημοτική Ενότητα Ταύρου" }),
      f({ name: "Γαλατσίου", osm_key: "highway", osm_value: "secondary", type: "street", district: "Γαλάτσι", city: "Δήμος Γαλατσίου" }, [23.75, 38.01]),
      f({ name: "ΓΑΛΑΤΣΙ", osm_key: "highway", osm_value: "bus_stop" }),
      f({ name: "Δήμος Γαλατσίου", osm_key: "boundary", osm_value: "administrative" }),
      f({ osm_key: "place" }),
      f({ name: "Κακό", osm_key: "place" }, ["x", 1]),
      f({ street: "Μαρασλή", housenumber: "20", osm_key: "building", type: "house", city: "Αθήνα" }, [23.74, 37.98]),
      f({ name: "EKO", osm_key: "amenity", osm_value: "charging_station", type: "house", street: "Γαλατσίου", housenumber: "88", city: "Γαλάτσι" }, [23.74, 37.98]),
      { nope: 1 },
    ] });
    expect(r).toEqual<Place[]>([
      { label: "Ταύρος", hint: "Δημοτική Ενότητα Ταύρου", pts: [[37.97, 23.69]], lines: [], kind: "area" },
      { label: "Γαλατσίου", hint: "Γαλάτσι, Δήμος Γαλατσίου", pts: [[38.01, 23.75]], lines: [], kind: "street" },
      { label: "Μαρασλή 20", hint: "Αθήνα", pts: [[37.98, 23.74]], lines: [], kind: "street" },
      { label: "EKO", hint: "Γαλάτσι", pts: [[37.98, 23.74]], lines: [], kind: "poi" },
    ]);
  });
  it("keeps one of the same name and area (pieces of one street)", () => {
    const piece = (lat: number) => f({ name: "Μαρασλή", osm_key: "highway", type: "street", city: "Αθήνα" }, [23.74, lat]);
    expect(parsePhoton({ features: [piece(37.97), piece(37.971)] })).toHaveLength(1);
  });
  it("gives nothing for a body without features", () => {
    expect(parsePhoton({ error: "x" })).toEqual([]);
    expect(parsePhoton(null)).toEqual([]);
  });
});

describe("suggest", () => {
  const stop = (label: string, lat: number): Place => ({ label, pts: [[lat, 23.7]], lines: ["1"], kind: "stop" });
  const geo = (label: string, lat: number, kind: Place["kind"]): Place => ({ label, pts: [[lat, 23.7]], lines: [], kind });

  it("puts areas first, then stops, then streets, in a short list", () => {
    const own = ["Α", "Β", "Γ", "Δ", "Ε"].map((l, k) => stop(l, 38 + k));
    const r = suggest(own, [geo("Οδός", 37, "street"), geo("Περιοχή", 37.5, "area")], 6);
    expect(r.map(p => p.label)).toEqual(["Περιοχή", "Α", "Β", "Γ", "Δ", "Οδός"]);
  });
  it("shows at most one point of interest (shops, chargers), after streets", () => {
    const r = suggest([], [geo("Φορτιστής", 37, "poi"), geo("Κατάστημα", 37.1, "poi"), geo("Οδός", 37.2, "street")]);
    expect(r.map(p => p.label)).toEqual(["Οδός", "Φορτιστής"]);
  });
  it("drops an area that a stop place of the same name already covers", () => {
    const r = suggest([stop("ΑΜΠΕΛΟΚΗΠΟΙ", 37.987)], [geo("Αμπελόκηποι", 37.989, "area"), geo("Αμπελόκηποι", 37.5, "area")]);
    expect(r.map(p => p.pts[0][0])).toEqual([37.5, 37.987]);   // the far one is another place
  });
});
