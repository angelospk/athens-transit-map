import { describe, expect, it } from "vitest";
import { CITIES } from "../src/lib/cities";
import { CITYBUS } from "../src/lib/citybus";
import { muniGapNote, muniGaps, serviceNote, serviceTag } from "../src/lib/service";
import type { MunicipalRoute } from "../src/lib/municipal";
import type { MuniTimetable } from "../src/lib/muniTimes";

const code = (c: string) => CITYBUS.find(x => x.code === c)!;

describe("citybus.gr service per city (measured 2026-11-07)", () => {
  it("only the timetable where no bus sends its position", () => {
    for (const c of ["dra", "pto", "cha", "kso", "nao", "jsi"]) expect([c, code(c).service]).toEqual([c, "timetable"]);
  });
  it("partial where only some buses send it", () => {
    for (const c of ["ver", "ser", "kom", "kat", "agq", "mes", "jkh"]) expect([c, code(c).service]).toEqual([c, "partial"]);
  });
  it("gaps where citybus.gr publishes an incomplete timetable", () => {
    expect(code("art").service).toBe("gaps");
  });
  it("live everywhere else, Athens and Thessaloniki too", () => {
    const marked = CITYBUS.filter(c => c.service !== "live").map(c => c.code).sort();
    expect(marked).toHaveLength(14);
    expect(code("her").service).toBe("live");
    expect(code("pat").service).toBe("live");
    expect([CITIES.athens.service, CITIES.thessaloniki.service]).toEqual(["live", "live"]);
    expect(CITIES.drama.service).toBe("timetable");
  });
});

describe("serviceTag", () => {
  it("a short tag for the picker; none for live", () => {
    expect(serviceTag("timetable")).toBe("μόνο πρόγραμμα");
    expect(serviceTag("partial")).toBe("λίγα live");
    expect(serviceTag("gaps")).toBe("ελλιπές πρόγραμμα");
    expect(serviceTag("live")).toBeNull();
  });
});

describe("serviceNote", () => {
  it("one line with the city's inName, capitalised", () => {
    expect(serviceNote("timetable", "στη Δράμα")).toBe("Στη Δράμα τα λεωφορεία δεν στέλνουν θέση. Βλέπεις μόνο τις ώρες του προγράμματος.");
    expect(serviceNote("partial", "στη Βέροια")).toBe("Στη Βέροια μόνο μερικά λεωφορεία στέλνουν θέση. Οι υπόλοιπες ώρες είναι από το πρόγραμμα.");
    expect(serviceNote("gaps", "στην Άρτα")).toBe("Στην Άρτα το πρόγραμμα του citybus.gr είναι ελλιπές. Μπορεί να λείπουν δρομολόγια.");
    expect(serviceNote("partial", "στις Σέρρες")).toMatch(/^Στις Σέρρες /);
  });
  it("nothing for live", () => {
    expect(serviceNote("live", "στο Ηράκλειο")).toBeNull();
  });
});

const route = (stops: string[], municipality = "Δήμος Γαλατσίου"): MunicipalRoute =>
  ({ id: "osm:r1", ref: null, name: "x", municipality, timetable_url: "https://x.gr", shape: [], stops });
const table = (municipality: string) => ({ municipality, checked: "2026-11-05", valid: null, source: "", watch: [], lines: [] }) as MuniTimetable;

describe("muniGaps", () => {
  it("a route with no stops; a municipality with no timetable", () => {
    expect(muniGaps(route([]), [table("Δήμος Βύρωνα")])).toEqual({ stops: true, times: true });
    expect(muniGaps(route([], "Δήμος Νέας Ιωνίας"), [table("Δήμος Νέας Ιωνίας")])).toEqual({ stops: true, times: false });
    expect(muniGaps(route(["osm:n1"], "Δήμος Βύρωνα"), [table("Δήμος Βύρωνα")])).toEqual({ stops: false, times: false });
    expect(muniGaps(route(["osm:n1"]), [table("Δήμος Βύρωνα")])).toEqual({ stops: false, times: true });
  });
  it("claims no times only once the timetables are loaded (none yet: unknown, not missing)", () => {
    expect(muniGaps(route(["osm:n1"]), [])).toEqual({ stops: false, times: false });
  });
});

describe("muniGapNote", () => {
  it("names what is missing", () => {
    const tail = " σε μορφή που μπορούμε να δείξουμε. Δες τη σελίδα του δήμου.";
    expect(muniGapNote({ stops: true, times: false })).toBe(`Ο δήμος δεν δημοσιεύει στάσεις${tail}`);
    expect(muniGapNote({ stops: false, times: true })).toBe(`Ο δήμος δεν δημοσιεύει ώρες${tail}`);
    expect(muniGapNote({ stops: true, times: true })).toBe(`Ο δήμος δεν δημοσιεύει στάσεις και ώρες${tail}`);
    expect(muniGapNote({ stops: false, times: false })).toBeNull();
  });
});
