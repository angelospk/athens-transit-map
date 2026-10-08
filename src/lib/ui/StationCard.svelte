<script lang="ts">
  import type { AppState } from "../state.svelte";
  import MetroToggles from "./MetroToggles.svelte";

  // The tapped metro/tram station: its lines, each pinnable to the map.
  let { app }: { app: AppState } = $props();

  const station = $derived(app.metroStation ? app.metro?.stations.find(s => s.name === app.metroStation) : undefined);
</script>

<svelte:window onkeydown={e => { if (e.key === "Escape" && app.metroStation) app.selectStation(null); }} />

{#if station}
  <section class="card" aria-live="polite" aria-label="Σταθμός {station.name}">
    <header>
      <h2>{station.name}</h2>
      <button type="button" class="close" aria-label="Κλείσιμο" onclick={() => app.selectStation(null)}>×</button>
    </header>
    <p>Πάτα μια γραμμή για να φαίνεται στον χάρτη. Το ίδιο ρυθμίζεται και στα επίπεδα χάρτη.</p>
    <MetroToggles {app} ids={station.lines} />
    <!-- Off: the stations go from the map and this card closes (app.hideStations says where to turn them back on). -->
    <label class="switch">
      <input type="checkbox" checked={app.metroStations} onchange={e => { if (!e.currentTarget.checked) app.hideStations(); }} />
      <span>Εμφάνιση σταθμών μετρό και τραμ</span>
    </label>
  </section>
{/if}

<style>
  .card { position: absolute; z-index: 6; left: 12px; bottom: 28px; width: 340px; padding: 12px 14px;
    background: var(--panel); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow);
    backdrop-filter: blur(8px); }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  h2 { flex: 1; margin: 0; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  p { margin: 0 0 10px; color: var(--muted); font-size: 12px; }
  .close { width: 36px; height: 36px; margin: -8px -10px -8px 0; border: 0; background: none; font-size: 22px;
    color: var(--muted); cursor: pointer; border-radius: 8px; }
  .close:hover { background: var(--control); }
  .switch { margin: 12px 0 0; padding-top: 10px; border-top: 1px solid var(--border); font-size: 13px; }
  @media (max-width: 719px) {
    .card { left: 0; right: 0; bottom: 0; width: auto; border-radius: 16px 16px 0 0; border-width: 1px 0 0;
      padding: 14px 16px calc(14px + env(safe-area-inset-bottom)); }
  }
</style>
