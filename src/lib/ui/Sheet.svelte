<script lang="ts">
  // A sheet from the foot of the screen over a dimmed page (the options and «Θύμισέ μου» of «Πού πας;», a stop's own
  // name): a handle, a title, its content; a tap on the dim part or Escape closes it. Its rows and choices share these
  // styles: plain questions (.sq), a row of choices (.seg), a list of ticks or one-of rows (.slist), «Έτοιμο» (.sdone).
  import type { Snippet } from "svelte";
  import { rise, soft } from "../anim";

  let { title, onclose, children }: { title: string; onclose: () => void; children: Snippet } = $props();
  const id = `sheet-${Math.random().toString(36).slice(2, 8)}`;
</script>

<svelte:window onkeydown={e => { if (e.key === "Escape") { e.stopPropagation(); onclose(); } }} />

<div class="shade" role="presentation" onclick={onclose} transition:soft></div>
<div class="sheet" role="dialog" aria-modal="true" aria-labelledby={id} transition:rise={{ y: 60, duration: 260 }}>
  <i class="sgrip" aria-hidden="true"></i>
  <h2 {id}>{title}</h2>
  {@render children()}
</div>

<style>
  .shade { position: fixed; inset: 0; z-index: 80; background: rgba(0, 0, 0, .5); }
  .sheet { position: fixed; z-index: 81; left: 0; right: 0; bottom: 0; max-height: calc(100dvh - 60px - env(safe-area-inset-top)); overflow-y: auto;
    margin: 0 auto; max-width: 520px; box-sizing: border-box; padding: 10px 16px calc(20px + env(safe-area-inset-bottom));
    border-radius: var(--sheet-r, 28px) var(--sheet-r, 28px) 0 0; background: var(--surface); color: var(--fg); overscroll-behavior: contain;
    box-shadow: 0 -10px 40px rgba(0, 0, 0, .35); }
  .sgrip { display: block; width: 40px; height: 5px; margin: 0 auto; border-radius: 3px; background: color-mix(in srgb, var(--fg) 22%, transparent); }
  h2 { margin: 18px 0 4px; font-size: 22px; font-weight: 700; line-height: 1.1; }

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
