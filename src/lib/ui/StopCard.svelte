<script lang="ts">
  import { fetchStop, peekStop } from "../api";
  import { arrivalGroups, linesAt, timeText, toward, twins, type StopBoard } from "../stops";
  import type { AppState } from "../state.svelte";
  import type { FetchResult } from "../poller";

  // The tapped bus stop: the lines that call there (a tap shows the line), the buses on their way to it
  // by line and headsign (backend, from GPS: timetable time plus each bus's delay), and the stop of the
  // same name across the street. Asked again every 20 s while open and the tab visible (cached 15 s).
  let { app }: { app: AppState } = $props();

  const ix = $derived(app.stopIx);
  const i = $derived(app.busStop);
  const stop = $derived(ix && i != null ? ix.s[i] : undefined);
  const lines = $derived(ix && i != null ? linesAt(ix, i) : []);
  const across = $derived(ix && i != null ? twins(ix, i)[0] : undefined);

  const REFRESH_MS = 20_000;
  let board = $state.raw<StopBoard | null>(null);
  let failed = $state(false);
  let now = $state(Date.now());   // set from app.serverMs() when a stop opens
  const groups = $derived(board ? arrivalGroups(board.arrivals, now) : []);
  const variantsOf = (line: string) => lines.find(l => l.line === line)?.variants ?? [];

  const boardOf = (r: FetchResult | undefined) => {
    const b = r?.body as StopBoard | null | undefined;
    return r?.status === 200 && b && Array.isArray(b.arrivals) ? b : null;
  };

  $effect(() => {
    const id = stop?.[3];
    board = null;
    failed = !id;   // an index from before the ids: no live arrivals
    if (!id) return;
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    now = app.serverMs();
    board = boardOf(peekStop(id));
    const load = async () => {
      if (busy) return;
      clearTimeout(timer);
      if (document.visibilityState !== "hidden") {
        busy = true;
        const r = await fetchStop(id);
        busy = false;
        if (ac.signal.aborted) return;
        now = app.serverMs();
        const b = boardOf(r);
        if (b) board = b;
        failed = !b;
      }
      timer = setTimeout(load, REFRESH_MS);
    };
    const shown = () => { if (document.visibilityState === "visible") load(); };
    load();
    const tick = setInterval(() => (now = app.serverMs()), 10_000);
    document.addEventListener("visibilitychange", shown);
    return () => { ac.abort(); clearTimeout(timer); clearInterval(tick); document.removeEventListener("visibilitychange", shown); };
  });
</script>

<svelte:window onkeydown={e => { if (e.key === "Escape" && app.busStop != null) app.selectBusStop(null); }} />

{#if stop}
  <section class="card" aria-live="polite" aria-label="Στάση {stop[0]}">
    <header>
      <h2>{stop[0]}</h2>
      <button type="button" class="close" aria-label="Κλείσιμο" onclick={() => app.selectBusStop(null)}>×</button>
    </header>
    {#if across}
      <button type="button" class="across" onclick={() => app.selectBusStop(across.i)}>Απέναντι στάση · {across.m} μ</button>
    {/if}
    <div class="lines" role="group" aria-label="Γραμμές της στάσης">
      {#each lines as l (l.line)}
        {@const c = app.lineColor(l.line)}
        <button type="button" style:--bg={c.bg} style:--fg={c.fg} aria-label="Γραμμή {l.line}"
          onclick={() => app.openLineAt(l.line, l.variants)}>{l.line}</button>
      {/each}
    </div>
    {#if board}
      {#if groups.length}
        <ul class="arr" aria-label="Επόμενα λεωφορεία">
          {#each groups as g (g.line + g.headsign)}
            {@const c = app.lineColor(g.line)}
            <li><button type="button" onclick={() => app.openLineAt(g.line, g.variant ? [g.variant] : variantsOf(g.line), g.times[0].vehicle)}>
              <b style:--bg={c.bg} style:--fg={c.fg}>{g.line}</b><span class="to" title={g.headsign}>→ {toward(g.headsign)}{#if g.times[0].away}<small>σε {g.times[0].away} στάσεις</small>{/if}</span>
              <span class="when">{#each g.times as t, k (k)}{#if k}{" · "}{/if}{timeText(t)}{#if t.late >= 2}{" "}<em>+{t.late}′</em>{/if}{/each}</span>
            </button></li>
          {/each}
        </ul>
      {:else}
        <p>Κανένα λεωφορείο καθ’ οδόν τώρα.</p>
      {/if}
      <p class="src">Ζωντανά, από το GPS των λεωφορείων.{#if failed}{" "}Η τελευταία ενημέρωση απέτυχε.{/if}</p>
    {:else if failed}
      <p>{stop[3] ? "Δεν φόρτωσαν οι αφίξεις. Ξαναδοκιμάζω σε 20″." : "Οι αφίξεις δεν είναι διαθέσιμες. Ανανέωσε τη σελίδα."}</p>
    {:else}
      <p>Φόρτωση αφίξεων…</p>
    {/if}
  </section>
{/if}

<style>
  .card { position: absolute; z-index: 6; left: 12px; bottom: 28px; width: 340px; padding: 12px 14px;
    background: var(--panel); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow);
    backdrop-filter: blur(8px); }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; }
  h2 { flex: 1; margin: 0; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  p { margin: 0 0 10px; color: var(--muted); font-size: 12px; }
  .across { display: inline-block; margin: 0 0 8px; padding: 0; border: 0; background: none; color: var(--accent);
    font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; text-underline-offset: 3px; }
  .across:hover { text-decoration: underline; }
  .lines { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
  .lines button, .arr b { min-width: 34px; padding: 2px 7px; border: 0; border-radius: 6px; background: var(--bg); color: var(--fg);
    font: inherit; font-size: 12px; font-weight: 700; text-align: center; font-variant-numeric: tabular-nums; }
  .lines button { min-height: 28px; cursor: pointer; }
  .arr { list-style: none; margin: 0 0 4px; padding: 0; max-height: 40vh; overflow-y: auto; }
  .arr button { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 36px; padding: 0 4px; margin: 0 -4px;
    border: 0; border-radius: 8px; background: none; color: inherit; font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
  .arr button:hover { background: var(--control); }
  .arr b { flex: none; }
  .to { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .to small { display: block; margin-top: -1px; font-size: 11px; line-height: 13px; color: var(--muted); }
  .when { flex: none; font-weight: 600; font-variant-numeric: tabular-nums; }
  .when em { font-style: normal; font-size: 11px; color: var(--late2); }
  .src { margin: 6px 0 0; font-size: 11px; }
  .close { width: 36px; height: 36px; margin: -8px -10px -8px 0; border: 0; background: none; font-size: 22px;
    color: var(--muted); cursor: pointer; border-radius: 8px; }
  .close:hover { background: var(--control); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @media (max-width: 719px) {
    .card { left: 0; right: 0; bottom: 0; width: auto; border-radius: 16px 16px 0 0; border-width: 1px 0 0;
      padding: 14px 16px calc(14px + env(safe-area-inset-bottom)); }
    .arr { max-height: 30vh; }
  }
</style>
