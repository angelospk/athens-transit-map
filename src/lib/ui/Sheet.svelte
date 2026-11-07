<script lang="ts">
  // A sheet from the foot of the screen over a dimmed page (the options and «Θύμισέ μου» of «Πού πας;», a stop's own
  // name): a handle, a title with ✕, its content; ✕, a tap on the dim part, Escape, or the handle (or the title row)
  // pulled down closes it. Its rows and choices share these
  // styles: plain questions (.sq), a row of choices (.seg), a list of ticks or one-of rows (.slist), «Έτοιμο» (.sdone).
  import type { Snippet } from "svelte";
  import { rise, soft } from "../anim";
  import Icon from "./Icon.svelte";

  let { title, onclose, children }: { title: string; onclose: () => void; children: Snippet } = $props();
  const id = `sheet-${Math.random().toString(36).slice(2, 8)}`;
  // While it is open the page under it stays still: its scrolling panels are held (html.sheet-open, app.css), and a
  // drag on the dim part or on a sheet with nothing to scroll is not passed on to them (iOS hands it to the page).
  $effect(() => {
    const h = document.documentElement;
    h.dataset.sheets = String((+(h.dataset.sheets ?? 0)) + 1);
    h.classList.add("sheet-open");
    return () => {
      const n = Math.max(0, +(h.dataset.sheets ?? 1) - 1);
      h.dataset.sheets = String(n);
      if (!n) h.classList.remove("sheet-open");
    };
  });
  // Pulled down by the handle or the title row: the sheet follows the finger; let go past 90 px (or a quick flick) it
  // closes, else it goes back up.
  let dy = $state(0);
  let dragging = $state(false);
  let y0 = 0, t0 = 0;
  function grab(e: PointerEvent) {
    if (e.button !== 0 || (e.target as Element).closest("button")) return;
    dragging = true; y0 = e.clientY; t0 = performance.now(); dy = 0;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function pull(e: PointerEvent) { if (dragging) dy = Math.max(0, e.clientY - y0); }
  function drop() {
    if (!dragging) return;
    dragging = false;
    if (dy > 90 || dy / Math.max(1, performance.now() - t0) > 0.6) onclose();
    else dy = 0;
  }
  function still(node: HTMLElement, own: boolean) {
    let y = 0;
    const start = (e: TouchEvent) => { y = e.touches[0]?.clientY ?? 0; };
    const move = (e: TouchEvent) => {
      if (!own) { e.preventDefault(); return; }
      // The sheet scrolls itself; at its top pulling down, at its foot pushing up, or with nothing to scroll: held.
      const dy = (e.touches[0]?.clientY ?? 0) - y, el = node;
      const none = el.scrollHeight <= el.clientHeight + 1;
      if (none || (dy > 0 && el.scrollTop <= 0) || (dy < 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 1)) e.preventDefault();
    };
    node.addEventListener("touchstart", start, { passive: true });
    node.addEventListener("touchmove", move, { passive: false });
    return { destroy() { node.removeEventListener("touchstart", start); node.removeEventListener("touchmove", move); } };
  }
</script>

<svelte:window onkeydown={e => { if (e.key === "Escape") { e.stopPropagation(); onclose(); } }} />

<div class="shade" role="presentation" onclick={onclose} use:still={false} transition:soft></div>
<div class="sheet" class:dragging use:still={true} role="dialog" aria-modal="true" aria-labelledby={id} style:transform={dy ? `translateY(${dy}px)` : undefined}
  transition:rise={{ y: 60, duration: 260 }}>
  <div class="sgrab" role="presentation" onpointerdown={grab} onpointermove={pull} onpointerup={drop} onpointercancel={drop}>
    <i class="sgrip" aria-hidden="true"></i>
    <div class="shead">
      <h2 {id}>{title}</h2>
      <button type="button" class="sclose" aria-label="Κλείσιμο" title="Κλείσιμο" onclick={onclose}><Icon name="close" size={16} /></button>
    </div>
  </div>
  {@render children()}
</div>

<style>
  .shade { position: fixed; inset: 0; z-index: 80; background: rgba(0, 0, 0, .5); }
  .sheet { position: fixed; z-index: 81; left: 0; right: 0; bottom: 0; max-height: calc(100dvh - 60px - env(safe-area-inset-top)); overflow-y: auto;
    margin: 0 auto; max-width: 520px; box-sizing: border-box; padding: 10px 16px calc(20px + env(safe-area-inset-bottom));
    border-radius: var(--sheet-r, 28px) var(--sheet-r, 28px) 0 0; background: var(--surface); color: var(--fg); overscroll-behavior: contain;
    box-shadow: 0 -10px 40px rgba(0, 0, 0, .35); transition: transform .22s ease; }
  .sheet.dragging { transition: none; }
  /* The handle and the title row are where the sheet is pulled down: no scrolling or zooming starts there. */
  .sgrab { margin: -10px -16px 0; padding: 10px 16px 0; touch-action: none; cursor: grab; }
  .sheet.dragging .sgrab { cursor: grabbing; }
  .sgrip { display: block; width: 40px; height: 5px; margin: 0 auto; border-radius: 3px; background: color-mix(in srgb, var(--fg) 22%, transparent); }
  .shead { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 12px 0 4px; }
  h2 { margin: 0; font-size: 22px; font-weight: 700; line-height: 1.1; }
  .sclose { flex: none; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 50%;
    background: color-mix(in srgb, var(--fg) 10%, transparent); color: var(--fg); cursor: pointer; }
  .sclose:hover { background: color-mix(in srgb, var(--fg) 16%, transparent); }
  @media (prefers-reduced-motion: reduce) { .sheet { transition: none; } }

  .sheet :global(.sq) { margin: 22px 0 10px; font-size: 16px; font-weight: 600; line-height: 1.2; }
  .sheet :global(.sp) { margin: 10px 0 0; font-size: 15px; color: var(--muted); line-height: 1.45; }
  .sheet :global(.seg) { display: grid; grid-auto-columns: 1fr; grid-auto-flow: column; gap: 4px; height: 52px; padding: 4px; box-sizing: border-box; border-radius: 14px;
    background: color-mix(in srgb, var(--fg) 7%, var(--surface)); }
  .sheet :global(.seg button) { display: flex; align-items: center; justify-content: center; padding: 0 4px; border: 0; border-radius: 11px; background: none; color: var(--muted);
    font: inherit; font-size: 15px; font-weight: 500; line-height: 1; cursor: pointer; white-space: nowrap; }
  .sheet :global(.seg button.on) { background: color-mix(in srgb, var(--fg) 16%, var(--surface)); color: var(--fg); font-weight: 600; }
  .sheet :global(.slist) { border-radius: 16px; background: color-mix(in srgb, var(--fg) 7%, var(--surface)); overflow: hidden; }
  .sheet :global(.srow) { width: 100%; min-height: 56px; display: flex; align-items: center; gap: 12px; padding: 10px 16px; box-sizing: border-box; border: 0; background: none; color: var(--fg);
    font: inherit; font-size: 17px; font-weight: 500; line-height: 1.2; text-align: left; cursor: pointer; }
  .sheet :global(.srow + .srow) { border-top: 1px solid color-mix(in srgb, var(--fg) 10%, transparent); }
  .sheet :global(.srow:disabled) { cursor: default; }
  .sheet :global(.srow > svg), .sheet :global(.srow > .ic) { flex: none; color: var(--muted); }
  .sheet :global(.srow .tx) { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .sheet :global(.srow .tx small) { font-size: 13px; color: var(--muted); }
  .sheet :global(.tick) { flex: none; width: 26px; height: 26px; box-sizing: border-box; border-radius: 8px; border: 2px solid color-mix(in srgb, var(--fg) 35%, transparent);
    display: flex; align-items: center; justify-content: center; color: #fff; }
  .sheet :global(.tick.on) { border: 0; background: var(--accent); }
  .sheet :global(.radio) { flex: none; width: 24px; height: 24px; box-sizing: border-box; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--fg) 35%, transparent);
    display: flex; align-items: center; justify-content: center; }
  .sheet :global(.radio.on) { border-color: var(--accent); }
  .sheet :global(.radio.on::after) { content: ""; width: 12px; height: 12px; border-radius: 50%; background: var(--accent); }
  .sheet :global(.sacts) { display: flex; gap: 10px; margin-top: 24px; }
  .sheet :global(.sdone), .sheet :global(.sback) { flex: 1; height: 56px; display: flex; align-items: center; justify-content: center; gap: 8px; border: 0; border-radius: 16px;
    font: inherit; font-size: 17px; font-weight: 700; line-height: 1; cursor: pointer; }
  .sheet :global(.sdone) { flex: 1.6; background: var(--accent); color: var(--on-accent, #fff); }
  .sheet :global(.sback) { background: color-mix(in srgb, var(--fg) 9%, var(--surface)); color: var(--fg); font-weight: 600; }
  @media (max-width: 719px) { .sheet { max-width: none; } }
</style>
