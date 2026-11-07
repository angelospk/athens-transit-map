<script lang="ts">
  import { untrack } from "svelte";
  import { fetchLineStatic, fetchStop, peekStop } from "../api";
  import { alertLinesAt, arrivalGroups, arrivalNote, boardLines, headTo, linesAt, linesToWarm, mineFirst, timeText, toward, twins, usualRows, scheduleRows, signCode, type ArrivalGroup, type ArrivalTime, type StopBoard } from "../stops";
  import Bell from "./Bell.svelte";
  import type { AppState } from "../state.svelte";
  import type { FetchResult } from "../poller";
  import Back from "./Back.svelte";
  import Toward from "./Toward.svelte";
  import { towardsOf } from "../towards";
  import Icon from "./Icon.svelte";
  import DisruptionRows from "./DisruptionRows.svelte";
  import { forStop } from "../disruptions";
  import { busId } from "../busNs";
  import { busStopCard, legacyOf } from "../legacy";
  import { reportedStops } from "../stopfix";
  import StopFixBar from "./StopFixBar.svelte";

  // The tapped bus stop, laid out as the phone app's: the user's lines first («Οι γραμμές μου | Όλες»), each
  // line and headsign with its next bus in big minutes, where it is and whether it runs late, the next ones,
  // and a bell (the alert sheet for that line and direction); the other lines short below («Περνούν επίσης»)
  // and the ones with no bus near. Arrivals: backend, from GPS; asked again every 20 s while open and the tab
  // visible (cached 15 s). The stop of the same name across the street is a tap away.
  let { app }: { app: AppState } = $props();
  let board = $state.raw<StopBoard | null>(null);

  const ix = $derived(app.stopIx);
  const i = $derived(app.busStop);
  const stop = $derived(ix && i != null ? ix.s[i] : undefined);
  // Until the stop index (trips.json, slow on a phone) loads, the card shows from the board alone.
  const top = $derived(app.stack.at(-1));
  const early = $derived.by(() => {
    const l = !ix && top ? legacyOf(top) : null;
    return l?.kind === "bus-stop" ? l.code : null;
  });
  const id = $derived(stop ? stop[3] : early);
  const name = $derived(stop?.[0] ?? board?.stop.name ?? top?.title ?? "Στάση");
  const lines = $derived(ix && i != null ? linesAt(ix, i) : board ? boardLines(board) : []);
  // The star: the stop's /v2 id is <bus namespace>:<GTFS id>; an index from before the ids has none.
  const favId = $derived(id ? busId(id) : null);
  const starred = $derived(!!favId && app.isFavStop(favId));
  // The OASA notices about the stop or its lines (/v2 ids: oasa:<GTFS stop id>, oasa:<line> in Athens).
  const lineIds = $derived(lines.map(l => busId(l.line)));
  const disruptions = $derived(favId ? forStop(app.disruptions, favId, lineIds, app.serverNow) : []);
  const dir = $derived(ix && i != null ? towardsOf(ix, i) : null);   // which way the buses leave
  const across = $derived(ix && i != null ? twins(ix, i)[0] : undefined);
  // The code on the stop sign, bottom right, so a rider can find the stop (rev 21).
  const code = $derived(signCode(board?.stop.code, id, app.cityId === "athens"));

  // «Λάθος θέση;»: the card gives way to a short bar while the user drags a pin (StopFixBar, MapView).
  // sent: this device already reported this stop (one report per device per stop).
  const fixing = $derived(!!id && app.stopFix?.id === id);
  let sent = $state(false);
  $effect(() => {
    const sid = id;
    sent = !!sid && reportedStops().includes(sid);
    untrack(() => { if (app.stopFix && app.stopFix.id !== sid) { app.stopFix = null; app.stopFixAt = null; } });
  });
  const at = $derived<[number, number] | null>(stop ? [stop[1], stop[2]] : board ? [board.stop.lat, board.stop.lon] : null);
  function startFix() {
    if (!id || !at) return;
    app.stopFix = { id, name, from: at };
    app.stopFixAt = at;
  }
  const endFix = () => { app.stopFix = null; app.stopFixAt = null; };

  // «Οι γραμμές μου»: the stop's lines among the favourites and the lines on the map.
  let all = $state(false);
  const mine = $derived(lines.map(l => l.line).filter(l => app.favorites.includes(l) || app.selected.includes(l)));
  const showAll = $derived(all || !mine.length || mine.length === lines.length);

  // The alert sheet (AlertSheet, loaded on the first bell) for one line, in the tapped row's direction.
  // From the header: every line of the stop (one with no bus near too), the user's lines ticked.
  let alertFor = $state.raw<{ line?: string; toward?: string; lines: ReturnType<typeof alertLinesAt>; ticked?: string[] } | null>(null);
  // «Όλες οι γραμμές εδώ» of the favourites panel opens the stop with all its lines (ref "all").
  $effect(() => { void i; alertFor = null; const t = untrack(() => app.stack.at(-1)); all = t?.kind === "stop" && t.ref === "all"; });
  const alertLines = $derived(app.cityInfo.alerts && ix && i != null ? alertLinesAt(ix, i) : []);   // the bot watches only some cities
  function bell(g: ArrivalGroup) {
    const l = alertLines.find(x => x.line === g.line);
    if (!l) return;
    const same = l.variants.filter(v => v.id === g.variant);
    alertFor = { line: g.line, toward: dest(g).to, lines: [{ line: g.line, variants: same.length ? same : l.variants }] };
  }
  const REFRESH_MS = 20_000, QUICK_RETRY_MS = 2_000;
  let failed = $state(false);
  let now = $state(Date.now());   // set from app.serverMs() when a stop opens
  const groups = $derived(board ? arrivalGroups(board.arrivals, now) : []);
  const split = $derived(mineFirst(groups, mine));
  const shown = $derived(showAll ? groups : split.mine);
  const also = $derived(showAll ? [] : split.also.slice(0, 4));
  // The lines shown with no bus on its way: how often they usually pass now (backend rev 18, map#24), grey,
  // never mixed with the live rows; the rest as chips. citybus.gr cities have no "usual": their timetable times.
  const usual = $derived(board ? (app.cityInfo.gtfsHost === "citybus.gr" ? scheduleRows(board.arrivals, groups, now) : usualRows(board.usual, groups, now))
    .filter(u => showAll || mine.includes(u.line)) : []);
  const quiet = $derived(lines.filter(l => (showAll || mine.includes(l.line)) && !groups.some(g => g.line === l.line) && !usual.some(u => u.line === l.line)));
  const big = (t: ArrivalTime) => (t.here ? "τώρα" : timeText(t));
  // Where a row's bus runs to; on a loop, after the turn, back to the start (headTo).
  const dest = (g: { line: string; headsign: string; variant?: string }) =>
    (ix && i != null && g.variant ? headTo(ix, g.line, g.variant, i, g.headsign) : { to: toward(g.headsign), back: false });
  const variantsOf = (line: string) => lines.find(l => l.line === line)?.variants ?? [];

  const boardOf = (r: FetchResult | undefined) => {
    const b = r?.body as StopBoard | null | undefined;
    return r?.status === 200 && b && typeof b.stop === "object" && b.stop && Array.isArray(b.arrivals) ? b : null;
  };

  $effect(() => {
    const sid = id;
    board = null;
    failed = !sid;   // an index from before the ids: no live arrivals
    if (!sid) return;
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false, misses = 0;
    now = app.serverMs();
    board = boardOf(peekStop(sid));
    const load = async () => {
      if (busy) return;
      clearTimeout(timer);
      let quick = false;
      if (document.visibilityState !== "hidden") {
        busy = true;
        const r = await fetchStop(sid);
        busy = false;
        if (ac.signal.aborted) return;
        now = app.serverMs();
        const b = boardOf(r);
        if (b) {
          board = b;
          // Loaded once per page (api.ts): a tapped bus then shows its stops ahead with no wait.
          for (const l of linesToWarm(b.arrivals)) void fetchLineStatic(l).catch(() => {});
        }
        // Nothing shown yet and the first try lost on the network (a weak phone network): once more in 2 s, still «Φόρτωση».
        misses = b ? 0 : misses + 1;
        quick = !board && misses === 1 && r?.status === 0;   // a 429 or 5xx keeps the long wait
        failed = !b && !quick;
      }
      timer = setTimeout(load, quick ? QUICK_RETRY_MS : REFRESH_MS);
    };
    const shown = () => { if (document.visibilityState === "visible") load(); };
    load();
    const tick = setInterval(() => (now = app.serverMs()), 10_000);
    document.addEventListener("visibilitychange", shown);
    return () => { ac.abort(); clearTimeout(timer); clearInterval(tick); document.removeEventListener("visibilitychange", shown); };
  });
