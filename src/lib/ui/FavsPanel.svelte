<script lang="ts">
  // The favourites panel (★ in the top bar, B6): the favourite stops first, in the order they were added, each with
  // the user's lines there and what else passes; then the favourite lines.
  // Shown while no card is open (a card pushed from here covers it). Data from /v2, asked again every 30 s
  // while it is open, at most 8 requests at a time.
  import { untrack } from "svelte";
  import { fetchV2LineVehicles, fetchV2Stop } from "../api";
  import { lineSummary, type FavStop } from "../favs";
  import { busVehicleCard } from "../legacy";
  import { stopRows, type StopRow, type V2Arrival, type V2Line, type V2Stop, type V2Vehicle } from "../v2";
  import type { AppState } from "../state.svelte";
  import CardSheet, { whenText } from "./CardSheet.svelte";
  import Icon from "./Icon.svelte";

  let { app }: { app: AppState } = $props();

  const POLL_MS = 30_000, PARALLEL = 8, OTHERS = 3;
  const open = $derived(app.favsOpen && app.stack.length === 0);
  const native = (id: string) => id.slice(id.indexOf(":") + 1);

  type Board = { stop: V2Stop; lines: V2Line[]; arrivals: V2Arrival[] };
  let boards = $state.raw<Record<string, Board>>({});
  let vehicles = $state.raw<Record<string, V2Vehicle[]>>({});

  const stopKey = $derived(app.favs.stops.map(s => s.id).join("|"));
  const lineKey = $derived(app.favs.lines.map(l => l.id).join("|"));

  // Failed requests, by "s:<stop id>" / "l:<line id>": with no data yet the row says so; with old data it says that.
  let failed = $state.raw<Record<string, boolean>>({});
  const setFailed = (k: string, f: boolean) => { if (!!failed[k] !== f) failed = { ...failed, [k]: f }; };

  $effect(() => {
    if (!open) return;
    void stopKey; void lineKey;   // a change restarts the polling
    const stops = untrack(() => app.favs.stops.map(s => s.id)), lines = untrack(() => app.favs.lines.map(l => l.id));
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const jobs: (() => Promise<void>)[] = [
      ...stops.map(id => async () => {
        const r = await fetchV2Stop(id);
        if (ac.signal.aborted) return;
        const b = r.body as (Partial<Board> & { stop?: V2Stop }) | null;
        if (r.status === 200 && b?.stop) boards = { ...boards, [id]: { stop: b.stop, lines: b.lines ?? [], arrivals: b.arrivals ?? [] } };
        setFailed("s:" + id, !(r.status === 200 && b?.stop));
      }),
      ...lines.map(id => async () => {
        const r = await fetchV2LineVehicles(id);
        if (ac.signal.aborted) return;
        const ok = r.status === 200 && !!r.body;
        if (ok) vehicles = { ...vehicles, [id]: (r.body as { vehicles?: V2Vehicle[] }).vehicles ?? [] };
        setFailed("l:" + id, !ok);
      }),
    ];
    // One queue for both: at most PARALLEL requests in flight, and none sent after the panel closed.
    const load = async () => {
      if (document.visibilityState !== "hidden") {
        let next = 0;
        const worker = async () => { while (next < jobs.length && !ac.signal.aborted) await jobs[next++](); };
        await Promise.all(Array.from({ length: Math.min(PARALLEL, jobs.length) }, worker));
      }
      if (!ac.signal.aborted) timer = setTimeout(load, POLL_MS);
    };
    void load();
    return () => { ac.abort(); clearTimeout(timer); };
  });

  const favLines = $derived(new Set(app.favs.lines.map(l => l.id)));
  // Every line any board knows, for the badge colours of the other modes.
  const known = $derived(new Map(Object.values(boards).flatMap(b => b.lines.map(l => [l.id, l] as const))));

  function badge(id: string) {
    if (id.startsWith("oasa:")) { const c = app.lineColor(native(id)); return { label: native(id), bg: c.bg, fg: c.fg }; }
    const l = known.get(id);
    return { label: l?.label ?? l?.name ?? native(id), bg: l?.color ?? "#6b7280", fg: l?.text_color ?? "#ffffff" };
  }
  const label = (id: string) => app.favs.lines.find(l => l.id === id)?.label ?? native(id);

  const rowsOf = (s: FavStop): StopRow[] => {
    const b = boards[s.id];
    return b ? stopRows(b.arrivals, app.serverNow / 1000) : [];
  };

  function openRow(r: StopRow) {
    if (r.vehicle && r.line.startsWith("oasa:")) app.push(busVehicleCard(native(r.line), native(r.vehicle)));
    else if (r.vehicle) app.push({ kind: "vehicle", id: r.vehicle, line: r.line });
    else app.push({ kind: "line", id: r.line, dir: r.dir ?? undefined });
  }
</script>

