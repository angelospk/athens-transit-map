<script lang="ts">
  import type { Snippet } from "svelte";
  import { busId } from "../busNs";
  import type { AppState } from "../state.svelte";
  import Icon from "./Icon.svelte";

  // The picked lines (chips), and under them, while the panel's dropdown is open (expanded), the button that opens
  // the quick picks (favourites, popular).
  // tail: buttons of the panel, at the right of the first row (the chips, or the search with no chips).
  let { app, expanded = true, onsearch, tail }:
    { app: AppState; expanded?: boolean; onsearch?: () => void; tail?: Snippet } = $props();

  const QUICK = ["040", "550", "Α1", "Χ95", "2"];

  const quick = $derived(QUICK.filter(id => app.lineInfo.has(id) && !app.selected.includes(id)));
  const favs = $derived(app.favorites.filter(id => app.lineInfo.has(id)));
  // Only the starred lines not on the map: the chips above already show the others.
  const favsOff = $derived(favs.filter(id => !app.selected.includes(id)));

  const openCard = (id: string) => app.open({ kind: "line", id: busId(id), title: id });
  // A quick pick puts the line on the map and opens its card (not when the 5-line limit refused it).
  function add(id: string) {
    app.toggleLine(id);
    if (app.selected.includes(id)) openCard(id);
  }

  function chipState(id: string) {
    const s = app.pollState[id];
    const age = app.live[id] ? app.serverNow / 1000 - app.live[id].updated_at : 0;
    if (s === "backoff") return { icon: "!", title: "Σφάλμα σύνδεσης, νέα προσπάθεια σε λίγο" };
    if (s === "warming" || s === "loading") return { icon: "…", title: "Φόρτωση" };
    if (age > 120) return { icon: "!", title: "Η γραμμή δεν ανανεώνεται" };
    return null;
  }
</script>

