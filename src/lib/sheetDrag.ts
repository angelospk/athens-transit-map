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

/** The snap a sheet settles at: a flick goes one step its way, a slow drag to the nearest. */
export function settleSnap<T extends string>(order: T[], current: T, at: number, places: Record<T, number>, v: number, grows: "up" | "down"): T {
  if (Math.abs(v) > 0.5) {
    const toBigger = grows === "up" ? v < 0 : v > 0;   // order runs from smallest to biggest
    const i = order.indexOf(current) + (toBigger ? 1 : -1);
    return order[Math.max(0, Math.min(order.length - 1, i))];
  }
  return order.reduce((a, b) => (Math.abs(places[b] - at) < Math.abs(places[a] - at) ? b : a));
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
