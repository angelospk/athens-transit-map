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
  import type { SheetState } from "../sheet";
  import { pickDetent, rubber, springTo } from "../sheetDrag";
  import type { AppState } from "../state.svelte";
  import Back from "./Back.svelte";
  import Icon from "./Icon.svelte";

  let { app, key, header, children, starred, onstar, starLabel, pinColor, onpin, closeOnEscape = true, onclose, compact = false }: {
    app: AppState;
    key: string;                       // a new key opens the sheet again
    header: Snippet;
    children: Snippet;
    starred?: boolean;                 // with onstar: the star button
    onstar?: () => void;
    starLabel?: string;
    pinColor?: string | null;          // with onpin: the pin button, in the pin's colour once pinned
    onpin?: () => void;
    closeOnEscape?: boolean;
    onclose?: () => void;              // × and Escape; default: close the cards
    compact?: boolean;                 // on a phone, the compact mockups' sheet: to the screen's edges, 40px circles, × not ‹ on its own
  } = $props();
  const close = () => (onclose ?? (() => app.closeCards()))();

  const narrow = new MediaQuery("(max-width: 719px)");
  // A phone: three places, as a native sheet: «open» (all of it), «mid» (its top at about half the screen, so the
  // map and its buttons above it show; where a tall card opens) and «peek» (its header). `sheet` is open or peek.
  type Place = "open" | "mid" | "peek";
  let place = $state<Place>("mid");
  const sheet = $derived<SheetState>(place === "peek" ? "peek" : "open");
  let drag = $state(0);   // px the finger has moved it from its place
  let dragging = $state(false);
  let grab: { id: number; y: number; from: Place; range: number; moved: boolean; base: number; t: number; ly: number; v: number } | null = null;
  // While the spring moves it: where it is (px down from open).
  let rest = $state<number | null>(null);
  let stopSpring = () => {};
  let card: HTMLElement | undefined = $state();
  let cardH = $state(0), topH = $state(0);
  // How far it travels to peek: all but its padding (the bottom one holds the safe area) and its top.
  function measure() {
    if (!card) return 0;
    const cs = getComputedStyle(card);
    return Math.max(0, card.offsetHeight - topH - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom));
  }
  const range = $derived.by(() => { void cardH; void topH; return measure(); });
  let vh = $state(typeof innerHeight === "number" ? innerHeight : 800);
  // The places, px down from open. «mid» puts its top at 47% of the screen; a card shorter than that has no middle.
  function places(r = range): Record<Place, number> {
    const bottom = card ? parseFloat(getComputedStyle(card).bottom) || 12 : 12;
    const openTop = vh - bottom - cardH, mid = Math.max(0, Math.min(r, vh * 0.47 - openTop));
    return { open: 0, mid: mid < 40 ? 0 : mid, peek: r };
  }
  const shift = $derived.by(() => { void vh; return narrow.current ? (rest ?? places()[place]) + drag : 0; });

  $effect(() => {
    void key;
    // A finger still down on the old sheet must not move, or settle, the new one.
    untrack(() => { stopSpring(); place = "mid"; drag = 0; dragging = false; grab = null; rest = null; });
  });

  // A tap on its header: from its header to the middle, from the middle to all of it, and from all of it down again.
  const next = (p: Place): Place => (p === "peek" ? "mid" : p === "mid" && places().mid > 0 ? "open" : "peek");

  // Riding behind a vehicle (3D chase): on a phone the sheet steps down to its header, so the street shows.
  // Riding it («Είμαι μέσα») keeps the sheet open under the 3D view: the stops left are what the rider needs.
  $effect(() => { if (app.chase && narrow.current && !app.ride) untrack(() => { stopSpring(); place = "peek"; drag = 0; rest = null; }); });

  function down(e: PointerEvent) {
    if (!narrow.current || e.button !== 0 || grab || (e.target as Element).closest("button:not(.grab)")) return;
    stopSpring();
    const r = measure();
    grab = { id: e.pointerId, y: e.clientY, from: place, range: r, moved: false, base: rest ?? places(r)[place], t: performance.now(), ly: e.clientY, v: 0 };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (!grab || e.pointerId !== grab.id) return;
    const dy = e.clientY - grab.y;
    if (!grab.moved && Math.abs(dy) < 6) return;   // a tap is not a drag
    grab.moved = true;
    dragging = true;
    const now = performance.now();
    if (now > grab.t) grab.v = 0.7 * ((e.clientY - grab.ly) / (now - grab.t)) + 0.3 * grab.v;
    grab.t = now; grab.ly = e.clientY;
    drag = rubber(grab.base + dy, 0, grab.range) - grab.base;
  }
  // Let go: to the place it was heading for (open, or down to its header), with the spring (sheetDrag.ts).
  function glide(to: Place, from: number, v = 0, r = measure()) {
    stopSpring();
    place = to;
    rest = from; drag = 0; dragging = true;
    stopSpring = springTo(from, places(r)[to], v, x => (rest = x), () => { rest = null; dragging = false; });
  }
  // Also on pointercancel and a lost capture, so the sheet never stays between its places.
  function end(e: PointerEvent) {
    if (!grab || e.pointerId !== grab.id) return;
    const g = grab;
    grab = null;
    dragging = false;
    if (g.moved) {
      const v = performance.now() - g.t > 120 ? 0 : g.v, at = g.base + drag;
      glide(pickDetent(places(g.range), at, v), at, v, g.range);
    } else if (e.type === "pointerup") { glide(next(g.from), g.base, 0, g.range); }
    else drag = 0;
  }
