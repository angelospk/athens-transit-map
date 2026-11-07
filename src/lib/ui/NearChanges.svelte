<script lang="ts">
  // «Αλλαγές εδώ κοντά», on a stop's or a station's card: the stations and the other bus stops a short walk away, with
  // the lines they add (hubs.ts), rail first; and «Πού θες να πας από εδώ;»: the lines from here and from those stops
  // that go to a stop of that name. With 30 lines around a square, typing where beats reading a list.
  import type { AppState } from "../state.svelte";
  import { BUS_M, goesTo, nearby, railBadge, railPoints, stopsNear, type RailNear } from "../hubs";
  import { busStopCard, railStationCard, stationCard } from "../legacy";
  import { fold } from "../search";
  import { titleCase } from "../nearby";
  import Icon from "./Icon.svelte";

  let { app, at, stop = null, lines = [], station = null, modes = [] }: {
    app: AppState;
    at: [number, number];            // [lat, lon]
    stop?: number | null;            // the bus stop of the card (index of trips.json): its lines are not changes
    lines?: string[];
    station?: string | null;         // the station of the card, and its modes: itself is not a change (its tram stop is)
    modes?: string[];
  } = $props();

  $effect(() => { if (!app.stopIx) void app.loadStops(); });
  const ix = $derived(app.stopIx);
  const rail = $derived(railPoints(app.metro, app.suburban));
  const railColors = $derived(Object.fromEntries((app.metro?.lines ?? []).map(l => [l.id, l.color])));
  const near = $derived.by(() => {
    const n = nearby(ix, rail, at, { skip: lines, skipStops: stop != null ? [stop] : [] });
    return station ? { ...n, rail: n.rail.filter(r => fold(r.name) !== fold(station!) || !modes.includes(r.mode)) } : n;
  });
  let moreBus = $state(false);
  let goQ = $state("");
  $effect(() => { void stop; void station; goQ = ""; moreBus = false; });
  const from = $derived(ix ? [...(stop != null ? [{ i: stop, m: 0 }] : []), ...stopsNear(ix, at, BUS_M).filter(s => s.i !== stop)] : []);
  const goes = $derived(ix && goQ.trim().length >= 3 ? goesTo(ix, from, goQ) : []);
  const MODE_NAME = { metro: "Μετρό", tram: "Τραμ", suburban: "Προαστιακός" } as const;
  const openRail = (r: RailNear) => app.push(r.mode === "suburban" && r.id ? railStationCard(r.id, r.name) : stationCard(r.name, r.lines));
  function openStop(k: number) {
    const s = ix?.s[k];
    if (s?.[3]) app.push(busStopCard(s[3], s[0]));
  }
  const variantsThrough = (line: string, k: number) => Object.keys(ix?.l[line] ?? {}).filter(v => ix!.l[line][v].includes(k));
  const walkOf = (k: number) => from.find(f => f.i === k)?.m ?? 0;
</script>

