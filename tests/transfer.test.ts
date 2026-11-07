import { describe, expect, it } from "vitest";
import { changeLine, changeMargin, changeWords, levelM, metroId, transferLook } from "../src/lib/transfer";

const SYNTAGMA: [number, number] = [23.7353, 37.9745];
const clock = (t: number) => new Date(t * 1000).toISOString().slice(11, 16);

describe("transfer", () => {
  it("knows a metro line by its label or id, and nothing else", () => {
    expect(metroId("metro", "Μ3")).toBe("M3");
    expect(metroId("metro", "Γραμμή", "stasy:M2")).toBe("M2");
    expect(metroId("metro", "1")).toBe("M1");
    expect(metroId("bus", "M3")).toBeNull();
    expect(metroId("metro", "Τ6")).toBeNull();
  });
  it("puts M3 under M2 at Syntagma (the published depths), M1 above M3 at Monastiraki, and the bus on the street", () => {
    const m2 = levelM("metro", "M2", SYNTAGMA, "", "ΣΥΝΤΑΓΜΑ"), m3 = levelM("metro", "M3", SYNTAGMA, "", "Σύνταγμα (Κέντρο)");
    expect([m2, m3]).toEqual([17, 28]);
    expect(levelM("metro", "M1", [23.7257, 37.9767], "", "Μοναστηράκι")).toBeLessThan(levelM("metro", "M3", [23.7257, 37.9767], "", "ΜΟΝΑΣΤΗΡΑΚΙ"));
    expect(levelM("metro", "M1", [23.79, 38.06], "", "ΜΑΡΟΥΣΙ")).toBe(0);
    expect(levelM("metro", "M3", [23.78, 37.99], "", "ΠΑΝΟΡΜΟΥ")).toBeGreaterThan(0);
    expect(levelM("bus", "309", SYNTAGMA)).toBe(0);
    const l = transferLook(m2, m3);
    expect(l).toMatchObject({ way: "down", under: true });
    expect(changeLine(l, "M3", "metro", 3)).toBe("Κατεβαίνεις στο M3 · 3′");
    expect(changeLine(transferLook(0, 0), "309", "bus", 0, 0)).toBe("Ίδια στάση");
  });
  it("says where to go: the line's signs and the platform, not «the same stop»", () => {
    const w = changeWords({ stop: "Σύνταγμα", next: "", toward: "Δ. Πλακεντίας", m: 0, min: 3, prev: { label: "M2", mode: "metro" }, label: "M3", mode: "metro" }, transferLook(50, 70));
    expect(w.map(x => `${x.t}${x.b ?? ""}${x.after ?? ""}`)).toEqual([
      "Βγες από το M2 και ακολούθησε τις πινακίδες για τη Γραμμή 3.", "Κατέβα στην αποβάθρα προς Δ. Πλακεντίας."]);
    const b = changeWords({ stop: "Αμαλίας", next: "Σύνταγμα", toward: "Δ. Πλακεντίας", m: 120, min: 6, prev: { label: "309", mode: "bus" }, label: "M3", mode: "metro" }, transferLook(0, 70));
    expect(b[0].t).toBe("Κατέβα στη στάση Αμαλίας και περπάτα 120 μ ως την είσοδο του σταθμού.");
    expect(b).toHaveLength(3);
    expect(`${b[2].t}${b[2].b}`).toBe("Αποβάθρα προς Δ. Πλακεντίας");
  });
  it("says a tight change means and what then", () => {
    const m = changeMargin(0, 2, { in_min: 9, arrive_at: 0 }, { what: "Το τρένο", at: "20:24", rail: true }, clock);
    expect(m).toEqual({ tone: "tight", big: "Σφιχτό: φεύγει μόλις φτάσεις", small: "Αν το χάσεις, το επόμενο σε 9′. Φτάνεις 00:00." });
    expect(changeMargin(4, 2, null, { what: "Το τρένο", at: "08:52", rail: true }, clock))
      .toEqual({ tone: "ok", big: "Άνετα: 4′ περιθώριο", small: "Το τρένο 08:52 σε περιμένει στην αποβάθρα." });
  });
});