</script>

<svelte:window bind:innerHeight={vh} onkeydown={e => { if (e.key === "Escape" && closeOnEscape) close(); }} />

<section class="card" class:compact class:dragging class:peek={narrow.current && sheet === "peek"} aria-label="Λεπτομέρειες" bind:this={card} bind:offsetHeight={cardH}
  style:transform={shift ? `translateY(${shift}px)` : undefined}>
  <!-- svelte-ignore a11y_no_static_element_interactions (the keyboard goes through the grab button) -->
  <div class="top" bind:offsetHeight={topH} onpointerdown={down} onpointermove={move} onpointerup={end} onpointercancel={end}
    onlostpointercapture={end}>
    <!-- Pointer taps and drags are handled above; a click with no pointer (Enter, Space) comes here. -->
    <button type="button" class="grab" aria-expanded={sheet === "open"} aria-controls="card-body"
      aria-label={sheet === "open" ? "Σύμπτυξη λεπτομερειών" : "Ανάπτυξη λεπτομερειών"} onclick={e => { if (e.detail === 0) { glide(next(place), shift); } }}><span></span></button>
    <header>
      {#if !(compact && narrow.current) || app.stack.length > 1}<Back {app} onclose={close} />{/if}
      <div class="hd">{@render header()}</div>
      {#if onpin}
        <button type="button" class="star pin" class:on={!!pinColor} style:--pc={pinColor} aria-pressed={!!pinColor}
          title={pinColor ? "Καρφιτσωμένη στον χάρτη" : "Καρφίτσωμα στον χάρτη"} aria-label={pinColor ? "Ρυθμίσεις καρφιτσώματος" : "Καρφίτσωμα στον χάρτη"} onclick={onpin}><Icon name="pushpin" size={19} /></button>
      {/if}
      {#if onstar}
        <button type="button" class="star" class:on={starred} aria-pressed={starred} title={starLabel} aria-label={starLabel} onclick={onstar}><Icon name={starred ? "star-filled" : "star"} size={20} /></button>
      {/if}
      <button type="button" class="close" aria-label="Κλείσιμο" onclick={close}><Icon name="close" size={18} /></button>
    </header>
  </div>

  <div class="body" id="card-body" inert={narrow.current && sheet === "peek"}>
    {@render children()}
  </div>
</section>

<style>
  .card { position: absolute; z-index: 6; left: 16px; bottom: 28px; width: 400px; padding: 14px 16px 16px;
    border: 0; border-radius: var(--radius); background: var(--glass-strong); --card: var(--glass-fill); --card-border: var(--glass-line); -webkit-backdrop-filter: var(--glass-fx); backdrop-filter: var(--glass-fx); box-shadow: var(--glass-rim); text-shadow: var(--glass-text); }
  .top { touch-action: none; }
  .grab { display: none; width: 100%; height: 16px; margin: -8px 0 4px; padding: 0; border: 0; background: none; cursor: grab; }
  .grab span { display: block; width: 40px; height: 5px; margin: 0 auto; border-radius: 3px; background: var(--grip); }
  .grab:focus-visible { outline: 2px solid var(--accent); border-radius: 6px; }
  .body { max-height: min(62dvh, 580px); overflow-y: auto; overscroll-behavior: contain; transition: opacity .15s; }
  .card.peek .body { opacity: 0; }
  /* A card with a long list (the vehicle's stops): the list alone scrolls, the facts and buttons stay put. */
  .body:has(> :global(.listscroll)) { display: flex; flex-direction: column; overflow: hidden; }
  .body:has(> :global(.listscroll)) > :global(*) { flex: none; }
  .body:has(> :global(.listscroll)) > :global(.listscroll) { flex: 0 1 auto; }   /* no sliver of it under the header */
  header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  .hd { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; }

  /* The line badge: a solid tile in the line's colour, like the markers and chips. */
  header :global(.pill) { flex: none; display: inline-flex; align-items: center; justify-content: center; min-width: 48px; height: 36px;
    padding: 0 14px; border-radius: 18px; background: var(--c); color: var(--t); font-size: 18px; font-weight: 800; line-height: 1; }
  header :global(h2) { flex: 1; min-width: 0; margin: 0; font-size: 16px; font-weight: 700; letter-spacing: -.01em; color: var(--fg);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* A title that must be read whole (where a bus goes): up to two lines. */
  header :global(h2.wrap) { white-space: normal; line-height: 1.2; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
  header :global(.fresh) { flex: none; display: inline-flex; align-items: center; height: 24px; padding: 0 8px; border-radius: 12px;
    background: var(--control); font-size: 11px; font-weight: 600; line-height: 1; color: var(--muted); font-variant-numeric: tabular-nums; }
  header :global(.fresh.warn) { background: var(--bad-bg); color: var(--late3); }
  .close, .star { flex: none; display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; padding: 0; border: 0;
    border-radius: 50%; background: var(--card); color: var(--fg); cursor: pointer; }
  .close { margin: -4px -4px -4px 0; }
  .star { margin: -4px 0; }
  .close:hover, .star:hover { background: var(--control-hover); color: var(--fg); }
  .star.on { background: color-mix(in srgb, var(--star) 16%, var(--card)); color: var(--star); }
  .star.pin.on { background: color-mix(in srgb, var(--pc) 18%, var(--card)); color: var(--pc); }
  @media (prefers-reduced-motion: reduce) { .card { transition: none !important; } }
  @media (max-width: 719px) {
    .card { left: 12px; right: 12px; bottom: max(12px, env(safe-area-inset-bottom)); width: auto; border-radius: var(--sheet-r);
      padding: 14px 16px 16px; transition: transform .22s ease; }
    .card.dragging { transition: none; }
    .grab { display: block; }
  }
  /* A phone has Back for closing (the mockup's header); × stays on a desktop. */
  @media (max-width: 719px) { .close { display: none; } }
  /* The compact mockups' sheet (as the stop card's): to the screen's edges, the handle on top, a 44px header with 40px circles,
     × to close when no card is below. */
  @media (max-width: 719px) {
    .card.compact { left: 0; right: 0; bottom: 0; border-radius: 24px 24px 0 0; padding: 8px 16px calc(16px + env(safe-area-inset-bottom)); }
    .compact .grab { display: flex; align-items: flex-start; justify-content: center; width: calc(100% + 32px); height: 25px; margin: -8px -16px 0; padding-top: 8px; box-sizing: border-box; }
    .compact .grab span { margin: 0; }
    .compact header { gap: 10px; min-height: 44px; margin-bottom: 12px; }
    .compact .hd { gap: 10px; }
    .compact .close, .compact .star { width: 40px; height: 40px; margin: 0; background: var(--control); }
    .compact .close { display: flex; }
    .compact .star.on { background: color-mix(in srgb, var(--star) 16%, var(--control)); }
    .compact .body { max-height: min(64dvh, 600px); }
  }
  /* A card comes up from below; under a press its round buttons give a little. */
  .card { animation: cardIn .32s cubic-bezier(.2, .8, .2, 1); }
  @keyframes cardIn { from { transform: translateY(28px); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .card { animation: none; } }
  /* Beside the trip planner, not over it (Panel sets data-planner on a computer while it is open). */
  @media (min-width: 900px) { :global(:root[data-planner]) .card { left: calc(32px + var(--col-w, 440px)); } }
  /* A computer (desktop mockups Υ5, Υ6): the left column, from the top of the window down, in the home panel's place. */
  @media (min-width: 720px) { .card { left: 16px; width: var(--col-w, 440px); top: calc(16px + env(safe-area-inset-top)); bottom: auto; max-height: calc(100dvh - 32px - env(safe-area-inset-top)); } .body { max-height: calc(100dvh - 140px - env(safe-area-inset-top)); } }
</style>
