import { describe, expect, it } from "vitest";
import { greeklish, greeklishKeys, hasLatin } from "../src/lib/search";

// The Greek name and the Greeklish query fold to one key; a query matches the names whose key holds its own.
const same = (greek: string, ...latin: string[]) => {
  for (const q of latin) expect(greeklish(q), `${q} ~ ${greek}`).toBe(greeklish(greek));
};

describe("greeklish", () => {
  it("matches the common spellings of a Greek name", () => {
    same("Σύνταγμα", "syntagma", "sintagma", "SYNTAGMA");
    same("Κηφισιά", "kifisia", "kifissia", "kifisia");
    same("Θησείο", "thiseio", "thisio");
    expect(greeklish("8η ΨΥΧΙΚΟΥ").startsWith(greeklish("thi"))).toBe(false);   // a number, not θ
    same("Χαλάνδρι", "chalandri", "halandri", "xalandri");
    same("Ομόνοια", "omonoia", "omonia");
    same("Πειραιάς", "peiraias", "pireas", "piraias");
    same("Ευαγγελισμός", "evaggelismos", "evangelismos", "euaggelismos");
    same("Αμπελόκηποι", "ampelokipoi", "abelokipi", "ambelokipoi");
    same("Βύρωνας", "vyronas", "vironas", "byronas");
    same("Ψυχικό", "psychiko", "psixiko");
    same("Εξάρχεια", "exarcheia", "eksarxeia", "exarxia");
    same("Μοσχάτο", "moschato", "mosxato");
    same("Ευκαρπία", "efkarpia", "eukarpia");
    same("Ντάβαρη", "davari", "ntavari");
    same("Γλυφάδα", "glyfada", "glifada");
    same("Μουσείο", "mouseio", "musio");
    same("Αφροδίτης", "afroditis", "aphroditis");
  });
  it("finds the name while it is typed, also when the last letter starts a pair (nt, mp, ou...)", () => {
    const finds = (name: string, typed: string) => greeklishKeys(typed).some(k => greeklish(name).startsWith(k));
    for (const [name, word] of [["ΣΥΝΤΑΓΜΑ", "syntagma"], ["ΑΜΠΕΛΟΚΗΠΟΙ", "ampelokipoi"], ["ΜΟΥΣΕΙΟ", "mouseio"],
      ["ΘΗΣΕΙΟ", "thiseio"], ["ΧΑΛΑΝΔΡΙ", "chalandri"], ["ΕΥΑΓΓΕΛΙΣΜΟΣ", "evangelismos"], ["ΑΦΡΟΔΙΤΗΣ", "aphroditis"],
      ["ΑΦΙΔΝΕΣ", "aphidnes"], ["ΑΦΙΔΝΕΣ", "afidnes"], ["ΕΥΚΑΡΠΙΑ", "efkarpia"]] as const)
      for (let n = 1; n <= word.length; n++) expect(finds(name, word.slice(0, n)), `${word.slice(0, n)} ~ ${name}`).toBe(true);
  });
  it("keeps word breaks, so a word start is still one", () => {
    expect(greeklish("ΠΛ. ΣΥΝΤΑΓΜΑΤΟΣ")).toBe(`pl. ${greeklish("syntagmatos")}`);
  });
  it("tells a Latin query from a Greek one or a number", () => {
    expect(hasLatin("syntagma")).toBe(true);
    expect(hasLatin("Σύνταγμα")).toBe(false);
    expect(hasLatin("040")).toBe(false);
  });
});
