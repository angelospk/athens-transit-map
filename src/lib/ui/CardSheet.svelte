<script module lang="ts">
  import { clockHM } from "../trains";

  // The time of an arrival, in the cards' short form: «τώρα», «8′», and the clock from an hour on.
  export function whenText(at: number, nowMs: number): string {
    const m = Math.round((at * 1000 - nowMs) / 60_000);
    return m <= 0 ? "τώρα" : m < 60 ? `${m}′` : clockHM(at);
  }
</script>

<script lang="ts">
  // The shell of the three cards (vehicle, line, rail stop): on a phone a bottom sheet with three places (its header,
  // half the screen, all of it), dragged by its top (sheetDrag.ts); on a desktop a card at the map's left. The header
  // snippet holds the badge, the title and the freshness tag; the shell adds Back, the star and ×.
  import type { Snippet } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { bottomSheet, type Place } from "../sheetDrag";
  import type { AppState } from "../state.svelte";
  import Back from "./Back.svelte";
  import Icon from "./Icon.svelte";

  let { app, key, header, children, starred, onstar, starLabel, closeOnEscape = true, onclose }: {
    app: AppState;
    key: string;                       // a new key opens the sheet again
    header: Snippet;
    children: Snippet;
    starred?: boolean;                 // with onstar: the star button
    onstar?: () => void;
    starLabel?: string;
    closeOnEscape?: boolean;
    onclose?: () => void;              // × and Escape; default: close the cards
  } = $props();
  const close = () => (onclose ?? (() => app.closeCards()))();

  const narrow = new MediaQuery("(max-width: 719px)");
  let place = $state<Place>("half");
  const peek = $derived(narrow.current && place === "peek");
</script>

<svelte:window onkeydown={e => { if (e.key === "Escape" && closeOnEscape) close(); }} />

<section class="card" class:peek aria-label="Λεπτομέρειες"
  use:bottomSheet={{ handle: ".top", scroll: ".body", on: () => narrow.current, key, onplace: p => (place = p) }}>
  <div class="top">
    <!-- Taps and drags are the sheet's (sheetDrag.ts); a click with no pointer (Enter, Space) steps it too. -->
    <button type="button" class="grab" aria-expanded={!peek} aria-controls="card-body"
      aria-label={peek ? "Ανάπτυξη λεπτομερειών" : "Σύμπτυξη λεπτομερειών"}><span></span></button>
    <header>
      <Back {app} />
      <div class="hd">{@render header()}</div>
      {#if onstar}
        <button type="button" class="star" class:on={starred} aria-pressed={starred} title={starLabel} aria-label={starLabel} onclick={onstar}><Icon name={starred ? "star-filled" : "star"} size={20} /></button>
      {/if}
      <button type="button" class="close" aria-label="Κλείσιμο" onclick={close}>×</button>
    </header>
  </div>

  <div class="body" id="card-body" inert={peek}>
    {@render children()}
  </div>
</section>

<style>
  .card { position: absolute; z-index: 6; left: 12px; bottom: 28px; width: 360px; padding: 12px 14px;
    background: var(--panel); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow);
    backdrop-filter: blur(8px); }
  .top { touch-action: none; }
  .grab { display: none; width: 100%; height: 14px; margin: -8px 0 2px; padding: 0; border: 0; background: none; cursor: grab; }
  .grab span { display: block; width: 40px; height: 5px; margin: 0 auto; border-radius: 3px; background: var(--border); }
  .grab:focus-visible { outline: 2px solid var(--accent); border-radius: 6px; }
  .body { max-height: min(55dvh, 420px); overflow-y: auto; overscroll-behavior: contain; transition: opacity .15s; }
  .card.peek .body { opacity: 0; }   /* no sliver of it under the header */
  header { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 6px; }
  .hd { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; }
  /* Under Back, the badge and title get a row of their own: Back and the buttons above. */
  header:has(> :global(.back)) > :global(.back) { margin-right: auto; }
  header:has(> :global(.back)) .hd { order: 1; flex-basis: 100%; }
  header :global(.pill) { flex: none; padding: 2px 8px; border-radius: 10px; background: var(--c); color: var(--t); font-weight: 700; }
  header :global(h2) { flex: 1; min-width: 0; margin: 0; font-size: 13px; font-weight: 600; color: var(--muted); overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; }
  header :global(.fresh) { flex: none; font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
  header :global(.fresh.warn) { color: #e03131; }
  .close { flex: none; width: 36px; height: 36px; margin: -8px -10px -8px 0; border: 0; background: none; font-size: 22px;
    color: var(--muted); cursor: pointer; border-radius: 8px; }
  .close:hover { background: var(--control); }
  .star { flex: none; width: 36px; height: 36px; margin: -8px -4px -8px 0; border: 0; background: none; color: var(--muted); font-size: 20px;
    cursor: pointer; border-radius: 8px; }
  .star:hover { background: var(--control); }
  .star.on { color: #f59f00; }
  @media (prefers-reduced-motion: reduce) { .card { transition: none !important; } }
  @media (max-width: 719px) {
    /* GreekCaptain's fork: it floats 8 px in, rounded all round; as tall as its content, at most the screen. */
    .card { left: 8px; right: 8px; bottom: calc(8px + env(safe-area-inset-bottom)); width: auto; border-radius: 28px;
      padding: 14px 16px 14px; display: flex; flex-direction: column; box-sizing: border-box;
      max-height: calc(100dvh - 16px - env(safe-area-inset-top) - env(safe-area-inset-bottom)); }
    .top { flex: none; }
    .body { flex: 1 1 auto; min-height: 0; max-height: none; padding-bottom: var(--sheet-room, 0px); }
    .grab { display: block; }
  }
</style>
