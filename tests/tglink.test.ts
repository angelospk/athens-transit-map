import { describe, expect, it } from "vitest";
import { decodeAlert, encodeAlert, MAX_PAYLOAD } from "../src/lib/tglink";
import type { TripIndex } from "../src/lib/trip";

const ix: TripIndex = {
  v: "2026-07-08",
  s: Array.from({ length: 60 }, (_, k) => [`S${k}`, 38, 23.7]),
  l: { "622": { "5433": [0, 1, 2, 3], "5432": [3, 2, 1, 0] }, "Α1": { "10": Array.from({ length: 50 }, (_, k) => k) }, "040": { "1": [5, 6] } },
};
const pick = (line: string, id: string, i: number) => ({ line, variants: [{ id, i }] });

describe("encodeAlert / decodeAlert", () => {
  it("round-trips lines, variants, boarding positions and n, in the link alphabet", () => {
    const lines = [{ line: "622", variants: [{ id: "5433", i: 2 }, { id: "5432", i: 1 }] }, pick("Α1", "10", 45)];
    const p = encodeAlert(ix, 3, lines)!;
    expect(p).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(p.length).toBeLessThanOrEqual(MAX_PAYLOAD);
    expect(decodeAlert(ix, p)).toEqual({ ok: true, n: 3, lines });
  });

  it("keeps the first entries that fit 64 characters", () => {
    const many = Array.from({ length: 20 }, (_, k) => ({ id: "10", i: k }));
    const p = encodeAlert(ix, 2, [{ line: "Α1", variants: many }])!;
    expect(p.length).toBeLessThanOrEqual(MAX_PAYLOAD);
    const d = decodeAlert(ix, p);
    expect(d.ok && d.lines[0].variants.map(v => v.i)).toEqual(Array.from({ length: 11 }, (_, k) => k));
  });

  it("gives null when nothing can be encoded", () => {
    expect(encodeAlert(ix, 3, [pick("999", "1", 0)])).toBeNull();
    expect(encodeAlert(ix, 3, [pick("622", "5433", 9)])).toBeNull();   // no stop 9
    expect(encodeAlert(ix, 9, [pick("622", "5433", 1)])).toBeNull();   // n out of range
    expect(encodeAlert(ix, 8, [pick("622", "5433", 1)])).toBeNull();
  });

  it("carries up to 7 stops ahead", () => {
    const p = encodeAlert(ix, 7, [pick("622", "5433", 2)])!;
    expect(decodeAlert(ix, p)).toMatchObject({ ok: true, n: 7 });
  });

  it("refuses links from other stop data and broken links", () => {
    const p = encodeAlert(ix, 3, [pick("622", "5433", 2)])!;
    expect(decodeAlert({ ...ix, v: "2026-10-08" }, p)).toEqual({ ok: false, why: "old" });
    for (const bad of ["", "x", p + "a", p.slice(0, -1), p.replace(/^1/, "2"), "1" + p.slice(1, 4) + "0" + p.slice(5), p + "!!!!!"])
      expect(decodeAlert(ix, bad).ok).toBe(false);
    const far = p.slice(0, 5) + "zz" + p.slice(7);   // line index out of range
    expect(decodeAlert(ix, far)).toEqual({ ok: false, why: "bad" });
  });

  it("merges entries of one line in order", () => {
    const p = encodeAlert(ix, 1, [pick("040", "1", 0), pick("622", "5432", 1)])!;
    const d = decodeAlert(ix, p);
    expect(d.ok && d.lines.map(l => l.line)).toEqual(["040", "622"]);
  });
});

describe("recurring alerts in the link", () => {
  const lines = [pick("622", "5433", 2)];
  const rep = { days: 31, start: 450, len: 60 };   // weekdays 07:30, for an hour

  it("round-trips days, start and length after a \"2\"", () => {
    const p = encodeAlert(ix, 2, lines, rep)!;
    expect(p[0]).toBe("2");
    expect(p).toMatch(/^[0-9a-z]+$/);
    expect(decodeAlert(ix, p)).toEqual({ ok: true, n: 2, lines, rep });
    expect(decodeAlert(ix, encodeAlert(ix, 2, lines)!)).toEqual({ ok: true, n: 2, lines });   // one-off: no rep
  });

  it("keeps the entries that fit next to the longer head", () => {
    const many = Array.from({ length: 20 }, (_, k) => ({ id: "10", i: k }));
    const p = encodeAlert(ix, 2, [{ line: "Α1", variants: many }], rep)!;
    expect(p.length).toBeLessThanOrEqual(MAX_PAYLOAD);
    const d = decodeAlert(ix, p);
    expect(d.ok && d.lines[0].variants).toHaveLength(10);
  });

  it("refuses a schedule it cannot keep", () => {
    for (const r of [{ days: 0, start: 450, len: 60 }, { days: 128, start: 450, len: 60 }, { days: 31, start: 452, len: 60 },
      { days: 31, start: 450, len: 50 }, { days: 31, start: 450, len: 0 }, { days: 31, start: 450, len: 255 }, { days: 31, start: 1410, len: 60 }])
      expect(encodeAlert(ix, 2, lines, r)).toBeNull();
    const p = encodeAlert(ix, 2, lines, rep)!;
    expect(decodeAlert(ix, p.slice(0, 5) + "00" + p.slice(7)).ok).toBe(false);   // no days
  });
});
