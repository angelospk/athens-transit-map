<script module lang="ts">
  import { clockHM } from "../trains";

  // The time of an arrival, in the cards' short form: «τώρα», «8′», and the clock from an hour on.
  export function whenText(at: number, nowMs: number): string {
    const m = Math.round((at * 1000 - nowMs) / 60_000);
    return m <= 0 ? "τώρα" : m < 60 ? `${m}′` : clockHM(at);
  }
</script>

<script lang="ts">
  // The shell of the three cards (vehicle, line, rail stop): on a phone a bottom sheet, dragged down by its top
  // it peeks (only the header shows), dragged up it opens; on a desktop a card at the map's left. The header
  // snippet holds the badge, the title and the freshness tag; the shell adds Back, the star and ×.
  import { untrack, type Snippet } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { clampDrag, settle, type SheetState } from "../sheet";
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
  let sheet = $state<SheetState>("open");
  let drag = $state(0);   // px the finger has moved it from its place
  let dragging = $state(false);
  let grab: { id: number; y: number; from: SheetState; range: number; moved: boolean } | null = null;
  let card: HTMLElement | undefined = $state();
  let cardH = $state(0), topH = $state(0);
  // How far it travels to peek: all but its padding (the bottom one holds the safe area) and its top.
  function measure() {
    if (!card) return 0;
    const cs = getComputedStyle(card);
    return Math.max(0, card.offsetHeight - topH - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom));
  }
  const range = $derived.by(() => { void cardH; void topH; return measure(); });
  const shift = $derived(narrow.current ? (sheet === "peek" ? range : 0) + drag : 0);

  $effect(() => {
    void key;
    // A finger still down on the old sheet must not move, or settle, the new one.
    untrack(() => { sheet = "open"; drag = 0; dragging = false; grab = null; });
  });

  const flip = (s: SheetState): SheetState => (s === "open" ? "peek" : "open");

  function down(e: PointerEvent) {
    if (!narrow.current || e.button !== 0 || grab || (e.target as Element).closest("button:not(.grab)")) return;
    grab = { id: e.pointerId, y: e.clientY, from: sheet, range: measure(), moved: false };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (!grab || e.pointerId !== grab.id) return;
    const dy = e.clientY - grab.y;
    if (!grab.moved && Math.abs(dy) < 6) return;   // a tap is not a drag
    grab.moved = true;
    dragging = true;
    drag = clampDrag(grab.from, dy, grab.range);
  }
  // Also on pointercancel and a lost capture, so the sheet never stays between its places.
  function end(e: PointerEvent) {
    if (!grab || e.pointerId !== grab.id) return;
    const g = grab;
    grab = null;
    dragging = false;
    sheet = g.moved ? settle(g.from, e.type === "pointerup" ? e.clientY - g.y : drag, g.range) : e.type === "pointerup" ? flip(g.from) : g.from;
    drag = 0;
  }
</script>

<svelte:window onkeydown={e => { if (e.key === "Escape" && closeOnEscape) close(); }} />

<section class="card" class:dragging class:peek={narrow.current && sheet === "peek"} aria-label="Λεπτομέρειες" bind:this={card} bind:offsetHeight={cardH}
  style:transform={shift ? `translateY(${shift}px)` : undefined}>
  <!-- svelte-ignore a11y_no_static_element_interactions (the keyboard goes through the grab button) -->
  <div class="top" bind:offsetHeight={topH} onpointerdown={down} onpointermove={move} onpointerup={end} onpointercancel={end}
    onlostpointercapture={end}>
    <!-- Pointer taps and drags are handled above; a click with no pointer (Enter, Space) comes here. -->
    <button type="button" class="grab" aria-expanded={sheet === "open"} aria-controls="card-body"
      aria-label={sheet === "open" ? "Σύμπτυξη λεπτομερειών" : "Ανάπτυξη λεπτομερειών"} onclick={e => { if (e.detail === 0) sheet = flip(sheet); }}><span></span></button>
    <header>
      <Back {app} />
      {@render header()}
      {#if onstar}
        <button type="button" class="star" class:on={starred} aria-pressed={starred} title={starLabel} aria-label={starLabel} onclick={onstar}><Icon name={starred ? "star-filled" : "star"} size={20} /></button>
      {/if}
      <button type="button" class="close" aria-label="Κλείσιμο" onclick={close}>×</button>
    </header>
  </div>

  <div class="body" id="card-body" inert={narrow.current && sheet === "peek"}>
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
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
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
    .card { left: 0; right: 0; bottom: 0; width: auto; border-radius: 16px 16px 0 0; border-width: 1px 0 0;
      padding: 14px 16px calc(14px + env(safe-area-inset-bottom)); transition: transform .22s ease; }
    .card.dragging { transition: none; }
    .grab { display: block; }
  }
</style>