{#if open}
  <CardSheet {app} key="favs" onclose={() => (app.favsOpen = false)}>
    {#snippet header()}
      <h2 class="title">Αγαπημένα</h2>
    {/snippet}
    {#if !app.favs.stops.length && !app.favs.lines.length}
      <p class="muted">Πάτα <Icon name="star" size={13} label="το αστέρι" /> σε μια στάση ή γραμμή για να μπει εδώ.</p>
    {/if}

    {#if app.favs.stops.length}
      <h3 class="sub">Στάσεις</h3>
      {#each app.favs.stops as s (s.id)}
        {@const rows = rowsOf(s)}
        {@const mine = rows.filter(r => favLines.has(r.line))}
        {@const others = rows.filter(r => !favLines.has(r.line)).slice(0, OTHERS)}
        {@const quiet = (boards[s.id]?.lines ?? []).filter(l => favLines.has(l.id) && !rows.some(r => r.line === l.id))}
        <section class="stop" aria-label="Στάση {s.name}">
          <div class="shead">
            <button type="button" class="name" onclick={() => app.push({ kind: "stop", id: s.id, title: s.name })}>{s.name}</button>
            <button type="button" class="unstar" title="Αφαίρεση από τα αγαπημένα" aria-label="Αφαίρεση της στάσης {s.name} από τα αγαπημένα"
              onclick={() => app.toggleFavStop(s)}><Icon name="star-filled" size={20} /></button>
          </div>
          {#if !boards[s.id]}
            <p class="muted">{failed["s:" + s.id] ? "Δεν φόρτωσε. Δοκιμάζω ξανά." : "Φόρτωση…"}</p>
          {:else}
            {#if failed["s:" + s.id]}<p class="muted">παλιά δεδομένα</p>{/if}
            {#each mine as r (r.line + "|" + (r.dir ?? r.headsign))}
              {@const bd = badge(r.line)}
              <button type="button" class="row" onclick={() => openRow(r)}>
                <span class="pill" style:--c={bd.bg} style:--t={bd.fg}>{bd.label}</span>
                <span class="head">→ {r.headsign}</span>
                <span class="when"><b>{whenText(r.times[0].at, app.serverNow)}</b>{#if r.times[1]}<small>μετά {whenText(r.times[1].at, app.serverNow)}</small>{/if}</span>
              </button>
            {/each}
            {#each others as r (r.line + "|" + (r.dir ?? r.headsign))}
              {@const bd = badge(r.line)}
              <button type="button" class="row other" onclick={() => openRow(r)}>
                <span class="pill" style:--c={bd.bg} style:--t={bd.fg}>{bd.label}</span>
                <span class="head">→ {r.headsign} {whenText(r.times[0].at, app.serverNow)}</span>
              </button>
            {/each}
            {#if !rows.length}<p class="muted">Καμία άφιξη τώρα.</p>{/if}
            {#if quiet.length}<p class="muted">Χωρίς λεωφορείο κοντά τώρα: {quiet.map(l => l.label ?? l.name ?? native(l.id)).join(", ")}</p>{/if}
            <button type="button" class="all" onclick={() => app.push({ kind: "stop", id: s.id, title: s.name, ...(s.id.startsWith("oasa:") ? { ref: "all" } : {}) })}>Όλες οι γραμμές εδώ ({boards[s.id].stop.lines.length}) ›</button>
          {/if}
        </section>
      {/each}
    {/if}

    {#if app.favs.lines.length}
      <h3 class="sub">Γραμμές</h3>
      {#each app.favs.lines as l (l.id)}
        {@const bd = badge(l.id)}
        {@const vs = vehicles[l.id]}
        <button type="button" class="row" onclick={() => app.push({ kind: "line", id: l.id, title: label(l.id) })}>
          <span class="pill" style:--c={bd.bg} style:--t={bd.fg}>{label(l.id)}</span>
          <span class="head muted">{vs ? lineSummary(vs) + (failed["l:" + l.id] ? " · παλιά δεδομένα" : "") : failed["l:" + l.id] ? "Δεν φόρτωσε. Δοκιμάζω ξανά." : "Φόρτωση…"}</span>
          <span aria-hidden="true" class="chev">›</span>
        </button>
      {/each}
    {/if}
  </CardSheet>
{/if}

<style>
  .title { color: var(--fg); font-size: 15px; font-weight: 700; }
  .muted { margin: 4px 0; color: var(--muted); font-size: 12px; }
  .sub { margin: 8px 0 2px; font-size: 12px; font-weight: 600; color: var(--muted); }
  .stop { margin: 6px 0 10px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
  .shead { display: flex; align-items: center; gap: 8px; }
  .name { flex: 1; min-width: 0; min-height: 36px; padding: 0; border: 0; background: none; color: var(--fg); font: inherit; font-size: 14px;
    font-weight: 700; text-align: left; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name:hover { text-decoration: underline; text-underline-offset: 3px; }
  .unstar { flex: none; width: 36px; height: 36px; border: 0; border-radius: 8px; background: none; color: #f59f00; font-size: 18px; cursor: pointer; }
  .unstar:hover { background: var(--control); }
  .row { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 40px; padding: 0 4px; margin: 0 -4px; border: 0; border-radius: 8px;
    background: none; color: inherit; font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
  .row:hover { background: var(--control); }
  .row.other { min-height: 32px; color: var(--muted); font-size: 12px; }
  .pill { flex: none; min-width: 34px; padding: 2px 8px; border-radius: 10px; background: var(--c); color: var(--t); font-weight: 700; text-align: center; }
  .head { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .head.muted { margin: 0; }
  .when { flex: none; display: flex; align-items: baseline; gap: 6px; font-variant-numeric: tabular-nums; }
  .when b { font-size: 15px; }
  .when small { color: var(--muted); font-size: 11px; white-space: nowrap; }
  .chev { flex: none; color: var(--muted); }
  .all { display: block; width: 100%; min-height: 36px; padding: 0; border: 0; background: none; color: var(--accent); font: inherit; font-size: 13px;
    font-weight: 600; cursor: pointer; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @media (pointer: coarse) { .name, .unstar { min-height: 44px; } .row { min-height: 44px; } .all { min-height: 44px; } }
</style>
