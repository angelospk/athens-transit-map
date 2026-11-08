import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { cleanTerminus, stopDirections, towardsOf, towardsOfId, towardsText } from "../src/lib/towards";
import type { TripIndex } from "../src/lib/trip";

// Two stops of one name on both sides of a road (0 runs south-west, 1 north-east), the next stop each way
// (7, 8) and the termini. Lines count once, whatever their variants.
const ix: TripIndex = {
  v: "t",
  s: [
    ["ΚΑΤΕΧΑΚΗ", 37.99, 23.76, "770021"],        // 0
    ["ΚΑΤΕΧΑΚΗ", 37.9902, 23.7605, "60605"],     // 1
    ["ΜΟΥΣΕΙΟ", 37.98, 23.75, "2"],              // 2
    ["ΠΟΛΥΓΩΝΟ", 37.981, 23.749, "3"],           // 3
    ["ΠΛ. ΧΑΛΑΝΔΡΙΟΥ", 38.0, 23.77, "4"],         // 4
    ["ΠΛ. ΠΛΑΤΑΝΟΥ", 38.001, 23.771, "5"],        // 5
    ["ΑΦΕΤΗΡΙΑ 602", 37.979, 23.751, "6"],        // 6
    ["Σ1", 37.985, 23.755, "7"],                 // 7
    ["Σ2", 37.995, 23.765, "8"],                 // 8
    ["ΖΩΓΡΑΦΟΥ", 37.982, 23.748, "9"],           // 9
  ],
  l: {
    L1: { v1: [4, 0, 7, 2], v2: [4, 0, 7, 2], v3: [2, 7, 1, 8, 4] },
    L2: { v: [5, 0, 7, 3], w: [3, 7, 1, 8, 5] },
    L3: { v: [0, 7, 2] },
    L4: { v: [0, 7, 6] },                         // to a noise name: skipped
    L5: { a: [0, 7, 9], b: [0, 7, 9], c: [0, 7, 9] },   // three variants, still one line
    L6: { v: [0, 7, 3] },
  },
};
ix.d = stopDirections(ix);