<div class="picker" class:chipped={app.selected.length > 0} class:folded={!expanded}>
  {#if app.selected.length}
    <ul class="chips" aria-label="Επιλεγμένες γραμμές">
      {#each app.selected as id (id)}
        {@const info = app.lineInfo.get(id)}
        {@const st = chipState(id)}
        <!-- A tap on the chip opens the line's card; only its × takes the line off the map. -->
        <li class="chip" style:--c={app.lineColor(id).bg} style:--t={app.lineColor(id).fg}>
          <button type="button" class="open" title={st?.title ?? info?.name} aria-label="Γραμμή {id}: πληροφορίες"
            onclick={() => openCard(id)}>{id}{#if st}<span class="st">{st.icon}</span>{/if}</button>
          <button type="button" class="x" title="Αφαίρεση" aria-label="Αφαίρεση γραμμής {id}"
            onclick={() => app.toggleLine(id)}>×</button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if tail}<div class="tail">{@render tail()}</div>{/if}

  {#if !app.selected.length}
    <!-- The one search, «Πού πας;» (StartScreen); with lines on the map, the glass beside them opens it instead. -->
    <button type="button" class="find" aria-haspopup="dialog" onclick={onsearch}>
      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
        <circle cx="8.5" cy="8.5" r="5.5" /><path d="M12.6 12.6L17 17" />
      </svg><span>Πού πας; Στάση ή γραμμή</span><kbd aria-hidden="true">/</kbd>
    </button>
  {/if}

  {#if expanded && favsOff.length}
    <!-- Starred lines off the map: a tap each puts one on it. -->
    <div class="quick" role="group" aria-label="Αγαπημένες γραμμές εκτός χάρτη">
      <Icon name="star-filled" size={14} />
      {#each favsOff as id (id)}
        <button type="button" class="fav" style:--c={app.lineColor(id).bg} style:--t={app.lineColor(id).fg}
          aria-label="Εμφάνιση γραμμής {id}" onclick={() => add(id)}>{id}</button>
      {/each}
      {#if favsOff.length > 1}
        <button type="button" class="all" onclick={() => app.showFavorites()}>Όλες</button>
      {/if}
    </div>
  {:else if expanded && !app.selected.length && quick.length}
    <div class="quick">
      <span>Δημοφιλείς:</span>
      {#each quick as id (id)}
        <button type="button" class="q" style:--c={app.lineInfo.get(id)?.color} onclick={() => add(id)}>{id}</button>
      {/each}
    </div>
    <div class="tip">Πάτα <Icon name="star" size={12} label="το αστέρι" /> σε μια γραμμή ή στάση για να μπει στα αγαπημένα.</div>
  {/if}

</div>

<style>
  .picker { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 4px; align-items: start; }
  .chips { grid-column: 1; grid-row: 1; display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 10px; padding: 0; list-style: none; }
  .folded .chips { margin-bottom: 0; }   /* nothing under them */
  /* The panel's buttons: beside the chips, or, with no chips, beside the search. */
  .tail { grid-column: 2; grid-row: 1; display: flex; align-items: center; gap: 2px; height: 44px; margin: 0 -6px 0 0; }   /* centred on the search's row */
  .picker:not(.chipped) .find { grid-column: 1; grid-row: 1; }
  .chipped .find { grid-column: 1 / -1; grid-row: 2; justify-self: stretch; }
  .find { display: flex; align-items: center; justify-self: stretch; gap: 10px; min-height: 44px; padding: 0 10px 0 14px;
    border: 0; border-radius: max(14px, calc(var(--radius) - 12px)); background: var(--control); color: var(--muted); font: inherit; font-size: 15px; font-weight: 600; line-height: 1; cursor: pointer; }
  .find svg { color: var(--accent); }
  .find kbd { flex: none; margin-left: auto; min-width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; box-sizing: border-box;
    border: 1px solid var(--border); border-radius: 7px; font: inherit; font-size: 12px; font-weight: 700; color: var(--muted); }
  @media (pointer: coarse) { .find kbd { display: none; } }
  .find:hover { background: var(--control-hover); }
  .find { min-width: 0; max-width: 100%; }
  .find svg { flex: none; }
  .find span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .quick, .tip { grid-column: 1 / -1; }
  /* A line on the map: its chip opens its card, only the × takes it off (two buttons in one chip). */
  .chip { display: inline-flex; align-items: stretch; min-height: 34px; border-radius: 10px; background: var(--c); color: var(--t);
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .06); }
  .chip button { display: inline-flex; align-items: center; gap: 6px; padding: 0; border: 0; background: none; color: inherit;
    font: inherit; font-size: 14px; font-weight: 700; line-height: 1; cursor: pointer; }
  .chip .open { padding: 0 4px 0 12px; }
  .chip .x { min-width: 30px; justify-content: center; padding: 0 6px 0 2px; font-size: 16px; font-weight: 600; opacity: .8; }
  .chip .x:hover { opacity: 1; }
  .chip .st { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%;
    background: rgba(0, 0, 0, .3); font-size: 11px; line-height: 1; }
  .quick { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 10px; color: var(--muted); font-size: 12px; }
  .q { display: inline-flex; align-items: center; min-height: 32px; padding: 0 10px; border: 0; border-radius: 9px;
    background: var(--c, var(--accent)); color: #fff; font-weight: 700; line-height: 1; cursor: pointer; }
  .fav { display: inline-flex; align-items: center; min-height: 32px; padding: 0 10px; border: 2px solid var(--c, var(--accent)); border-radius: 9px;
    background: none; color: var(--fg); font-weight: 700; line-height: 1; cursor: pointer; }
  .all { display: inline-flex; align-items: center; min-height: 32px; padding: 0 12px; border: 0; border-radius: 9px; background: var(--control);
    font-size: 12px; font-weight: 600; line-height: 1; cursor: pointer; }
  .tip { margin-top: 8px; color: var(--muted); font-size: 12px; }
</style>
