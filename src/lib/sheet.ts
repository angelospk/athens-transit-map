// A bottom sheet dragged with a finger between two places: open, and peeking (only its header shows).
// `range` is how far it travels, in px; `dy` is how far the finger has moved down (negative: up).

export type SheetState = "open" | "peek";

// An open sheet only goes down, a peeking one only up, neither past the range.
export function clampDrag(from: SheetState, dy: number, range: number): number {
  return from === "open" ? Math.min(Math.max(dy, 0), range) : Math.max(Math.min(dy, 0), -range);
}

// Where it settles when the finger lifts: past a third of the range (at most 80px) it goes to the
// other place, else back. With no range there is nothing to hide: open.
export function settle(from: SheetState, dy: number, range: number): SheetState {
  if (range <= 0) return "open";
  const moved = Math.abs(clampDrag(from, dy, range));
  const far = moved >= Math.min(80, range / 3);
  return (from === "open") === far ? "peek" : "open";
}
