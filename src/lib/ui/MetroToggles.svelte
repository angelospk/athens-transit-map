<script lang="ts">
  import type { AppState } from "../state.svelte";

  // One pin button per metro/tram line; pinned lines are drawn on the map. The layers menu and a
  // station's card both use it, so they show and change the same state.
  let { app, ids }: { app: AppState; ids: string[] } = $props();

  const lines = $derived(ids.flatMap(id => app.metro?.lines.find(l => l.id === id) ?? []));
</script>

<div class="metro" role="group" aria-label="Γραμμές μετρό και τραμ στον χάρτη">
  {#each lines as l (l.id)}
    {@const on = app.metroLines.includes(l.id)}
    <button type="button" style:--c={l.color} aria-pressed={on} title={l.name}
      aria-label="{on ? 'Απόκρυψη' : 'Εμφάνιση'} γραμμής {l.id} στον χάρτη" onclick={() => app.toggleMetroLine(l.id)}>
      {l.id}<span aria-hidden="true">{on ? "✓" : "+"}</span>
    </button>
  {/each}
</div>

<style>
  .metro { display: flex; flex-wrap: wrap; gap: 6px; }
  button { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 0 12px; border: 2px solid var(--c);
    border-radius: 17px; background: none; color: var(--c); font-weight: 700; font-size: 13px; cursor: pointer; }
  button[aria-pressed="true"] { background: var(--c); color: #fff; }
  span { font-weight: 400; opacity: .85; }
</style>
