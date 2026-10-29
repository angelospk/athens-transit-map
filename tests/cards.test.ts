import { beforeEach, describe, expect, it } from "vitest";
import { CardNav, MAX_DEPTH, cardFromQuery, cardQuery, pushCard, sameCard, type Card, type Hist } from "../src/lib/cards";

const stop = (id: string, title?: string): Card => ({ kind: "stop", id, ...(title ? { title } : {}) });
const line = (id: string, extra: Partial<Extract<Card, { kind: "line" }>> = {}): Card => ({ kind: "line", id, ...extra });
const vehicle = (id: string, l: string): Card => ({ kind: "vehicle", id, line: l });

describe("pushCard", () => {
  it("adds a new card on top", () => {
    expect(pushCard([stop("a")], line("l"))).toEqual([stop("a"), line("l")]);
  });
  it("truncates back to a card already in the stack, which takes the new card's details", () => {
    const s = [vehicle("v", "l"), stop("s"), line("l")];
    expect(pushCard(s, stop("s", "Σύνταγμα"))).toEqual([vehicle("v", "l"), stop("s", "Σύνταγμα")]);
  });
  it("matches a card by kind and id only", () => {
    expect(sameCard(line("l", { dir: 0 }), line("l", { dir: 1 }))).toBe(true);
    expect(sameCard(stop("x"), line("x"))).toBe(false);
  });
  it(`keeps at most ${MAX_DEPTH} cards, dropping the oldest`, () => {
    let s: Card[] = [];
    for (let i = 0; i < MAX_DEPTH + 2; i++) s = pushCard(s, stop(`s${i}`));
    expect(s).toHaveLength(MAX_DEPTH);
    expect(s[0].id).toBe("s2");
    expect(s[MAX_DEPTH - 1].id).toBe(`s${MAX_DEPTH + 1}`);
  });
});

describe("deep links", () => {
  it("reads the top card from the query", () => {
    expect(cardFromQuery("?stop=oasa%3A400012")).toEqual(stop("oasa:400012"));
    expect(cardFromQuery("?line=stasy%3AM2&dir=1")).toEqual(line("stasy:M2", { dir: 1 }));
    expect(cardFromQuery("?line=oasa%3A040&dir=7")).toEqual(line("oasa:040"));
    expect(cardFromQuery("?vehicle=oasa%3A12216&line=oasa%3A021")).toEqual(vehicle("oasa:12216", "oasa:021"));
  });
  it("needs a vehicle's line, and has no card without a known key", () => {
    expect(cardFromQuery("?vehicle=oasa%3A12216")).toBeNull();
    expect(cardFromQuery("?l=040,%CE%911")).toBeNull();
    expect(cardFromQuery("")).toBeNull();
    expect(cardFromQuery("?stop=")).toBeNull();
  });
  it("writes the picked lines first, then the top card, ids percent-encoded", () => {
    expect(cardQuery(null, [])).toBe("");
    expect(cardQuery(null, ["040", "Α1"])).toBe("?l=040,%CE%911");
    expect(cardQuery(stop("oasa:400012"), [])).toBe("?stop=oasa%3A400012");
    expect(cardQuery(line("stasy:M2", { dir: 1, pattern: "p" }), ["040"])).toBe("?l=040&line=stasy%3AM2&dir=1");
    expect(cardQuery(vehicle("oasa:1", "oasa:021"), [])).toBe("?line=oasa%3A021&vehicle=oasa%3A1");
  });
  it("round-trips every card kind", () => {
    for (const c of [stop("stasy:συνταγμα-metro"), line("proastiakos:PIRAIR", { dir: 0 }), vehicle("stasy:run:1:2026-10-29", "stasy:M1")])
      expect(cardFromQuery(cardQuery(c, ["040"]))).toEqual(c);
  });
});

// A browser history in memory: go() moves at once and queues the popstate, as browsers do.
class FakeHistory implements Hist {
  entries: { state: unknown; url: string }[] = [{ state: null, url: "/" }];
  i = 0;
  queued = false;
  get state() { return this.entries[this.i].state; }
  get url() { return this.entries[this.i].url; }
  pushState(state: unknown, _: string, url: string) {
    this.entries = [...this.entries.slice(0, this.i + 1), { state, url }];
    this.i++;
  }
  replaceState(state: unknown, _: string, url: string) { this.entries[this.i] = { state, url }; }
  go(n: number) {
    const to = Math.max(0, Math.min(this.entries.length - 1, this.i + n));
    if (to === this.i) return;
    this.i = to;
    this.queued = true;
  }
  back() { this.go(-1); }
}

