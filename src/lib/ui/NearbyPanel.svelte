<script lang="ts">
  // «Κοντά σου»: the bus stops near the user (nearby.ts), nearest first, each with its next buses. Opens with the page
  // when the location is allowed (MapView), and again from the locate button; × closes it until the next open.
  // Shown while no card and no favourites are open. Live data from /v2, asked again every 30 s while it shows.
  import { untrack } from "svelte";
  import { fetchV2Stop } from "../api";
  import { busVehicleCard } from "../legacy";
  import { distText, foldRows, rowNote, titleCase, walkMin, type NearGroup } from "../nearby";
  import { toward } from "../stops";
  import { stopRows, type StopRow, type V2Arrival } from "../v2";
  import type { AppState } from "../state.svelte";
  import CardSheet, { whenText } from "./CardSheet.svelte";
  import Icon from "./Icon.svelte";
  import { CITIES, type CityId } from "../cities";

  let { app }: { app: AppState } = $props();

  function pickCity(c: CityId) {
    app.setCity(c);
    app.nearOpen = false;   // the map, not the empty list, is what to look at now
  }

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

  // One stop at a time shows all its lines («Όλες ▾»); the others show their next ROWS buses.
  let openKey = $state<string | null>(null);
  const keyOf = (g: NearGroup) => g.ids.join("|");

  // A group's buses (both sides of the street together), soonest first; null before any answer.
  // quiet: its lines with no bus on the way now.
  function boardOf(g: NearGroup): { rows: StopRow[]; quiet: string[] } | null {
    const got = g.ids.filter(id => boards[id]);
    if (!got.length) return null;
    const rows = stopRows(got.flatMap(id => boards[id]), app.serverNow / 1000);
    const moving = new Set(rows.map(r => native(r.line)));
    return { rows, quiet: g.lines.filter(l => !moving.has(l)) };
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

<!-- The city picker: without a location the user says where they are; a pick moves the map there. -->
{#snippet cities()}
  <div class="cities" role="group" aria-label="Πόλη">
    {#each Object.values(CITIES) as c (c.id)}
      <button type="button" class="city" aria-pressed={app.cityId === c.id} onclick={() => pickCity(c.id)}>
        <b>{c.name}</b><small>{c.hint}</small>
      </button>
    {/each}
  </div>
{/snippet}

{#if app.nearShown}
  <CardSheet {app} key="near" onclose={() => (app.nearOpen = false)}>
    {#snippet header()}
      <h2 class="title">Κοντά σου</h2>
    {/snippet}
    {#if !app.myPos || app.locState === "denied"}
      {#if app.locState === "denied"}
        <p class="muted">Ο browser δεν δίνει τη θέση σου. Διάλεξε πόλη:</p>
      {:else if app.locState === "unavailable"}
        <p class="muted">Δεν βρίσκω τη θέση σου. Διάλεξε πόλη:</p>
      {:else if app.locState === "off"}
        <p class="muted">Δες ποια λεωφορεία περνάνε από τις στάσεις γύρω σου.</p>
        <button type="button" class="use" onclick={() => app.locate()}>Χρήση της θέσης μου</button>
      {:else}
        <p class="muted">Βρίσκω τη θέση σου…</p>
      {/if}
      {@render cities()}
    {:else if !app.cityInfo.ready}
      <p class="muted">{app.cityInfo.name}: οι στάσεις και τα λεωφορεία έρχονται σύντομα.</p>
      {@render cities()}
    {:else if !app.stopIx}
      <p class="muted">Φορτώνω τις στάσεις…</p>
    {:else if !app.nearGroups.length}
      <p class="muted">Καμία στάση σε 1 χλμ.</p>
    {:else}
      {#each app.nearGroups as g (keyOf(g))}
        {@const b = boardOf(g)}
        {@const open = openKey === keyOf(g)}
        {@const f = b ? foldRows(b.rows, b.quiet, ROWS, open) : { shown: [], rest: g.lines, more: true }}
        {@const shown = f.shown}
        {@const rest = f.rest}
        {@const name = titleCase(g.name)}
        <section class="stop" aria-label="Στάση {name}">
          <div class="shead">
            <div class="who">
              <button type="button" class="name" onclick={() => app.push({ kind: "stop", id: `oasa:${g.ids[0]}`, title: name })}>{name}<span class="go" aria-hidden="true">›</span></button>
              <div class="meta">στάση λεωφορείων · {distText(g.m)}</div>
            </div>
            <span class="walk" title="Περίπου {walkMin(g.m)}′ με τα πόδια"><Icon name="walk" size={15} /><span class="sr">Με τα πόδια περίπου</span>{walkMin(g.m)}′</span>
          </div>
          {#if !b}
            <p class="muted pad">Φόρτωση…</p>
          {:else if !b.rows.length}
            <p class="muted pad">Καμία άφιξη τώρα.</p>
          {/if}
          {#each shown as r (r.line + "|" + (r.dir ?? r.headsign))}
            {@const bd = badge(r.line)}
            {@const n = rowNote(r.times[0])}
            <button type="button" class="row" onclick={() => openRow(r)}>
              <span class="pill" style:--c={bd.bg} style:--t={bd.fg}>{bd.label}</span>
              <span class="dest"><b>→ {titleCase(toward(r.headsign))}</b><small class={n.tone}>{n.text}</small></span>
              <span class="when"><b class:now={whenText(r.times[0].at, app.serverNow) === "τώρα"}>{whenText(r.times[0].at, app.serverNow)}</b>{#if r.times[1]}<small>μετά {whenText(r.times[1].at, app.serverNow)}</small>{/if}</span>
            </button>
          {/each}
          {#if open && b?.quiet.length}
            <p class="quiet">Χωρίς λεωφορείο κοντά τώρα: {b.quiet.join(", ")}</p>
          {/if}
          {#if f.more}
            <button type="button" class="more" aria-expanded={open} onclick={() => (openKey = open ? null : keyOf(g))}>
              <span class="chips">
                {#if !open}
                  {#each rest.slice(0, 3) as l (l)}<span class="chip">{l}</span>{/each}
                  {#if rest.length > 3}<span class="chip">+{rest.length - 3}</span>{/if}
                {/if}
              </span>
              <span class="lbl">{open ? "Λιγότερα" : `Όλες (${g.lines.length})`}</span>
              <span class="chev" class:up={open}><Icon name="chevron" size={14} /></span>
            </button>
          {/if}
        </section>
      {/each}
    {/if}
  </CardSheet>
{/if}

<style>
  .title { color: var(--fg); font-size: 15px; font-weight: 700; }
  .muted { margin: 4px 0; color: var(--muted); font-size: 12px; }
  .muted.pad { margin: 6px 0 8px; }
  .use { min-height: 40px; margin: 4px 0 6px; padding: 0 14px; border: 0; border-radius: 10px; background: var(--accent); color: #fff;
    font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
  .cities { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 6px 0 4px; }
  .city { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-height: 52px; padding: 8px 12px;
    border: 1px solid var(--border); border-radius: 12px; background: none; color: var(--fg); font: inherit; text-align: left; cursor: pointer; }
  .city b { font-size: 15px; font-weight: 700; }
  .city small { color: var(--muted); font-size: 11.5px; }
  .city[aria-pressed="true"] { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  .stop { margin: 0 0 10px; padding: 10px 12px 2px; border: 1px solid var(--border); border-radius: 14px; }
  .stop:last-child { margin-bottom: 2px; }
  .shead { display: flex; align-items: flex-start; gap: 10px; padding-bottom: 6px; }
  .who { flex: 1; min-width: 0; }
  .name { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; min-height: 28px; padding: 0; border: 0; background: none;
    color: var(--fg); font: inherit; font-size: 16px; font-weight: 700; text-align: left; cursor: pointer; }
  .name:hover { text-decoration: underline; text-underline-offset: 3px; }
  .go { color: var(--muted); font-weight: 400; font-size: 18px; line-height: 1; }
  .meta { color: var(--muted); font-size: 12.5px; }
  .walk { flex: none; display: inline-flex; align-items: center; gap: 3px; margin-top: 2px; padding: 4px 10px 4px 8px; border: 1px solid var(--border);
    border-radius: 999px; color: var(--accent); font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px; width: 100%; min-height: 52px;
    padding: 6px 0; border: 0; border-top: 1px solid var(--border); border-radius: 0; background: none; color: inherit;
    font: inherit; text-align: left; cursor: pointer; }
  .row:hover { background: var(--control); }
  .pill { min-width: 44px; padding: 5px 8px; border-radius: 8px; background: var(--c); color: var(--t); font-size: 14px; font-weight: 800;
    text-align: center; font-variant-numeric: tabular-nums; }
  .dest { min-width: 0; display: flex; flex-direction: column; }
  .dest b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 600; }
  .dest small { font-size: 12px; font-weight: 600; }
  .ok { color: var(--ontime); }
  .late { color: var(--late2); }
  .dest small.muted { margin: 0; font-weight: 400; }
  .when { display: flex; flex-direction: column; align-items: flex-end; font-variant-numeric: tabular-nums; }
  .when b { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.05; }
  .when b.now { font-size: 17px; }
  .when small { color: var(--muted); font-size: 11px; white-space: nowrap; }
  .quiet { margin: 0; padding: 6px 0; border-top: 1px solid var(--border); color: var(--muted); font-size: 12px; }
  .more { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 40px; padding: 0; border: 0; border-top: 1px solid var(--border);
    background: none; color: var(--fg); font: inherit; text-align: left; cursor: pointer; }
  .chips { flex: 1; min-width: 0; display: flex; gap: 4px; overflow: hidden; }
  .chip { flex: none; padding: 2px 7px; border-radius: 7px; background: var(--control); font-size: 12px; font-weight: 700; }
  .lbl { flex: none; color: var(--accent); font-size: 13px; font-weight: 600; }
  .chev { flex: none; display: inline-flex; color: var(--accent); transition: transform .2s cubic-bezier(.2, .8, .2, 1); }
  .chev.up { transform: rotate(180deg); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @media (pointer: coarse) { .name { min-height: 36px; } .more, .use { min-height: 44px; } }
  @media (prefers-reduced-motion: reduce) { .chev { transition: none; } }
</style>
