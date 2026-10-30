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

  const MODES: Record<string, string> = { metro: "Μετρό", tram: "Τραμ", suburban: "Προαστιακός" };
  const modeText = $derived([...new Set(board?.stop.modes ?? [])].map(m => MODES[m] ?? m).join(" · "));
  const patterns = $derived(Object.fromEntries(Object.entries(details).map(([l, d]) => [l, d.patterns])) as Record<string, V2Pattern[]>);
  const stops = $derived(Object.assign({}, ...Object.values(details).map(d => d.stops)) as Record<string, V2Stop>);
  const rows = $derived(board ? stopRows(board.arrivals, app.serverNow / 1000, patterns, stops) : []);
  const anyTimetable = $derived(rows.some(r => r.times.some(t => !t.live)));
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
      <h2 class="stopname">{board?.stop.name ?? card.title ?? ""}</h2>
      {#if modeText}<span class="fresh">{modeText}</span>{/if}
    {/snippet}
    {#if app.railAlert && app.railAlert.stop === card.id}
      {@const a = app.railAlert}
      <p class="armed"><Bell /> Ειδοποίηση: {a.label} προς {a.toward}, {a.min}′ πριν, έως {clock(a.until).slice(0, 5)}.
        <button type="button" class="link" onclick={() => app.setRailAlert(null)}>Ακύρωση</button></p>
    {/if}
    {#if failed}
      <p class="muted">Δεν φόρτωσε η στάση. Δοκίμασε ξανά.</p>
    {:else if !board}
      <p class="muted">Φόρτωση…</p>
    {:else if !rows.length}
      <p class="muted">Καμία άφιξη τώρα.</p>
    {:else}
      {#if anyTimetable}<p class="note">πρόγραμμα</p>{/if}
      <ul class="rows" aria-live="polite" aria-label="Αφίξεις">
        {#each rows as r (r.line + "|" + (r.dir ?? r.headsign))}
          {@const ln = lineOf(r.line)}
          {@const plat = r.times.find(t => t.platform)?.platform}
          <li><button type="button" class="go"
            onclick={() => app.push(r.vehicle ? { kind: "vehicle", id: r.vehicle, line: r.line } : { kind: "line", id: r.line, dir: r.dir ?? undefined })}>
            <span class="pill" style:--c={ln?.color ?? "#3b5bdb"} style:--t={ln?.text_color ?? "#ffffff"}>{ln?.label ?? ln?.name ?? r.line.slice(r.line.indexOf(":") + 1)}</span>
            <span class="head">→ {r.headsign}</span>
            {#if plat}<span class="plat">Αποβ. {plat}</span>{/if}
            <span class="times">
              {#each r.times as t, k (k)}<span class:first={k === 0} class:sched={!t.live}>{whenText(t.at, app.serverNow)}</span>{/each}
            </span>
          </button><button type="button" class="bell" class:on={alertFor?.rail.line === r.line && alertFor.rail.toward === r.headsign}
            title="Ειδοποίηση άφιξης" aria-label="Ειδοποίηση άφιξης του {labelOf(r.line)} προς {r.headsign}" onclick={() => bell(r)}><Bell /></button></li>
        {/each}
      </ul>
    {/if}
    {#if board?.lines.length}
      <div class="lines" role="group" aria-label="Οι γραμμές του σταθμού">
        {#each board.lines as l (l.id)}
          <button type="button" class="pill" style:--c={l.color} style:--t={l.text_color} aria-label="Γραμμή {l.label ?? l.name}"
            onclick={() => app.push({ kind: "line", id: l.id, title: l.label ?? l.name })}>{l.label ?? l.name}</button>
        {/each}
      </div>
    {/if}
  </CardSheet>
  {#if alertFor}
    {@const a = alertFor}
    {#await import("./AlertSheet.svelte") then m}
      <m.default {app} rail={a.rail} color={a.color} label={a.rail.name} line={a.rail.label} toward={a.rail.toward} onclose={() => (alertFor = null)} />
    {/await}
  {/if}
{/if}

<style>
  .muted { margin: 4px 0; color: var(--muted); font-size: 12px; }
  .note { margin: 4px 0 2px; font-size: 11px; color: var(--muted); }
  .stopname { color: var(--fg); font-size: 15px; font-weight: 700; }
  .rows { list-style: none; margin: 0; padding: 0; }
  .rows li { display: flex; align-items: center; gap: 2px; }
  .rows .go { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; width: 100%; min-height: 44px; padding: 0 4px; margin: 0 0 0 -4px; border: 0;
    border-radius: 8px; background: none; color: inherit; font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
  .rows .go:hover { background: var(--control); }
  .bell { flex: none; display: grid; place-items: center; width: 44px; height: 44px; border: 0; border-radius: 8px; background: none;
    color: var(--muted); cursor: pointer; }
  .bell:hover, .bell.on { background: var(--control); color: var(--accent); }
  .armed { margin: 0 0 6px; font-size: 12px; }
  .link { border: 0; padding: 0; background: none; color: var(--accent); font: inherit; text-decoration: underline; cursor: pointer; }
  .pill { flex: none; padding: 2px 8px; border-radius: 10px; background: var(--c); color: var(--t); font-weight: 700; }
  .head { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lines { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .lines .pill { min-height: 36px; min-width: 44px; border: 0; font: inherit; font-weight: 700; cursor: pointer; }
  .plat { flex: none; padding: 1px 8px; border-radius: 10px; background: var(--control); font-size: 11px; }
  .times { flex: none; display: flex; gap: 8px; font-variant-numeric: tabular-nums; color: var(--muted); }
  .times .first { color: var(--fg); font-weight: 700; }
  .times .sched { font-style: italic; }
</style>
