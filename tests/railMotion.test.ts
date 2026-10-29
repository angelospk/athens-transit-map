import { describe, expect, it } from "vitest";
import cases from "./fixtures/motion-cases.json";
import { knotMetres, lineTrains, railMotions, stasyPlace, trainsFC, type StasyVehicle } from "../src/lib/trains";

// The backend's client rule for /v2 motion.knots (athens-transit-rt docs/fixtures/v2/motion-cases.json).
describe("knotMetres", () => {
  for (const c of cases.cases)
    it(c.name, () => {
      for (const [t, m] of c.at) expect(knotMetres(c.knots as [number, number][], t)).toBeCloseTo(m, 6);
    });
});

const veh: StasyVehicle = {
  trip: "40077", line: "M1", route_color: "#00a651", headsign: "ΠΕΙΡΑΙΑΣ",
  from: { name: "ΚΗΦΙΣΙΑ", lat: 38, lon: 23, at: 1000 }, to: { name: "ΚΑΤ", lat: 38, lon: 23.001, at: 1010 },
};
// About 878 m east along latitude 38 (0.01° of longitude), then 1112 m north.
const v2 = (run: string | null, knots: [number, number][] | null) => ({
  id: run ?? "x", run, mode: "metro",
  motion: { path: [[38, 23], [38, 23.01]], path_beyond: [[38, 23.01], [38.01, 23.01]], path_stops: null, speed: null, path_speeds: null, knots },
});

describe("railMotions", () => {
  it("keys each run's track (path then path_beyond) and knots by its /v1 trip number", () => {
    const m = railMotions({ vehicles: [v2("stasy:run:40077:2026-10-29", [[0, 1000], [878, 1100]])] });
    expect(Object.keys(m)).toEqual(["40077"]);
    expect(m["40077"].track).toEqual([[38, 23], [38, 23.01], [38, 23.01], [38.01, 23.01]]);
    expect(m["40077"].knots).toEqual([[0, 1000], [878, 1100]]);
  });
  it("leaves out runs without knots or run id, and a body that is not a list", () => {
    expect(railMotions({ vehicles: [v2("stasy:run:1:2026-10-29", null), v2("stasy:run:2:2026-10-29", []), v2(null, [[0, 1]])] })).toEqual({});
    expect(railMotions(null)).toEqual({});
    expect(railMotions({ vehicles: "x" })).toEqual({});
  });
});

describe("stasyPlace with knots", () => {
  const m = railMotions({ vehicles: [v2("stasy:run:40077:2026-10-29", [[0, 1000], [878, 1100], [878, 1130], [1990, 1230]])] })["40077"];

  it("runs on past the /v1 pair's next stop: placed by the knots, not frozen at `to`", () => {
    const p = stasyPlace(veh, 1180, [], m);   // /v1 alone: at `to` since 1010
    expect(p.pos[0]).toBeCloseTo(23.01, 4);
    expect(p.pos[1]).toBeCloseTo(38.005, 3);   // half of the north leg
    expect(p.h).toBeCloseTo(0, 0);
  });
  it("heads east on the first leg; no heading while it dwells or after the last knot", () => {
    expect(stasyPlace(veh, 1050, [], m).h).toBeCloseTo(90, 0);
    const dwell = stasyPlace(veh, 1115, [], m);
    expect(dwell.pos[0]).toBeCloseTo(23.01, 4);
    expect(dwell.pos[1]).toBeCloseTo(38, 4);
    expect(dwell.h).toBeNull();
    expect(stasyPlace(veh, 1300, [], m).h).toBeNull();
  });
});

describe("trainsFC with motions", () => {
  it("places a metro train by its run's knots when it has them", () => {
    const motions = railMotions({ vehicles: [v2("stasy:run:40077:2026-10-29", [[0, 1000], [878, 1100]])] });
    const fc = trainsFC({ stasy: [veh], suburban: [], corridors: {}, nowS: 1050, sel: null, motions });
    const [x, y] = (fc.features[0].geometry as GeoJSON.Point).coordinates;
    expect(x).toBeCloseTo(23.005, 4);
    expect(y).toBeCloseTo(38, 6);
  });
});

describe("lineTrains with motions", () => {
  it("the line card looks where the map draws the train", () => {
    const motions = railMotions({ vehicles: [v2("stasy:run:40077:2026-10-29", [[0, 1000], [878, 1100]])] });
    const [t] = lineTrains({ kind: "metro", id: "M1" }, [veh], [], 1050, motions);
    expect(t.pos[0]).toBeCloseTo(23.005, 4);
    expect(lineTrains({ kind: "metro", id: "M1" }, [veh], [], 1050)[0].pos).toEqual([23.001, 38]);
  });
});
