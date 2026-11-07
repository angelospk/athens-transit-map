<script lang="ts">
  // The card of a metro, tram or suburban stop, from /v2: the next arrivals per line and direction,
  // asked again every 20 s while it is open (cached 15 s). A tap on a row opens its train, else its line;
  // its bell opens the alert sheet for that line and direction (web push, bot/bot.ts).
  import { untrack } from "svelte";
  import { fetchV2Line, fetchV2Stop } from "../api";
  import { clock } from "../format";
  import { railHeads, type RailSpec } from "../railAlerts";
  import { dirOf, headsignName, stopRows, type LineDetail, type StopRow, type V2Arrival, type V2Line, type V2Pattern, type V2Stop } from "../v2";
  import type { AppState } from "../state.svelte";
  import Bell from "./Bell.svelte";
  import CardSheet, { whenText } from "./CardSheet.svelte";
  import Icon from "./Icon.svelte";
  import NearChanges from "./NearChanges.svelte";
  import { clockHM } from "../trains";

  let { app }: { app: AppState } = $props();

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
  <CardSheet {app} key={card.id} closeOnEscape={!alertFor} starred={!!st && app.isFavStop(st.id)} starLabel={st && app.isFavStop(st.id) ? "Αφαίρεση από τις αγαπημένες" : "Προσθήκη στις αγαπημένες"}
    onstar={st ? () => app.toggleFavStop({ id: st.id, name: st.name, lat: st.lat, lon: st.lon }) : undefined}>
    {#snippet header()}
      <span class="ht">
        <h2 class="stopname">{board?.stop.name ?? card.title ?? ""}</h2>
        {#if modeText}<span class="kind">{modeText}</span>{/if}
      </span>
    {/snippet}
    <div class="body">
      {#if board?.lines.length}
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
          <button type="button" class="primary" onclick={() => trip("to")}><Icon name="route" size={18} /><span>Πώς πάω</span></button>
          <button type="button" class="second" onclick={() => trip("from")}><Icon name="locate" size={17} /><span>Από εδώ</span></button>
        </div>
      {/if}
      {#if app.railAlert && app.railAlert.stop === card.id}
        {@const a = app.railAlert}
        <p class="armed"><Bell /> Ειδοποίηση: {a.label} προς {a.toward}, {a.min}′ πριν, έως {clock(a.until).slice(0, 5)}.
          <button type="button" class="link" onclick={() => app.setRailAlert(null)}>Ακύρωση</button></p>
      {/if}
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
</style>
