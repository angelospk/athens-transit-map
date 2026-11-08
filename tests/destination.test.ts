import { describe, expect, it } from "vitest";
import { destination, endOf, lineDestinations, variantEnds, withDestinations, type VariantEnds } from "../src/lib/destination";
import { destinationOf, headTo, lineTowardAt } from "../src/lib/stops";
import type { TripIndex } from "../src/lib/trip";
import type { LineStatic } from "../src/lib/types";

// Real names and stop names from the static data (2026-11-08).
describe("destination: the name cut at one dash into two ends, each matched to the map's end of the variant", () => {
  it("02Κ Thessaloniki: «ΚΤΕΛ-ΜΑΚΕΔΟΝΙΑ» is one place, ΙΚΕΑ the other end", () => {
    const ikea = ["ΑΝΑΤΟΛΙΚΟΣ ΣΤΑΘΜΟΣ ΙΚΕΑ A"], ktel = ["Τ.Σ. Κ.Τ.Ε.Λ  A"];
    expect(destination("ΙΚΕΑ-ΚΤΕΛ-ΜΑΚΕΔΟΝΙΑ", ikea, ktel)).toBe("ΚΤΕΛ-ΜΑΚΕΔΟΝΙΑ");
    expect(destination("ΙΚΕΑ-ΚΤΕΛ-ΜΑΚΕΔΟΝΙΑ", ktel, ikea)).toBe("ΙΚΕΑ");
  });

  it("02Κ with its real headsigns, in either order: the data says which end", () => {
    const ikea = ["ΑΝΑΤΟΛΙΚΟΣ ΣΤΑΘΜΟΣ ΙΚΕΑ A"], ktel = ["Τ.Σ. Κ.Τ.Ε.Λ  A"];
    expect(destination("Α.Σ.ΙΚΕΑ-Κ.Τ.Ε.Λ ΜΑΚΕΔΟΝΙΑ", ikea, ktel)).toBe("Κ.Τ.Ε.Λ ΜΑΚΕΔΟΝΙΑ");
    expect(destination("Κ.Τ.Ε.Λ ΜΑΚΕΔΟΝΙΑ - Α.Σ.ΙΚΕΑ", ktel, ikea)).toBe("Α.Σ.ΙΚΕΑ");
    // The line's name runs ΙΚΕΑ → ΚΤΕΛ; the variant runs the other way: the data wins.
    expect(destination("Α.Σ.ΙΚΕΑ-Κ.Τ.Ε.Λ ΜΑΚΕΔΟΝΙΑ", ktel, ikea)).toBe("Α.Σ.ΙΚΕΑ");
  });

  it("Thessaloniki 12: a weekday after the end is not part of it", () => {
    expect(destination("ΚΑΤΩ ΤΟΥΜΠΑ - ΚΤΕΛ-ΔΕΥΤΕΡΑ", ["Τ.Σ. ΚΑΤΩ ΤΟΥΜΠΑΣ"], ["Τ.Σ. Κ.Τ.Ε.Λ  A"])).toBe("ΚΤΕΛ");
  });

  it("Thessaloniki 01N/1N: «ΝΥΧΤΕΡΙΝΟ» (night) is not a place", () => {
    expect(destination("ΕΥΚΑΡΠΙΑ - Κ.Τ.Ε.Λ. ΝΥΧΤΕΡΙΝΟ", ["Τ.Σ. ΕΥΚΑΡΠΙΑΣ"], ["Τ.Σ. Κ.Τ.Ε.Λ  A"])).toBe("Κ.Τ.Ε.Λ.");
    expect(destination("Κ.Τ.Ε.Λ. - ΑΕΡΟΔΡΟΜΙΟ - ΝΥΧΤΕΡΙΝΟ", ["Τ.Σ. Κ.Τ.Ε.Λ  A"], ["ΑΕΡΟΔΡΟΜΙΟ ΜΑΚΕΔΟΝΙΑ - ΑΦΙΞΕΙΣ"])).toBe("ΑΕΡΟΔΡΟΜΙΟ");
  });

  it("three parts: the middle one is a place on the way (Athens 115, Thessaloniki 58)", () => {
    expect(destination("ΚΙΤΣΙ - ΒΟΥΛΙΑΓΜΕΝΗ - ΓΛΥΦΑΔΑ", ["ΚΙΤΣΙ"], ["ΓΛΥΦΑΔΑ"])).toBe("ΓΛΥΦΑΔΑ");
    expect(destination("ΓΛΥΦΑΔΑ - ΒΟΥΛΙΑΓΜΕΝΗ - ΚΙΤΣΙ", ["ΓΛΥΦΑΔΑ"], ["ΚΙΤΣΙ"])).toBe("ΚΙΤΣΙ");
    expect(destination("ΒΕΝΙΖΕΛΟΥ - ΠΑΝΟΡΑΜΑ - ΔΙΑΣΤΑΥΡΩΣΗ ΧΟΡΤΙΑΤΗ", ["Τ.Σ. ΒΕΝΙΖΕΛΟΥ"],
      ["ΣΤΑΘΜΟΣ ΜΕΤΕΠΙΒΙΒΑΣΗΣ ΔΙΑΣΤΑΥΡΩΣΗ ΧΟΡΤΙΑΤΗ"])).toBe("ΔΙΑΣΤΑΥΡΩΣΗ ΧΟΡΤΙΑΤΗ");
  });

  it("Athens 4: a remark in brackets is left out of the end", () => {
    expect(destination("ΣΤ. ΑΓ. ΙΩΑΝΝΗΣ - ΑΓ. ΑΡΤΕΜΙΟΣ - ΑΝΩ ΚΥΨΕΛΗ (ΠΡΟΣΩΡΙΝΗ ΛΟΓΩ ΕΡΓΩΝ)",
      ["ΣΤ. ΜΕΤΡΟ ΑΓ. ΙΩΑΝΝΗΣ"], ["ΑΝΩ ΚΥΨΕΛΗ"])).toBe("ΑΝΩ ΚΥΨΕΛΗ");
  });

  it("citybus.gr cities: Larissa, Heraklion, Alexandroupoli", () => {
    expect(destination("ΠΛ.ΤΟΥΜΠΑΣ - ΩΔΕΙΟ", ["ΠΛΑΤΕΙΑ ΤΟΥΜΠΑΣ"], ["ΩΔΕΙΟ"])).toBe("ΩΔΕΙΟ");
    expect(destination("Κ.ΠΛΑΤΕΙΑ - ΜΟΥΣΙΚΟ ΓΥΜΝΑΣΙΟ", ["ΚΕΝΤΡΙΚΗ ΠΛΑΤΕΙΑ ΓΡ. 7, 10"], ["ΜΟΥΣΙΚΟ ΓΥΜΝΑΣΙΟ"])).toBe("ΜΟΥΣΙΚΟ ΓΥΜΝΑΣΙΟ");
    expect(destination("ΜΟΥΣΙΚΟ ΓΥΜΝΑΣΙΟ - Κ. ΠΛΑΤΕΙΑ", ["ΜΟΥΣΙΚΟ ΓΥΜΝΑΣΙΟ"], ["ΚΕΝΤΡΙΚΗ ΠΛΑΤΕΙΑ ΓΡ. 7, 10"])).toBe("Κ. ΠΛΑΤΕΙΑ");
    expect(destination("ΛΙΜΑΝΙ - ΓΑΖΙ", ["ΤΣ ΛΙΜΑΝΙ"], ["ΤΣ ΓΑΖΙ"])).toBe("ΓΑΖΙ");
    expect(destination("ΠΟΙΜΕΝΙΔΗ - ΔΙΚΕΛΛΑ", ["ΠΟΙΜΕΝΙΔΗ ΠΡΟΣ ΚΕΝΤΡΟ"], ["ΠΛΑΤΕΙΑ ΔΙΚΕΛΛΩΝ"])).toBe("ΔΙΚΕΛΛΑ");
  });

  it("one end is enough when the start stop names no place (Ptolemaida 10, Arta 01, Thessaloniki 11)", () => {
    expect(endOf("ΠΤΟΛΕΜΑIΔΑ - ΦΟΥΦΑΣ", ["ΑΦEΤΗΡΙΑ"], ["ΤEΡΜΑ ? ΔΗΜΟΤΙΚΟ ΣΧΟΛEΙΟ ΦΟΥΦΑ"])).toEqual({ name: "ΦΟΥΦΑΣ", one: true });
    expect(destination("ΑΡΤΑ-ΚΟΜΠΟΤΙ", ["ΠΛΑΤΕΙΑ ΚΑΡΑΙΣΚΑΚΗ"], ["ΤΕΡΜΑ ΚΟΜΠΟΤΙΟΥ"])).toBe("ΚΟΜΠΟΤΙ");
    // Named the other way round: the end the variant runs to is the name's start.
    expect(destination("ΠΑΝΕΠΙΣΤΗΜΙΟ - ΠΥΛΑΙΑ", ["Τ.Σ. ΠΥΛΑΙΑΣ"], ["Τ.Σ. ΣΙΝΤΡΙΒΑΝΙ"])).toBeNull();
    expect(destination("ΠΑΝΕΠΙΣΤΗΜΙΟ - ΠΥΛΑΙΑ-ΔΕΥΤΕΡΑ", ["Τ.Σ. ΣΙΝΤΡΙΒΑΝΙ"], ["Τ.Σ. ΠΥΛΑΙΑΣ"])).toBe("ΠΥΛΑΙΑ");
    // Both ends matched wins over one: 02Κ stays a two-end cut.
    expect(endOf("ΙΚΕΑ-ΚΤΕΛ-ΜΑΚΕΔΟΝΙΑ", ["ΑΝΑΤΟΛΙΚΟΣ ΣΤΑΘΜΟΣ ΙΚΕΑ A"], ["Τ.Σ. Κ.Τ.Ε.Λ  A"])).toEqual({ name: "ΚΤΕΛ-ΜΑΚΕΔΟΝΙΑ", one: false });
  });

  it("a variant that ends before the name's last place: the place where it ends (Athens 035)", () => {
    expect(destination("ΑΝΩ ΚΥΨΕΛΗ - ΠΕΤΡΑΛΩΝΑ - ΤΑΥΡΟΣ", ["ΑΝΩ ΚΥΨΕΛΗ"], ["ΠΕΤΡΑΛΩΝΑ"], ["ΤΑΥΡΟΣ"])).toBe("ΠΕΤΡΑΛΩΝΑ");
    // A dash with no space and no variant ending at the next piece: one place, kept whole.
    expect(destination("ΙΚΕΑ-ΚΤΕΛ-ΜΑΚΕΔΟΝΙΑ", ["ΙΚΕΑ"], ["Τ.Σ. Κ.Τ.Ε.Λ  A"], ["ΑΝΑΤΟΛΙΚΟΣ ΣΤΑΘΜΟΣ ΙΚΕΑ A"])).toBe("ΚΤΕΛ-ΜΑΚΕΔΟΝΙΑ");
  });

  it("no clear cut: as today (null)", () => {
    // Athens 212: neither end of the name is where the variant ends (ΑΓ. ΜΑΡΙΝΑ).
    expect(destination("ΣΤ. ΔΑΦΝΗ - ΥΜΗΤΤΟΣ - ΒΥΡΩΝΑΣ - ΚΑΡΕΑΣ", ["ΣΤ. ΔΑΦΝΗ"], ["ΑΓ. ΜΑΡΙΝΑ"])).toBeNull();
    // Ioannina 10: no dash, nothing to cut.
    expect(destination("ΚΑΡΔΑΜΗΤΣΙΑ ΠΑΝΕΠΙΣΤΗΜΙΟ", ["ΜΕΛΑΝΔΡΑ (ΑΦΕΤΗΡΙΑ)"], ["ΦΙΛΟΣΟΦΙΚΗ"])).toBeNull();
    // Lamia 02: the end is named after a shop, the start not at all.
    expect(destination("ΑΓΙΟΙ ΑΠΟΣΤΟΛΟΙ-ΚΑΤΩ ΚΑΛΥΒΙΑ", ["ΑΦΕΤΗΡΙΑ ( ΠΑΠΑΔΗΜΗΤΡΟΠΟΥΛΟΣ)"], ["ΑΦΕΤΗΡΙΑ (ΠΑΜΠΛΙΚ)"])).toBeNull();
    // One end matches and the rest of the name names where the variant ends: not clear.
    expect(destination("ΓΑΖΙ - ΛΙΜΑΝΙ", ["ΠΟΥΘΕΝΑ"], ["ΤΣ ΓΑΖΙ ΛΙΜΑΝΙ"])).toBeNull();
    // The end names the place where the variant starts too: not clear.
    expect(destination("ΛΙΜΑΝΙ - ΓΑΖΙ", ["ΑΦΕΤΗΡΙΑ ΓΑΖΙ"], ["ΤΣ ΓΑΖΙ"])).toBeNull();
    // Both ends match the same place: not clear.
    expect(destination("ΚΤΕΛ-ΑΝΘΗΛΗ-ΚΤΕΛ", ["ΚΤΕΛ"], ["ΚΤΕΛ"])).toBeNull();
  });
});

