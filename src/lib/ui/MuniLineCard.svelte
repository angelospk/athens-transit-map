<script lang="ts">
  // The card of a municipal line («muni:<osm id>», muniLine.ts), in the shape of LineCard: its directions, the
  // buses the timetable implies now (an estimate: no municipality gives live positions), today's runs and its
  // stops. The chosen direction and those buses are drawn by MapView (app.muniFocus).
  import { untrack } from "svelte";
  import type { AppState } from "../state.svelte";
  import { athensClock } from "../muniTimes";
  import { routeLabel, simulate, stitch, todayRuns } from "../muniLine";
  import CardSheet from "./CardSheet.svelte";

  let { app }: { app: AppState } = $props();

  const top = $derived(app.stack.at(-1));
  const card = $derived(top?.kind === "line" && top.id.startsWith("muni:") ? top : null);
  const mc = $derived(card ? app.muniCards.find(c => c.id === card.id) ?? null : null);
  const dir = $derived(mc ? Math.min(card?.dir ?? 0, mc.routes.length - 1) : 0);
  const route = $derived(mc?.routes[dir]);

  // A deep link comes before the routes: load them (the layer may be off).
  $effect(() => { if (card && !app.municipal) untrack(() => app.loadMunicipal()); });

  // The estimate moves on every 2 s; the runs' «past» each minute with it.
  let now = $state(Date.now());
  $effect(() => {
    if (!card) return;
    now = app.serverMs();
    const t = setInterval(() => (now = app.serverMs()), 2000);
    return () => clearInterval(t);
  });

  const clock = $derived(athensClock(now));
  const runs = $derived(mc && route ? todayRuns(mc.lines, route.id, clock) : []);
  const sims = $derived(mc && route && app.municipal ? simulate(route, app.municipal.stops, mc.lines, now) : []);
  const byStop = $derived.by(() => {
    const m = new Map<string, typeof runs>();
    for (const r of runs) { const k = r.at ?? ""; m.set(k, [...(m.get(k) ?? []), r]); }
    return [...m];
  });
  const line = $derived(mc && route ? mc.lines.find(l => l.routes.includes(route.id)) ?? null : null);
  const stopList = $derived(route && app.municipal ? route.stops.flatMap(id => {
    const n = app.municipal!.stops[id]?.name;
    return n ? [{ id, name: n }] : [];
  }) : []);
  const label = $derived(mc ? (mc.ref ? `${mc.ref} · ${mc.name}` : mc.name) : "");

  $effect(() => { if (mc) untrack(() => app.retitle(label)); });
  $effect(() => {
    app.muniFocus = route ? { route, vehicles: sims } : null;
  });
  $effect(() => () => { app.muniFocus = null; });

  // Frame the direction once per card and direction, not at each tick.
  let framed = "";
  $effect(() => {
    if (!route || !card) return;
    const k = `${card.id}|${route.id}`;
    if (k === framed) return;
    framed = k;
    const pts = stitch(route.shape).map(([lat, lon]) => [lon, lat] as [number, number]);
    untrack(() => app.fitPoints(pts));
  });

  let showTimes = $state(true);
  let showStops = $state(false);
  const pick = (d: 0 | 1) => app.replaceTop({ ...card!, dir: d });
  const report = () => {
    if (!mc?.table || !line) return;
    const shown = runs.filter(r => !r.past).slice(0, 3).map(r => `${r.time}${r.at ? ` από ${r.at}` : ""}`);
    app.muniReport = { stop: null, items: [{ table: mc.table, line, shown }] };
  };
  const checked = $derived(mc?.table ? mc.table.checked.split("-").reverse().map(Number).join("/") : "");
</script>

