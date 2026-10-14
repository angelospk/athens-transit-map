import { describe, expect, it } from "vitest";
import type { MetroData } from "../src/lib/metro";
import { alertTargets, anyMetro, metroDirect, boardings, findTransfers, findTrips, metroPlaces, nearestStation, parsePhoton, places, searchPlaces, suggest, termini, type Place, type Pt, type TripIndex } from "../src/lib/trip";

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

  it("ranks lines by estimated time (walking and riding), then stops, then id, deterministically", () => {
    const two = index({ Z: { v: [0, 5, 10] }, Y: { v: [0, 10] }, X: { v: [1, 10] } });
    expect(findTrips(two, [at(0)], [at(10)], 300).map(t => t.line)).toEqual(["Y", "Z", "X"]);
  });

  it("estimates minutes: walking at 4.5 km/h on streets a third longer than the straight line, riding at 15 km/h", () => {
    const [t] = findTrips(ix, [at(0)], [at(10)], 300);
    expect(t.min).toBeCloseTo(1110 / 250, 0);                 // 1.1 km on the bus, no walking
    const [w] = findTrips(ix, [[38, 23.701]], [at(10)], 300);  // 88 m west of stop 0
    expect(w.min - t.min).toBeCloseTo((88 * 1.3) / 75, 0);
  });

  it("prefers a longer walk that saves a long ride", () => {
    // V reaches stop 10 from stop 0 the long way round; W boards 220 m away and goes straight there
    const long = index({ V: { v: [0, 30, 31, 32, 33, 10] }, W: { v: [2, 10] } });
    long.s[30] = ["F1", 38.02, 23.75]; long.s[31] = ["F2", 38.04, 23.75]; long.s[32] = ["F3", 38.04, 23.70]; long.s[33] = ["F4", 38.02, 23.70];
    expect(findTrips(long, [at(0)], [at(10)], 300).map(t => t.line)).toEqual(["W", "V"]);
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

describe("termini", () => {
  const names = ["ΑΡΧΗ", "ΜΕΣΗ", "ΤΕΡΜΑ", "ΑΛΛΟ", "ΑΛΛΟΥ"];
  const ix = index({
    A: { up: [0, 1, 2], up2: [0, 1, 2], other: [0, 1, 3] },   // two variants end at ΤΕΡΜΑ
    L: { loop: [0, 1, 0] },
    Z: { gone: [] },
  }, names);

  it("is where each direction ends, once", () => {
    expect(termini(ix, "A", ["up", "up2", "other"])).toEqual(["ΤΕΡΜΑ", "ΑΛΛΟ"]);
  });
  it("is the first stop again for a loop", () => {
    expect(termini(ix, "L", ["loop"])).toEqual(["ΑΡΧΗ"]);
  });
  it("leaves out a variant or line the index does not know", () => {
    expect(termini(ix, "A", ["nope", "up"])).toEqual(["ΤΕΡΜΑ"]);
    expect(termini(ix, "Z", ["gone"])).toEqual([]);
    expect(termini(ix, "Q", ["up"])).toEqual([]);
  });
});

describe("boardings", () => {
  // Stops 0-10 on one street; 1 and 3 share a name (two sides of a square).
  const names = ["S0", "ΠΛΑΤΕΙΑ", "S2", "ΠΛΑΤΕΙΑ"];
  const ix = index({
    A: { up: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], down: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0] },
    B: { up: [2, 3, 4, 10] },
    C: { up: [0, 9] },
  }, names);

  it("lists the stops near the start that reach the end, nearest first, one per name", () => {
    const r = boardings(ix, [at(0)], [at(10)], 400, ["A", "B", "C"]);
    expect(r.map(b => [b.name, Math.round(b.walk / 10) * 10])).toEqual([["S0", 0], ["ΠΛΑΤΕΙΑ", 110], ["S2", 220]]);
  });

  it("gives each stop its lines in trip order, at the stop's position in each variant", () => {
    const r = boardings(ix, [at(0)], [at(10)], 400, ["B", "A", "C"]);
    const sq = r.find(b => b.name === "ΠΛΑΤΕΙΑ")!;
    expect(sq.lines).toEqual([
      { line: "B", variants: [{ id: "up", i: 1, from: 3 }] },
      { line: "A", variants: [{ id: "up", i: 1, from: 1 }] },   // the nearer of the two stops of the name
    ]);
    expect(r.find(b => b.name === "S0")!.lines.map(l => l.line)).toEqual(["A", "C"]);
  });

  it("leaves out lines not asked for, and keeps at most max stops", () => {
    expect(boardings(ix, [at(0)], [at(10)], 400, ["C"]).map(b => b.name)).toEqual(["S0"]);
    expect(boardings(ix, [at(0)], [at(10)], 400, ["A", "B", "C"], 2)).toHaveLength(2);
  });

  it("boards a loop at the occurrence with the fewest stops to the end", () => {
    const loop = index({ L: { v: [0, 1, 2, 3, 4, 5, 6, 0, 7, 8, 9, 10] } });
    expect(boardings(loop, [at(0)], [at(10)], 50, ["L"])[0].lines[0].variants).toEqual([{ id: "v", i: 7, from: 0 }]);
  });
});

