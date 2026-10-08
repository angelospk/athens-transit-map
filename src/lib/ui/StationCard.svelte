<script lang="ts">
  import type { AppState } from "../state.svelte";
  import MetroToggles from "./MetroToggles.svelte";

  // The tapped metro/tram station: its lines, each with the switch that draws it on the map.
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
    <p>Άνοιξε μια γραμμή για να φαίνεται η διαδρομή της στον χάρτη. Είναι οι ίδιοι διακόπτες με το 👁 → Μετρό.</p>
    <MetroToggles {app} ids={station.lines} />
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
  @media (max-width: 719px) {
    .card { left: 0; right: 0; bottom: 0; width: auto; border-radius: 16px 16px 0 0; border-width: 1px 0 0;
      padding: 14px 16px calc(14px + env(safe-area-inset-bottom)); }
  }
</style>