const ends = (id: string, headsign: string, first: string, last: string, start: [number, number], end: [number, number], loop = false): VariantEnds =>
  ({ id, headsign, first: [first], last: [last], start, end, loop });

describe("lineDestinations: every variant of a line", () => {
  const IKEA: [number, number] = [22.97, 40.6], KTEL: [number, number] = [22.91, 40.65];

  it("02Κ: both variants, from their own headsigns", () => {
    const r = lineDestinations("Α.Σ.ΙΚΕΑ-Κ.Τ.Ε.Λ ΜΑΚΕΔΟΝΙΑ", [
      ends("6212", "Α.Σ.ΙΚΕΑ-Κ.Τ.Ε.Λ ΜΑΚΕΔΟΝΙΑ", "ΑΝΑΤΟΛΙΚΟΣ ΣΤΑΘΜΟΣ ΙΚΕΑ A", "Τ.Σ. Κ.Τ.Ε.Λ  A", IKEA, KTEL),
      ends("6310", "Κ.Τ.Ε.Λ ΜΑΚΕΔΟΝΙΑ - Α.Σ.ΙΚΕΑ", "Τ.Σ. Κ.Τ.Ε.Λ  A", "ΑΝΑΤΟΛΙΚΟΣ ΣΤΑΘΜΟΣ ΙΚΕΑ A", KTEL, IKEA),
    ]);
    expect(r).toEqual({ "6212": "Κ.Τ.Ε.Λ ΜΑΚΕΔΟΝΙΑ", "6310": "Α.Σ.ΙΚΕΑ" });
  });

  it("the start of a variant is also where the other variants end", () => {
    // The start stop has no place name; the other variant ends there at a stop that has one.
    const r = lineDestinations("ΛΙΜΑΝΙ - ΓΑΖΙ", [
      ends("a", "ΛΙΜΑΝΙ - ΓΑΖΙ", "ΑΦΕΤΗΡΙΑ", "ΤΣ ΓΑΖΙ", [25.13, 35.34], [25.08, 35.33]),
      ends("b", "ΓΑΖΙ - ΛΙΜΑΝΙ", "ΤΣ ΓΑΖΙ", "ΤΣ ΛΙΜΑΝΙ", [25.08, 35.33], [25.1302, 35.3401]),
    ]);
    expect(r).toEqual({ a: "ΓΑΖΙ", b: "ΛΙΜΑΝΙ" });
  });

  it("a variant with no clear name takes the name of the place where it ends, when one name is found there", () => {
    const r = lineDestinations("ΛΙΜΑΝΙ - ΓΑΖΙ", [
      ends("a", "ΛΙΜΑΝΙ - ΓΑΖΙ", "ΤΣ ΛΙΜΑΝΙ", "ΤΣ ΓΑΖΙ", [25.13, 35.34], [25.08, 35.33]),
      ends("c", "ΓΑΖΙ ΝΕΟ", "ΠΟΥΘΕΝΑ", "ΤΕΡΜΑ", [25.2, 35.3], [25.0801, 35.3301]),
    ]);
    expect(r).toEqual({ a: "ΓΑΖΙ", c: "ΓΑΖΙ" });
  });

  it("a loop gets none: the stop card keeps its loop rule", () => {
    const r = lineDestinations("ΚΤΕΛ-ΑΝΘΗΛΗ-ΚΤΕΛ", [ends("l", "ΚΤΕΛ-ΑΝΘΗΛΗ", "ΚΤΕΛ", "ΚΤΕΛ", [22.4, 38.9], [22.4, 38.9], true)]);
    expect(r).toEqual({});
  });
});

