<script lang="ts">
  // «Κοντά σου»: the bus stops near the user (nearby.ts), nearest first, each with its next buses. Opens with the page
  // when the location is allowed (MapView), and again from the locate button; × closes it until the next open.
  // Shown while no card and no favourites are open. Live data from /v2, asked again every 30 s while it shows.
  import { untrack } from "svelte";
  import { fetchV2Stop } from "../api";
  import { busVehicleCard } from "../legacy";
  import { distText } from "../nearby";
  import { toward } from "../stops";
  import { stopRows, type StopRow, type V2Arrival } from "../v2";
  import type { AppState } from "../state.svelte";
  import CardSheet, { whenText } from "./CardSheet.svelte";

  let { app }: { app: AppState } = $props();

  const POLL_MS = 30_000, PARALLEL = 6, ROWS = 2;
  const native = (id: string) => id.slice(id.indexOf(":") + 1);

  // Each stop's arrivals, by GTFS id; failed: no answer yet for it.
  let boards = $state.raw<Record<string, V2Arrival[]>>({});

  $effect(() => { if (app.nearShown) void app.loadStops(); });

  const ids = $derived(app.nearGroups.flatMap(g => g.ids));
  const idKey = $derived(ids.join("|"));

  $effect(() => {
    if (!app.nearShown || !idKey) return;
    const want = untrack(() => ids);
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (document.visibilityState !== "hidden") {
        let next = 0;
        const worker = async () => {
          while (next < want.length && !ac.signal.aborted) {
            const id = want[next++], r = await fetchV2Stop(`oasa:${id}`);
            if (ac.signal.aborted) return;
            const b = r.body as { arrivals?: V2Arrival[] } | null;
            if (r.status === 200 && b) boards = { ...boards, [id]: b.arrivals ?? [] };
          }
        };
        await Promise.all(Array.from({ length: Math.min(PARALLEL, want.length) }, worker));
      }
      if (!ac.signal.aborted) timer = setTimeout(load, POLL_MS);
    };
    void load();
    return () => { ac.abort(); clearTimeout(timer); };
  });

  // The next buses of a group (both sides of the street together), soonest first; null before any answer.
  function rowsOf(groupIds: string[]): StopRow[] | null {
    const got = groupIds.filter(id => boards[id]);
    if (!got.length) return null;
    return stopRows(got.flatMap(id => boards[id]), app.serverNow / 1000).slice(0, ROWS);
  }

  function badge(line: string) {
    const c = app.lineColor(line.startsWith("oasa:") ? native(line) : line);
    return { label: line.startsWith("oasa:") ? native(line) : line, bg: c.bg, fg: c.fg };
  }

  function openRow(r: StopRow) {
    if (r.vehicle && r.line.startsWith("oasa:")) app.push(busVehicleCard(native(r.line), native(r.vehicle)));
    else if (r.vehicle) app.push({ kind: "vehicle", id: r.vehicle, line: r.line });
    else app.push({ kind: "line", id: r.line, dir: r.dir ?? undefined });
  }
</script>

{#if app.nearShown}
  <CardSheet {app} key="near" onclose={() => (app.nearOpen = false)}>
    {#snippet header()}
      <h2 class="title">Κοντά σου</h2>
    {/snippet}
    {#if !app.myPos}
      {#if app.locState === "off" || app.locState === "denied"}
        <p class="muted">Δες ποια λεωφορεία περνάνε από τις στάσεις γύρω σου.</p>
        <button type="button" class="use" onclick={() => app.locate()}>Χρήση της θέσης μου</button>
      {:else}
        <p class="muted">Βρίσκω τη θέση σου…</p>
      {/if}
    {:else if !app.stopIx}
      <p class="muted">Φορτώνω τις στάσεις…</p>
    {:else if !app.nearGroups.length}
      <p class="muted">Καμία στάση σε 1 χλμ.</p>
    {:else}
      {#each app.nearGroups as g (g.ids.join("|"))}
        {@const rows = rowsOf(g.ids)}
        <section class="stop" aria-label="Στάση {g.name}">
          <div class="shead">
            <button type="button" class="name" onclick={() => app.push({ kind: "stop", id: `oasa:${g.ids[0]}`, title: g.name })}>{g.name}</button>
            <span class="dist">{distText(g.m)}</span>
          </div>
          {#if rows?.length}
            {#each rows as r (r.line + "|" + (r.dir ?? r.headsign))}
              {@const bd = badge(r.line)}
              <button type="button" class="row" onclick={() => openRow(r)}>
                <span class="pill" style:--c={bd.bg} style:--t={bd.fg}>{bd.label}</span>
                <span class="head">→ {toward(r.headsign)}</span>
                <span class="when"><b>{whenText(r.times[0].at, app.serverNow)}</b></span>
              </button>
            {/each}
          {:else}
            <div class="lines">
              {#each g.lines.slice(0, 8) as l (l)}
                {@const bd = badge(l)}
                <span class="pill" style:--c={bd.bg} style:--t={bd.fg}>{bd.label}</span>
              {/each}
              {#if g.lines.length > 8}<span class="muted">+{g.lines.length - 8}</span>{/if}
            </div>
            {#if rows}<p class="muted">Καμία άφιξη τώρα.</p>{/if}
          {/if}
        </section>
      {/each}
    {/if}
  </CardSheet>
{/if}

<style>
  .title { color: var(--fg); font-size: 15px; font-weight: 700; }
  .muted { margin: 4px 0; color: var(--muted); font-size: 12px; }
  .use { min-height: 40px; margin: 4px 0 6px; padding: 0 14px; border: 0; border-radius: 10px; background: var(--accent); color: #fff;
    font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
  .stop { margin: 4px 0 8px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
  .stop:last-child { border-bottom: 0; }
  .shead { display: flex; align-items: center; gap: 8px; }
  .name { flex: 1; min-width: 0; min-height: 36px; padding: 0; border: 0; background: none; color: var(--fg); font: inherit; font-size: 14px;
    font-weight: 700; text-align: left; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name:hover { text-decoration: underline; text-underline-offset: 3px; }
  .dist { flex: none; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
  .row { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 36px; padding: 0 4px; margin: 0 -4px; border: 0; border-radius: 8px;
    background: none; color: inherit; font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
  .row:hover { background: var(--control); }
  .pill { flex: none; min-width: 34px; padding: 2px 8px; border-radius: 10px; background: var(--c); color: var(--t); font-size: 12px; font-weight: 700; text-align: center; }
  .head { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .when { flex: none; font-variant-numeric: tabular-nums; }
  .when b { font-size: 15px; }
  .lines { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: 2px 0 4px; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @media (pointer: coarse) { .name, .row, .use { min-height: 44px; } }
</style>
