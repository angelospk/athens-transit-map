<script lang="ts">
  import { fetchSuburban, peekSuburban } from "../api";
  import { trainRows, type Train } from "../suburban";
  import { byDestination, destColor } from "../trains";
  import { athensClock } from "../timetable";
  import type { AppState } from "../state.svelte";
  import type { FetchResult } from "../poller";

  // The tapped suburban station: its corridors and the next trains by destination, in minutes, from the
  // Hellenic Train board (railway.gov.gr through the backend) with the delay when it is not 0. Asked
  // again every 60 s while the card is open and the tab visible (the server caches 60 s).
  let { app }: { app: AppState } = $props();

  const station = $derived(app.railStation ? app.suburban?.stations.find(s => s.id === app.railStation) : undefined);
  const corridors = $derived([...new Set(station?.corridors ?? [])].flatMap(id => { const c = app.suburban?.corridors[id]; return c ? [{ id, ...c }] : []; }));

  const REFRESH_MS = 60_000;
  let trains = $state.raw<Train[] | null>(null);
  let failed = $state<"" | "upstream" | "error">("");
  let now = $state(Date.now());
  const rows = $derived(trains ? trainRows(trains, athensClock(now, new Date(now).toLocaleDateString("sv-SE", { timeZone: "Europe/Athens" }))) : []);
  const groups = $derived(station && app.suburban ? byDestination(rows).map(g => ({ ...g, color: destColor(app.suburban!, station.id, g.to) })) : []);
  const when = (m: number) => (m === 0 ? "τώρα" : `${m}′`);

  const depsOf = (r: FetchResult | undefined) => {
    const deps = (r?.body as { departures?: unknown } | null)?.departures;
    return r?.status === 200 && Array.isArray(deps) ? (deps as Train[]) : null;
  };

  $effect(() => {
    const id = station?.id;
    if (!id) return;
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    now = Date.now();   // the tick stops while the card is closed
    trains = depsOf(peekSuburban(id));   // loaded already by the map: shown at once
    failed = "";
    const load = async () => {
      if (busy) return;
      clearTimeout(timer);
      if (document.visibilityState !== "hidden") {
        busy = true;
        const r = await fetchSuburban(id);
        busy = false;
        if (ac.signal.aborted) return;
        now = Date.now();
        trains = depsOf(r);
        failed = trains ? "" : r.status === 502 ? "upstream" : "error";
      }
      timer = setTimeout(load, REFRESH_MS);
    };
    const shown = () => { if (document.visibilityState === "visible") load(); };
    load();
    const tick = setInterval(() => (now = Date.now()), 15_000);
    document.addEventListener("visibilitychange", shown);
    return () => { ac.abort(); clearTimeout(timer); clearInterval(tick); document.removeEventListener("visibilitychange", shown); };
  });
</script>

<svelte:window onkeydown={e => { if (e.key === "Escape" && app.railStation) app.selectRailStation(null); }} />

{#if station}
  <section class="card" aria-live="polite" aria-label="Σταθμός Προαστιακού {station.name}">
    <header>
      <h2>{station.name}</h2>
      <button type="button" class="close" aria-label="Κλείσιμο" onclick={() => app.selectRailStation(null)}>×</button>
    </header>
    <p class="lines">{#each corridors as c (c.id)}<button type="button" style:--accent={c.color} title="Η γραμμή και τα τρένα της"
      onclick={() => app.selectRailLine({ kind: "suburban", id: c.id })}>{c.name}</button>{/each}</p>
    {#if trains}
      {#if groups.length}
        <ul class="deps" aria-label="Επόμενα τρένα">
          {#each groups as g (g.to)}
            <li><i style:--accent={g.color} aria-hidden="true"></i><span class="to">→ {g.to}</span>
              <span class="when">{#each g.times as t, i (i)}{#if i}{" · "}{/if}{when(t.in)}{#if t.delay}{" "}<em>{t.delay > 0 ? "+" : ""}{t.delay}′</em>{/if}{/each}</span></li>
          {/each}
        </ul>
      {:else}
        <p>Κανένα τρένο στον πίνακα τώρα.</p>
      {/if}
      <p class="src">Πρόγραμμα Hellenic Train.</p>
    {:else if failed}
      <p>{failed === "upstream" ? "Η Hellenic Train δεν απαντά τώρα. Ξαναδοκιμάζω σε ένα λεπτό." : "Δεν φόρτωσαν τα επόμενα τρένα."}</p>
    {:else}
      <p>Φόρτωση επόμενων τρένων…</p>
    {/if}
  </section>
{/if}

<style>
  .card { position: absolute; z-index: 6; left: 12px; bottom: 28px; width: 340px; padding: 12px 14px;
    background: var(--panel); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow);
    backdrop-filter: blur(8px); }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  h2 { flex: 1; margin: 0; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  p { margin: 0 0 10px; color: var(--muted); font-size: 12px; }
  .lines { display: flex; flex-wrap: wrap; gap: 4px 6px; margin-bottom: 8px; }
  .lines button { min-height: 26px; padding: 1px 7px; border: 0; border-radius: 6px; background: var(--accent); color: #fff; font: inherit;
    font-size: 11px; font-weight: 600; cursor: pointer; }
  .deps { list-style: none; margin: 0 0 4px; padding: 0; }
  .deps li { display: flex; align-items: center; gap: 8px; min-height: 28px; font-size: 13px; }
  .deps i { flex: none; width: 6px; height: 18px; border-radius: 3px; background: var(--accent); }
  .to { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .when { flex: none; font-weight: 600; font-variant-numeric: tabular-nums; }
  .when em { font-style: normal; font-size: 11px; color: var(--late2); }
  .src { margin: 6px 0 0; font-size: 11px; }
  .close { width: 36px; height: 36px; margin: -8px -10px -8px 0; border: 0; background: none; font-size: 22px;
    color: var(--muted); cursor: pointer; border-radius: 8px; }
  .close:hover { background: var(--control); }
  @media (max-width: 719px) {
    .card { left: 0; right: 0; bottom: 0; width: auto; border-radius: 16px 16px 0 0; border-width: 1px 0 0;
      padding: 14px 16px calc(14px + env(safe-area-inset-bottom)); }
  }
</style>
