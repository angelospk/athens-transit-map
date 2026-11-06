<script lang="ts">
  // A municipal stop («muni:<osm node>», a stop card), laid out as a bus stop's (StopCard): each line and
  // direction through it with its next departures from the terminus (muniLine.stopRows). The timetables give
  // no times at the other stops and no bus is live, so there are no minutes to wait, only scheduled times.
  // A row opens the line's card; the red pin marks the stop (app.muniStop, focus.stopPin).
  import { untrack } from "svelte";
  import type { AppState } from "../state.svelte";
  import { athensClock, type MuniLine, type MuniTimetable } from "../muniTimes";
  import { stopRows } from "../muniLine";
  import Back from "./Back.svelte";

  let { app }: { app: AppState } = $props();

  const top = $derived(app.stack.at(-1));
  const card = $derived(top?.kind === "stop" && top.id.startsWith("muni:") ? top : null);
  const sid = $derived(card ? `osm:${card.id.slice(5)}` : null);
  const stop = $derived(sid ? app.municipal?.stops[sid] ?? null : null);
  const name = $derived(stop?.name ?? card?.title ?? "Στάση");

  // A deep link comes before the routes: load them (the layer may be off).
  $effect(() => { if (card && !app.municipal) untrack(() => app.loadMunicipal()); });
  $effect(() => {
    app.muniStop = stop ? [stop.lon, stop.lat] : null;
  });
  $effect(() => { if (stop && card && !card.title) untrack(() => app.retitle(name)); });

  let now = $state(Date.now());
  $effect(() => {
    if (!card) return;
    now = app.serverMs();
    const t = setInterval(() => (now = app.serverMs()), 20_000);
    return () => clearInterval(t);
  });
  const rows = $derived(sid && app.municipal ? stopRows(sid, app.municipal, app.muniCards, athensClock(now), 3) : []);
  const lineCount = $derived(new Set(rows.map(r => r.card)).size);
  const municipality = $derived(rows.length ? app.muniCards.find(c => c.id === rows[0].card)?.municipality ?? "" : "");

  const open = (cardId: string, dir: 0 | 1) => {
    const c = app.muniCards.find(x => x.id === cardId);
    if (c) app.push({ kind: "line", id: c.id, title: c.ref ? `${c.ref} · ${c.name}` : c.name, ...(dir ? { dir } : {}) });
  };
  // «Κάτι δεν ισχύει;»: the lines here with a timetable, each with what the card shows for it.
  const report = () => {
    const items: { table: MuniTimetable; line: MuniLine; shown: string[] }[] = [];
    for (const r of rows) {
      const c = app.muniCards.find(x => x.id === r.card);
      const route = c?.routes[r.dir];
      const line = route ? c?.lines.find(l => l.routes.includes(route.id)) : undefined;
      if (!c?.table || !line) continue;
      const shown = r.times.length ? [`${r.times.join(" · ")}${r.at ? ` από ${r.at}` : ""}`] : [];
      const had = items.find(x => x.line === line);
      if (had) had.shown.push(...shown); else items.push({ table: c.table, line, shown });
    }
    if (items.length) app.muniReport = { stop: name, items };
  };
  const chipText = (ref: string | null) => ref ?? "Δ";
</script>

<svelte:window onkeydown={e => { if (e.key === "Escape" && card && !app.muniReport) app.closeCards(); }} />

