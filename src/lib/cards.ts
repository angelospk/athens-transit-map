// Card stack: the cards open over the map, deep links, and the browser history that mirrors them.
// A card's identity is kind + id; title and ref are display/lookup hints only.

export type Card =
  | { kind: "vehicle"; id: string; line: string; title?: string; ref?: string }
  | { kind: "stop"; id: string; title?: string; ref?: string }
  | { kind: "line"; id: string; dir?: 0 | 1; pattern?: string; title?: string; ref?: string };

export const MAX_DEPTH = 6;

export function sameCard(a: Card, b: Card): boolean {
  return a.kind === b.kind && a.id === b.id;
}

// A card already in the stack cuts the stack back to it (with the new details); otherwise it goes on top.
export function pushCard(stack: readonly Card[], card: Card): Card[] {
  const i = stack.findIndex(c => sameCard(c, card));
  if (i >= 0) return [...stack.slice(0, i), card];
  return [...stack, card].slice(-MAX_DEPTH);
}

// The top card named by a deep link; empty values count as missing.
export function cardFromQuery(search: string): Card | null {
  const p = new URLSearchParams(search);
  const vehicle = p.get("vehicle");
  const line = p.get("line");
  const stop = p.get("stop");
  if (vehicle && line) return { kind: "vehicle", id: vehicle, line };
  if (stop) return { kind: "stop", id: stop };
  if (line) {
    const dir = p.get("dir");
    return dir === "0" || dir === "1" ? { kind: "line", id: line, dir: Number(dir) as 0 | 1 } : { kind: "line", id: line };
  }
  return null;
}

// The query for the picked lines and the top card. Picks are joined by a literal comma.
export function cardQuery(card: Card | null, picks: string[]): string {
  const e = encodeURIComponent;
  const parts: string[] = [];
  if (picks.length) parts.push(`l=${picks.map(e).join(",")}`);
  if (card?.kind === "vehicle") parts.push(`line=${e(card.line)}`, `vehicle=${e(card.id)}`);
  else if (card?.kind === "stop") parts.push(`stop=${e(card.id)}`);
  else if (card?.kind === "line") {
    parts.push(`line=${e(card.id)}`);
    if (card.dir !== undefined) parts.push(`dir=${card.dir}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

export interface Hist {
  readonly state: unknown;
  pushState(state: unknown, unused: string, url: string): void;
  replaceState(state: unknown, unused: string, url: string): void;
  go(n: number): void;
}

type NavState = { cards: Card[]; depth: number };

function parseState(state: unknown): NavState {
  const s = state as { cards?: unknown; depth?: unknown } | null;
  if (s && typeof s === "object" && Array.isArray(s.cards) && typeof s.depth === "number") {
    return { cards: s.cards as Card[], depth: s.depth };
  }
  return { cards: [], depth: 0 };
}

// History entries mirror the stack: each entry the class writes holds { cards, depth }, where depth
// counts the entries above the page's base entry. Depth can exceed cards.length once MAX_DEPTH drops old cards.
export class CardNav {
  stack: Card[] = [];
  private depth = 0;
  // A stack to settle on once the history move in flight reaches its popstate.
  private pending: Card[] | null = null;

  constructor(
    private h: Hist,
    private onChange: (stack: Card[]) => void,
    private url: (stack: Card[]) => string,
  ) {}

  start(initial: Card | null): void {
    this.stack = [];
    this.depth = 0;
    this.h.replaceState({ cards: [], depth: 0 }, "", this.url([]));
    if (initial) {
      this.depth = 1;
      this.stack = [initial];
      this.h.pushState({ cards: [initial], depth: 1 }, "", this.url([initial]));
    }
    this.onChange(this.stack);
  }

  push(card: Card): void {
    const next = pushCard(this.stack, card);
    const i = this.stack.findIndex(c => sameCard(c, card));
    if (i >= 0) {
      if (i === this.stack.length - 1) {
        this.h.replaceState({ cards: next, depth: this.depth }, "", this.url(next));
        this.stack = next;
        this.onChange(this.stack);
      } else {
        this.pending = next;
        this.h.go(-(this.stack.length - 1 - i));
      }
      return;
    }
    this.pushEntry(next);
  }

  // A fresh start from a map tap: the stack becomes just this card, one Back from closed.
  open(card: Card): void {
    if (this.depth === 0) this.pushEntry([card]);
    else if (this.depth === 1) {
      this.h.replaceState({ cards: [card], depth: 1 }, "", this.url([card]));
      this.stack = [card];
      this.onChange(this.stack);
    } else {
      this.pending = [card];
      this.h.go(-(this.depth - 1));
    }
  }

  // The top card's title, once its data names it (a deep link brings no title). No onChange: nothing
  // else changes.
  retitle(title: string): void {
    const top = this.stack[this.stack.length - 1];
    if (!top || top.title === title) return;
    this.stack = [...this.stack.slice(0, -1), { ...top, title }];
    this.h.replaceState({ cards: this.stack, depth: this.depth }, "", this.url(this.stack));
  }

  back(): void {
    if (this.depth > 0) this.h.go(-1);
  }

  close(): void {
    if (this.depth > 0) {
      this.pending = null;
      this.h.go(-this.depth);
    }
  }

  // Call on every popstate with the history state of the entry now showing.
  popped(state: unknown): void {
    const parsed = parseState(state);
    if (this.pending) {
      const next = this.pending;
      this.h.replaceState({ cards: next, depth: parsed.depth }, "", this.url(next));
      this.stack = next;
      this.pending = null;
    } else {
      this.stack = parsed.cards;
    }
    this.depth = parsed.depth;
    this.onChange(this.stack);
  }

  private pushEntry(next: Card[]): void {
    this.depth += 1;
    this.h.pushState({ cards: next, depth: this.depth }, "", this.url(next));
    this.stack = next;
    this.onChange(this.stack);
  }
}
