<script lang="ts">
  // «Κοντά σου» (compact mockup 5): the stops near the user, nearest first, a row each: its number, its name, the
  // minutes on foot, and the next bus of each line (or the next train of each metro and tram line, where it goes).
  // A tap opens the stop's card. The bus stops come from nearby.ts, the metro, tram and suburban stops near from
  // /v2/stops (Athens only); «Όλα · Λεωφ. · Ράγες» shows one kind when both are near.
  // Opens with the page when the location is allowed (MapView), and again from the locate button; × closes it until
  // the next open. Shown while no card and no favourites are open. Live data from /v2, asked again every 30 s.
  // A phone: a sheet from the bottom edge, dragged by its handle or header (sheetDrag.ts); a desktop: a card at the left.
  import { untrack } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { fetchV2Line, fetchV2Stop, fetchV2Stops } from "../api";
  import { distanceM } from "../glide";
  import { distText, elsewhere, titleCase, walkMin, type NearGroup } from "../nearby";
  import { freeSheet } from "../sheetDrag";
  import { toward } from "../stops";
  import { headsignName, stopRows, type LineDetail, type StopRow, type V2Arrival, type V2Line, type V2Stop } from "../v2";
  import type { StopEntry } from "../finder";
  import type { AppState } from "../state.svelte";
  import { whenText } from "./CardSheet.svelte";
  import Icon from "./Icon.svelte";
  import LineChip from "./LineChip.svelte";
  import { CITIES, findCities, MAIN_CITIES, nearestCity, type CityId } from "../cities";
  import { busId, isBusId } from "../busNs";

  let { app }: { app: AppState } = $props();
  const narrow = new MediaQuery("(max-width: 719px)");

  function pickCity(c: CityId) {
    app.setCity(c);
    app.nearOpen = false;   // the map, not the empty list, is what to look at now
  }
  const close = () => (app.nearOpen = false);

  const POLL_MS = 30_000, PARALLEL = 6, RAIL_M = 1000, RAIL_MAX = 2, BUS_CHIPS = 3, RAIL_CHIPS = 2;
  // The picker's search over the citybus.gr cities (the two big buttons need no search).
  let query = $state("");
  const found = $derived(findCities(query));
  const native = (id: string) => id.slice(id.indexOf(":") + 1);

  // Each stop's answer from /v2, by its /v2 id (oasa:<GTFS id>, stasy:…).
  type Board = { arrivals: V2Arrival[]; lines: V2Line[] };
  let boards = $state.raw<Record<string, Board>>({});

  $effect(() => { if (app.nearShown) void app.loadStops(); });

  // The city of the last fix (myPos is [lat, lon]), and whether the map shows another one: then the user picks or taps.
  const fixCity = $derived(app.myPos ? nearestCity([app.myPos[1], app.myPos[0]]) : null);
  const away = $derived(elsewhere({ fixCity, cityId: app.cityId, hasPos: !!app.myPos, locked: app.cityLocked }));

  // The metro, tram and suburban stops near: every stop of /v2 (cached an hour), asked for once it shows.
  let allStops = $state.raw<StopEntry[]>([]);
  $effect(() => {
    if (!app.nearShown || !app.cityInfo.rail || allStops.length) return;
    fetchV2Stops().then(r => { if (r.status === 200 && r.body) allStops = (r.body as { stops: StopEntry[] }).stops; }, () => {});
  });
  const RAIL_MODES = new Set(["metro", "tram", "suburban", "rail"]);
  const railNear = $derived.by(() => {
    const at = app.myPos;
    if (!at || !app.cityInfo.rail || !allStops.length) return [];
    return allStops.flatMap(s => {
      if (isBusId(s[0]) || !s[4].some(m => RAIL_MODES.has(m))) return [];
      const m = Math.round(distanceM([at[1], at[0]], [s[3], s[2]]));
      return m <= RAIL_M ? [{ s, m }] : [];
    }).sort((a, b) => a.m - b.m).slice(0, RAIL_MAX);
  });

  // One list, nearest first: the bus stops (a group of one name) and the stations.
  type Item = { key: string; kind: "bus" | "rail"; name: string; m: number; ids: string[]; g?: NearGroup; mode?: string };
  const MODE_WORD: Record<string, string> = { metro: "μετρό", tram: "τραμ", suburban: "προαστιακός", rail: "προαστιακός" };
  const items = $derived.by((): Item[] => {
    const bus = app.nearGroups.map((g): Item => ({ key: `b|${g.ids.join("|")}`, kind: "bus", name: titleCase(g.name), m: g.m, ids: g.ids.map(id => busId(id)), g }));
    const rail = railNear.map(({ s, m }): Item => {
      const mode = s[4].find(x => RAIL_MODES.has(x)) ?? "metro";
      return { key: `r|${s[0]}`, kind: "rail", name: `${s[1]} · ${MODE_WORD[mode] ?? mode}`, m, ids: [s[0]], mode };
    });
    return [...bus, ...rail].sort((a, b) => a.m - b.m);
  });
  const both = $derived(items.some(x => x.kind === "bus") && items.some(x => x.kind === "rail"));
  let only = $state<"all" | "bus" | "rail">("all");
  const kinds = [{ k: "all", t: "Όλα", l: "Όλες οι στάσεις" }, { k: "bus", t: "Λεωφ.", l: "Λεωφορεία" }, { k: "rail", t: "Ράγες", l: "Μετρό, τραμ, προαστιακός" }] as const;

  const ids = $derived(items.flatMap(x => x.ids));
  const idKey = $derived(ids.join("|"));

  $effect(() => {
    if (!app.nearShown || !idKey) return;
    const want = untrack(() => ids);
    // Only the stops near now: the boards of the ones passed on the way go.
    untrack(() => { boards = Object.fromEntries(Object.entries(boards).filter(([k]) => want.includes(k))); });
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (document.visibilityState !== "hidden") {
        let next = 0;
        const worker = async () => {
          while (next < want.length && !ac.signal.aborted && document.visibilityState !== "hidden") {
            const id = want[next++], r = await fetchV2Stop(busId(id));
            if (ac.signal.aborted) return;
            const b = r.body as { arrivals?: V2Arrival[]; lines?: V2Line[] } | null;
            if (r.status === 200 && b) boards = { ...boards, [id]: { arrivals: b.arrivals ?? [], lines: b.lines ?? [] } };
          }
        };
        await Promise.all(Array.from({ length: Math.min(PARALLEL, want.length) }, worker));
      }
      if (!ac.signal.aborted) timer = setTimeout(load, POLL_MS);
    };
    void load();
    return () => { ac.abort(); clearTimeout(timer); };
  });

  // A station's lines (cached an hour): their stops give the headsigns their proper names («ΕΛΛΗΝΙΚΟ» is «Ελληνικό»).
  let details = $state.raw<Record<string, LineDetail>>({});
  const asked = new Set<string>();
  $effect(() => {
    for (const x of items) if (x.kind === "rail") for (const l of boards[x.ids[0]]?.lines ?? []) {
      if (asked.has(l.id)) continue;
      asked.add(l.id);
      fetchV2Line(l.id).then(r => { if (r.status === 200 && r.body) details = { ...details, [l.id]: r.body as LineDetail }; }, () => {});
    }
  });

  // A bus stop's chips: the next bus of each line (both sides of the street together), soonest first; plus: the
  // lines left out. null before any answer.
  function busChips(x: Item): { rows: StopRow[]; plus: number } | null {
    const got = x.ids.filter(id => boards[id]);
    if (!got.length) return null;
    const rows = stopRows(got.flatMap(id => boards[id].arrivals), app.serverNow / 1000);
    const seen = new Set<string>(), first: StopRow[] = [];
    for (const r of rows) if (!seen.has(r.line)) { seen.add(r.line); first.push(r); }
    const all = new Set([...(x.g?.lines ?? []), ...first.map(r => native(r.line))]);
    const shown = first.slice(0, BUS_CHIPS);
    return { rows: shown, plus: Math.max(0, all.size - shown.length) };
  }

  // A station's chips: the next train of each line, then the other direction, where it goes.
  function railChips(x: Item): { line: V2Line; row: StopRow; to: string | null }[] | null {
    const b = boards[x.ids[0]];
    if (!b) return null;
    const patterns = Object.fromEntries(b.lines.map(l => [l.id, details[l.id]?.patterns ?? []]));
    const stops = Object.assign({}, ...b.lines.map(l => details[l.id]?.stops ?? {})) as Record<string, V2Stop>;
    const rows = stopRows(b.arrivals, app.serverNow / 1000, patterns, stops);
    const byLine = new Map(b.lines.map(l => [l.id, l]));
    const pick: StopRow[] = [];
    for (const r of rows) if (pick.length < RAIL_CHIPS && !pick.some(p => p.line === r.line)) pick.push(r);
    for (const r of rows) if (pick.length < RAIL_CHIPS && !pick.includes(r)) pick.push(r);
    return pick.flatMap(r => {
      const line = byLine.get(r.line);
      if (!line) return [];
      // The proper name once the line's stops are here; until then none, not the feed's capitals.
      const h = details[r.line] ? headsignName(r.headsign, stops) : null;
      return [{ line, row: r, to: h ? (h === h.toLocaleUpperCase("el") ? titleCase(toward(h)) : h) : null }];
    });
  }

  function busChip(line: string) {
    const id = native(line), c = app.lineColor(id);
    return { label: id, bg: c.bg, fg: c.fg, mode: app.lineInfo.get(id)?.kind === "trolley" ? "trolley" : "bus" };
  }
  function railChip(l: V2Line) {
    const mode = l.mode === "suburban" || l.mode === "rail" ? "rail" : l.mode;
    const label = l.mode === "metro" ? (l.label ?? native(l.id)).replace(/^M/, "") : l.mode === "suburban" ? "Π" : l.label ?? native(l.id);
    return { label, bg: l.color || "#3b5bdb", fg: l.text_color || "#ffffff", mode };
  }

  function openItem(x: Item) {
    app.push({ kind: "stop", id: x.ids[0], title: x.kind === "bus" ? x.name : x.name.replace(/ · .*$/, "") });
  }