</script>

<svelte:window onkeydown={e => { if (e.key !== "Escape") return; if (fixing) endFix(); else if ((stop || early) && !alertFor) app.closeCards(); }} />

{#snippet check()}
  <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" class="tick"><path d="M2 6.5l2.5 2.5L10 3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
{/snippet}
{#snippet chip(line: string)}
  {@const c = app.lineColor(line)}
  <b class="chip" style:--bg={c.bg} style:--fg={c.fg}>{line}</b>
{/snippet}

{#if fixing}
  <StopFixBar {app} ondone={() => (sent = !!id && reportedStops().includes(id))} />
{:else if stop || early}
  <section class="card" aria-label="Στάση {name}">
    <header>
      <Back {app} />
      <div class="t">
        <h2>{name}</h2>
        {#if dir && (dir.towards.length || dir.bearing != null)}<p class="dir"><Toward {dir} /></p>{/if}
        {#if across}<p class="sub"><button type="button" class="across"
          onclick={() => { const s = ix?.s[across.i]; if (s?.[3]) app.push(busStopCard(s[3], s[0])); }}>Απέναντι στάση · {across.m} μ</button></p>{/if}
      </div>
      {#if alertLines.length}
        <button type="button" class="bell" class:on={!!alertFor && !alertFor.line} title="Ειδοποίηση άφιξης σε αυτή τη στάση"
          aria-label="Ειδοποίηση άφιξης στη στάση {name}" onclick={() => (alertFor = { lines: alertLines, ticked: mine })}><Bell /></button>
      {/if}
      {#if favId && (stop || board)}
        <button type="button" class="starbtn" class:starred aria-pressed={starred} title={starred ? "Αφαίρεση από τις αγαπημένες" : "Προσθήκη στις αγαπημένες"}
          aria-label={starred ? "Αφαίρεση από τις αγαπημένες" : "Προσθήκη στις αγαπημένες"}
          onclick={() => app.toggleFavStop({ id: favId, name, lat: stop?.[1] ?? board!.stop.lat, lon: stop?.[2] ?? board!.stop.lon })}><Icon name={starred ? "star-filled" : "star"} size={20} /></button>
      {/if}
      <button type="button" class="close" aria-label="Κλείσιμο" onclick={() => app.closeCards()}>×</button>
    </header>
    <DisruptionRows alerts={disruptions} lines={lineIds} />
    {#if app.alert}
      {@const a = app.alert}
      <p class="on"><Bell /> Ειδοποίηση: {a.lines.map(l => l.line).join(", ")}, {a.n === 1 ? "στην προηγούμενη στάση" : `${a.n} στάσεις πριν`} από {a.label}.
        <button type="button" class="link" onclick={() => app.setAlert(null)}>Ακύρωση</button></p>
    {/if}
    {#if mine.length && mine.length < lines.length}
      <div class="seg" role="group" aria-label="Ποιες γραμμές">
        <button type="button" aria-pressed={!all} onclick={() => (all = false)}>{#if !all}{@render check()}{/if}Οι γραμμές μου · {mine.length}</button>
        <button type="button" aria-pressed={all} onclick={() => (all = true)}>{#if all}{@render check()}{/if}Όλες · {lines.length}</button>
      </div>
    {/if}
    {#if board}
      <!-- The live region stays mounted: the list and its empty state both speak when they change. -->
      <div aria-live="polite">
      {#if shown.length}
        <ul class="arr" aria-label="Επόμενα λεωφορεία">
          {#each shown as g (g.line + g.headsign)}
            {@const t = g.times[0]}
            {@const note = arrivalNote(t)}
            {@const d = dest(g)}
            <li><button type="button" class="row" onclick={() => app.openLineAt(g.line, g.variant ? [g.variant] : variantsOf(g.line), t.vehicle)}>
              {@render chip(g.line)}
              <span class="mid"><span class="to" title={g.headsign}>→ {d.to}{#if d.back}{" "}<span class="back">(επιστροφή)</span>{/if}</span><small class={note.tone}>{note.text}</small></span>
              <span class="when"><b>{big(t)}</b>{#if g.times.length > 1}<small>μετά {g.times.slice(1).map(timeText).join(", ")}</small>{/if}</span>
            </button>{#if alertLines.some(l => l.line === g.line)}<button type="button" class="bell" class:on={alertFor?.line === g.line}
              title="Ειδοποίηση για το {g.line}" aria-label="Ειδοποίηση άφιξης για το {g.line} στη στάση {name}" onclick={() => bell(g)}><Bell /></button>{/if}</li>
          {/each}
        </ul>
      {:else}
        <p class="empty">{showAll ? "Κανένα λεωφορείο καθ’ οδόν τώρα." : "Κανένα λεωφορείο των γραμμών σου καθ’ οδόν τώρα."}</p>
      {/if}
      </div>
      {#if !showAll}
        <h3>Περνούν επίσης · {lines.length - mine.length} {lines.length - mine.length === 1 ? "γραμμή" : "γραμμές"}</h3>
        <ul class="also">
          {#each also as g (g.line + g.headsign)}
            {@const t = g.times[0]}
            {@const d = dest(g)}
            <li><button type="button" class="row" onclick={() => app.openLineAt(g.line, g.variant ? [g.variant] : variantsOf(g.line), t.vehicle)}>
              {@render chip(g.line)}
              <span class="to" title={g.headsign}>→ {d.to}{#if d.back}{" (επιστροφή)"}{/if}{#if t.away}{` · ${t.away} στάσεις`}{/if}</span>
              <b class="w">{big(t)}</b>
            </button></li>
          {/each}
          <li><button type="button" class="row all" onclick={() => (all = true)}>Όλες οι γραμμές της στάσης ({lines.length}) ›</button></li>
        </ul>
      {/if}
      {#if usual.length}
        <ul class="usual" aria-label="Χωρίς λεωφορείο κοντά τώρα">
          {#each usual as u (u.line + u.headsign)}
            {@const d = dest(u)}
            <li><button type="button" class="row" onclick={() => app.openLineAt(u.line, variantsOf(u.line))}>
              {@render chip(u.line)}
              <span class="mid"><span class="to" title={u.headsign}>→ {d.to}{#if d.back}{" (επιστροφή)"}{/if}</span><small>{u.text}</small></span>
            </button></li>
          {/each}
        </ul>
      {/if}
      {#if quiet.length}
        <div class="quiet" role="group" aria-label="Χωρίς λεωφορείο κοντά τώρα">
          <span>Χωρίς λεωφορείο κοντά τώρα:</span>
          {#each quiet as l (l.line)}
            {@const c = app.lineColor(l.line)}
            <button type="button" class="chip" style:--bg={c.bg} style:--fg={c.fg} aria-label="Γραμμή {l.line}"
              onclick={() => app.openLineAt(l.line, l.variants)}>{l.line}</button>
          {/each}
        </div>
      {/if}
      <p class="src">{app.cityInfo.gtfsHost === "citybus.gr" ? "Ζωντανά, από τις αφίξεις του citybus.gr· οι θέσεις είναι εκτιμήσεις." : "Ζωντανά, από το GPS των λεωφορείων."}{#if failed}{" "}Η τελευταία ενημέρωση απέτυχε.{/if}</p>
    {:else if failed}
      <p>{id ? "Δεν φόρτωσαν οι αφίξεις. Ξαναδοκιμάζω σε 20″." : "Οι αφίξεις δεν είναι διαθέσιμες. Ανανέωσε τη σελίδα."}</p>
    {:else}
      <p>Φόρτωση αφίξεων…</p>
    {/if}
    {#if (id && at) || code}
      <div class="foot">
        {#if id && at}<p class="fix">{#if sent}Έστειλες τη θέση αυτής της στάσης. Ευχαριστούμε!{:else}<button type="button" class="link" onclick={startFix}>Λάθος θέση στάσης;</button>{/if}</p>{/if}
        {#if code}<p class="code">Κωδ. στάσης <b>{code}</b></p>{/if}
      </div>
    {/if}
  </section>
  {#if alertFor}
    {@const a = alertFor}
    {#await import("./AlertSheet.svelte") then m}
      <m.default {app} lines={a.lines} label={name} line={a.line} toward={a.toward} ticked={a.ticked} onclose={() => (alertFor = null)} />
    {/await}
  {/if}
{/if}

<style>
  .card { position: absolute; z-index: 6; left: 12px; bottom: 28px; width: 360px; padding: 12px 16px;
    background: var(--panel); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow);
    backdrop-filter: blur(8px); max-height: calc(100dvh - 140px); overflow-y: auto; overscroll-behavior: contain; box-sizing: border-box; }
  header { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; margin-bottom: 10px; }
  .t { flex: 1; min-width: 0; }
  /* Under Back, the name gets a row of its own: Back and the buttons above, the full width for the name. */
  header:has(> :global(.back)) > :global(.back) { margin-right: auto; }
  header:has(> :global(.back)) .t { order: 1; flex-basis: 100%; }
  h2 { margin: 0; font-size: 22px; font-weight: 600; line-height: 1.2; overflow: hidden; overflow-wrap: break-word;
    display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; }
  p { margin: 0 0 10px; color: var(--muted); font-size: 12px; }
  .sub { margin: 2px 0 0; font-size: 13px; }
  .dir { margin: 2px 0 0; font-size: 16px; }
  .across { padding: 0; border: 0; background: none; color: var(--accent); font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap; text-underline-offset: 3px; }
  .back { font-weight: 500; color: var(--muted); }
  .across:hover { text-decoration: underline; }
  /* A finger-sized hit area (about 39 px high) around the one-line link, the look unchanged. */
  .across { position: relative; }
  .across::after { content: ""; position: absolute; inset: -10px -4px; }
  .seg { display: flex; margin: 0 0 4px; border: 1px solid var(--border); border-radius: 20px; overflow: hidden; }
  .seg button { flex: 1; min-height: 38px; padding: 0 8px; border: 0; background: none; color: var(--fg); font: inherit; font-size: 13px;
    font-weight: 600; cursor: pointer; white-space: nowrap; }
  .seg button + button { border-left: 1px solid var(--border); }
  .seg button[aria-pressed="true"] { background: var(--control); }
  .chip { flex: none; min-width: 40px; padding: 5px 7px; border: 0; border-radius: 7px; background: var(--bg); color: var(--fg);
    font: inherit; font-size: 13px; font-weight: 700; text-align: center; font-variant-numeric: tabular-nums; box-sizing: border-box; }
  ul { list-style: none; margin: 0; padding: 0; }
  .arr li { display: flex; align-items: center; gap: 6px; border-bottom: 1px solid var(--border); }
  .row { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; min-height: 56px; padding: 6px 0; border: 0; background: none;
    color: inherit; font: inherit; text-align: left; cursor: pointer; }
  .row:hover .to { text-decoration: underline; text-underline-offset: 3px; }
  .mid { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .to { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 600; }
  .mid small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 600; }
  .ok { color: var(--ontime); }
  .late { color: var(--late2); }
  .muted { color: var(--muted); }
  .when { flex: none; display: flex; flex-direction: column; align-items: flex-end; }
  .when b { font-size: 24px; line-height: 1.05; font-weight: 700; font-variant-numeric: tabular-nums; }
  .when small { color: var(--muted); font-size: 11px; white-space: nowrap; }
  .bell { flex: none; display: grid; place-items: center; width: 40px; height: 40px; border: 0; border-radius: 50%;
    background: var(--control); color: var(--fg); cursor: pointer; }
  .bell:hover, .bell.on { background: var(--control-hover); color: var(--accent); }
  h3 { margin: 14px 0 2px; color: var(--muted); font-size: 13px; font-weight: 600; }
  .also .row { width: 100%; min-height: 40px; padding: 3px 0; }
  .also .to { flex: 1; color: var(--muted); font-weight: 400; }
  .also .w { flex: none; font-size: 16px; font-variant-numeric: tabular-nums; }
  .also .all { justify-content: center; border-top: 1px solid var(--border); color: var(--accent); font-weight: 600; }
  .tick { margin-right: 4px; vertical-align: -1px; }
  .usual { margin-top: 8px; }
  .usual li { border-bottom: 1px solid var(--border); }
  .usual .row { min-height: 48px; }
  .usual .to { color: var(--muted); font-weight: 500; }
  .usual small { color: var(--muted); font-size: 12px; font-weight: 500; line-height: 1.3; white-space: normal; }
  .quiet { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 12px 0 0; color: var(--muted); font-size: 12px; }
  .quiet .chip { min-width: 34px; min-height: 28px; padding: 2px 7px; font-size: 12px; cursor: pointer; }
  .empty { margin: 12px 0; font-size: 13px; }
  .on { margin-bottom: 8px; color: var(--accent); }
  .link { padding: 0; border: 0; background: none; color: var(--accent); text-decoration: underline; cursor: pointer; font: inherit; }
  .src { margin: 10px 0 0; font-size: 11px; }
  .foot { display: flex; align-items: center; gap: 8px; margin: 6px 0 0; }
  .fix { margin: 0; font-size: 12px; }
  .code { margin: 0 0 0 auto; font-size: 12px; color: var(--muted); user-select: all; }
  .code b { font-weight: 600; font-variant-numeric: tabular-nums; }
  .fix .link { min-height: 32px; color: var(--muted); }
  header .bell { margin-top: -2px; }
  .starbtn { flex: none; width: 36px; height: 36px; margin: -4px -4px 0 0; border: 0; background: none; color: var(--muted); font-size: 20px;
    cursor: pointer; border-radius: 8px; }
  .starbtn:hover { background: var(--control); }
  .starbtn.starred { color: #f59f00; }
  .close { flex: none; width: 36px; height: 36px; margin: -4px -10px 0 0; border: 0; background: none; font-size: 22px;
    color: var(--muted); cursor: pointer; border-radius: 8px; }
  .close:hover { background: var(--control); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @media (max-width: 719px) {
    .card { left: 0; right: 0; bottom: 0; width: auto; border-radius: 16px 16px 0 0; border-width: 1px 0 0;
      padding: 14px 16px calc(14px + env(safe-area-inset-bottom)); max-height: 55dvh; }
  }
</style>
