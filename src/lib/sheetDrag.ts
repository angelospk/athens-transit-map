// Dragging a sheet by its handle on a phone. Touch events with preventDefault (not only pointer events and
// touch-action): iOS Safari then never takes the gesture for a scroll of the page or of the sheet's own content,
// which made the handle feel dead and, at times, dragged the whole sheet's content instead. A mouse works too.

export interface SheetDrag {
  start: () => void;                         // the gesture began (read the sheet's place now)
  move: (dy: number) => void;                // finger moved this far since the start (down is +)
  end: (dy: number, v: number) => void;      // let go: total dy and speed (px per ms, down is +)
  tap?: () => void;                          // no move at all
  ignore?: string;                           // a press on these (the buttons in the header) is theirs, not a drag
}

const SLOP = 6;

export function sheetDrag(node: HTMLElement, h: SheetDrag) {
  let y0 = 0, last = 0, lastT = 0, v = 0, moved = false, on = false;
  const begin = (y: number) => { y0 = last = y; lastT = performance.now(); v = 0; moved = false; on = true; h.start(); };
  const step = (y: number) => {
    if (!on) return;
    const dy = y - y0;
    if (!moved && Math.abs(dy) < SLOP) return;
    moved = true;
    const now = performance.now();
    if (now > lastT) v = 0.7 * ((y - last) / (now - lastT)) + 0.3 * v;
    last = y; lastT = now;
    h.move(dy);
  };
  const finish = (y: number) => {
    if (!on) return;
    on = false;
    if (!moved) { h.tap?.(); return; }
    if (performance.now() - lastT > 120) v = 0;   // held still before letting go: no flick
    h.end(y - y0, v);
  };
  const theirs = (e: Event) => !!h.ignore && !!(e.target as Element | null)?.closest?.(h.ignore);
  const ts = (e: TouchEvent) => { if (e.touches.length === 1 && !theirs(e)) { e.preventDefault(); begin(e.touches[0].clientY); } };
  const tm = (e: TouchEvent) => { if (on) { e.preventDefault(); step(e.touches[0].clientY); } };
  const te = (e: TouchEvent) => { if (on) { e.preventDefault(); finish(e.changedTouches[0]?.clientY ?? last); } };
  const md = (e: MouseEvent) => {
    if (e.button !== 0 || theirs(e)) return;
    begin(e.clientY);
    const mm = (ev: MouseEvent) => step(ev.clientY);
    const mu = (ev: MouseEvent) => { removeEventListener("mousemove", mm); removeEventListener("mouseup", mu); finish(ev.clientY); };
    addEventListener("mousemove", mm);
    addEventListener("mouseup", mu);
  };
  node.addEventListener("touchstart", ts, { passive: false });
  node.addEventListener("touchmove", tm, { passive: false });
  node.addEventListener("touchend", te, { passive: false });
  node.addEventListener("touchcancel", te, { passive: false });
  node.addEventListener("mousedown", md);
  node.style.touchAction = "none";
  return {
    update(next: SheetDrag) { h = next; },
    destroy() {
      node.removeEventListener("touchstart", ts);
      node.removeEventListener("touchmove", tm);
      node.removeEventListener("touchend", te);
      node.removeEventListener("touchcancel", te);
      node.removeEventListener("mousedown", md);
    },
  };
}

// ---- Places a sheet rests at (detents), and the spring that takes it there ----------------------------------------
// As a native sheet: it follows the finger, and let go it goes to the place nearest to where it was heading (its
// position carried on by its speed for MOMENTUM_MS, so a flick can go past a place), with a short spring that
// overshoots a little (about 1%) and settles in about a third of a second.

/** How far ahead a let-go sheet is carried by its speed, in ms (a firm flick goes past the next place). */
export const MOMENTUM_MS = 220;

/** The place (of `places`, in px along the axis it moves on) nearest to where the sheet is heading: at `at`, moving
 *  at `v` px per ms on that same axis. */
export function pickDetent<T extends string>(places: Record<T, number>, at: number, v: number): T {
  const aim = at + v * MOMENTUM_MS;
  const keys = Object.keys(places) as T[];
  return keys.reduce((a, b) => (Math.abs(places[b] - aim) < Math.abs(places[a] - aim) ? b : a));
}

/** iOS's rubber band: `o` px pulled past the end moves the sheet (1 − 1/(o·k/d + 1))·d, d the screen's height. It
 *  gives k (0.55) of the finger from the first pixel and less and less after, toward d: an elastic, never a wall. */
