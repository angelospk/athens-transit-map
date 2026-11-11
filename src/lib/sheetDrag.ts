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
  let mm: ((e: MouseEvent) => void) | null = null, mu: ((e: MouseEvent) => void) | null = null;
  const unmouse = () => { if (mm) removeEventListener("mousemove", mm); if (mu) removeEventListener("mouseup", mu); mm = mu = null; };
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
    unmouse();
    begin(e.clientY);
    mm = ev => step(ev.clientY);
    mu = ev => { unmouse(); finish(ev.clientY); };
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
      unmouse();
      on = false;   // a gesture under way ends with the sheet: no callback after
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


// ---- Our bottom sheets on a phone (from GreekCaptain's fork, our content): three places --------------------------

export type Place = "full" | "half" | "peek";
export type Places = Partial<Record<Place, number>>;

/** The places of a sheet `H` px tall (its translateY from where it stands): all of it (0), `half` px of it showing,
 *  its header (`head` px) showing. Half only for a sheet at its most (`atMax`: its content scrolls) whose half differs
 *  enough from all of it; a sheet no taller than its header has one place. */
export function sheetPlaces(H: number, head: number, half: number, atMax: boolean): Places {
  if (H - head < 24) return { full: 0 };
  const p: Places = { full: 0 };
  if (atMax && H - half >= 48) p.half = H - half;
  p.peek = H - head;
  return p;
}

/** A tap on the handle: from the header up to the default place, from half to all, from all down to the header. */
export function nextPlace(place: Place, places: Places): Place {
  if (place === "peek") return places.half != null ? "half" : "full";
  if (place === "half") return "full";
  return places.peek != null ? "peek" : "full";
}

export interface BottomSheet {
  handle: string;                 // the parts that drag it (its header)
  scroll?: string;                // what scrolls inside it (default: the sheet itself)
  on: boolean;                    // a phone: else no places, no transform (a value, so a change reaches update)
  key?: unknown;                  // a new key opens it at its default place
  onplace?: (p: Place) => void;
}

/** A bottom sheet on a phone: moved by its handles with a translateY between its places, the finger followed (past
 *  its ends, iOS's band), let go it springs to the place it was heading for. A sheet at its most gets room at the foot
 *  of its scrolling part (--sheet-room) as large as the part off the screen, so all of it can still be scrolled to. */
export function bottomSheet(node: HTMLElement, opts: BottomSheet) {
  let o = opts, want: Place = "half", place: Place = "half", y = 0, start = 0, stop = () => {}, key = opts.key, busy = false;
  const half = () => Math.min((typeof innerHeight === "number" ? innerHeight : 844) * 0.55, 480);
  const head = () => {
    const hs = node.querySelectorAll<HTMLElement>(o.handle);
    if (!hs.length) return 96;
    const top = node.getBoundingClientRect().top;
    let b = 0;
    for (const h of hs) b = Math.max(b, h.getBoundingClientRect().bottom - top);
    return b + 10;
  };
  const atMax = () => {
    const mh = parseFloat(getComputedStyle(node).maxHeight);
    return Number.isFinite(mh) && node.offsetHeight >= mh - 1;
  };
  const places = () => sheetPlaces(node.offsetHeight, head(), half(), atMax());
  const resolve = (p: Places, w: Place): Place => (p[w] != null ? w : w === "half" ? "full" : p.peek != null ? "peek" : "full");
  const put = (to: number) => {
    y = to;
    node.style.transform = to ? `translateY(${to}px)` : "";
    node.style.setProperty("--sheet-room", atMax() && to > 0 ? `${Math.round(to)}px` : "0px");
  };
  const settleAt = (p: Place) => { if (p !== place) { place = p; o.onplace?.(p); } };
  const go = (p: Place, v = 0) => {
    const ps = places(), r = resolve(ps, p);
    settleAt(r);
    stop();
    busy = true;
    stop = springTo(y, ps[r] ?? 0, v, put, () => { busy = false; });
  };
  const drag: SheetDrag = {
    ignore: "button:not(.grab), a, input, select",
    start: () => { stop(); busy = true; start = y; },
    move: dy => { const ps = places(); put(rubber(start + dy, 0, ps.peek ?? 0)); },
    end: (dy, v) => {
      const ps = places(), at = rubber(start + dy, 0, ps.peek ?? 0);
      put(at);
      want = pickDetent(ps as Record<Place, number>, at, v);
      go(want, v);
    },
    tap: () => { want = nextPlace(place, places()); go(want); },
  };
  const bound: ReturnType<typeof sheetDrag>[] = [];
  const grab = () => node.querySelector<HTMLElement>(".grab");
  const key0 = (e: MouseEvent) => { if (e.detail === 0 && o.on) drag.tap!(); };
  const bind = () => {
    while (bound.length) bound.pop()!.destroy();
    if (!o.on) { stop(); busy = false; node.style.transform = ""; node.style.removeProperty("--sheet-room"); y = 0; settleAt("full"); return; }
    for (const h of node.querySelectorAll<HTMLElement>(o.handle)) bound.push(sheetDrag(h, drag));
    const g = grab();
    if (g && !g.closest(o.handle)) bound.push(sheetDrag(g, drag));
  };
  // Content that grows or shrinks (a board loading): the sheet stays at the place it was left at.
  // Not while a finger or the spring moves it (its own --sheet-room changes the size too).
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
    if (!o.on || busy) return;
    const ps = places(), r = resolve(ps, want);
    settleAt(r);
    stop();
    put(ps[r] ?? 0);
  }) : null;
  ro?.observe(node, { box: "border-box" });
  node.addEventListener("click", e => { if ((e.target as Element | null)?.closest?.(".grab")) key0(e); });
  bind();
  if (o.on) { const ps = places(), r = resolve(ps, want); settleAt(r); put(ps[r] ?? 0); }
  return {
    update(next: BottomSheet) {
      const was = o.on;
      o = next;
      if (next.key !== key) { key = next.key; want = "half"; if (o.on) go(want); }
      if (was !== o.on || o.on) bind();
    },
    destroy() { stop(); ro?.disconnect(); while (bound.length) bound.pop()!.destroy(); },
  };
}