describe("cleanTerminus", () => {
  it.each([
    ["ΑΦΕΤΗΡΙΑ 602", ""],
    ["ΤΕΡΜΑ", ""],
    ["ΣΑΡΩΝΙΔΑ 122- 123", "ΣΑΡΩΝΙΔΑ"],
    ["ΑΦΕΤΗΡΙΑ - ΡΗΓΑ ΦΕΡΑΙΟΥ", "ΡΗΓΑ ΦΕΡΑΙΟΥ"],
    ["ΑΓ. ΒΑΡΒΑΡΑ - ΑΦΕΤΗΡΙΑ 830", "ΑΓ. ΒΑΡΒΑΡΑ"],
    ["ΑΦΕΤΗΡΙΑ  ΑΓ. ΑΝΤΩΝΙΟΣ", "ΑΓ. ΑΝΤΩΝΙΟΣ"],
    ["ΤΕΡΜΑ - ΕΡΥΘΡΕΣ", "ΕΡΥΘΡΕΣ"],
    ["ΤΕΡΜΑ ΦΥΛΗΣ", "ΤΕΡΜΑ ΦΥΛΗΣ"],            // a place name, kept
    ["ΣΤ. ΚΗΦΙΣΙΑ (ΤΑΤΟΪΟΥ) 543-543Α", "ΣΤ. ΚΗΦΙΣΙΑ (ΤΑΤΟΪΟΥ)"],
    ["ΠΕΙΡΑΙΑΣ ΔΡΑΠΕΤΣΩΝΑ Χ96", "ΠΕΙΡΑΙΑΣ ΔΡΑΠΕΤΣΩΝΑ"],
    ["ΣΤ.  ΛΑΡΙΣΗΣ", "ΣΤ. ΛΑΡΙΣΗΣ"],
    ["ΠΛ. ΧΑΛΑΝΔΡΙΟΥ", "ΠΛ. ΧΑΛΑΝΔΡΙΟΥ"],
    // Thessaloniki (OASTH): «Τ.Σ.» marks a terminus, a last letter is the platform
    ["Τ.Σ. ΛΑΓΚΑΔΑ", "ΛΑΓΚΑΔΑ"],
    ["Τ.Σ. ΣΤΑΥΡΟΥΠΟΛΗΣ Β", "ΣΤΑΥΡΟΥΠΟΛΗΣ"],
    ["ΑΝΑΤΟΛΙΚΟΣ ΣΤΑΘΜΟΣ ΙΚΕΑ B", "ΑΝΑΤΟΛΙΚΟΣ ΣΤΑΘΜΟΣ ΙΚΕΑ"],
    ["Τ.Σ. Ν.Σ. ΣΤΑΘΜΟΣ β", "Ν.Σ. ΣΤΑΘΜΟΣ"],
    ["Τ.Σ. Κ.Τ.Ε.Λ  A", "Κ.Τ.Ε.Λ"],
    ["ΧΑΝΙΑ - Τ.Σ.ΒΑΣΙΛΙΚΩΝ", "ΧΑΝΙΑ - ΒΑΣΙΛΙΚΩΝ"],
    ["ΠΛΑΤΕΙΑ ΒΥΡΩΝΟΣ-Τ.Σ.ΜΕΣΗΜΕΡΙΟΥ", "ΠΛΑΤΕΙΑ ΒΥΡΩΝΟΣ-ΜΕΣΗΜΕΡΙΟΥ"],
    ["ΑΠΟΘΗΚΕΣ /Τ.Σ.ΛΑΓΚΑΔΙΚΙΑ", "ΑΠΟΘΗΚΕΣ - ΛΑΓΚΑΔΙΚΙΑ"],
    ["Τ.Σ. ΕΠΑΝΟΜΗΣ ΓΡ88Ε", "ΕΠΑΝΟΜΗΣ"],
    ["Τ.Σ. 40 ΕΚΚΛΗΣΙΩΝ", "40 ΕΚΚΛΗΣΙΩΝ"],          // a leading number is part of the name
    ["Τ.Σ. ΑΚΡΟΠΟΤΑΜΟY", "ΑΚΡΟΠΟΤΑΜΟΥ"],             // a Latin Y inside a Greek word
    ["Τ.Σ. ΚΑΤΩ ΗΛΙΟΥΠΟΛΗΣ-ΕΥΟΣΜΟΥ", "ΚΑΤΩ ΗΛΙΟΥΠΟΛΗΣ-ΕΥΟΣΜΟΥ"],
    ["MEDITERRANEAN COSMOS", "MEDITERRANEAN COSMOS"],
    ["ΑΜ/ΣΙΟ ΘΡΙΑΣΙΟΥ", "ΑΜ/ΣΙΟ ΘΡΙΑΣΙΟΥ"],          // a slash inside an abbreviation stays
    ["ΠΑΝ/ΠΟΛΗ", "ΠΑΝ/ΠΟΛΗ"],
    // citybus.gr (web#54): a stop number before the name, a trailing ΤΕΡΜΑ
    ["26-ΚΟΥΚΟΥΝΑΡΙΕΣ", "ΚΟΥΚΟΥΝΑΡΙΕΣ"],
    ["0-ΛΙΜΑΝΙ ΤΕΡΜΑ", "ΛΙΜΑΝΙ"],
    ["ΑΣΕΛΗΝΟΣ ΤΕΡΜΑ", "ΑΣΕΛΗΝΟΣ"],
    ["ΤΕΡΜΑ", ""],
    ["ΑΦEΤΗΡΙΑ", ""],                              // a Latin E (Ptolemaida)
    ["ΕΠΑΛ-ΙΕΚ 2", "ΕΠΑΛ-ΙΕΚ"],
    ["ΠΑΝΩ ΠΛΑΤΕΙΑ – ΤΕΡΜΑ", "ΠΑΝΩ ΠΛΑΤΕΙΑ"],        // no dash left behind (Drama)
  ])("%s → %s", (raw, out) => expect(cleanTerminus(raw)).toBe(out));
});

