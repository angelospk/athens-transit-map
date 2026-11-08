<script lang="ts">
  // «Εισιτήρια» (fares.ts): OASA's tickets and cards, full or reduced, and «Τι σε συμφέρει;» for a month of rides.
  // Opened from a trip's ticket row. A sheet from the bottom on a phone, a dialog on a computer.
  import { tick } from "svelte";
  import type { AppState } from "../state.svelte";
  import { FARE, bestBuy, euro, type Price } from "../fares";
  import Icon from "./Icon.svelte";

  let { app }: { app: AppState } = $props();

  let trips = $state(2);
  let days = $state(22);
  let box: HTMLElement | undefined = $state();
  let opener: Element | null = null;
  const red = $derived(app.fareReduced);
  const cmp = $derived(bestBuy(trips, days, red));

  $effect(() => {
    if (!app.faresOpen) return;
    opener = document.activeElement;
    void tick().then(() => box?.focus());
  });
  function close() {
    app.faresOpen = false;
    const o = opener as HTMLElement | null;
    opener = null;
    void tick().then(() => o?.focus?.());
  }
  const GROUPS: { title: string; rows: [string, string, Price][] }[] = [
    { title: "Για λίγες διαδρομές", rows: [
      ["90 λεπτών", "Λεωφορεία, τρόλεϊ, τραμ, μετρό, προαστιακός · όσες αλλαγές θες", FARE.single],
      ["Ημερήσιο", "24 ώρες · και το X80", FARE.daily],
      ["5 ημερών", "5 × 24 ώρες", FARE.five],
      ["Τουριστικό 3 ημερών", "Μαζί μία πήγαινε-έλα στο αεροδρόμιο", FARE.tourist3]] },
    { title: "Κάρτες", rows: [
      ["30 ημερών", "Όλη η πόλη, χωρίς το αεροδρόμιο", FARE.month],
      ["30 ημερών, όλα τα δίκτυα", "Και το αεροδρόμιο, εκτός X80", FARE.monthAll],
      ["365 ημερών", "Όλη η πόλη, χωρίς το αεροδρόμιο", FARE.year]] },
    { title: "Αεροδρόμιο", rows: [
      ["Μετρό αεροδρομίου", "90′ σε όλα τα μέσα · και ο προαστιακός", FARE.airport],
      ["Από Παλλήνη, Κάντζα ή Κορωπί", "Μετρό αεροδρομίου, 90′", FARE.airportNear],
      ["Express (X93, X95, X96, X97)", "Μία διαδρομή", FARE.express]] },
  ];
  function portal(node: HTMLElement) {
    document.body.append(node);
    return { destroy: () => node.remove() };
  }
</script>