</script>

<svelte:window onkeydown={e => { if (e.key === "Escape" && app.nearShown) close(); }} />

<!-- The city picker: without a location the user says where they are; a pick moves the map there. -->
{#snippet cities()}
  <div class="cities" role="group" aria-label="Πόλη">
    {#each MAIN_CITIES as id (id)}
      <button type="button" class="city" aria-pressed={app.cityId === id} onclick={() => pickCity(id)}>
        <b>{CITIES[id].name}</b><small>{CITIES[id].hint}</small>
      </button>
    {/each}
  </div>
  <input type="search" class="find" placeholder="Βρες πόλη…" aria-label="Βρες πόλη" bind:value={query} />
  {#if found.length}
    <div class="picks" role="group" aria-label="Πόλεις">
      {#each found as id (id)}
        <button type="button" class="chip" aria-pressed={app.cityId === id} title={CITIES[id].name} onclick={() => pickCity(id)}>{CITIES[id].name}</button>
      {/each}
    </div>
  {:else}
    <p class="muted">Καμία πόλη.</p>
  {/if}
{/snippet}

{#snippet when(t: StopRow["times"][number])}
  <span class="min" class:live={t.live}>{whenText(t.at, app.serverNow)}</span>
{/snippet}

{#if app.nearShown}
  <section class="near" aria-label="Κοντά σου" use:freeSheet={{ handles: ".grip, .near > header", keep: 120, on: () => narrow.current }}>
    <div class="grip" aria-hidden="true"></div>
    <header>
      <h2>Κοντά σου</h2>
      {#if both}
        <div class="kinds" role="group" aria-label="Είδος στάσης">
          {#each kinds as k (k.k)}
            <button type="button" class="kind" aria-pressed={only === k.k} aria-label={k.l} title={k.l} onclick={() => (only = k.k)}>{k.t}</button>
          {/each}
        </div>
      {/if}
      <button type="button" class="x" aria-label="Κλείσιμο" title="Κλείσιμο" onclick={close}><Icon name="close" size={14} /></button>
    </header>

    {#if away === "go" && fixCity}
      <p class="muted">Η θέση σου είναι στην {CITIES[fixCity].name}.</p>
      <button type="button" class="use" onclick={() => app.setCity(fixCity, false)}>Πήγαινε στην {CITIES[fixCity].name}</button>
    {:else if away === "pick"}
      <p class="muted">{#if fixCity}Η θέση σου είναι στην {CITIES[fixCity].name}· δείχνεις {app.cityInfo.name}.{:else}Η θέση σου δεν είναι σε πόλη που ξέρω.{/if} Διάλεξε πόλη:</p>
      {@render cities()}
    {:else if !app.myPos || app.locState === "denied"}
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
    {:else if !items.length}
      <p class="muted">Καμία στάση σε 1 χλμ.</p>
    {:else}
      <div class="list" aria-live="polite">
        {#each items as x, n (x.key)}
          {#if !both || only === "all" || only === x.kind}
            <button type="button" class="row" onclick={() => openItem(x)}>
              <span class="num" aria-hidden="true">{n + 1}</span>
              <span class="mid">
                <span class="top"><b class="name">{x.name}</b><span class="walk" title="{distText(x.m)} · περίπου {walkMin(x.m)}′ με τα πόδια"><span class="sr">με τα πόδια </span>{walkMin(x.m)}′</span></span>
                <span class="deps">
                  {#if x.kind === "bus"}
                    {@const c = busChips(x)}
                    {#if !c}
                      {#each (x.g?.lines ?? []).slice(0, BUS_CHIPS) as l (l)}{@const bd = busChip(l)}
                        <span class="dep sq"><LineChip label={bd.label} bg={bd.bg} fg={bd.fg} mode={bd.mode} size="sm" city={app.cityId} /></span>
                      {/each}
                      {#if (x.g?.lines.length ?? 0) > BUS_CHIPS}<span class="plus">+{x.g!.lines.length - BUS_CHIPS}</span>{/if}
                    {:else if !c.rows.length}
                      <span class="none">Καμία άφιξη τώρα</span>
                    {:else}
                      {#each c.rows as r (r.line)}{@const bd = busChip(r.line)}
                        <span class="dep sq"><LineChip label={bd.label} bg={bd.bg} fg={bd.fg} mode={bd.mode} size="sm" city={app.cityId} />{@render when(r.times[0])}</span>
                      {/each}
                      {#if c.plus}<span class="plus" title="Ακόμα {c.plus} γραμμές">+{c.plus}</span>{/if}
                    {/if}
                  {:else}
                    {@const c = railChips(x)}
                    {#if !c}
                      <span class="none">Φόρτωση…</span>
                    {:else if !c.length}
                      <span class="none">Καμία αναχώρηση τώρα</span>
                    {:else}
                      {#each c as d (d.row.line + "|" + d.row.headsign)}{@const bd = railChip(d.line)}
                        <span class="dep rail" class:sq={bd.mode !== "metro"}><LineChip label={bd.label} bg={bd.bg} fg={bd.fg} mode={bd.mode} size="sm" city={app.cityId} />{#if d.to}<span class="to">{d.to}</span>{/if}{@render when(d.row.times[0])}{#if c.length === 1 && !d.row.times[0].live}<span class="sched">πρόγρ.</span>{/if}</span>
                      {/each}
                    {/if}
                  {/if}
                </span>
              </span>
              <svg class="go" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
            </button>
          {/if}
        {/each}
      </div>
    {/if}
  </section>
{/if}

<style>
  /* A desktop: a card at the map's left, like the stop card. */
  .near { position: absolute; z-index: 6; left: 16px; bottom: 28px; width: 400px; padding: 16px; box-sizing: border-box;
    border: 0; border-radius: var(--radius); background: var(--glass-strong); --card: var(--glass-fill); --card-border: var(--glass-line);
    -webkit-backdrop-filter: var(--glass-fx); backdrop-filter: var(--glass-fx); box-shadow: var(--glass-rim); text-shadow: var(--glass-text);
    max-height: calc(100dvh - 140px); overflow: hidden; display: flex; flex-direction: column; gap: 12px; color: var(--fg); }
  .near > * { flex-shrink: 0; }
  .grip { display: none; }
  header { display: flex; align-items: center; gap: 6px; min-height: 34px; }
  h2 { flex: 1; min-width: 0; margin: 0 auto 0 0; font-size: 17px; font-weight: 700; line-height: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kinds { display: flex; gap: 6px; }
  .kind { flex: none; height: 32px; display: flex; align-items: center; justify-content: center; padding: 0 12px; border: 0; border-radius: 16px;
    background: var(--control); box-shadow: inset 0 0 0 1px var(--border); color: var(--fg); font: inherit; font-size: 13px; font-weight: 700; line-height: 1; cursor: pointer; }
  .kind:hover { background: var(--control-hover); }
  .kind[aria-pressed="true"] { background: var(--fg); box-shadow: none; color: var(--bg); font-weight: 800; }
  .x { flex: none; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; margin-left: 2px; padding: 0; border: 0;
    border-radius: 50%; background: var(--control); color: var(--fg); cursor: pointer; }
  .x :global(svg) { display: block; }
  .x:hover { background: var(--control-hover); }

  .muted { margin: 0; color: var(--muted); font-size: 12.5px; line-height: 1.35; }
  .use { height: 40px; display: flex; align-items: center; justify-content: center; padding: 0 14px; border: 0; border-radius: 12px; background: var(--accent);
    color: var(--on-accent); font: inherit; font-size: 14px; font-weight: 700; line-height: 1; cursor: pointer; }
  .cities { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .city { display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: 5px; min-height: 52px; padding: 8px 12px; box-sizing: border-box;
    border: 0; border-radius: 12px; background: var(--control); box-shadow: inset 0 0 0 1px var(--border); color: var(--fg); font: inherit; text-align: left; cursor: pointer; }
  .city b { font-size: 15px; font-weight: 700; line-height: 1; }
  .city small { color: var(--muted); font-size: 11.5px; line-height: 1; }
  .city[aria-pressed="true"] { box-shadow: inset 0 0 0 2px var(--accent); }

  /* The list alone scrolls, its bar inside the card's padding. */
  .list { flex: 0 1 auto; min-height: 0; display: flex; flex-direction: column; overflow-y: auto; overscroll-behavior: contain;
    margin-right: -12px; padding-right: 12px; }
  .row { flex: none; width: 100%; height: 62px; display: flex; align-items: center; gap: 12px; padding: 0; border: 0; border-bottom: 1px solid var(--border);
    border-radius: 0; background: none; color: var(--fg); font: inherit; text-align: left; cursor: pointer; }
  .row:last-child { border-bottom: 0; }
  .row:hover .name { text-decoration: underline; text-underline-offset: 3px; }
  .num { flex: none; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--fg); color: var(--bg);
    font-size: 12px; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; }
  .mid { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
  .top { display: flex; align-items: center; gap: 8px; height: 16px; }
  .name { min-width: 0; font-size: 15px; font-weight: 700; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .walk { flex: none; color: var(--muted); font-size: 12.5px; line-height: 1; font-variant-numeric: tabular-nums; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .deps { display: flex; align-items: center; gap: 10px; height: 20px; min-width: 0; overflow: hidden; }
  .dep { flex: none; display: flex; align-items: center; gap: 6px; min-width: 0; }
  .dep.rail { flex: 0 1 auto; gap: 6px; }
  .dep.rail + .dep.rail { margin-left: 2px; }
  .dep.rail:first-child:not(:last-child) { flex-shrink: 0; }   /* the first whole; the second gives way */
  /* The compact mockups' bus and tram chips are square-ish (6px corners), the metro's round; the bus disc a touch larger. */
  .dep.sq :global(.lc) { border-radius: 6px; padding: 0 6px 0 2px; }
  .dep :global(.lc .disc) { width: 16px; height: 16px; }
  .min { flex: none; font-size: 13px; font-weight: 700; line-height: 1; color: color-mix(in srgb, var(--fg) 82%, var(--muted)); font-variant-numeric: tabular-nums; }
  .min.live { color: var(--ontime); }
  .to { min-width: 0; font-size: 13px; font-weight: 600; line-height: 1; color: color-mix(in srgb, var(--fg) 82%, var(--muted)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sched { flex: none; font-size: 12px; font-weight: 600; line-height: 1; color: var(--muted); }
  .plus { flex: none; font-size: 12.5px; font-weight: 600; line-height: 1; color: var(--muted); }
  .none { font-size: 12.5px; line-height: 1; color: var(--muted); white-space: nowrap; }
  .go { flex: none; display: block; color: color-mix(in srgb, var(--muted) 60%, transparent); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  /* Beside the trip planner, not over it (Panel sets data-planner on a computer while it is open). */
  @media (min-width: 900px) { :global(:root[data-planner]) .near { left: 432px; } }
  /* ---- A phone (compact mockup 5): a sheet from the screen's edges, its handle on top. */
  @media (max-width: 719px) {
    .near { left: 0; right: 0; bottom: 0; width: auto; border-radius: 24px 24px 0 0; padding: 8px 16px calc(16px + env(safe-area-inset-bottom)); max-height: 78dvh; }
    /* The handle: a wide strip to catch the thumb (the header drags too), the bar in its middle. */
    .grip { display: flex; align-items: center; justify-content: center; align-self: stretch; height: 21px; margin: -8px -16px -8px; cursor: grab; }
    .grip::after { content: ""; width: 40px; height: 5px; border-radius: 3px; background: var(--grip); }
    .list { margin-right: 0; padding-right: 0; }
  }
  .near { animation: nearIn .32s cubic-bezier(.2, .8, .2, 1); }
  @keyframes nearIn { from { transform: translateY(28px); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .near { animation: none; } }
  .find { width: 100%; height: 40px; margin: 8px 0 6px; padding: 0 12px; box-sizing: border-box; border: 1px solid var(--border); border-radius: 10px;
    background: none; color: var(--fg); font: inherit; font-size: 16px; line-height: 1; }
  .picks { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin: 0 0 4px; }
  .picks .chip { height: 34px; display: flex; align-items: center; justify-content: center; padding: 0 2px; border: 1px solid var(--border); border-radius: 9px; background: none; color: var(--fg); font: inherit;
    font-size: 12.5px; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
  .picks .chip[aria-pressed="true"] { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
</style>