describe("variantEnds: the ends of each variant from a line's static file", () => {
  it("names near the start and near the end, the end first; a variant back at its start is a loop", () => {
    const st: LineStatic = {
      id: "1",
      stops: {
        a: { name: "Α", lat: 40, lon: 22 }, b: { name: "Β", lat: 40.001, lon: 22 }, c: { name: "Γ", lat: 40.05, lon: 22 },
        d: { name: "Δ", lat: 40.0505, lon: 22 }, e: { name: "Ε", lat: 40.1, lon: 22 },
      },
      variants: {
        x: { headsign: "Α - Δ", direction: 0, shape: [], stops: ["a", "b", "c", "d"] },
        y: { headsign: "Α", direction: 0, shape: [], stops: ["a", "e", "a"] },
      },
    };
    const [x, y] = variantEnds(st);
    expect(x).toMatchObject({ id: "x", headsign: "Α - Δ", first: ["Α", "Β"], last: ["Δ", "Γ"], start: [22, 40], end: [22, 40.0505], loop: false });
    expect(y.loop).toBe(true);
  });
});

// One stop index with the ends built in: 02Κ both ways, stop 1 on both variants, a loop line.
const ix: TripIndex = {
  v: "t",
  s: [["ΙΚΕΑ", 40.6, 22.97, "1"], ["ΜΕΣΗ", 40.62, 22.94, "2"], ["Τ.Σ. Κ.Τ.Ε.Λ  A", 40.65, 22.91, "3"], ["ΜΕΣΗ", 40.6201, 22.9401, "4"]],
  l: { "02K": { "6212": [0, 1, 2], "6310": [2, 3, 0] }, "L": { o: [0, 1, 2, 0] } },
};
ix.d = withDestinations({ n: ["ΚΤΕΛ"], s: [[], [], [], []] }, { "02K": { "6212": "Κ.Τ.Ε.Λ ΜΑΚΕΔΟΝΙΑ", "6310": "Α.Σ.ΙΚΕΑ" } });