{#if card}
  <CardSheet {app} key={card.id}>
    {#snippet header()}
      <span class="pill" style:--c="#8c7fa6" style:--t="#fff">{mc?.ref ?? "Δ"}</span>
      <h2>{mc?.name ?? ""}</h2>
    {/snippet}
    {#if !mc}
      <p class="muted">{app.municipal ? "Η γραμμή δεν βρέθηκε." : "Φόρτωση…"}</p>
    {:else}
      <p class="muni">{mc.municipality} · <span class="sched">Προγραμματισμένα · όχι live</span></p>
      {#if mc.routes.length > 1}
        <div class="dirs" role="group" aria-label="Κατεύθυνση">
          {#each mc.routes.slice(0, 2) as r, d (r.id)}
            <button type="button" aria-pressed={dir === d} onclick={() => pick(d as 0 | 1)}>→ {routeLabel(r, mc.lines)}</button>
          {/each}
        </div>
      {/if}

      {#if mc.table}
        <h3 class="sub">Οχήματα τώρα · εκτίμηση{sims.length ? ` · ${sims.length}` : ""}</h3>
        {#if sims.length}
          <ul class="runs" aria-label="Οχήματα κατά το ωράριο">
            {#each sims as v (v.id)}
              <li><button type="button" onclick={() => app.flyTo([v.lon, v.lat])}>
                <span class="lab">≈</span>
                <span class="next">Αναχώρησε {v.dep}{v.at ? ` από ${v.at}` : ""}</span>
                <span aria-hidden="true" class="chev">›</span>
              </button></li>
            {/each}
          </ul>
          <p class="muted">Θέση από την ώρα αναχώρησης και μέση ταχύτητα. Όχι GPS.</p>
        {:else}
          <p class="muted">Κανένα δρομολόγιο σε εξέλιξη τώρα, κατά το ωράριο.</p>
        {/if}

        <button type="button" class="times" aria-expanded={showTimes} aria-controls="muni-times" onclick={() => (showTimes = !showTimes)}>
          Δρομολόγια σήμερα <svg viewBox="0 0 12 8" width="9" height="6" aria-hidden="true" class={{ up: showTimes }}><path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
        {#if showTimes}
          <div id="muni-times">
            {#if byStop.length}
              {#each byStop as [at, list] (at)}
                {#if at}<p class="from">από {at}</p>{/if}
                <p class="chips">
                  {#each list as r (r.time)}<span class:past={r.past}>{r.approx ? "~" : ""}{r.time}</span>{/each}
                </p>
              {/each}
            {:else}
              <p class="muted">Σήμερα δεν έχει δρομολόγια.</p>
            {/if}
            {#if line?.note}<p class="muted">{line.note}</p>{/if}
          </div>
        {/if}
      {:else}
        <p class="muted">Ο δήμος δεν δημοσιεύει ωράριο για αυτή τη γραμμή.</p>
        {#if route?.timetable_url && /^https?:\/\//.test(route.timetable_url)}
          <a href={route.timetable_url} target="_blank" rel="noopener">Σελίδα του δήμου ›</a>
        {/if}
      {/if}

      {#if stopList.length}
        <button type="button" class="times" aria-expanded={showStops} aria-controls="muni-stops" onclick={() => (showStops = !showStops)}>
          Στάσεις · {stopList.length} <svg viewBox="0 0 12 8" width="9" height="6" aria-hidden="true" class={{ up: showStops }}><path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
        {#if showStops}<ol id="muni-stops" class="stops">{#each stopList as s, i (i)}<li><button type="button"
          onclick={() => app.push({ kind: "stop", id: `muni:${s.id.replace(/^osm:/, "")}`, title: s.name })}>{s.name}</button></li>{/each}</ol>{/if}
      {/if}

      <div class="foot">
        {#if mc.table}
          <a href={mc.table.source} target="_blank" rel="noopener">Ωράριο δήμου · ελέγχθηκε {checked} ›</a>
          <button type="button" class="report" onclick={report}>Κάτι δεν ισχύει;</button>
        {/if}
        <small>Διαδρομή: © OpenStreetMap</small>
      </div>
    {/if}
  </CardSheet>
{/if}

<style>
  h2 { margin: 0; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .muni { margin: 0 0 8px; color: var(--muted); font-size: 12px; }
  .sched { padding: 1px 6px; border-radius: 4px; background: var(--control); color: var(--fg); font-size: 11px; font-weight: 600; }
  .muted { margin: 4px 0; color: var(--muted); font-size: 12px; }
  .dirs { display: flex; gap: 2px; padding: 2px; border-radius: 10px; background: var(--control); }
  .dirs button { flex: 1; min-width: 0; min-height: 36px; padding: 4px 8px; border: 0; border-radius: 8px; background: none; color: inherit;
    font: inherit; font-size: 13px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dirs button[aria-pressed="true"] { background: var(--accent); color: #fff; font-weight: 600; }
  .sub { margin: 10px 0 2px; font-size: 12px; font-weight: 600; color: var(--muted); }
  .runs { list-style: none; margin: 0; padding: 0; }
  .runs button { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 36px; padding: 0 4px; margin: 0 -4px; border: 0;
    border-radius: 8px; background: none; color: inherit; font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
  .runs button:hover { background: var(--control); }
  .lab { flex: none; min-width: 20px; font-weight: 600; color: #8c7fa6; }
  .next { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chev { flex: none; color: var(--muted); }
  .times { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; margin-top: 8px; padding: 0; margin-right: 14px;
    border: 0; background: none; color: var(--accent); font-size: 13px; cursor: pointer; }
  .times svg { transition: transform .15s; }
  .times svg.up { transform: rotate(180deg); }
  .from { margin: 6px 0 2px; font-size: 12px; color: var(--muted); }
  .chips { display: flex; flex-wrap: wrap; gap: 4px 10px; margin: 0; font-size: 13px; font-variant-numeric: tabular-nums; }
  .chips .past { color: var(--muted); text-decoration: line-through; opacity: .6; }
  .stops { margin: 0; padding-left: 22px; font-size: 13px; }
  .stops button { min-height: 30px; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
  .stops button:hover { color: var(--accent); text-decoration: underline; }
  .foot { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 12px; margin-top: 10px; font-size: 12px; }
  .foot small { flex-basis: 100%; color: var(--muted); }
  .report { padding: 6px 0; border: 0; background: none; color: var(--muted); font: inherit; text-decoration: underline; cursor: pointer; }
</style>