{#if app.faresOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions (Escape closes) -->
  <div class="scrim" use:portal onclick={e => { if (e.target === e.currentTarget) close(); }}
    onkeydown={e => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="fares-h" tabindex="-1" bind:this={box}>
      <span class="grip" aria-hidden="true"></span>
      <div class="head">
        <h2 id="fares-h">Εισιτήρια</h2>
        <div class="seg" role="radiogroup" aria-label="Κόμιστρο">
          <button type="button" role="radio" aria-checked={!red} onclick={() => app.setFareReduced(false)}>Κανονικό</button>
          <button type="button" role="radio" aria-checked={red} onclick={() => app.setFareReduced(true)}>Μειωμένο</button>
        </div>
        <button type="button" class="x" aria-label="Κλείσιμο" onclick={close}><Icon name="close" size={16} /></button>
      </div>

      <section class="calc" aria-labelledby="fares-calc">
        <b id="fares-calc">Τι σε συμφέρει;</b>
        <div class="crow">
          <span>Διαδρομές τη μέρα</span>
          <span class="step">
            <button type="button" aria-label="Λιγότερες" disabled={trips <= 1} onclick={() => (trips = Math.max(1, trips - 1))}><svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M4.5 10h11" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg></button>
            <b aria-live="polite">{trips}</b>
            <button type="button" aria-label="Περισσότερες" disabled={trips >= 8} onclick={() => (trips = Math.min(8, trips + 1))}><svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg></button>
          </span>
        </div>
        <div class="crow col">
          <span id="fares-days">Μέρες τον μήνα</span>
          <div class="seg wide" role="radiogroup" aria-labelledby="fares-days">
            {#each [5, 10, 22, 30] as d (d)}<button type="button" role="radio" aria-checked={days === d} onclick={() => (days = d)}>{d}</button>{/each}
          </div>
        </div>
        <ul class="cmp">
          {#each cmp as c (c.key)}
            <li class:best={c.best}><span>{c.label}</span>{#if c.best}<em>Φθηνότερο</em>{/if}<b>{euro(c.cost)}</b></li>
          {/each}
        </ul>
      </section>

      {#each GROUPS as g (g.title)}
        <section class="grp">
          <h3>{g.title}</h3>
          <ul>
            {#each g.rows as [name, note, price] (name)}
              <li><span class="nt"><b>{name}</b><small>{note}</small></span>
                <b class="pr" class:none={red && price[1] == null}>{red && price[1] == null ? "Χωρίς μειωμένο" : euro(red && price[1] != null ? price[1] : price[0])}</b></li>
            {/each}
          </ul>
        </section>
      {/each}
      <p class="foot">Με ανέπαφη κάρτα ή κινητό πληρώνεις μόνο το κανονικό. Τα μειωμένα και οι κάρτες ημερών θέλουν προσωποποιημένη κάρτα ATH.ENA.
        Τιμές από το <a href="https://www.oasa.gr/en/tickets/prices-of-products/" target="_blank" rel="noopener">oasa.gr</a>.</p>
    </div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 1500; display: flex; align-items: center; justify-content: center; background: rgba(8, 10, 14, .45); animation: fade .15s ease; }
  .sheet { width: 440px; max-width: calc(100% - 24px); max-height: calc(100dvh - 48px); overflow-y: auto; scrollbar-width: none; box-sizing: border-box;
    display: flex; flex-direction: column; gap: 16px; padding: 18px; border-radius: 24px; background: var(--surface); color: var(--fg);
    box-shadow: 0 30px 80px rgba(0, 0, 0, .5); animation: rise .22s cubic-bezier(.2, .8, .2, 1); outline: none; }
  .sheet::-webkit-scrollbar { display: none; }
  .grip { display: none; }
  .head { display: flex; align-items: center; gap: 10px; }
  h2 { flex: 1; margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -.02em; line-height: 1; }
  .x { flex: none; display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; padding: 0; border: 0; border-radius: 50%;
    background: var(--control); color: var(--muted); cursor: pointer; }
  .seg { display: flex; gap: 3px; padding: 3px; border-radius: 12px; background: var(--control); }
  .seg button { height: 32px; display: flex; align-items: center; justify-content: center; padding: 0 12px; border: 0; border-radius: 9px; background: none;
    color: var(--muted); font: inherit; font-size: 12.5px; font-weight: 700; line-height: 1; cursor: pointer; }
  .seg button[aria-checked="true"] { background: var(--surface); color: var(--fg); box-shadow: 0 1px 3px rgba(0, 0, 0, .18); }
  .seg.wide { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .seg.wide button { height: 36px; }
  .calc { display: flex; flex-direction: column; gap: 14px; padding: 16px; border-radius: 18px; background: var(--card); border: 1px solid var(--card-border); }
  .calc > b { font-size: 16px; font-weight: 800; line-height: 1; }
  .crow { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 14px; color: var(--muted); }
  .crow.col { flex-direction: column; align-items: stretch; gap: 8px; }
  .step { display: flex; align-items: center; gap: 4px; }
  .step b { width: 34px; text-align: center; font-size: 18px; font-weight: 800; color: var(--fg); line-height: 1; font-variant-numeric: tabular-nums; }
  .step button { width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 50%;
    background: var(--control-hover); color: var(--fg); cursor: pointer; }
  .step button:disabled { opacity: .4; cursor: default; }
  .cmp { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .cmp li { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 12px; border-radius: 12px; border: 1px solid var(--card-border); font-size: 14px; }
  .cmp li span { flex: 1; min-width: 0; font-weight: 600; line-height: 1.2; }
  .cmp li b { font-size: 16px; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; }
  .cmp li.best { border-color: color-mix(in srgb, var(--ontime) 40%, transparent); background: color-mix(in srgb, var(--ontime) 9%, transparent); }
  .cmp li.best b { color: var(--ontime); }
  .cmp em { height: 22px; display: flex; align-items: center; padding: 0 8px; border-radius: 11px; background: var(--ontime); color: #fff;
    font-size: 11px; font-weight: 800; font-style: normal; line-height: 1; }
  .grp { display: flex; flex-direction: column; gap: 6px; }
  h3 { margin: 0 0 2px 4px; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); line-height: 1; }
  .grp ul { list-style: none; margin: 0; padding: 0; border-radius: 16px; background: var(--card); border: 1px solid var(--card-border); }
  .grp li { display: flex; align-items: center; gap: 12px; min-height: 60px; padding: 8px 14px; box-sizing: border-box; }
  .grp li + li { border-top: 1px solid var(--card-border); }
  .nt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .nt b { font-size: 14.5px; font-weight: 700; line-height: 1.2; }
  .nt small { font-size: 12px; line-height: 1.3; color: var(--muted); }
  .pr { flex: none; font-size: 16px; font-weight: 800; line-height: 1; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .pr.none { font-size: 12px; font-weight: 600; color: var(--muted); }
  .foot { margin: 0; font-size: 12px; line-height: 1.5; color: var(--muted); }
  .foot a { color: var(--accent); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @keyframes fade { from { opacity: 0; } }
  @keyframes rise { from { transform: translateY(24px); opacity: 0; } }
  @media (max-width: 719px) {
    .scrim { align-items: flex-end; }
    .sheet { width: 100%; max-width: none; max-height: calc(100dvh - 40px); margin: 0 8px max(8px, env(safe-area-inset-bottom)); padding: 10px 16px 16px; border-radius: 26px; }
    .grip { display: block; align-self: center; flex: none; width: 40px; height: 4px; border-radius: 2px; background: var(--grip); }
  }
  @media (prefers-reduced-motion: reduce) { .scrim, .sheet { animation: none; } }
</style>