describe("the stop card reads the ends from the stop index", () => {
  it("withDestinations: the names into d.n (shared), by line and variant in d.h", () => {
    expect(ix.d!.n).toEqual(["ΚΤΕΛ", "Κ.Τ.Ε.Λ ΜΑΚΕΔΟΝΙΑ", "Α.Σ.ΙΚΕΑ"]);
    expect(ix.d!.h).toEqual({ "02K": { "6212": 1, "6310": 2 } });
  });

  it("destinationOf: the variant's end, null with none", () => {
    expect(destinationOf(ix, "02K", "6212")).toBe("Κ.Τ.Ε.Λ ΜΑΚΕΔΟΝΙΑ");
    expect(destinationOf(ix, "02K", "nope")).toBeNull();
    expect(destinationOf({ v: "t", s: [], l: {} }, "02K", "6212")).toBeNull();
  });

  it("headTo: the variant's end over the headsign; with none, the headsign as before", () => {
    expect(headTo(ix, "02K", "6212", 1, "Α.Σ.ΙΚΕΑ-Κ.Τ.Ε.Λ ΜΑΚΕΔΟΝΙΑ")).toEqual({ to: "Κ.Τ.Ε.Λ ΜΑΚΕΔΟΝΙΑ", back: false });
    expect(headTo(ix, "02K", "x", 1, "Α - Β")).toEqual({ to: "Β", back: false });
  });

  it("lineTowardAt: the line's end at a stop when its variants there agree; not at the end itself", () => {
    expect(lineTowardAt(ix, "02K", 1)).toBe("Κ.Τ.Ε.Λ ΜΑΚΕΔΟΝΙΑ");
    expect(lineTowardAt(ix, "02K", 3)).toBe("Α.Σ.ΙΚΕΑ");
    expect(lineTowardAt(ix, "02K", 0)).toBe("Κ.Τ.Ε.Λ ΜΑΚΕΔΟΝΙΑ");   // 6310 ends here, 6212 starts here
    expect(lineTowardAt(ix, "L", 1)).toBeNull();                       // a loop: no end
  });
});