describe("stopDirections", () => {
  it("has one entry per stop and a table of unique names", () => {
    expect(ix.d!.s).toHaveLength(ix.s.length);
    expect(new Set(ix.d!.n).size).toBe(ix.d!.n.length);
    expect(JSON.parse(JSON.stringify(ix.d))).toEqual(ix.d);
  });

  it("names the two busiest termini, by lines (not variants), noise skipped, ties by name", () => {
    expect(towardsOf(ix, 0).towards).toEqual(["ΜΟΥΣΕΙΟ", "ΠΟΛΥΓΩΝΟ"]);
    expect(towardsOf(ix, 1).towards).toEqual(["ΠΛ. ΠΛΑΤΑΝΟΥ", "ΠΛ. ΧΑΛΑΝΔΡΙΟΥ"]);
  });

  it("gives the bearing to the next stop, so the two sides of the road point opposite ways", () => {
    const a = towardsOf(ix, 0).bearing!, b = towardsOf(ix, 1).bearing!;
    expect(a).toBeGreaterThan(210);
    expect(a).toBeLessThan(226);
    expect(b).toBeGreaterThan(30);
    expect(b).toBeLessThan(45);
    expect(Number.isInteger(a)).toBe(true);
  });

  it("a stop where every pattern ends shows nothing", () => {
    expect(towardsOf(ix, 9)).toEqual({ bearing: null, towards: [] });
    expect(towardsOf(ix, 6)).toEqual({ bearing: null, towards: [] });
    expect(ix.d!.s[9]).toEqual([]);
  });

  it("skips a terminus of the stop's own name", () => {
    const t: TripIndex = {
      v: "t",
      s: [["ΜΟΥΣΕΙΟ", 37.9805, 23.7505, "a"], ["ΜΟΥΣΕΙΟ", 37.98, 23.75, "b"], ["ΠΟΛΥΓΩΝΟ", 37.981, 23.749, "c"]],
      l: { X: { v: [0, 1] }, Y: { v: [0, 1] }, Z: { v: [0, 2] } },
    };
    t.d = stopDirections(t);
    expect(towardsOf(t, 0).towards).toEqual(["ΠΟΛΥΓΩΝΟ"]);
  });

  it("an arrow only when a clear majority of lines leave the same way", () => {
    // 0 in the middle; 1-3 east, 4-5 north.
    const s: TripIndex["s"] = [
      ["Κ", 37.98, 23.75, "0"], ["Α1", 37.98, 23.752, "1"], ["Α2", 37.9801, 23.752, "2"], ["Α3", 37.9799, 23.752, "3"],
      ["Β1", 37.982, 23.75, "4"], ["Β2", 37.982, 23.7501, "5"],
    ];
    const most: TripIndex = { v: "t", s, l: { a: { v: [0, 1] }, b: { v: [0, 2] }, c: { v: [0, 3] }, d: { v: [0, 4] } } };
    most.d = stopDirections(most);
    const b = towardsOf(most, 0).bearing!;
    expect(b).toBeGreaterThanOrEqual(85);
    expect(b).toBeLessThanOrEqual(95);
    const split: TripIndex = { v: "t", s, l: { a: { v: [0, 1] }, b: { v: [0, 2] }, c: { v: [0, 4] }, d: { v: [0, 5] } } };
    split.d = stopDirections(split);
    expect(towardsOf(split, 0).bearing).toBeNull();
  });

  it("no arrow when the averaged bearing itself lacks the two-thirds support", () => {
    // From stop 0, lines leave at about 0°, 44°, 44°, 316°, 180°, 180°: 0° gathers 4 of 6 (0, 44, 44, 316),
    // but their mean (~12°) has only 3 of 6 within 45°.
    const at = (deg: number, k: number): [string, number, number, string] =>
      [`Σ${k}`, 37.98 + 0.002 * Math.cos(deg * Math.PI / 180), 23.75 + 0.002 * Math.sin(deg * Math.PI / 180) / Math.cos(37.98 * Math.PI / 180), `${k}`];
    const t: TripIndex = {
      v: "t",
      s: [["Κ", 37.98, 23.75, "0"], at(0, 1), at(44, 2), at(44.5, 3), at(316, 4), at(180, 5), at(180.5, 6)],
      l: { a: { v: [0, 1] }, b: { v: [0, 2] }, c: { v: [0, 3] }, d: { v: [0, 4] }, e: { v: [0, 5] }, f: { v: [0, 6] } },
    };
    t.d = stopDirections(t);
    expect(towardsOf(t, 0).bearing).toBeNull();
  });

  it("on a loop: towards the turn before it, back to the start after it", () => {
    const t: TripIndex = {
      v: "t",
      s: [
        ["ΑΡΧΗ", 37.98, 23.75, "0"], ["ΠΗΓΑΙΝΕΙ", 37.985, 23.75, "1"], ["ΣΤΡΟΦΗ", 37.99, 23.751, "2"],
        ["ΓΥΡΙΖΕΙ", 37.985, 23.752, "3"],
      ],
      l: { R: { v: [0, 1, 2, 3, 0] } },
    };
    t.d = stopDirections(t);
    expect(towardsOf(t, 1).towards).toEqual(["ΣΤΡΟΦΗ"]);
    expect(towardsOf(t, 3).towards).toEqual(["ΑΡΧΗ"]);
  });

  // Skiathos (#57): to and from «0-ΛΙΜΑΝΙ ΤΕΡΜΑ».
  it("names a citybus.gr terminus without its stop number and ΤΕΡΜΑ", () => {
    const t: TripIndex = {
      v: "t",
      s: [["0-ΛΙΜΑΝΙ", 39.16547, 23.49191, "000"], ["ΑΕΡΟΔΡΟΜΙΟ", 39.17566, 23.50048, "901"], ["0-ΛΙΜΑΝΙ ΤΕΡΜΑ", 39.16503, 23.49218, "001"]],
      l: { ΣΚΙ: { "901": [0, 1], "902": [1, 2] } },
    };
    t.d = stopDirections(t);
    expect(towardsOf(t, 0).towards).toEqual(["ΑΕΡΟΔΡΟΜΙΟ"]);
    expect(towardsOf(t, 1).towards).toEqual(["ΛΙΜΑΝΙ"]);
  });

  // Kastoria line 13 (#57): from «ΑΦΕΤΗΡΙΑ 2» round to «ΑΦΕΤΗΡΙΑ», two stop ids 23 m apart.
  const k13: TripIndex = {
    v: "t",
    s: [
      ["ΑΦΕΤΗΡΙΑ 2", 40.52148, 21.26212, "16600"], ["ΓΕΝΙΚΑ ΛΥΚΕΙΑ", 40.53208, 21.25885, "16136"],
      ["ΕΠΑΛ-ΙΕΚ", 40.54246, 21.2634, "16148"], ["1 ΓΥΜΝΑΣΙΟ", 40.53709, 21.26434, "16157"],
      ["ΓΕΝΙΚΑ ΛΥΚΕΙΑ ΚΑΣΤΟΡΙΑΣ", 40.53207, 21.26004, "16156"], ["ΒΑΝ ΦΛΥΤ", 40.52295, 21.2643, "16154"],
      ["ΑΦΕΤΗΡΙΑ", 40.5214, 21.26187, "16001"],
    ],
    l: { "13": { "013": [0, 1, 2, 3, 4, 5, 6] } },
  };
  k13.d = stopDirections(k13);

  it("a line that ends within a few metres of its start is a loop too", () => {
    expect(towardsOf(k13, 0).towards).toEqual(["ΕΠΑΛ-ΙΕΚ"]);
    expect(towardsOf(k13, 1).towards).toEqual(["ΕΠΑΛ-ΙΕΚ"]);
  });

  it("a terminus without a place name (ΑΦΕΤΗΡΙΑ): the last named stop before it", () => {
    expect(towardsOf(k13, 2).towards).toEqual(["ΒΑΝ ΦΛΥΤ"]);
    expect(towardsOf(k13, 3).towards).toEqual(["ΒΑΝ ΦΛΥΤ"]);
    expect(towardsOf(k13, 4).towards).toEqual(["ΒΑΝ ΦΛΥΤ"]);
    expect(towardsOf(k13, 5).towards).toEqual([]);   // no named stop left after it
  });
});

