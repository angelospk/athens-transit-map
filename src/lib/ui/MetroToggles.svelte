<script lang="ts">
  import { termini } from "../metro";
  import type { AppState } from "../state.svelte";

  // One switch per metro/tram line; a line switched on has its track drawn on the map. The layers menu
  // and a station's card both use it, so they show and change the same state.
  let { app, ids }: { app: AppState; ids: string[] } = $props();

  const lines = $derived(ids.flatMap(id => app.metro?.lines.find(l => l.id === id) ?? []));
</script>

<div class="metro" role="group" aria-label="Γραμμές μετρό και τραμ στον χάρτη">
  {#each lines as l (l.id)}
    {@const ends = app.metro && termini(app.metro, l.id)}
    <label class="switch" style:--accent={l.color}>
      <input type="checkbox" role="switch" checked={app.metroLines.includes(l.id)} onchange={() => app.toggleMetroLine(l.id)} />
      <b>{l.id}</b><span>{ends ? `${ends[0]} – ${ends[1]}` : l.name}</span>
    </label>
  {/each}
</div>

<style>
  .switch { align-items: center; margin: 0; min-height: 36px; }
  .switch input { margin: 0; }
  b { flex: none; min-width: 30px; padding: 2px 6px; border-radius: 6px; background: var(--accent); color: #fff;
    font-size: 12px; text-align: center; }
  span { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
