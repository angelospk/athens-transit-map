<script lang="ts">
  import { fetchSuburban } from "../api";
  import { trainRows, type Train } from "../suburban";
  import { athensClock } from "../timetable";
  import type { AppState } from "../state.svelte";

  // The tapped suburban station: its corridors and its live board (railway.gov.gr through the backend),
  // asked again every 60 s while the card is open and the tab visible (the server caches 60 s).
  let { app }: { app: AppState } = $props();

  const station = $derived(app.railStation ? app.suburban?.stations.find(s => s.id === app.railStation) : undefined);
  const corridors = $derived([...new Set(station?.corridors ?? [])].flatMap(id => app.suburban?.corridors[id] ?? []));

  const REFRESH_MS = 60_000;
  let trains = $state.raw<Train[] | null>(null);
  let failed = $state<"" | "upstream" | "error">("");
  let now = $state(Date.now());
  const rows = $derived(trains ? trainRows(trains, athensClock(now, new Date(now).toLocaleDateString("sv-SE", { timeZone: "Europe/Athens" }))) : []);

  $effect(() => {
    const id = station?.id;
    if (!id) return;
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    trains = null;
    failed = "";
    const load = async () => {
      if (busy) return;
      clearTimeout(timer);
      if (document.visibilityState !== "hidden") {
        busy = true;
        const r = await fetchSuburban(id, AbortSignal.any([ac.signal, AbortSignal.timeout(10_000)]));
        busy = false;
        if (ac.signal.aborted) return;
        now = Date.now();
        const deps = (r.body as { departures?: unknown } | null)?.departures;
        const ok = r.status === 200 && Array.isArray(deps);
        trains = ok ? (deps as Train[]) : null;
        failed = ok ? "" : r.status === 502 ? "upstream" : "error";
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
    <p class="lines">{#each corridors as c (c.name)}<span style:--accent={c.color}>{c.name}</span>{/each}</p>
    {#if trains}
      {#if rows.length}
        <ul class="deps" aria-label="Επόμενα τρένα">
          {#each rows as r, i (i)}
            <li>
              <b class:late={(r.delay ?? 0) > 0}>{r.expected}</b>
              <span class="to">→ {r.to}</span>
              {#if (r.delay ?? 0) > 0}<span class="delay" title="Προγραμματισμένο {r.t}">+{r.delay}′</span>{/if}
              {#if r.platform}<span class="pf" title="Αποβάθρα">Αποβ. {r.platform}</span>{/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p>Κανένα τρένο στον πίνακα τώρα.</p>
      {/if}
      <p class="src">Ζωντανά από τη Hellenic Train (railway.gov.gr).</p>
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
  .lines span { padding: 1px 7px; border-radius: 6px; background: var(--accent); color: #fff; font-size: 11px; font-weight: 600; }
  .deps { list-style: none; margin: 0 0 4px; padding: 0; }
  .deps li { display: flex; align-items: center; gap: 8px; min-height: 28px; font-size: 13px; }
  .deps b { flex: none; font-variant-numeric: tabular-nums; }
  .deps b.late, .delay { color: var(--late2); }
  .to { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .delay { flex: none; font-weight: 600; }
  .pf { flex: none; color: var(--muted); font-size: 12px; }
  .src { margin: 6px 0 0; font-size: 11px; }
  .close { width: 36px; height: 36px; margin: -8px -10px -8px 0; border: 0; background: none; font-size: 22px;
    color: var(--muted); cursor: pointer; border-radius: 8px; }
  .close:hover { background: var(--control); }
  @media (max-width: 719px) {
    .card { left: 0; right: 0; bottom: 0; width: auto; border-radius: 16px 16px 0 0; border-width: 1px 0 0;
      padding: 14px 16px calc(14px + env(safe-area-inset-bottom)); }
  }
</style>
