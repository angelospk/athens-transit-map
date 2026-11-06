import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { checkSources, sourceHash } from "../scripts/municipal-watch";

const sha = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");
const enc = (s: string) => new TextEncoder().encode(s);

describe("sourceHash", () => {
  it("a file: the hash of its bytes", () => {
    expect(sourceHash("file", enc("%PDF-1.4 abc"))).toBe(sha(enc("%PDF-1.4 abc")));
  });
  it("a page: the hash of its times only, so a new notice or banner is not a change", () => {
    const a = sourceHash("times", enc("<p>Αναχωρήσεις 7.30, 9:00</p><p>Νέα!</p>"));
    expect(a).toBe(sha("07:30,09:00"));
    expect(sourceHash("times", enc("<div>Άλλο banner</div> 07:30 · 09.00"))).toBe(a);
  });
});

describe("checkSources", () => {
  const table = (watch: { url: string; kind: "file" | "times"; sha256: string }[]) => ({ file: "x.json", municipality: "Δήμος Χ", watch });
  it("reports a changed source and an unreachable one, and nothing for the same", async () => {
    const pages: Record<string, string> = { "https://a/p": "Ώρες 07:30 09:00", "https://a/f.pdf": "PDF2" };
    const get = async (url: string) => (url in pages ? enc(pages[url]) : null);
    const out = await checkSources([table([
      { url: "https://a/p", kind: "times", sha256: sha("07:30,09:00") },
      { url: "https://a/f.pdf", kind: "file", sha256: sha(enc("PDF1")) },
      { url: "https://a/gone", kind: "file", sha256: sha("x") },
    ])], get);
    expect(out).toEqual([
      { file: "x.json", municipality: "Δήμος Χ", url: "https://a/f.pdf", status: "changed", now: sha(enc("PDF2")) },
      { file: "x.json", municipality: "Δήμος Χ", url: "https://a/gone", status: "unreachable", now: null },
    ]);
  });
  it("reports a watched file the source page no longer links to: a new timetable may be at a new address", async () => {
    const page = '<a href="/up/%CE%93%CE%A1%CE%91%CE%9C%CE%9C%CE%97_10.pdf">10</a> <a href="/up/ΔΡΟΜΟΛΟΓΙΟ1.pdf">x</a>';
    const pages: Record<string, string> = { "https://a/page": page, "https://a/up/ΓΡΑΜΜΗ_10.pdf": "P10", "https://a/up/1.pdf": "P1" };
    const get = async (url: string) => (url in pages ? enc(pages[url]) : null);
    const t = { ...table([
      { url: "https://a/up/ΓΡΑΜΜΗ_10.pdf", kind: "file", sha256: sha(enc("P10")) },
      { url: "https://a/up/1.pdf", kind: "file", sha256: sha(enc("P1")) },
    ]), source: "https://a/page" };
    expect(await checkSources([t], get)).toEqual([
      { file: "x.json", municipality: "Δήμος Χ", url: "https://a/up/1.pdf", status: "unlinked", now: null },
    ]);
    delete pages["https://a/page"];   // the page does not answer: no finding (its own watch reports it)
    expect(await checkSources([t], get)).toEqual([]);
  });
});