{#if near.rail.length || near.bus.length}
  <div class="nhead"><h3>Αλλαγές εδώ κοντά</h3></div>
  {#if ix}
    <label class="goq"><Icon name="search" size={16} />
      <input type="search" placeholder="Πού θες να πας από εδώ;" aria-label="Πού θες να πας από εδώ;" bind:value={goQ} autocomplete="off" /></label>
  {/if}
  {#if goQ.trim().length >= 3}
    <section class="ncard" aria-label="Γραμμές που πάνε εκεί">
      {#each goes as g (g.line)}
        {@const col = app.lineColor(g.line)}
        {@const m = walkOf(g.from)}
        <button type="button" class="nrow" onclick={() => app.openLineAt(g.line, variantsThrough(g.line, g.from))}>
          <b class="lchip" style:--lb={col.bg} style:--lf={col.fg}>{g.line}</b>
          <span class="nmid"><span class="nto">Ως {titleCase(g.to)}</span>
            <small>{g.from === stop ? "από εδώ" : `από ${titleCase(ix?.s[g.from]?.[0] ?? "")} · ${Math.max(1, Math.round((m * 1.3) / 80))}′ με τα πόδια`} · {g.hops} {g.hops === 1 ? "στάση" : "στάσεις"}</small></span>
        </button>
      {:else}
        <p class="nrow none">Καμία γραμμή από εδώ δεν πάει σε στάση με αυτό το όνομα.</p>
      {/each}
    </section>
  {:else}
    <section class="ncard" aria-label="Αλλαγές εδώ κοντά">
      {#each near.rail as r (r.name + r.mode)}
        <button type="button" class="nrow" onclick={() => openRail(r)}>
          <span class="rbadges">{#each r.lines as l (l)}{@const b = railBadge(l, railColors)}<b class="rb" class:round={b.round} style:--lb={b.color}>{b.label}</b>{/each}</span>
          <span class="nmid"><span class="nto">{MODE_NAME[r.mode]}</span><small>{titleCase(r.name)}</small></span>
          <span class="wk"><Icon name="walk" size={14} />{r.walk}′</span>
        </button>
      {/each}
      {#each moreBus ? near.bus : near.bus.slice(0, 3) as b (b.name)}
        <button type="button" class="nrow" onclick={() => openStop(b.stops[0])}>
          <span class="nmid"><span class="nto">{titleCase(b.name)}</span>
            <span class="chips">{#each b.lines.slice(0, 6) as l (l)}{@const col = app.lineColor(l)}<b class="lchip" style:--lb={col.bg} style:--lf={col.fg}>{l}</b>{/each}{#if b.lines.length > 6}<b class="lchip more">+{b.lines.length - 6}</b>{/if}</span></span>
          <span class="wk"><Icon name="walk" size={14} />{b.walk}′</span>
        </button>
      {/each}
      {#if near.bus.length > 3}
        <button type="button" class="nrow morebtn" aria-expanded={moreBus} onclick={() => (moreBus = !moreBus)}>
          {moreBus ? "Λιγότερες" : `Άλλες ${near.bus.length - 3} ${near.bus.length - 3 === 1 ? "στάση" : "στάσεις"}`}</button>
      {/if}
    </section>
  {/if}
{/if}

<style>
  /* In a card that scrolls (a flex column with a max height): never squeezed. */
  .nhead, .goq, .ncard { flex-shrink: 0; }
  .nhead { display: flex; align-items: center; min-height: 22px; margin-top: 2px; }
  h3 { margin: 0; font-size: 18px; font-weight: 800; line-height: 1; }
  .goq { display: flex; align-items: center; gap: 10px; height: 44px; padding: 0 14px; border-radius: 14px; background: var(--card); color: var(--muted); }
  .goq input { flex: 1; min-width: 0; height: 44px; padding: 0; border: 0; background: none; color: var(--fg); font: inherit; font-size: 15px; line-height: 44px; outline: none; }
  .goq input::-webkit-search-cancel-button { display: none; }
  .goq:focus-within { box-shadow: 0 0 0 2px var(--accent); }
  .ncard { border-radius: 16px; background: var(--card); border: 1px solid var(--card-border); overflow: hidden; }
  .nrow { width: 100%; display: flex; align-items: center; gap: 12px; min-height: 58px; margin: 0; padding: 10px 14px; border: 0; border-bottom: 1px solid var(--border);
    background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; box-sizing: border-box; }
  .nrow:last-child { border-bottom: 0; }
  button.nrow:hover { background: var(--control); }
  .nrow.none { cursor: default; color: var(--muted); font-size: 13px; line-height: 1.3; }
  .nmid { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 7px; }
  .nto { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; font-weight: 600; line-height: 1.15; }
  .nmid small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 12px; font-weight: 500; line-height: 1.2; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .lchip { flex: none; display: inline-flex; align-items: center; justify-content: center; min-width: 0; height: 22px; padding: 0 7px; border-radius: 6px;
    background: var(--lb); color: var(--lf); font-size: 11px; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; }
  .lchip.more { background: var(--control); color: var(--muted); }
  .rbadges { flex: none; display: flex; gap: 4px; }
  .rb { display: flex; align-items: center; justify-content: center; min-width: 24px; height: 24px; padding: 0 5px; box-sizing: border-box; border-radius: 6px;
    background: var(--lb); color: #fff; font-size: 12px; font-weight: 800; line-height: 1; }
  .rb.round { border-radius: 12px; }
  .wk { flex: none; display: flex; align-items: center; gap: 4px; font-size: 14px; font-weight: 700; line-height: 1; }
  .wk :global(svg) { color: var(--muted); }
  .morebtn { justify-content: center; min-height: 46px; color: var(--accent); font-size: 14px; font-weight: 700; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
</style>
