<script lang="ts">
  // The round ‹ at the start of a card's header (as in the mockup): back to the card below, or, with none, closed
  // (the map, or the tab the card was opened from). Back in the browser does the same.
  import { cardTitle } from "../legacy";
  import type { AppState } from "../state.svelte";
  import Icon from "./Icon.svelte";

  let { app, onclose }: { app: AppState; onclose?: () => void } = $props();
  const below = $derived(app.stack.length > 1 ? app.stack[app.stack.length - 2] : null);
  const label = $derived(below ? `Πίσω στο ${cardTitle(below)}` : "Πίσω");
</script>

<button type="button" class="back" title={label} aria-label={label}
  onclick={() => (below ? app.back() : (onclose ?? (() => app.closeCards()))())}><Icon name="back" size={20} /></button>

<style>
  .back { flex: none; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0;
    border-radius: 50%; background: var(--card); box-shadow: inset 0 0 0 1px var(--card-border), 0 2px 8px rgb(0 0 0 / .25); color: var(--fg); cursor: pointer; }
  .back:hover { background: var(--control-hover); }
  .back:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
