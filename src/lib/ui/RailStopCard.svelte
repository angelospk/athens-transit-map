<script lang="ts">
  // The card of a metro, tram or suburban stop, from /v2: the next arrivals per line and direction,
  // asked again every 20 s while it is open (cached 15 s). A tap on a row opens its train, else its line;
  // its bell opens the alert sheet for that line and direction (web push, bot/bot.ts).
  import { untrack } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { fetchV2Line, fetchV2Stop } from "../api";
  import { clock } from "../format";
  import { railHeads, type RailSpec } from "../railAlerts";
  import { dirOf, headsignName, stopRows, type LineDetail, type StopRow, type V2Arrival, type V2Line, type V2Pattern, type V2Stop } from "../v2";
  import type { AppState } from "../state.svelte";
  import Bell from "./Bell.svelte";
  import CardSheet, { whenText } from "./CardSheet.svelte";
  import Icon from "./Icon.svelte";
  import LineChip from "./LineChip.svelte";
  import NearChanges from "./NearChanges.svelte";
  import { clockHM } from "../trains";
  import { distM } from "../trip";

  let { app }: { app: AppState } = $props();
  // A phone shows the compact mockup 12: the operator's mark and the lines in the header, one list of the next trains.
  const narrow = new MediaQuery("(max-width: 719px)");

  const top = $derived(app.stack.at(-1));
  const card = $derived(top?.kind === "stop" && (top.id.startsWith("stasy:") || top.id.startsWith("proastiakos:")) ? top : null);

  type Board = { stop: V2Stop; lines: V2Line[]; arrivals: V2Arrival[] };
  let board = $state.raw<Board | null>(null);
  let details = $state.raw<Record<string, LineDetail>>({});
  let failed = $state(false);

  $effect(() => {
    if (!card) return;
    const id = card.id;
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    untrack(() => { board = null; details = {}; failed = false; });
    const load = async () => {
      if (document.visibilityState !== "hidden") {
        const r = await fetchV2Stop(id);
        if (ac.signal.aborted) return;
        if (r.status === 200 && r.body) {
          const b = r.body as Board;
          board = { stop: b.stop, lines: b.lines ?? [], arrivals: b.arrivals ?? [] };
          failed = false;
          const want = [...new Set([...board.lines.map(l => l.id), ...board.arrivals.map(a => a.line)])].filter(l => !details[l]);
          const got = await Promise.all(want.map(async l => [l, await fetchV2Line(l)] as const));
          if (ac.signal.aborted) return;
          const add: Record<string, LineDetail> = {};
          for (const [l, lr] of got) if (lr.status === 200 && lr.body) add[l] = lr.body as LineDetail;
          if (Object.keys(add).length) details = { ...details, ...add };
        } else if (!board) failed = true;
      }
      timer = setTimeout(load, 20_000);
    };
    void load();
    return () => { ac.abort(); clearTimeout(timer); };
  });

  // Its entrances (compact mockup 12, from the map's tiles: MapView), each with the walk from the user, the nearest
  // first in green; «Πήγαινέ με» plans the trip to that entrance.
  const ents = $derived.by(() => {
    const me = app.myPos, list = card?.id.startsWith("stasy:") ? app.stationEntrances : [];
    const rows = list.map(e => ({ ...e, m: me ? distM(me, e.at) : null }));
    const best = rows.reduce<(typeof rows)[number] | null>((a, b) => (b.m != null && (a?.m == null || b.m < a.m) ? b : a), null);
    return rows.map(r => ({ ...r, best: r === best && r.m != null }));
  });
  const entWalk = (m: number) => Math.max(1, Math.round((m * 1.3) / 80));
  function goEntrance(e: { name: string | null; at: [number, number] }, k: number) {
    if (app.myPos) app.tripFrom = { label: "Η θέση μου", pts: [app.myPos], lines: [], kind: "me" };
    app.tripTo = { label: `${board?.stop.name ?? ""} · ${e.name ?? `Είσοδος ${k + 1}`}`, pts: [e.at], lines: [], kind: "poi" };
    app.setTab("trip");
  }

  // «Σταθμός μετρό · στάση τραμ»: what the stop is, by its modes.
  const MODES: Record<string, string> = { metro: "σταθμός μετρό", tram: "στάση τραμ", suburban: "σταθμός προαστιακού" };
  const modeText = $derived.by(() => {
    const t = [...new Set(board?.stop.modes ?? [])].map(m => MODES[m] ?? m).join(" · ");
    return t ? t[0].toLocaleUpperCase("el") + t.slice(1) : "";
  });
  const patterns = $derived(Object.fromEntries(Object.entries(details).map(([l, d]) => [l, d.patterns])) as Record<string, V2Pattern[]>);
  const stops = $derived(Object.assign({}, ...Object.values(details).map(d => d.stops)) as Record<string, V2Stop>);
  const rows = $derived(board ? stopRows(board.arrivals, app.serverNow / 1000, patterns, stops) : []);
  // The departures as cards (Apple Maps' layout): one per line, in the station's order, a row per direction.
  const cards = $derived.by(() => {
    const order = board?.lines.map(l => l.id) ?? [];
    const by = new Map<string, StopRow[]>();
    for (const r of rows) by.set(r.line, [...(by.get(r.line) ?? []), r]);
    return [...by].sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)).map(([line, rs]) => ({ line, rows: rs }));
  });
  // How often a direction runs: the gap between its next two trains, in minutes (none from one train).
  const every = (r: StopRow) => (r.times.length > 1 ? Math.max(1, Math.round((r.times[1].at - r.times[0].at) / 60)) : null);
  const MODE_NAME: Record<string, string> = { metro: "Γραμμή", tram: "Τραμ", suburban: "Προαστιακός" };
  const titleOf = (id: string) => { const ln = lineOf(id); return `${MODE_NAME[ln?.mode ?? ""] ?? "Γραμμή"} ${labelOf(id)}`; };
  // «Πώς πάω» / «Από εδώ»: the planner, with the station as its end or its start.
  function trip(end: "from" | "to") {
    const st = board?.stop;
    if (!st) return;
    const here = { label: st.name, kind: "metro" as const, pts: [[st.lat, st.lon] as [number, number]], lines: [] };
    if (end === "from") app.tripFrom = here; else app.tripTo = here;
    app.setTab("trip");
  }
  const lineOf = (id: string) => board?.lines.find(l => l.id === id) ?? details[id]?.line;
  // The station's operator mark (metro, tram), else the mode's icon; and what its next departures are called.
  const LOGO: Record<string, string> = { metro: "icons/metro-logo.svg", tram: "icons/tram-logo.svg" };
  const mainMode = $derived(board?.stop.modes[0] ?? (card?.id.startsWith("proastiakos:") ? "suburban" : card?.id.endsWith("-tram") ? "tram" : "metro"));
  const nextWord = $derived(mainMode === "tram" ? "Επόμενα τραμ" : "Επόμενοι συρμοί");

  $effect(() => { if (board) untrack(() => app.retitle(board!.stop.name)); });

  // The alert sheet for one row: its line, and every headsign of its direction (the bot matches those).
  let alertFor = $state.raw<{ rail: Omit<RailSpec, "min" | "until">; color: { bg: string; fg: string } } | null>(null);
  $effect(() => { void card?.id; alertFor = null; });
  const labelOf = (id: string) => { const ln = lineOf(id); return ln?.label ?? ln?.name ?? id.slice(id.indexOf(":") + 1); };
  function bell(r: StopRow) {
    if (!board) return;
    const pats = patterns[r.line] ?? [];
    const raw = board.arrivals.find(a => a.line === r.line &&
      (r.dir != null ? dirOf(pats, a.headsign) === r.dir : headsignName(a.headsign, stops) === r.headsign))?.headsign ?? r.headsign;
    const ln = lineOf(r.line);
    alertFor = {
      rail: { stop: board.stop.id, name: board.stop.name, line: r.line, label: labelOf(r.line), toward: r.headsign, heads: railHeads(pats, r.dir, raw) },
      color: { bg: ln?.color ?? "#3b5bdb", fg: ln?.text_color ?? "#ffffff" },
    };
  }