export function band(o: number, d: number, k = 0.55): number {
  return (1 - 1 / ((o * k) / d + 1)) * d;
}

/** Past its first or last place the sheet still moves, but less and less (as an iOS list pulled past its end). */
export function rubber(x: number, lo: number, hi: number, d = typeof innerHeight === "number" && innerHeight > 0 ? innerHeight : 844, k = 0.55): number {
  if (x < lo) return lo - band(lo - x, d, k);
  if (x > hi) return hi + band(x - hi, d, k);
  return x;
}

const SPRING = { w: 15, z: 0.84 };   // rad/s and damping: ~0.35 s to rest, ~1% past the place

/** One step of the spring (pure, for the tests): position and speed (px, px/s) after `dt` seconds. */
export function springStep(x: number, v: number, to: number, dt: number): [number, number] {
  const a = -SPRING.w * SPRING.w * (x - to) - 2 * SPRING.z * SPRING.w * v;
  const nv = v + a * dt;
  return [x + nv * dt, nv];
}

/** Moves a value from `from` to `to` with the spring, starting at `v` px per ms (the finger's speed), calling `frame`
 *  on every animation frame and `done` at rest. Returns a function that stops it (a new grab). Without motion
 *  (prefers-reduced-motion) it goes straight there. */
export function springTo(from: number, to: number, v: number, frame: (x: number) => void, done?: () => void): () => void {
  if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
    frame(to); done?.(); return () => {};
  }
  let x = from, vs = v * 1000, last = performance.now(), id = 0, stopped = false;
  const tick = (now: number) => {
    if (stopped) return;
    let dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    while (dt > 0) { const h = Math.min(dt, 1 / 240); [x, vs] = springStep(x, vs, to, h); dt -= h; }
    if (Math.abs(x - to) < 0.4 && Math.abs(vs) < 12) { frame(to); done?.(); return; }
    frame(x);
    id = requestAnimationFrame(tick);
  };
  id = requestAnimationFrame(tick);
  return () => { stopped = true; cancelAnimationFrame(id); };
}


/** The screen's safe-area insets in px (the notch, the home bar), read once from CSS. */
let insets: { top: number; bottom: number } | null = null;
export function safeInsets(): { top: number; bottom: number } {
  if (insets) return insets;
  const d = document.createElement("div");
  d.style.cssText = "position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)";
  document.body.appendChild(d);
  const cs = getComputedStyle(d);
  insets = { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
  d.remove();
  return insets;
}

/** A bottom sheet moved by its handles with a translateY (its height its own): open (0), or lowered to `keep` px
 *  still showing; let go it springs to the one it was heading for; a tap opens it, or lowers it when open. Only on
 *  a phone (`on`). The handles alone take the touch, so the sheet's content still scrolls. */
export function freeSheet(node: HTMLElement, o: { handles: string; keep?: number; on?: () => boolean }) {
  // rest: the place it is going to (open 0, or lowered); y: where it is drawn now (the spring between them).
  let rest = 0, y = 0, start = 0, stop = () => {};
  const max = () => Math.max(0, node.offsetHeight - (o.keep ?? 96));
  const put = (to: number) => {
    y = to;
    node.style.transition = "none";
    node.style.transform = to ? `translateY(${to}px)` : "";
  };
  const go = (to: number, v = 0) => { rest = to; stop(); stop = springTo(y, to, v, put); };
  const drag: SheetDrag = {
    ignore: "button:not(.grip), a, input",
    start: () => { stop(); start = y; },
    move: dy => put(rubber(start + dy, 0, max())),
    end: (dy, v) => { const at = rubber(start + dy, 0, max()); put(at); go(pickDetent({ open: 0, low: max() }, at, v) === "open" ? 0 : max(), v); },
    tap: () => go(rest > 0 ? 0 : max()),
  };
  const bound: ReturnType<typeof sheetDrag>[] = [];
  const bind = () => {
    while (bound.length) bound.pop()!.destroy();
    if (o.on && !o.on()) { stop(); rest = 0; put(0); return; }
    for (const h of node.querySelectorAll<HTMLElement>(o.handles)) bound.push(sheetDrag(h, drag));
  };
  bind();
  return {
    update(next: typeof o) { o = next; bind(); },
    destroy() { while (bound.length) bound.pop()!.destroy(); },
  };
}