describe("towardsOf / towardsOfId / towardsText", () => {
  it("names stay in capitals, without accents (capitals take none in Greek), abbreviations as they are", () => {
    const t: TripIndex = {
      v: "t",
      s: [["Κ", 37.98, 23.75, "0"], ["Μουσείο Ακρόπολης", 37.97, 23.75, "1"], ["ΑΓ. ΠΑΡΑΣΚΕΥΗ", 37.99, 23.75, "2"]],
      l: { a: { v: [0, 1] }, b: { v: [0, 1] }, c: { v: [0, 2] } },
    };
    t.d = stopDirections(t);
    expect(towardsOf(t, 0).towards).toEqual(["ΜΟΥΣΕΙΟ ΑΚΡΟΠΟΛΗΣ", "ΑΓ. ΠΑΡΑΣΚΕΥΗ"]);
  });

  it("an index without directions (an older trips.json) gives nothing", () => {
    const old: TripIndex = { v: "t", s: ix.s, l: ix.l };
    expect(towardsOf(old, 0)).toEqual({ bearing: null, towards: [] });
  });

  it("finds a stop by its /v2 id (oasa:<GTFS id>); other ids and no index: null", () => {
    expect(towardsOfId(ix, "oasa:770021")).toEqual(towardsOf(ix, 0));
    expect(towardsOfId(ix, "oasa:nope")).toBeNull();
    expect(towardsOfId(ix, "stasy:770021")).toBeNull();
    expect(towardsOfId(null, "oasa:770021")).toBeNull();
  });

  it("writes «προς X · Y», empty with no names", () => {
    expect(towardsText(["ΜΟΥΣΕΙΟ", "ΕΡΥΘΡΟΣ ΣΤΑΥΡΟΣ"])).toBe("προς ΜΟΥΣΕΙΟ · ΕΡΥΘΡΟΣ ΣΤΑΥΡΟΣ");
    expect(towardsText(["ΜΟΥΣΕΙΟ"])).toBe("προς ΜΟΥΣΕΙΟ");
    expect(towardsText([])).toBe("");
  });
});

// Every city's stop index (scripts/trips.ts writes public/trips*.json) carries the directions, one entry per stop.
describe("public/trips*.json", () => {
  const dir = new URL("../public/", import.meta.url);
  const files = readdirSync(dir).filter(f => /^trips(-[a-z]+)?\.json$/.test(f));
  it("finds the Athens and Thessaloniki files", () => expect(files).toEqual(expect.arrayContaining(["trips.json", "trips-thessaloniki.json"])));
  it.each(files)("%s has directions for every stop", f => {
    const ix: TripIndex = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
    expect(ix.d?.s).toHaveLength(ix.s.length);
    // A small citybus.gr network often ends its lines at a stop named only «ΑΦΕΤΗΡΙΑ»/«ΤΕΡΜΑ», which names no
    // place (Skiathos: 38%): the 80% bar holds for Athens and Thessaloniki only.
    const share = f === "trips.json" || f === "trips-thessaloniki.json" ? 0.8 : 0.3;
    expect(ix.s.filter((_, i) => towardsOf(ix, i).towards.length).length).toBeGreaterThan(ix.s.length * share);
  });
});