</script>

{#if card}
  {@const st = board?.stop}
  <CardSheet {app} key={card.id} compact closeOnEscape={!alertFor} starred={!!st && app.isFavStop(st.id)} starLabel={st && app.isFavStop(st.id) ? "Αφαίρεση από τις αγαπημένες" : "Προσθήκη στις αγαπημένες"}
    onstar={st ? () => app.toggleFavStop({ id: st.id, name: st.name, lat: st.lat, lon: st.lon }) : undefined}>
    {#snippet header()}
      {#if narrow.current}
        {#if LOGO[mainMode]}<img class="plogo" class:tram={mainMode === "tram"} src="{import.meta.env.BASE_URL}{LOGO[mainMode]}" alt="" />
        {:else}<span class="pmode" aria-hidden="true"><Icon name={mainMode === "suburban" ? "suburban" : "metro"} size={20} /></span>{/if}
      {/if}
      <span class="ht">
        <h2 class="stopname">{board?.stop.name ?? card.title ?? ""}</h2>
        {#if narrow.current && board?.lines.length}
          <span class="plines" role="group" aria-label="Οι γραμμές του σταθμού">
            {#each board.lines as l (l.id)}
              <button type="button" class="pchip" style:--c={l.color} style:--t={l.text_color} aria-label="Γραμμή {l.label ?? l.name}"
                onclick={() => app.push({ kind: "line", id: l.id, title: l.label ?? l.name })}>{l.label ?? l.name}</button>
            {/each}
          </span>
        {:else if modeText}<span class="kind">{modeText}</span>{/if}
      </span>
    {/snippet}
    <div class="body">
      {#if board?.lines.length && !narrow.current}
        <div class="lchips" role="group" aria-label="Οι γραμμές του σταθμού">
          {#each board.lines as l, k (l.id)}
            {#if k === 0 || board.lines[k - 1].mode !== l.mode}
              {#if k}<i class="sep" aria-hidden="true"></i>{/if}
              <span class="mode" aria-hidden="true"><Icon name={l.mode === "tram" ? "tram" : l.mode === "suburban" ? "suburban" : "metro"} size={14} /></span>
            {/if}
            <button type="button" class="lchip" class:round={l.mode === "metro"} style:--c={l.color} style:--t={l.text_color} aria-label="Γραμμή {l.label ?? l.name}"
              onclick={() => app.push({ kind: "line", id: l.id, title: l.label ?? l.name })}>{l.label ?? l.name}</button>
          {/each}
        </div>
      {/if}
      {#if st}
        <div class="acts">
          <button type="button" class="primary" onclick={() => trip("to")}><Icon name="route" size={narrow.current ? 16 : 18} /><span>Πώς πάω</span></button>
          <button type="button" class="second" onclick={() => trip("from")}><Icon name="locate" size={narrow.current ? 16 : 17} /><span>Από εδώ</span></button>
        </div>
      {/if}
      {#if app.railAlert && app.railAlert.stop === card.id}
        {@const a = app.railAlert}
        <p class="armed"><Bell /> Ειδοποίηση: {a.label} προς {a.toward}, {a.min}′ πριν, έως {clock(a.until).slice(0, 5)}.
          <button type="button" class="link" onclick={() => app.setRailAlert(null)}>Ακύρωση</button></p>
      {/if}
      {#if ents.length}
        <div class="ents">
          <span class="ecap">Είσοδοι και έξοδοι</span>
          <div class="elist">
            {#each ents as e, k (e.at.join())}
              <div class="erow">
                <span class="en" class:best={e.best}>{k + 1}</span>
                <span class="et"><b>{e.name ?? `Είσοδος ${k + 1}`}</b>{#if e.m != null}<small class:best={e.best}>{e.best ? "η πιο κοντινή · " : ""}{entWalk(e.m)}′ με τα πόδια</small>{/if}</span>
                <button type="button" class="ego" class:best={e.best} onclick={() => goEntrance(e, k)}><Icon name="route" size={14} /><span>Πήγαινέ με</span></button>
              </div>
            {/each}
          </div>
        </div>
      {/if}
      {#if narrow.current}
        <!-- A phone (compact mockup 12): the changes first, then one list, a row per line and direction. -->
        {#if st}<NearChanges {app} at={[st.lat, st.lon]} station={st.name} modes={st.modes} compact />{/if}
        <div class="psec">
          <div class="phead">
            <h3>{nextWord}</h3>
            {#if board && rows.length}<span class="pfresh">{rows.some(r => r.times.some(t => t.live)) ? "ζωντανά" : "από το πρόγραμμα"}</span>{/if}
          </div>
          {#if failed}
            <p class="muted">Δεν φόρτωσε η στάση. Δοκίμασε ξανά.</p>
          {:else if !board}
            <p class="muted">Φόρτωση…</p>
          {:else if !rows.length}
            <p class="muted">Καμία άφιξη τώρα.</p>
          {:else}
            <div class="plist" aria-live="polite">
              {#each cards as c (c.line)}
                {@const ln = lineOf(c.line)}
                {#each c.rows as r (r.line + "|" + (r.dir ?? r.headsign))}
                  {@const t0 = r.times[0]}
                  {@const plat = r.times.find(t => t.platform)?.platform}
                  <div class="prow">
                    <button type="button" class="pgo" aria-label="{labelOf(r.line)} προς {r.headsign}, {whenText(t0.at, app.serverNow)}"
                      onclick={() => app.push(r.vehicle ? { kind: "vehicle", id: r.vehicle, line: r.line } : { kind: "line", id: r.line, dir: r.dir ?? undefined })}>
                      <LineChip label={labelOf(r.line)} bg={ln?.color ?? "#3b5bdb"} fg={ln?.text_color ?? "#ffffff"} mode={ln?.mode ?? "metro"} city={app.cityId} />
                      <span class="pto">προς {r.headsign}{#if plat}<small> · Αποβάθρα {plat}</small>{/if}</span>
                      <b class="p1" class:live={t0.live}>{whenText(t0.at, app.serverNow)}</b>
                      <span class="p2">{r.times[1] ? whenText(r.times[1].at, app.serverNow) : ""}</span>
                    </button>
                    <button type="button" class="pbell" class:on={alertFor?.rail.line === r.line && alertFor.rail.toward === r.headsign}
                      title="Ειδοποίηση άφιξης" aria-label="Ειδοποίηση άφιξης του {labelOf(r.line)} προς {r.headsign}" onclick={() => bell(r)}><Bell /></button>
                  </div>
                {/each}
              {/each}
            </div>
          {/if}
        </div>
      {:else}
        <div class="dhead">
          <h3>Αναχωρήσεις</h3>
          {#if board && rows.length}<span class="fresh"><i class:hollow={!rows.some(r => r.times.some(t => t.live))}></i>{rows.some(r => r.times.some(t => t.live)) ? "ζωντανά" : "από το πρόγραμμα"} · {clockHM(app.serverNow / 1000)}</span>{/if}
        </div>
        {#if failed}
          <p class="muted">Δεν φόρτωσε η στάση. Δοκίμασε ξανά.</p>
        {:else if !board}
          <p class="muted">Φόρτωση…</p>
        {:else if !rows.length}
          <p class="muted">Καμία άφιξη τώρα.</p>
        {:else}
          <div class="deps" aria-live="polite">
            {#each cards as c (c.line)}
              {@const ln = lineOf(c.line)}
              {@const gaps = c.rows.map(every).filter(g => g != null) as number[]}
              <section class="dcard" aria-label={titleOf(c.line)}>
                <button type="button" class="dtop" onclick={() => app.push({ kind: "line", id: c.line, title: labelOf(c.line) })}>
                  <b class="lchip sm" class:round={ln?.mode === "metro"} style:--c={ln?.color ?? "#3b5bdb"} style:--t={ln?.text_color ?? "#ffffff"}>{labelOf(c.line)}</b>
                  <span>{titleOf(c.line)}</span>
                  {#if gaps.length}<small>κάθε {Math.min(...gaps)}′</small>{/if}
                </button>
                {#each c.rows as r (r.line + "|" + (r.dir ?? r.headsign))}
                  {@const plat = r.times.find(t => t.platform)?.platform}
                  {@const t0 = r.times[0]}
                  <div class="drow">
                    <button type="button" class="dgo"
                      onclick={() => app.push(r.vehicle ? { kind: "vehicle", id: r.vehicle, line: r.line } : { kind: "line", id: r.line, dir: r.dir ?? undefined })}>
                      <span class="dmid"><span class="dto">{r.headsign}</span>
                        <small class="dnote"><i class:hollow={!t0.live}></i>{[plat ? `Αποβάθρα ${plat}` : null, t0.live ? "ζωντανά" : "πρόγραμμα"].filter(Boolean).join(" · ")}</small></span>
                      <span class="dwhen"><b class:live={t0.live}>{whenText(t0.at, app.serverNow)}</b>{#if r.times[1]}<small>{whenText(r.times[1].at, app.serverNow)}</small>{/if}</span>
                    </button>
                    <button type="button" class="bell" class:on={alertFor?.rail.line === r.line && alertFor.rail.toward === r.headsign}
                      title="Ειδοποίηση άφιξης" aria-label="Ειδοποίηση άφιξης του {labelOf(r.line)} προς {r.headsign}" onclick={() => bell(r)}><Bell /></button>
                  </div>
                {/each}
              </section>
            {/each}
          </div>
        {/if}
        {#if st}<NearChanges {app} at={[st.lat, st.lon]} station={st.name} modes={st.modes} />{/if}
      {/if}
    </div>
  </CardSheet>
  {#if alertFor}
    {@const a = alertFor}
    {#await import("./AlertSheet.svelte") then m}
      <m.default {app} rail={a.rail} color={a.color} label={a.rail.name} line={a.rail.label} toward={a.rail.toward} onclose={() => (alertFor = null)} />
    {/await}
  {/if}
{/if}

<style>
  .ht { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .stopname { margin: 0; color: var(--fg); font-size: 22px; font-weight: 800; line-height: 1.1; }
  .kind { color: var(--muted); font-size: 13px; font-weight: 500; line-height: 1.2; }
  .body { display: flex; flex-direction: column; gap: 14px; }
  .body > * { flex-shrink: 0; }
  .muted { margin: 4px 0; color: var(--muted); font-size: 12px; }
  .armed { margin: 0; font-size: 12px; }
  .link { border: 0; padding: 0; background: none; color: var(--accent); font: inherit; text-decoration: underline; cursor: pointer; }

  .lchips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .mode { flex: none; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 6px;
    background: var(--control); color: var(--fg); }
  .sep { width: 1px; height: 16px; margin: 0 2px; background: var(--border); }
  .lchip { flex: none; display: inline-flex; align-items: center; justify-content: center; min-width: 26px; height: 26px; padding: 0 8px;
    border: 0; border-radius: 7px; background: var(--c); color: var(--t); font: inherit; font-size: 12px; font-weight: 800; line-height: 1;
    box-sizing: border-box; cursor: pointer; }
  .lchip.round { min-width: 26px; padding: 0 6px; border-radius: 13px; }
  .lchip.sm { min-width: 22px; height: 22px; padding: 0 6px; border-radius: 6px; font-size: 11px; }
  .lchip.sm.round { border-radius: 11px; }
  b.lchip { cursor: inherit; }

  .acts { display: flex; gap: 8px; }
  .primary, .second { flex: 1; height: 46px; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 0 14px; border: 0;
    border-radius: 14px; font-size: 15px; font-weight: 800; line-height: 1; cursor: pointer; }
  .primary { background: var(--accent); color: var(--on-accent); }
  .second { background: var(--card); color: var(--fg); font-weight: 700; }
  .second:hover { background: var(--control-hover); }

  .dhead { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 22px; }
  h3 { margin: 0; font-size: 18px; font-weight: 800; line-height: 1; }
  .fresh { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; font-weight: 500; line-height: 1; white-space: nowrap; }
  .fresh i, .dnote i { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--ontime); }
  .fresh i.hollow, .dnote i.hollow { background: none; border: 1.5px solid var(--muted); box-sizing: border-box; }

  .deps { display: flex; flex-direction: column; gap: 10px; }
  .dcard { border-radius: 16px; background: var(--card); border: 1px solid var(--card-border); overflow: hidden; }
  .dtop { width: 100%; display: flex; align-items: center; gap: 10px; min-height: 46px; padding: 0 14px; border: 0; border-bottom: 1px solid var(--border);
    background: none; color: var(--fg); font: inherit; text-align: left; cursor: pointer; box-sizing: border-box; }
  .dtop > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; font-weight: 700; line-height: 1.1; }
  .dtop > small { flex: none; color: var(--muted); font-size: 12px; font-weight: 600; line-height: 1; }
  .dtop:hover > span { text-decoration: underline; text-underline-offset: 3px; }
  .drow { display: flex; align-items: center; gap: 2px; padding-right: 6px; border-bottom: 1px solid var(--border); }
  .drow:last-child { border-bottom: 0; }
  .dgo { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; min-height: 58px; padding: 9px 8px 9px 14px; border: 0; background: none;
    color: inherit; font: inherit; text-align: left; cursor: pointer; }
  .dgo:hover { background: var(--control); }
  .dmid { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .dto { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; font-weight: 600; line-height: 1.15; }
  .dnote { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; font-weight: 500; line-height: 1.2; white-space: nowrap; }
  .dwhen { flex: none; display: flex; align-items: baseline; gap: 8px; line-height: 1; font-variant-numeric: tabular-nums; }
  .dwhen b { font-size: 22px; font-weight: 800; letter-spacing: -.3px; color: var(--fg); }
  .dwhen b.live { color: var(--ontime); }
  .dwhen small { color: var(--muted); font-size: 14px; font-weight: 600; }
  .bell { flex: none; display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; padding: 0; border: 0; border-radius: 50%;
    background: none; color: var(--muted); cursor: pointer; }
  .bell:hover, .bell.on { background: var(--control); color: var(--accent); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  /* ---- A phone (compact mockup 12): the operator's mark, a 19px title over the line chips, the two actions at 40px, the changes
     near, then one list of the next trains, a 48px row per line and direction. */
  .plogo { flex: none; width: 36px; height: 36px; display: block; }
  .plogo.tram { width: 26px; object-fit: contain; }
  .pmode { flex: none; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border-radius: 50%;
    background: var(--control); color: var(--fg); }
  .plines { display: flex; align-items: center; gap: 4px; height: 18px; }
  .pchip { flex: none; height: 18px; display: flex; align-items: center; justify-content: center; padding: 0 6px; border: 0; border-radius: 9px;
    background: var(--c); color: var(--t); font: inherit; font-size: 11px; font-weight: 800; line-height: 1; box-sizing: border-box; cursor: pointer; }
  .psec { display: flex; flex-direction: column; gap: 6px; }
  .phead { height: 18px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 2px; }
  .phead h3 { font-size: 13px; font-weight: 700; color: var(--muted); }
  .pfresh { color: var(--muted); font-size: 12px; font-weight: 600; line-height: 1; white-space: nowrap; }
  .plist { display: flex; flex-direction: column; border-radius: 16px; background: var(--card); overflow: hidden; }
  .prow { display: flex; align-items: center; height: 48px; padding-right: 6px; border-bottom: 1px solid var(--border); }
  .prow:last-child { border-bottom: 0; }
  .pgo { flex: 1; min-width: 0; align-self: stretch; display: flex; align-items: center; gap: 10px; padding: 0 4px 0 12px; border: 0;
    background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
  .prow .pgo :global(.lc) { --h: 24px; padding: 0 8px 0 2px; gap: 4px; font-size: 12.5px; }
  .pto { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 600; line-height: 1; }
  .pto small { color: var(--muted); font-size: 12px; font-weight: 500; }
  .p1 { flex: none; font-size: 16px; font-weight: 700; line-height: 1; color: color-mix(in srgb, var(--fg) 85%, var(--muted)); font-variant-numeric: tabular-nums; }
  .p1.live { color: var(--ontime); }
  .p2 { flex: none; min-width: 28px; text-align: right; color: var(--muted); font-size: 12.5px; line-height: 1; font-variant-numeric: tabular-nums; }
  .pbell { flex: none; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 50%;
    background: none; color: var(--muted); cursor: pointer; }
  .pbell:hover, .pbell.on { background: var(--control); color: var(--accent); }
  @media (max-width: 719px) {
    .ht { gap: 6px; }
    .stopname { font-size: 19px; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .body { gap: 12px; }
    .primary, .second { height: 40px; gap: 7px; border-radius: 12px; font-size: 14px; }
    .second { background: var(--control); }
    .muted { margin: 2px; font-size: 13px; }
  }
  .ents { display: flex; flex-direction: column; gap: 6px; flex: none; }
  .ecap { height: 18px; display: flex; align-items: center; padding: 0 2px; font-size: 13px; font-weight: 700; line-height: 1; color: var(--muted); }
  .elist { display: flex; flex-direction: column; border-radius: 16px; background: var(--card); }
  .erow { height: 60px; display: flex; align-items: center; gap: 10px; padding: 0 12px; border-bottom: 1px solid var(--border); }
  .erow:last-child { border-bottom: 0; }
  .en { flex: none; width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--fg) 18%, var(--card));
    color: var(--fg); font-size: 14px; font-weight: 800; line-height: 1; }
  .en.best { background: #2f9e5b; color: #ffffff; }
  .et { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .et b { font-size: 14.5px; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .et small { font-size: 12.5px; line-height: 1; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .et small.best { color: color-mix(in srgb, var(--ontime) 75%, #ffffff); }
  .ego { flex: none; height: 32px; display: flex; align-items: center; gap: 5px; padding: 0 10px; border: 0; border-radius: 10px; background: var(--control); color: var(--fg);
    font: inherit; font-size: 12.5px; font-weight: 800; line-height: 1; cursor: pointer; }
  .ego.best { background: #4d8af0; color: #ffffff; }
</style>
