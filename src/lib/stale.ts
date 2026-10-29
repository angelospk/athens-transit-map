// A page left open across a deploy still asks for the old build's chunks (the info sheet, the planner),
// and GitHub Pages no longer has them: the import fails. Vite then fires vite:preloadError; the page
// reloads once to get the new build. A second failure within RELOAD_MS is a real one: it is left to
// the caller's own message, so a broken network cannot loop the page.

export const RELOAD_MS = 60_000;
const KEY = "staleReloadAt";

export function shouldReload(last: number | null, now: number): boolean {
  return last == null || !(now - last < RELOAD_MS);
}

export function reloadOnStaleChunk(win: Window = window) {
  win.addEventListener("vite:preloadError", e => {
    let last: number | null = null;
    try { last = Number(win.sessionStorage.getItem(KEY)) || null; } catch { /* storage blocked */ }
    const now = Date.now();
    if (!shouldReload(last, now)) return;
    try { win.sessionStorage.setItem(KEY, String(now)); } catch { return; }   // no guard: no reload
    e.preventDefault();
    win.location.reload();
  });
}