describe("CardNav", () => {
  let h: FakeHistory, nav: CardNav, seen: Card[][];
  // Delivers the popstate the last go() queued.
  const pop = () => { if (h.queued) { h.queued = false; nav.popped(h.state); } };
  beforeEach(() => {
    h = new FakeHistory();
    seen = [];
    nav = new CardNav(h, s => seen.push(s), s => (s.length ? `/?top=${s[s.length - 1].id}` : "/"));
  });

  it("starts with no card and leaves the page's entry alone", () => {
    nav.start(null);
    expect(nav.stack).toEqual([]);
    expect(h.entries).toHaveLength(1);
  });
  it("opens a deep link's card above the page's entry, so Back closes it", () => {
    nav.start(stop("s"));
    expect(nav.stack).toEqual([stop("s")]);
    expect(h.entries.map(e => e.url)).toEqual(["/", "/?top=s"]);
    nav.back(); pop();
    expect(nav.stack).toEqual([]);
    expect(h.i).toBe(0);
  });
  it("vehicle → stop → line → Back → Back returns to the vehicle (web#10)", () => {
    nav.start(null);
    nav.open(vehicle("v", "l"));
    nav.push(stop("s"));
    nav.push(line("l"));
    expect(nav.stack.map(c => c.id)).toEqual(["v", "s", "l"]);
    expect(h.entries).toHaveLength(4);
    nav.back(); pop();
    expect(nav.stack.map(c => c.id)).toEqual(["v", "s"]);
    nav.back(); pop();
    expect(nav.stack).toEqual([vehicle("v", "l")]);
    expect(h.url).toBe("/?top=v");
    expect(seen[seen.length - 1]).toEqual([vehicle("v", "l")]);
  });
  it("the browser's own Back and Forward move through the same cards", () => {
    nav.start(null);
    nav.open(stop("a"));
    nav.push(stop("b"));
    h.go(-1); pop();
    expect(nav.stack.map(c => c.id)).toEqual(["a"]);
    h.go(1); pop();
    expect(nav.stack.map(c => c.id)).toEqual(["a", "b"]);
  });
  it("a map tap starts a fresh stack: one Back then closes it", () => {
    nav.start(null);
    nav.open(stop("a"));
    nav.push(stop("b"));
    nav.push(stop("c"));
    nav.open(line("x")); pop();
    expect(nav.stack).toEqual([line("x")]);
    expect(h.i).toBe(1);
    expect(h.url).toBe("/?top=x");
    nav.back(); pop();
    expect(nav.stack).toEqual([]);
    expect(h.i).toBe(0);
  });
  it("a map tap on a single card replaces it in place", () => {
    nav.start(null);
    nav.open(stop("a"));
    nav.open(stop("b"));
    expect(nav.stack).toEqual([stop("b")]);
    expect(h.entries).toHaveLength(2);
  });
  it("pushing a card already in the stack goes back to it", () => {
    nav.start(null);
    nav.open(vehicle("v", "l"));
    nav.push(stop("s"));
    nav.push(line("l"));
    nav.push(stop("s", "Σ")); pop();
    expect(nav.stack).toEqual([vehicle("v", "l"), stop("s", "Σ")]);
    expect(h.i).toBe(2);
    expect(h.entries[2].state).toMatchObject({ cards: [vehicle("v", "l"), stop("s", "Σ")] });
  });
  it("pushing the top card again updates it without a new entry", () => {
    nav.start(null);
    nav.open(line("l", { dir: 0 }));
    nav.push(line("l", { dir: 1 }));
    expect(nav.stack).toEqual([line("l", { dir: 1 })]);
    expect(h.entries).toHaveLength(2);
  });
  it("× clears the whole stack in one step", () => {
    nav.start(null);
    nav.open(stop("a"));
    nav.push(stop("b"));
    nav.push(stop("c"));
    nav.close(); pop();
    expect(nav.stack).toEqual([]);
    expect(h.i).toBe(0);
    nav.close();   // nothing open: nothing happens
    expect(h.queued).toBe(false);
  });
  it("a deep stack keeps its last cards, and Back still steps one at a time", () => {
    nav.start(null);
    nav.open(stop("s0"));
    for (let i = 1; i < MAX_DEPTH + 2; i++) nav.push(stop(`s${i}`));
    expect(nav.stack).toHaveLength(MAX_DEPTH);
    nav.back(); pop();
    expect(nav.stack[nav.stack.length - 1].id).toBe(`s${MAX_DEPTH}`);
    nav.close(); pop();
    expect(nav.stack).toEqual([]);
    expect(h.i).toBe(0);
  });
  it("names the top card once its data is in, in the stack and in its entry", () => {
    nav.start(stop("s"));
    nav.retitle("Σύνταγμα");
    expect(nav.stack).toEqual([stop("s", "Σύνταγμα")]);
    expect(h.state).toMatchObject({ cards: [stop("s", "Σύνταγμα")] });
    nav.close(); pop();
    nav.retitle("x");   // no card: nothing to name
    expect(nav.stack).toEqual([]);
  });
  it("an entry it did not write (another page state) reads as no card", () => {
    nav.start(null);
    nav.open(stop("a"));
    nav.popped({ something: "else" });
    expect(nav.stack).toEqual([]);
  });
});
