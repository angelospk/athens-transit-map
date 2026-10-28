<script lang="ts">
  import type { AppState } from "../state.svelte";
  import type { FetchResult } from "../poller";
  import { fetchStasy, peekStasy } from "../api";
  import { boardRows, nextBoards, stationNames, type Boards } from "../rail";
  import MetroToggles from "./MetroToggles.svelte";

  // The tapped metro/tram station: its lines, each with the switch that draws it on the map.
  let { app }: { app: AppState } = $props();

  const station = $derived(app.metroStation ? app.metro?.stations.find(s => s.name === app.metroStation) : undefined);

  // The next trains, from the STASY timetable: asked again every 30 s while the card is open and the tab
  // visible (the server caches 30 s; a copy the map loaded is shown at once), the minutes counted down in between.
  const REFRESH_MS = 30_000;
  let st = $state.raw<Boards>({ boards: null, at: 0, failed: "" });
  let now = $state(Date.now());
  const boards = $derived(st.boards), failed = $derived(st.failed);
  const rows = $derived(boards ? boardRows(boards, Math.max(0, (now - st.at) / 1000)) : []);
  const indicative = $derived(boards?.some(b => b.indicative) ?? false);

  $effect(() => {
    const name = station?.name, all = app.metro?.stations;
    if (!name || !all) return;
    const names = stationNames(all, name);
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Loaded already (the map loads the stations on screen while it rests): shown at once.
    const seen = names.map(peekStasy);
    const opened = Date.now();   // not `now`: reading it would rerun this effect on every tick
    now = opened;   // the tick stops while the card is closed
    st = seen.every(r => r) ? nextBoards(seen as FetchResult[], opened) : { boards: null, at: 0, failed: "" };
    let busy = false;   // one round at a time: a tab shown again during one does not start a second loop
    const load = async () => {
      if (busy) return;
      clearTimeout(timer);
      if (document.visibilityState !== "hidden") {
        busy = true;
        // A stalled request must not hold the card on "loading": each gets 10 s.
        const rs = await Promise.all(names.map(fetchStasy));
        busy = false;
        if (ac.signal.aborted) return;
        st = nextBoards(rs, (now = Date.now()));
      }
      timer = setTimeout(load, REFRESH_MS);
    };
    // Back from a hidden tab: ask at once, so rows counted down meanwhile do not read as "no trains".
    const shown = () => { if (document.visibilityState === "visible") load(); };
    load();
    const tick = setInterval(() => (now = Date.now()), 15_000);
    document.addEventListener("visibilitychange", shown);
    return () => { ac.abort(); clearTimeout(timer); clearInterval(tick); document.removeEventListener("visibilitychange", shown); };
  });

  const when = (m: number) => (m === 0 ? "τώρα" : `${m}′`);
</script>

<svelte:window onkeydown={e => { if (e.key === "Escape" && app.metroStation) app.selectStation(null); }} />

{#if station}
  <section class="card" aria-live="polite" aria-label="Σταθμός {station.name}">
    <header>
      <h2>{station.name}</h2>
      <button type="button" class="close" aria-label="Κλείσιμο" onclick={() => app.selectStation(null)}>×</button>
    </header>
    {#if boards}
      {#if rows.length}
        <ul class="deps" aria-label="Επόμενα τρένα">
          {#each rows as r (r.line + r.headsign)}
            <li title={r.times.join(" · ")}><b style:--accent={r.color}>{r.line}</b><span class="to">→ {r.headsign}</span>
              <span class="when">{r.mins.map(when).join(" · ")}</span></li>
          {/each}
        </ul>
      {:else}
        <p>Κανένα τρένο στην επόμενη ώρα.</p>
      {/if}
      <p class="src">{indicative ? "Ενδεικτικά, από" : "Από"} το πρόγραμμα της ΣΤΑΣΥ, όχι live.</p>
    {:else if failed}
      <p>{failed === "warming" ? "Το πρόγραμμα της ΣΤΑΣΥ φορτώνει ακόμη." : "Δεν φόρτωσαν τα επόμενα τρένα."}</p>
    {:else}
      <p>Φόρτωση επόμενων τρένων…</p>
    {/if}
    <p>Άνοιξε μια γραμμή για να φαίνεται η διαδρομή της.</p>
    <MetroToggles {app} ids={station.lines} />
    <p class="hide"><button type="button" class="link" onclick={() => app.setStationsOn(false)}>Κρύψε τους σταθμούς</button>
      Ξανά από το κουμπί με το μάτι → Μετρό.</p>
  </section>
{/if}

<style>
  .card { position: absolute; z-index: 6; left: 12px; bottom: 28px; width: 340px; padding: 12px 14px;
    background: var(--panel); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow);
    backdrop-filter: blur(8px); }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  h2 { flex: 1; margin: 0; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  p { margin: 0 0 10px; color: var(--muted); font-size: 12px; }
  .hide { margin: 10px 0 0; }
  .deps { list-style: none; margin: 0 0 4px; padding: 0; }
  .deps li { display: flex; align-items: center; gap: 8px; min-height: 28px; font-size: 13px; }
  .deps b { flex: none; min-width: 30px; padding: 2px 6px; border-radius: 6px; background: var(--accent); color: #fff;
    font-size: 12px; text-align: center; }
  .to { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .when { flex: none; font-weight: 600; font-variant-numeric: tabular-nums; }
  .src { font-size: 11px; }
  .link { border: 0; background: none; padding: 0 6px 0 0; color: var(--accent); text-decoration: underline; cursor: pointer; font-size: 12px; }
  .close { width: 36px; height: 36px; margin: -8px -10px -8px 0; border: 0; background: none; font-size: 22px;
    color: var(--muted); cursor: pointer; border-radius: 8px; }
  .close:hover { background: var(--control); }
  @media (max-width: 719px) {
    .card { left: 0; right: 0; bottom: 0; width: auto; border-radius: 16px 16px 0 0; border-width: 1px 0 0;
      padding: 14px 16px calc(14px + env(safe-area-inset-bottom)); }
  }
</style>
