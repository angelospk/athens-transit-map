<script lang="ts">
  import { dayMonth } from "../format";
  import { GTFS_PAGE } from "../sources";

  // The OASA timetable ended on `ended`: a small chip on the ⓘ's row; it opens a short explanation
  // (the info dialog has the long one).
  let { ended, onmore }: { ended: string; onmore: () => void } = $props();

  let open = $state(false);
  let chip: HTMLButtonElement | undefined = $state();
</script>

<!-- Escape closes it first (capture: before the info card's handler clears the selection). -->
<svelte:window onpointerdown={e => { if (open && !(e.target as Element).closest?.(".old, .more")) open = false; }}
  onkeydowncapture={e => { if (e.key === "Escape" && open) { open = false; e.stopPropagation(); chip?.focus(); } }} />

<button type="button" class="old" bind:this={chip} aria-expanded={open} aria-controls="old-note" onclick={() => (open = !open)}>
  ⚠ Παλιό πρόγραμμα <svg viewBox="0 0 12 8" width="9" height="6" aria-hidden="true" class={{ up: open }}><path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
</button>
{#if open}
  <div class="more" id="old-note" role="region" aria-label="Παλιό πρόγραμμα ΟΑΣΑ">
    <p><b>Το πρόγραμμα του ΟΑΣΑ έληξε στις {dayMonth(ended)}.</b> Οι θέσεις των οχημάτων είναι ζωντανές· οι καθυστερήσεις
      και τα δρομολόγια βγαίνουν από το παλιό πρόγραμμα, άρα είναι κατά προσέγγιση. Μόλις βγει νέο, ο χάρτης το παίρνει μόνος του.</p>
    <p class="links">
      <a href={GTFS_PAGE} target="_blank" rel="noopener">Το αρχείο στο data.gov.gr</a>
      <button type="button" onclick={() => { open = false; onmore(); }}>Περισσότερα</button>
    </p>
  </div>
{/if}

<style>
  /* On the row of the map's ⓘ (bottom right: 10px margin, a 24px button), to its left. */
  .old { position: absolute; z-index: 2; right: 40px; bottom: 10px; display: inline-flex; align-items: center; gap: 5px;
    height: 24px; padding: 0 9px; border: 0; border-radius: 12px; background: var(--warn-bg); color: var(--fg); font-size: 11px;
    box-shadow: var(--shadow); cursor: pointer; }
  .old svg { transition: transform .15s; }
  .old svg.up { transform: rotate(180deg); }
  .more { position: absolute; z-index: 2; right: 10px; bottom: 40px; width: min(300px, calc(100% - 20px)); padding: 10px 12px;
    border-radius: 12px; background: var(--warn-bg); color: var(--fg); font-size: 12px; box-shadow: var(--shadow); }
  .more p { margin: 0 0 6px; }
  .more .links { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0; }
  .more a { color: inherit; }
  .more button { min-height: 28px; padding: 0 10px; border: 1px solid currentColor; border-radius: 14px; background: none;
    color: inherit; font-size: 12px; cursor: pointer; }
</style>
