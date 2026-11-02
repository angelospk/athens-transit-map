import { describe, expect, it } from "vitest";
import { nearbyGroups, focusLines, onOpen, distText, titleCase, walkMin, foldRows, rowNote } from "../src/lib/nearby";
import type { TripIndex } from "../src/lib/trip";

// 0 and 1: one stop on both sides of a street (~44 m apart), 2: the same name 1.1 km away,
// 3: another name ~14 m from 0, 4: a stop with no GTFS id, 5: far away (~11 km).
const ix: TripIndex = {
  v: "t",
  s: [
    ["Άγιος Νικόλαος", 37.98, 23.7, "100"],
    ["ΑΓΙΟΣ ΝΙΚΟΛΑΟΣ", 37.9804, 23.7, "101"],
    ["Άγιος Νικόλαος", 37.99, 23.7, "102"],
    ["Πλατεία", 37.9801, 23.7001, "103"],
    ["Χωρίς id", 37.981, 23.7, undefined],
    ["Μακριά", 38.08, 23.7, "105"],
  ],
  l: {
    "040": { a: [0, 3], b: [1] },
    "10": { c: [3, 0, 2] },
    "Α1": { d: [2] },
    "B2": { e: [4] },
  },
};
const at: [number, number] = [37.98, 23.7];   // [lat, lon], on stop 0

describe("nearbyGroups", () => {
  it("merges stops of one name close together (both sides of the street), nearest first", () => {
    const g = nearbyGroups(ix, at, { radiusM: 2000 });
    expect(g.map(x => x.ids)).toEqual([["100", "101"], ["103"], ["102"]]);
    expect(g[0].name).toBe("Άγιος Νικόλαος");   // the nearest stop's spelling
    expect(g[0].m).toBe(0);
    expect(g[1].m).toBe(14);                    // whole metres to the nearest stop of the group
  });

  it("lists the lines of every stop in the group, once each, in Greek numeric order", () => {
    const g = nearbyGroups(ix, at, { radiusM: 2000 });
    expect(g[0].lines).toEqual(["10", "040"]);
    expect(g[2].lines).toEqual(["10", "Α1"]);
  });

  it("keeps only stops within the radius and only the first max groups", () => {
    expect(nearbyGroups(ix, at, { radiusM: 500 }).map(x => x.ids)).toEqual([["100", "101"], ["103"]]);
    expect(nearbyGroups(ix, at, { radiusM: 2000, max: 1 }).map(x => x.ids)).toEqual([["100", "101"]]);
  });

  it("leaves out stops with no GTFS id (their card cannot open)", () => {
    expect(nearbyGroups(ix, at, { radiusM: 2000 }).flatMap(x => x.ids)).not.toContain(undefined);
  });

  it("does not merge the same name further apart than mergeM", () => {
    const g = nearbyGroups(ix, at, { radiusM: 2000, mergeM: 30 });
    expect(g.map(x => x.ids)).toEqual([["100"], ["103"], ["101"], ["102"]]);
  });

  it("defaults: 1000 m, 5 groups", () => {
    expect(nearbyGroups(ix, at).map(x => x.ids)).toEqual([["100", "101"], ["103"]]);
  });

  it("is empty far from every stop", () => {
    expect(nearbyGroups(ix, [40.6, 22.9])).toEqual([]);
  });
});

describe("focusLines", () => {
  it("the lines of the first n groups, once each", () => {
    const g = nearbyGroups(ix, at, { radiusM: 2000 });
    expect(focusLines(g, 2).sort()).toEqual(["040", "10"]);
    expect(focusLines(g, 3).sort()).toEqual(["040", "10", "Α1"]);
    expect(focusLines([], 3)).toEqual([]);
  });
});

