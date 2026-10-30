<script lang="ts">
  // «‹ <the card below>» in a card's header, while there is a card below; Back in the browser does the same.
  import { cardTitle } from "../legacy";
  import type { AppState } from "../state.svelte";

  let { app }: { app: AppState } = $props();
  const below = $derived(app.stack.length > 1 ? app.stack[app.stack.length - 2] : null);
</script>

{#if below}
  <button type="button" class="back" title="Πίσω: {cardTitle(below)}" aria-label="Πίσω στο {cardTitle(below)}"
    onclick={() => app.back()}><span aria-hidden="true">‹</span><span class="t">{cardTitle(below)}</span></button>
{/if}

<style>
  .back {
    flex: none; display: inline-flex; align-items: center; gap: 2px; max-width: 40%; min-height: 32px; padding: 0 8px 0 4px;
    border: 0; border-radius: 8px; background: var(--control); color: var(--fg); font: inherit; font-size: 13px; cursor: pointer;
  }
  .back span[aria-hidden] { font-size: 20px; line-height: 1; }
  .back .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .back:hover { background: var(--control-hover); }
  /* On a phone the label would squeeze the card's title: the arrow alone, the label stays in aria-label. */
  @media (max-width: 480px) {
    .back { min-width: 44px; min-height: 44px; justify-content: center; padding: 0; }
    .back .t { display: none; }
  }
</style>