{#if card}
  <section class="card" aria-label="Στάση {name}">
    <header>
      <Back {app} />
      <div class="t">
        <h2>{name}</h2>
        <p class="sub">{lineCount} {lineCount === 1 ? "γραμμή" : "γραμμές"}{municipality ? ` · ${municipality}` : ""}</p>
      </div>
      <button type="button" class="close" aria-label="Κλείσιμο" onclick={() => app.closeCards()}>×</button>
    </header>
    {#if !app.municipal}
      <p>Φόρτωση…</p>
    {:else if !stop}
      <p>Η στάση δεν βρέθηκε.</p>
    {:else}
      <span class="sched">Δημοτική συγκοινωνία · προγραμματισμένα, όχι live</span>
      <ul class="arr" aria-label="Επόμενα δρομολόγια">
        {#each rows as r, i (i)}
          <li><button type="button" class="row" onclick={() => open(r.card, r.dir)}>
            <b class="chip">{chipText(r.ref)}</b>
            <span class="mid"><span class="to">→ {r.to}</span>
              <small>{r.times.length ? `αναχώρηση${r.at ? ` από ${r.at}` : " από την αφετηρία"}` : r.timetable ? `Σήμερα κανένα άλλο δρομολόγιο${r.at ? ` από ${r.at}` : ""}` : "Ο δήμος δεν δίνει ωράριο"}</small></span>
            {#if r.times.length}
              <span class="when"><b>{r.approx ? "~" : ""}{r.times[0]}</b>{#if r.times.length > 1}<small>μετά {r.times.slice(1).join(", ")}</small>{/if}</span>
            {/if}
          </button></li>
        {/each}
      </ul>
      <p class="src">Ώρες αναχώρησης από την αφετηρία, από το ωράριο του δήμου.
        {#if rows.some(r => r.timetable)}<button type="button" class="link" onclick={report}>Κάτι δεν ισχύει;</button>{/if}</p>
      <p class="src">Στάση και διαδρομή: © OpenStreetMap</p>
    {/if}
  </section>
{/if}

<style>
  .card { position: absolute; z-index: 6; left: 12px; bottom: 28px; width: 360px; padding: 12px 16px;
    background: var(--panel); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow);
    backdrop-filter: blur(8px); max-height: calc(100dvh - 140px); overflow-y: auto; overscroll-behavior: contain; box-sizing: border-box; }
  header { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; margin-bottom: 10px; }
  .t { flex: 1; min-width: 0; }
  header:has(> :global(.back)) > :global(.back) { margin-right: auto; }
  header:has(> :global(.back)) .t { order: 1; flex-basis: 100%; }
  h2 { margin: 0; font-size: 22px; font-weight: 600; line-height: 1.2; overflow: hidden; overflow-wrap: break-word;
    display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; }
  p { margin: 0 0 10px; color: var(--muted); font-size: 12px; }
  .sub { margin: 2px 0 0; font-size: 13px; }
  .sched { display: inline-block; margin-bottom: 4px; padding: 2px 7px; border-radius: 4px; background: var(--control);
    font-size: 11px; font-weight: 600; }
  .chip { flex: none; min-width: 40px; padding: 5px 7px; border-radius: 7px; background: #8c7fa6; color: #fff;
    font-size: 13px; font-weight: 700; text-align: center; font-variant-numeric: tabular-nums; box-sizing: border-box; }
  ul { list-style: none; margin: 0; padding: 0; }
  .arr li { display: flex; align-items: center; border-bottom: 1px solid var(--border); }
  .row { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; min-height: 56px; padding: 6px 0; border: 0; background: none;
    color: inherit; font: inherit; text-align: left; cursor: pointer; }
  .row:hover .to { text-decoration: underline; text-underline-offset: 3px; }
  .mid { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .to { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 600; }
  .mid small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 12px; font-weight: 600; }
  .when { flex: none; display: flex; flex-direction: column; align-items: flex-end; }
  .when b { font-size: 22px; line-height: 1.05; font-weight: 700; font-variant-numeric: tabular-nums; }
  .when small { color: var(--muted); font-size: 11px; white-space: nowrap; }
  .src { margin: 10px 0 0; font-size: 11px; }
  .link { padding: 0; border: 0; background: none; color: var(--accent); text-decoration: underline; cursor: pointer; font: inherit; }
  .close { flex: none; width: 36px; height: 36px; margin: -4px -10px 0 0; border: 0; background: none; font-size: 22px;
    color: var(--muted); cursor: pointer; border-radius: 8px; }
  .close:hover { background: var(--control); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @media (max-width: 719px) {
    .card { left: 0; right: 0; bottom: 0; width: auto; border-radius: 16px 16px 0 0; border-width: 1px 0 0;
      padding: 14px 16px calc(14px + env(safe-area-inset-bottom)); max-height: 55dvh; }
  }
</style>
