<script lang="ts">
  import type { Snippet } from "svelte";
  import type { AppState } from "../state.svelte";

  // The picked lines (chips), and under them, while the panel's dropdown is open (expanded), the button that opens
  // the search modal (onsearch) and the quick picks (favourites, popular).
  // tail: buttons of the panel, at the right of the first row (the chips, or the search with no chips).
  let { app, expanded = true, onsearch, tail }:
    { app: AppState; expanded?: boolean; onsearch?: () => void; tail?: Snippet } = $props();

  const QUICK = ["040", "550", "Α1", "Χ95", "2"];

  const quick = $derived(QUICK.filter(id => app.lineInfo.has(id) && !app.selected.includes(id)));
  const favs = $derived(app.favorites.filter(id => app.lineInfo.has(id)));
  const favsOff = $derived(favs.filter(id => !app.selected.includes(id)).length);

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
        <li>
          <button
            type="button"
            class="chip"
            style:--c={app.lineColor(id).bg}
            style:--t={app.lineColor(id).fg}
            title={st?.title ?? info?.name}
            aria-label="Αφαίρεση γραμμής {id}"
            onclick={() => app.toggleLine(id)}
          >
            {id}{#if st}<span class="st">{st.icon}</span>{/if}<span class="x" aria-hidden="true">×</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if tail}<div class="tail">{@render tail()}</div>{/if}

  {#if expanded || !app.selected.length}
    <button type="button" class="find" onclick={onsearch}>
      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
        <circle cx="8.5" cy="8.5" r="5.5" /><path d="M12.6 12.6L17 17" />
      </svg>Αναζήτηση γραμμής ή στάσης
    </button>
  {/if}

  {#if expanded && favs.length}
    <!-- Starred lines: each chip shows or hides its line, so several are a tap each. -->
    <div class="quick" role="group" aria-label="Αγαπημένες γραμμές">
      <span aria-hidden="true">★</span>
      {#each favs as id (id)}
        {@const on = app.selected.includes(id)}
        <button type="button" class="fav" style:--c={app.lineColor(id).bg} style:--t={app.lineColor(id).fg} aria-pressed={on}
          aria-label="{on ? 'Απόκρυψη' : 'Εμφάνιση'} γραμμής {id}" onclick={() => app.toggleLine(id)}>{id}</button>
      {/each}
      {#if favs.length > 1 && favsOff}
        <button type="button" class="all" onclick={() => app.showFavorites()}>Όλες</button>
      {/if}
    </div>
  {:else if expanded && !app.selected.length && quick.length}
    <div class="quick">
      <span>Δημοφιλείς:</span>
      {#each quick as id (id)}
        <button type="button" class="q" style:--c={app.lineInfo.get(id)?.color} onclick={() => app.toggleLine(id)}>{id}</button>
      {/each}
    </div>
    <div class="tip">Πάτα ☆ σε μια γραμμή ή στάση για να μπει στα αγαπημένα.</div>
  {/if}

</div>

<style>
  .picker { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 4px; align-items: start; }
  .chips { grid-column: 1; grid-row: 1; display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 8px; padding: 0; list-style: none; }
  .folded .chips { margin-bottom: 0; }   /* nothing under them */
  /* The panel's buttons: beside the chips, or, with no chips, beside the search. */
  .tail { grid-column: 2; grid-row: 1; display: flex; align-items: center; gap: 2px; margin: -4px -6px 0 0; }
  .picker:not(.chipped) .find { grid-column: 1; grid-row: 1; }
  .chipped .find { grid-column: 1 / -1; grid-row: 2; }
  .find { display: inline-flex; align-items: center; justify-self: start; gap: 6px; min-height: 36px; padding: 0 12px;
    border: 0; border-radius: 18px; background: var(--control); color: var(--muted); font-size: 13px; cursor: pointer; }
  .find:hover { background: var(--control-hover); }
  .quick, .tip { grid-column: 1 / -1; }
  .chip { display: inline-flex; align-items: center; gap: 4px; min-height: 32px; padding: 0 10px; border: 0;
    border-radius: 16px; background: var(--c); color: var(--t); font-weight: 700; cursor: pointer; }
  .chip .x { opacity: .8; font-weight: 400; margin-left: 2px; }
  .chip .st { display: inline-grid; place-items: center; width: 16px; height: 16px; border-radius: 50%;
    background: rgba(0, 0, 0, .3); font-size: 11px; }
  .quick { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; color: var(--muted); font-size: 12px; }
  .q { min-height: 32px; padding: 0 10px; border: 0; border-radius: 16px; background: var(--c, #3b5bdb); color: #fff;
    font-weight: 700; cursor: pointer; }
  .fav { min-height: 32px; padding: 0 10px; border: 2px solid var(--c, #3b5bdb); border-radius: 16px; background: none;
    color: var(--fg); font-weight: 700; cursor: pointer; }
  .fav[aria-pressed="true"] { background: var(--c, #3b5bdb); color: var(--t, #fff); }
  .all { min-height: 32px; padding: 0 10px; border: 1px solid var(--border); border-radius: 16px; background: var(--control);
    font-size: 12px; cursor: pointer; }
  .tip { margin-top: 6px; color: var(--muted); font-size: 11px; }
</style>
