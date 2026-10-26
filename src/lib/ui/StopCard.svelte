<script lang="ts">
  import { isStalePos } from "../format";
  import type { AppState } from "../state.svelte";
  import { etaLabel, groupRows, oasaGroups, stopLines } from "../stopboard";

  // The tapped bus stop: its lines by direction, each with the next buses coming and in about how many
  // minutes (stopboard.ts). A row opens its next bus.
  let { app }: { app: AppState } = $props();

  const info = $derived(app.stopInfo);
  const groups = $derived(info ? app.stopOasa
    ? oasaGroups(app.stopOasa, app.stopRows, info.serve, app.stopStatics)
    : groupRows(app.stopRows, info.serve, app.stopStatics) : []);
  const nowS = $derived(app.serverNow / 1000);
  // A changed OASA route may be absent from our GTFS; still show its prediction.
  const unmapped = $derived(app.stopOasa?.arrivals.filter(a => app.stopOasa!.updated_at + a.minutes * 60 >= nowS - 30
    && !app.stopRows.some(r => r.variant === a.route_code)) ?? []);
  // The stops of the same name across the street, with their lines.
  const across = $derived(info && app.stopIndex
    ? info.twins.map(k => ({ k, lines: stopLines(app.stopIndex!, k).serve.map(l => l.line) })) : []);
</script>

<svelte:window onkeydown={e => { if (e.key === "Escape" && app.stop != null) app.selectStop(null); }} />

{#if info}
  <section class="card" aria-live="polite" aria-label="Στάση {info.name}">
    <header>
      <h2>{info.name}</h2>
      <button type="button" class="close" aria-label="Κλείσιμο" onclick={() => app.selectStop(null)}>×</button>
    </header>
    {#if across.length}
      <p class="across">
        {#each across as t (t.k)}
          <button type="button" class="link" onclick={() => app.selectStop(t.k)}>Απέναντι{t.lines.length ? `: ${t.lines.join(", ")}` : ""}</button>
        {/each}
      </p>
    {/if}
    {#if !info.id}
      <p>Ξαναφόρτωσε τη σελίδα για να δεις τα λεωφορεία που έρχονται.</p>
    {:else if groups.length}
      <ul>
        {#each groups as g (`${g.line}|${g.variants.join()}`)}
          {@const next = g.rows[0]}
          {@const bus = g.rows.find(r => r.vehicle)}
          {@const c = app.lineColor(g.line)}
          <li>
            <button type="button" class="row" disabled={!bus?.vehicle} onclick={() => bus?.vehicle && app.selectCityVehicle(g.line, bus.vehicle)}
              aria-label="Γραμμή {g.line}{g.to ? ` προς ${g.to}` : ""}{next ? `, σε ${etaLabel(next.etaS, nowS)}` : app.stopOasa ? ", καμία πρόβλεψη ΟΑΣΑ" : ", κανένα λεωφορείο κοντά"}">
              <span class="pill" style:--c={c.bg} style:--t={c.fg}>{g.line}</span>
              <span class="to">{g.to ? `→ ${g.to}` : ""}</span>
              <span class="etas">
                {#each g.rows.slice(0, 2) as r (r.vehicle ?? `trip@${r.etaS}`)}
                  <b class:stale={isStalePos(r.ageS)} class:sched={!r.vehicle}
                    title={app.stopOasa ? "Πρόβλεψη άφιξης ΟΑΣΑ" : !r.vehicle ? "Από το πρόγραμμα· κανένα λεωφορείο ακόμα" : r.stopsAway == null ? "" : r.stopsAway === 1 ? "Επόμενη στάση του" : `${r.stopsAway} στάσεις πριν`}>{etaLabel(r.etaS, nowS)}</b>
                {:else}
                  <i>{app.stopOasa ? "καμία πρόβλεψη" : app.stopReady ? "κανένα κοντά" : "…"}</i>
                {/each}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p>Κανένα λεωφορείο δεν ξεκινά από εδώ.</p>
    {/if}
    {#if info.end.length}<p>Τέρμα για: {info.end.join(", ")}</p>{/if}
    {#if unmapped.length}
      <p>Προβλέψεις ΟΑΣΑ χωρίς αντιστοίχιση γραμμής στο πρόγραμμα:</p>
      <ul>
        {#each unmapped as a, i (`${a.route_code}|${a.veh_code}|${i}`)}
          <li class="unmapped">Διαδρομή {a.route_code}: {etaLabel(app.stopOasa!.updated_at + a.minutes * 60, nowS)}</li>
        {/each}
      </ul>
    {/if}
    <p class="note">
      {#if app.stopOasa}
        Χρόνοι άφιξης ΟΑΣΑ · ενημέρωση πριν {Math.max(0, Math.floor(nowS - app.stopOasa.updated_at))}″ · ανανέωση κάθε 30″.
      {:else if app.stopOasaState === "loading"}
        Αναζήτηση χρόνων άφιξης ΟΑΣΑ…
      {:else}
        {#if app.stopOasaState === "error"}Οι χρόνοι ΟΑΣΑ δεν είναι διαθέσιμοι. {/if}
        Περίπου, από τη θέση κάθε λεωφορείου και τις συνήθεις ταχύτητες· όχι οι χρόνοι του ΟΑΣΑ.
      {/if}
    </p>
  </section>
{/if}

<style>
  .card { position: absolute; z-index: 6; left: 12px; bottom: 28px; width: 340px; max-height: min(60dvh, 520px);
    display: flex; flex-direction: column; padding: 12px 14px;
    background: var(--panel); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow);
    backdrop-filter: blur(8px); }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  h2 { flex: 1; margin: 0; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  p { margin: 0 0 8px; color: var(--muted); font-size: 12px; }
  .across { display: flex; flex-wrap: wrap; gap: 4px 12px; }
  .link { border: 0; background: none; padding: 0; color: var(--accent); text-decoration: underline; cursor: pointer; font-size: 12px; text-align: left; }
  ul { min-height: 0; margin: 0 -6px 8px; padding: 0; overflow-y: auto; list-style: none; }
  .row { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 40px; padding: 4px 6px; border: 0; border-radius: 8px;
    background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
  .row:hover:not(:disabled) { background: var(--control); }
  .row:disabled { cursor: default; }
  .pill { flex: none; min-width: 34px; padding: 2px 8px; border-radius: 10px; background: var(--c); color: var(--t);
    font-weight: 700; text-align: center; }
  .to { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
  .etas { flex: none; display: flex; gap: 10px; font-variant-numeric: tabular-nums; }
  .etas b { min-width: 2.2em; text-align: right; font-size: 15px; }
  .etas b + b { font-weight: 500; color: var(--muted); }
  .etas b.stale { opacity: .55; }
  .etas b.sched { font-style: italic; font-weight: 400; }
  .etas i { font-style: normal; font-size: 12px; color: var(--muted); }
  .note { margin: 0; font-size: 11px; }
  .unmapped { margin: 0 6px 4px; font-size: 12px; color: var(--muted); }
  .close { width: 36px; height: 36px; margin: -8px -10px -8px 0; border: 0; background: none; font-size: 22px;
    color: var(--muted); cursor: pointer; border-radius: 8px; }
  .close:hover { background: var(--control); }
  @media (max-width: 719px) {
    .card { left: 0; right: 0; bottom: 0; width: auto; max-height: 55dvh; border-radius: 16px 16px 0 0; border-width: 1px 0 0;
      padding: 14px 16px calc(14px + env(safe-area-inset-bottom)); }
  }
</style>