describe("alertTargets", () => {
  const trips = [
    { line: "A", walk: 0, stops: 9, min: 0, variants: [{ id: "up", i: 0, j: 9, from: 0, to: 9, walk: 0, stops: 9, ride: 0, min: 0 }] },
    { line: "B", walk: 10, stops: 3, min: 0, variants: [{ id: "x", i: 2, j: 5, from: 4, to: 9, walk: 10, stops: 3, ride: 0, min: 0 }] },
  ];
  const board = { name: "ΠΛΑΤΕΙΑ", walk: 100, lines: [{ line: "B", variants: [{ id: "x", i: 1, from: 3 }] }, { line: "A", variants: [{ id: "up", i: 1, from: 1 }] }] };

  it("uses each line's own boarding stop when no stop is chosen", () => {
    expect(alertTargets(trips, ["A", "B"], null, [])).toEqual([
      { line: "A", variants: [{ id: "up", i: 0, from: 0 }] },
      { line: "B", variants: [{ id: "x", i: 2, from: 4 }] },
    ]);
  });

  it("uses the chosen stop for every line", () => {
    expect(alertTargets(trips, ["A", "B"], board, [])).toEqual(board.lines);
  });

  it("leaves out lines unticked or not on the map", () => {
    expect(alertTargets(trips, ["A", "B"], null, ["A"]).map(l => l.line)).toEqual(["B"]);
    expect(alertTargets(trips, ["A"], board, []).map(l => l.line)).toEqual(["A"]);
  });
});

describe("findTransfers", () => {
  // A goes north from stop 0 to stop 5; B starts 44 m east of stop 5 and goes east to stop 10.
  const ix: TripIndex = { v: "t", s: [
    ...Array.from({ length: 6 }, (_, k) => [`N${k}`, 38 + k * 0.001, 23.7] as [string, number, number]),
    ["E0", 38.005, 23.7005], ["E1", 38.005, 23.702], ["E2", 38.005, 23.704], ["E3", 38.005, 23.706], ["E4", 38.005, 23.708],
  ], l: { A: { up: [0, 1, 2, 3, 4, 5] }, B: { e: [6, 7, 8, 9, 10] }, C: { e: [0, 1] } } };
  const end: Pt = [38.005, 23.708];

  it("changes once, walking to a nearby stop of the second line", () => {
    const [r] = findTransfers(ix, [at(0)], [end], 300);
    expect(r.legs.map(l => l.line)).toEqual(["A", "B"]);
    expect(r.legs[0]).toMatchObject({ id: "up", from: 0, to: 5 });
    expect(r.legs[1]).toMatchObject({ id: "e", from: 6, to: 10 });
    expect(r.xfer).toBeGreaterThan(30);
    expect(r.xfer).toBeLessThan(60);
    expect(r.min).toBeGreaterThan(5);                          // a change costs a wait
  });

  it("finds no change when the second line is out of walking reach, or the trip needs none", () => {
    const far: TripIndex = { ...ix, s: ix.s.map((x, k) => (k >= 6 ? [x[0], x[1] - 0.004, x[2] + 0.003] : x)) as TripIndex["s"] };
    expect(findTransfers(far, [at(0)], [[38.001, 23.711]], 300)).toEqual([]);
    expect(findTransfers(ix, [at(0)], [at(5)], 300).every(r => r.legs[0].line !== r.legs[1].line)).toBe(true);
  });

  it("leaves out lines missing from the current line list", () => {
    expect(findTransfers(ix, [at(0)], [end], 300, new Set(["A"]))).toEqual([]);
  });
});

describe("metro places", () => {
  const data: MetroData = { source: "t", lines: [], stations: [
    { name: "ΣΥΝΤΑΓΜΑ", lat: 37.975, lon: 23.735, lines: ["M2", "M3"] },
    { name: "ΑΚΡΟΠΟΛΗ", lat: 37.969, lon: 23.729, lines: ["M2"] },
    { name: "ΖΑΠΠΕΙΟ", lat: 37.970, lon: 23.738, lines: ["T6"] },
  ] };

  it("are stations to start or end at, with their lines", () => {
    const ps = metroPlaces(data);
    expect(ps.map(p => p.label)).toEqual(["ΣΥΝΤΑΓΜΑ", "ΑΚΡΟΠΟΛΗ", "ΖΑΠΠΕΙΟ"]);
    expect(ps[0]).toMatchObject({ kind: "metro", lines: ["M2", "M3"], pts: [[37.975, 23.735]] });
  });

  it("come before a bus stop place of the same name", () => {
    const bus: Place = { label: "ΣΥΝΤΑΓΜΑ", pts: [[37.976, 23.734]], lines: ["1", "2", "3", "4"], kind: "stop" };
    expect(searchPlaces([bus, ...metroPlaces(data)], "συνταγμα")[0].kind).toBe("metro");
  });

  it("any metro station: every metro and ISAP station, not the tram", () => {
    const any = anyMetro(data);
    expect(any.kind).toBe("metro-any");
    expect(any.pts).toEqual([[37.975, 23.735], [37.969, 23.729]]);
  });

  it("finds a metro or tram line that joins stations near both ends", () => {
    const r = metroDirect(data, [[37.9752, 23.7352]], [[37.9692, 23.7292]], 300);
    expect(r).toMatchObject({ line: "M2", from: "ΣΥΝΤΑΓΜΑ", to: "ΑΚΡΟΠΟΛΗ" });
    expect(metroDirect(data, [[37.975, 23.735]], [[37.970, 23.738]], 300)).toBeNull();   // ΖΑΠΠΕΙΟ: T6 only, no shared line
    expect(metroDirect(data, [[37.99, 23.70]], [[37.969, 23.729]], 300)).toBeNull();     // no station near the start
  });

  it("names the metro station nearest a point, with its distance", () => {
    expect(nearestStation(data, [37.9691, 23.7291])).toMatchObject({ name: "ΑΚΡΟΠΟΛΗ" });
    expect(nearestStation(data, [37.9691, 23.7291])!.d).toBeLessThan(20);
    expect(nearestStation({ ...data, stations: [] }, [37.97, 23.73])).toBeNull();
  });
});