describe("onOpen", () => {
  it("a link to a card or lines: the page opens on that, not on «Κοντά σου»", () => {
    expect(onOpen({ linked: true, perm: "granted", asked: false })).toBe("none");
    expect(onOpen({ linked: true, perm: "prompt", asked: false })).toBe("none");
  });
  it("location allowed: load at once", () => {
    expect(onOpen({ linked: false, perm: "granted", asked: true })).toBe("load");
  });
  it("location refused: nothing", () => {
    expect(onOpen({ linked: false, perm: "denied", asked: false })).toBe("none");
  });
  it("not decided yet: ask by itself the first time only, then a button", () => {
    expect(onOpen({ linked: false, perm: "prompt", asked: false })).toBe("ask");
    expect(onOpen({ linked: false, perm: "prompt", asked: true })).toBe("button");
  });
  it("no Permissions API (unknown): the last answer this browser gave decides", () => {
    expect(onOpen({ linked: false, perm: "unknown", asked: true, last: "granted" })).toBe("load");
    expect(onOpen({ linked: false, perm: "unknown", asked: true, last: "denied" })).toBe("none");
    expect(onOpen({ linked: false, perm: "granted", asked: true, last: "denied" })).toBe("load");   // the API wins
  });
  it("no Permissions API (unknown) and no answer yet counts as not decided", () => {
    expect(onOpen({ linked: false, perm: "unknown", asked: false })).toBe("ask");
    expect(onOpen({ linked: false, perm: "unknown", asked: true })).toBe("button");
  });
});

describe("distText", () => {
  it("metres in tens under 1 km, then km with one decimal and a Greek comma", () => {
    expect(distText(0)).toBe("0 μ");
    expect(distText(14)).toBe("10 μ");
    expect(distText(126)).toBe("130 μ");
    expect(distText(995)).toBe("1 χλμ");
    expect(distText(1240)).toBe("1,2 χλμ");
  });
});

describe("titleCase", () => {
  it("OASA's capitals as a name: first letter of each word up, the rest down, final sigma kept", () => {
    expect(titleCase("ΠΛ. ΚΥΨΕΛΗΣ")).toBe("Πλ. Κυψελης");
    expect(titleCase("ΠΛ ΚΥΨΕΛΗΣ (ΤΕΡΜΑ 036)")).toBe("Πλ Κυψελης (Τερμα 036)");
    expect(titleCase("ΣΤ.ΚΑΤΕΧΑΚΗ-ΓΑΛΑΤΣΙ")).toBe("Στ.Κατεχακη-Γαλατσι");
    expect(titleCase("Ήδη γραμμένο")).toBe("Ήδη γραμμένο");   // words not in capitals are left as they are
    expect(titleCase("ΚΑΙΣΑΡΙΑΝΗ (Προσωρινή λόγω έργων)")).toBe("Καισαριανη (Προσωρινή λόγω έργων)");
    expect(titleCase("Α ΚΥΨΕΛΗ")).toBe("Α Κυψελη");
    expect(titleCase("ΑΣ ΠΑΜΕ")).toBe("Ας Παμε");   // a final sigma in a two-letter word
  });
});

describe("walkMin", () => {
  it("minutes on foot at 80 m a minute, at least 1", () => {
    expect(walkMin(0)).toBe(1);
    expect(walkMin(230)).toBe(3);
    expect(walkMin(1000)).toBe(13);
  });
});

describe("foldRows", () => {
  const r = (line: string) => ({ line });
  it("closed: the first n rows, then the other lines (rows first, then the quiet ones), once each", () => {
    expect(foldRows([r("oasa:1"), r("oasa:2"), r("oasa:3")], ["9"], 2, false)).toEqual({ shown: [r("oasa:1"), r("oasa:2")], rest: ["3", "9"], more: true });
  });
  it("a third bus of a line already shown still needs the toggle", () => {
    expect(foldRows([r("oasa:1"), r("oasa:2"), r("oasa:1")], [], 2, false)).toEqual({ shown: [r("oasa:1"), r("oasa:2")], rest: [], more: true });
  });
  it("nothing more to show: no toggle", () => {
    expect(foldRows([r("oasa:1")], [], 2, false)).toEqual({ shown: [r("oasa:1")], rest: [], more: false });
  });
  it("open: every row, and the toggle to close it", () => {
    expect(foldRows([r("oasa:1"), r("oasa:2"), r("oasa:3")], [], 2, true)).toEqual({ shown: [r("oasa:1"), r("oasa:2"), r("oasa:3")], rest: [], more: true });
  });
});

describe("rowNote", () => {
  it("live and late by 2 minutes or more, live on time, live with no delay known, timetable", () => {
    expect(rowNote({ live: true, delay_s: 180 })).toEqual({ text: "αργεί 3′", tone: "late" });
    expect(rowNote({ live: true, delay_s: 60 })).toEqual({ text: "στην ώρα του", tone: "ok" });
    expect(rowNote({ live: true, delay_s: null })).toEqual({ text: "ζωντανά", tone: "muted" });
    expect(rowNote({ live: false, delay_s: null })).toEqual({ text: "από το πρόγραμμα", tone: "muted" });
  });
});
