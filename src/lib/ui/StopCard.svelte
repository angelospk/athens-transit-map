<script lang="ts">
  import { untrack } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { freeSheet } from "../sheetDrag";
  import { fetchLineStatic, fetchSchedule, fetchStop, peekStop } from "../api";
  import { athensClock, matchDirection, timetableView, type Schedule } from "../timetable";
  import { placeNote, alertLinesAt, arrivalGroups, arrivalNote, boardLines, headTo, linesAt, linesToWarm, timeText, toward, twins, usualRows, type ArrivalGroup, type ArrivalTime, type StopBoard } from "../stops";
  import type { AppState } from "../state.svelte";
  import type { FetchResult } from "../poller";
  import Back from "./Back.svelte";
  import NameSheet from "./NameSheet.svelte";
  import Icon from "./Icon.svelte";
  import DisruptionRows from "./DisruptionRows.svelte";
  import { forStop } from "../disruptions";
  import { busStopCard, legacyOf } from "../legacy";
  import NearChanges from "./NearChanges.svelte";
  import { reportedStops } from "../stopfix";
  import StopFixBar from "./StopFixBar.svelte";
  import { metresBetween, walkTo } from "../now";
  import { distText, titleCase } from "../nearby";
  import { clockHM } from "../trains";
  import LineChip from "./LineChip.svelte";

  // The tapped bus stop, laid out as the phone app's: the user's lines first («Οι γραμμές μου | Όλες»), each
  // line and headsign with its next bus in big minutes, where it is and whether it runs late, the next ones,
  // and a bell (the alert sheet for that line and direction); the other lines short below («Περνούν επίσης»)
  // and the ones with no bus near. Arrivals: backend, from GPS; asked again every 20 s while open and the tab
  // visible (cached 15 s). The stop of the same name across the street is a tap away.
  // A phone: the card is a sheet, dragged by its handle or header to where it suits (sheetDrag.ts).
  const narrow = new MediaQuery("(max-width: 719px)");
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
  const name = $derived(titleCase(stop?.[0] ?? board?.stop.name ?? top?.title ?? "Στάση"));
  const lines = $derived(ix && i != null ? linesAt(ix, i) : board ? boardLines(board) : []);
  // The star: the stop's /v2 id is oasa:<GTFS id>; an index from before the ids has none.
  const favId = $derived(id ? `oasa:${id}` : null);
  const starred = $derived(!!favId && app.isFavStop(favId));
  let naming = $state(false);
  // The OASA notices about the stop or its lines (/v2 ids: oasa:<GTFS stop id>, oasa:<line>).
  const lineIds = $derived(lines.map(l => `oasa:${l.line}`));
  const disruptions = $derived(favId ? forStop(app.disruptions, favId, lineIds, app.serverNow) : []);
  const across = $derived(ix && i != null ? twins(ix, i)[0] : undefined);

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

  // The user's lines (favourites and lines on the map): their cards come first.
  const mine = $derived(lines.map(l => l.line).filter(l => app.favorites.includes(l) || app.selected.includes(l)));

  // The alert sheet (AlertSheet, loaded on the first bell) for the lines of a card, in its direction.
  let alertFor = $state.raw<{ line?: string; toward?: string; lines: ReturnType<typeof alertLinesAt>; ticked?: string[] } | null>(null);
  $effect(() => { void i; alertFor = null; });
  const alertLines = $derived(app.cityInfo.alerts && ix && i != null ? alertLinesAt(ix, i) : []);   // the bot watches only some cities
  function bell(gs: ArrivalGroup[]) {
    const ls = gs.flatMap(g => {
      const l = alertLines.find(x => x.line === g.line);
      if (!l) return [];
      const same = l.variants.filter(v => v.id === g.variant);
      return [{ line: g.line, variants: same.length ? same : l.variants }];
    });
    if (!ls.length) return;
    alertFor = { line: ls.length === 1 ? ls[0].line : undefined, toward: dest(gs[0]).to, lines: ls, ticked: ls.map(l => l.line) };
  }
  const REFRESH_MS = 20_000, QUICK_RETRY_MS = 2_000;
  let failed = $state(false);
  let now = $state(Date.now());   // set from app.serverMs() when a stop opens
  const groups = $derived(board ? arrivalGroups(board.arrivals, now) : []);
  // The lines shown with no bus on its way: how often they usually pass now (backend rev 18, map#24).
  const usual = $derived(board ? usualRows(board.usual, groups, now) : []);
  // A terminus (a route's first stop): OASA predicts no arrivals there, so a line with no bus on its way shows its next
  // departures from today's timetable instead of «no bus». Asked once a minute.
  // With no arrivals at all (no connection), every line here shows its timetable instead: kept on the phone
  // (public/sw.js), the times it leaves its terminus.
  const noBoard = $derived(!board && failed);
  const starts = $derived(ix && i != null ? lines.flatMap(l => l.variants.filter(v => noBoard ? !!ix.l[l.line]?.[v]?.includes(i) && ix.l[l.line][v].at(-1) !== i : ix.l[l.line]?.[v]?.[0] === i)
    .map(v => ({ line: l.line, variant: v, first: ix.l[l.line]?.[v]?.[0] === i }))) : []);
  const startsKey = $derived(starts.map(t => `${t.line}/${t.variant}`).join(","));
  let departs = $state.raw<{ line: string; variant: string; to: string; from: string; first: boolean; times: string[] }[]>([]);
  $effect(() => {
    const key = startsKey, list = untrack(() => starts);
    departs = [];
    if (!key) return;
    const ac = new AbortController();
    const load = async () => {
      const out: typeof departs = [];
      for (const t of list) {
        try {
          const [st, r] = await Promise.all([fetchLineStatic(t.line), fetchSchedule(t.line, AbortSignal.any([ac.signal, AbortSignal.timeout(10_000)]))]);
          const v = st.variants[t.variant], sc = r.body as Schedule | null;
          if (r.status !== 200 || !v || !Array.isArray(sc?.directions) || out.some(o => o.line === t.line && o.to.trim() === v.headsign.trim())) continue;
          const dir = matchDirection(sc!.directions, v.headsign);
          const times = dir ? timetableView(dir, athensClock(app.serverMs(), sc!.date)).items.filter(x => x.state === "next").map(x => x.t) : [];
          // Two variants of one direction share its timetable: once.
          if (times.length && !out.some(o => o.line === t.line && o.times.join() === times.join())) out.push({ line: t.line, variant: t.variant, to: v.headsign, from: st.stops[v.stops[0]]?.name ?? "", first: t.first, times });
        } catch { /* the next minute tries again */ }
      }
      if (!ac.signal.aborted) departs = out;
    };
    void load();
    const timer = setInterval(load, 60_000);
    return () => { ac.abort(); clearInterval(timer); };
  });

  // One line at a time: a tap on a line in the header (again: all).
  let only = $state<string | null>(null);
  $effect(() => { void i; only = untrack(() => app.stopOnly); if (untrack(() => app.stopOnly)) app.stopOnly = null; });
  const pick = (l: string) => (only = only === l ? null : l);

  // The departures as cards (Apple Maps' layout): the buses on their way, one card per destination, so the lines that
  // go the same way sit together and the first to come shows at once; the user's lines first, then the soonest.
  type Card = { to: string; back: boolean; groups: ArrivalGroup[] };
  const cards = $derived.by(() => {
    const out: Card[] = [];
    for (const g of groups) {
      if (only && g.line !== only) continue;
      const d = dest(g);
      const c = out.find(x => x.to === d.to && x.back === d.back);
      if (c) c.groups.push(g); else out.push({ to: d.to, back: d.back, groups: [g] });
    }
    const first = (c: Card) => Math.min(...c.groups.map(g => (g.times[0].here ? -1 : g.times[0].min)));
    const isMine = (c: Card) => c.groups.some(g => mine.includes(g.line));
    return out.sort((a, b) => Number(isMine(b)) - Number(isMine(a)) || first(a) - first(b));
  });
  // The other lines, in one last card: leaving the terminus, how often they usually pass, or no bus near now.
  const leaving = $derived(departs.filter(d => !groups.some(g => g.line === d.line) && (!only || only === d.line)));
  const usualShown = $derived(usual.filter(u => !only || only === u.line));
  const quiet = $derived(lines.filter(l => (!only || only === l.line) && !groups.some(g => g.line === l.line) && !usual.some(u => u.line === l.line)
    && !leaving.some(d => d.line === l.line)));
  const big = (t: ArrivalTime) => (t.here ? "τώρα" : timeText(t));
  // The clock time of an arrival, for the tooltip.
  const clockOf = (t: ArrivalTime) => clockHM(now / 1000 + t.min * 60);
  const kindOf = (line: string) => (app.lineInfo.get(line)?.kind === "trolley" ? "Τρόλεϊ" : "Λεωφορείο");
  const modeOf = (line: string) => (app.lineInfo.get(line)?.kind === "trolley" ? "trolley" : "bus");
  // The board holds what is still to come: each time seen (to the minute) is kept, and the last one gone by is
  // «πέρασε 08:44» (compact mockups 4 and 6).
  const seen = new Map<string, Set<number>>();
  $effect(() => {
    void i; seen.clear();
  });
  $effect(() => {
    const t0 = untrack(() => now) / 1000;
    for (const g of groups) {
      const k = `${g.line}|${g.headsign}`, set = seen.get(k) ?? new Set<number>();
      for (const t of g.times) set.add(Math.round((t0 + t.min * 60) / 60) * 60);
      seen.set(k, set);
    }
  });
  const passed = (g: ArrivalGroup): number | null => {
    let last: number | null = null;
    for (const t of seen.get(`${g.line}|${g.headsign}`) ?? []) if (t < now / 1000 - 30 && (last == null || t > last)) last = t;
    return last;
  };
  const hm = (s: number) => clockHM(s);
  // Where the bus is, on the open line (compact mockup 6): the two stops before this one, the bus between them by its
  // stops away, and when it is here.
  function strip(g: ArrivalGroup) {
    const t = g.times[0];
    if (!ix || i == null || t.here || !t.away) return null;
    const seq = ix.l[g.line]?.[g.variant] ?? Object.values(ix.l[g.line] ?? {}).find(q => q.includes(i!));
    const k = seq ? seq.indexOf(i) : -1;
    if (!seq || k < 2) return null;
    const name = (j: number) => titleCase(ix.s[seq[j]]?.[0] ?? "");
    return { a: name(k - 2), b: name(k - 1), pos: t.away >= 3 ? 0 : t.away === 2 ? 25 : 75, away: t.away, at: clockOf(t) };
  }
  // A tap on a line opens it in the list: its times (the one gone by first), «Πες μου όταν έρχεται», «Όλη η γραμμή».
  let openRow = $state<string | null>(null);
  $effect(() => { void i; openRow = null; });

  // The walk from the user to the stop (a location fix is needed).
  const walk = $derived(at ? walkTo(app.myPos, { lat: at[0], lon: at[1] }) : null);
  const metres = $derived(at && app.myPos ? metresBetween(app.myPos, at) : null);

  // «Πώς πάω»: the planner opens with this stop as the end; «Από εδώ»: as the start.
  function trip(end: "from" | "to") {
    if (!at) return;
    const here = { label: name, kind: "stop" as const, pts: [at], lines: lines.map(l => l.line) };
    if (end === "from") app.tripFrom = here; else app.tripTo = here;
    app.setTab("trip");
  }
  // Where a row's bus runs to; on a loop, after the turn, back to the start (headTo).
  const dest = (g: ArrivalGroup) => {
    const d = ix && i != null ? headTo(ix, g.line, g.variant, i, g.headsign) : { to: toward(g.headsign), back: false };
    return { ...d, to: titleCase(placeNote(d.to).place) };
  };
  const variantsOf = (line: string) => lines.find(l => l.line === line)?.variants ?? [];
  const clockNow = $derived(clockHM(now / 1000));

  // «Πλήρης οθόνη» (a computer): the stop's board as a station's screen, for a wall or a TV: the clock, the next
  // buses in large type, what runs late. It fills the screen (the Fullscreen API where allowed, else the window);
  // Esc, or leaving full screen, closes it.
  let tv = $state(false);
  let tvEl: HTMLElement | undefined = $state();
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }
  async function openTv() {
    tv = true;
    await Promise.resolve();
    try { await tvEl?.requestFullscreen?.(); } catch { /* not allowed: the window is enough */ }
  }
  function closeTv() {
    tv = false;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }
  $effect(() => {
    if (!tv) return;
    const off = () => { if (!document.fullscreenElement && tv) tv = false; };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); closeTv(); } };
    document.addEventListener("fullscreenchange", off);
    addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("fullscreenchange", off); removeEventListener("keydown", esc, true); };
  });
  const tvRows = $derived([...groups].filter(g => g.times.length).sort((a, b) => a.times[0].min - b.times[0].min).slice(0, 7));
  // Lines with no bus on its way yet: their timetable time, after the live ones.
  const tvLeaving = $derived(departs.filter(d => !groups.some(g => g.line === d.line)).slice(0, Math.max(0, 7 - tvRows.length)));
  // Soonest usual time first, then the lines known only by how often they pass.
  const usualKey = (u: { big: string; every: boolean }) => u.every ? 1e4 + parseInt(u.big) : (() => {
    const [h, m] = u.big.slice(1).split(":").map(Number); const d = h * 60 + m - nowMin(); return d < 0 ? d + 1440 : d; })();
  const athens = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const nowMin = () => { const [h, m] = athens.format(new Date(now)).split(":").map(Number); return h * 60 + m; };
  const tvUsual = $derived([...usual].sort((a, b) => usualKey(a) - usualKey(b)).slice(0, Math.max(0, 7 - tvRows.length - tvLeaving.length)));
  const tvNote = (t: ArrivalTime) => t.here ? "Στη στάση τώρα" : t.est ? "Από το πρόγραμμα" : t.late >= 2 ? `Ζωντανά · καθυστέρηση ${t.late}′` : "Ζωντανά · στην ώρα του";
  const tvTone = (t: ArrivalTime) => t.est ? "sched" : t.late >= 2 ? "late" : "ok";
  const tvLate = $derived(tvRows.filter(g => !g.times[0].est && g.times[0].late >= 3));

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
    const online = app.online;
    const load = async () => {
      if (busy) return;
      clearTimeout(timer);
      let quick = false;
      // No network: no use asking; the timetables show at once (and this starts over when it is back).
      if (!online && !board) failed = true;
      else if (document.visibilityState !== "hidden") {
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

{#snippet chip(line: string)}
  {@const c = app.lineColor(line)}
  <b class="chip" style:--lb={c.bg} style:--lf={c.fg}>{line}</b>
{/snippet}

{#if naming && id}
  <div use:portal><NameSheet {app} {id} official={name} onclose={() => (naming = false)} /></div>
{/if}
{#if fixing}
  <StopFixBar {app} ondone={() => (sent = !!id && reportedStops().includes(id))} />
{:else if stop || early}
  <section class="card" aria-label="Στάση {name}" use:freeSheet={{ handles: ".grip, .card > header", keep: 120, on: () => narrow.current }}>
    <div class="grip" aria-hidden="true"></div>
    <header>
      {#if !narrow.current || app.stack.length > 1}<Back {app} />{/if}
      <div class="t">
        <h2>{app.stopLabel(id, name)}</h2>
        <p class="sub">{#if id && app.stopNames[id]?.name}{name} · {/if}{lines.some(l => app.lineInfo.get(l.line)?.kind === "trolley") && lines.every(l => app.lineInfo.get(l.line)?.kind === "trolley") ? "Στάση τρόλεϊ" : "Στάση λεωφορείου"}{#if walk != null} · {walk}′ με τα πόδια{/if}</p>
      </div>
      {#if favId && (stop || board)}
        <button type="button" class="circle star" class:starred aria-pressed={starred} title={starred ? "Αφαίρεση από τις αγαπημένες" : "Προσθήκη στις αγαπημένες"}
          aria-label={starred ? "Αφαίρεση από τις αγαπημένες" : "Προσθήκη στις αγαπημένες"}
          onclick={() => app.toggleFavStop({ id: favId, name, lat: stop?.[1] ?? board!.stop.lat, lon: stop?.[2] ?? board!.stop.lon })}><Icon name={starred ? "star-filled" : "star"} size={18} /></button>
      {/if}
      {#if id && at}
        {@const pin = app.pinOf("stop", id)}
        <button type="button" class="circle pinbtn" class:on={!!pin} style:--pc={pin?.color} aria-pressed={!!pin}
          aria-label={pin ? "Ρυθμίσεις καρφιτσώματος" : "Καρφίτσωμα στον χάρτη"} title={pin ? "Καρφιτσωμένη στον χάρτη" : "Καρφίτσωμα στον χάρτη"}
          onclick={() => (app.pinEdit = pin ?? { kind: "stop", id: id!, label: name, color: "#f0ae45", width: 2, vehicles: false, top: true, at: [at![1], at![0]] })}><Icon name="pushpin" size={18} /></button>
      {/if}
      {#if board}
        <button type="button" class="circle tvbtn" aria-label="Πίνακας σε όλη την οθόνη" title="Πίνακας σε όλη την οθόνη" onclick={openTv}>
          <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" /></svg>
        </button>
      {/if}
      <button type="button" class="circle x" aria-label="Κλείσιμο" onclick={() => app.closeCards()}><Icon name="close" size={16} /></button>
    </header>

    {#if at}
      <div class="acts">
        <button type="button" class="primary" onclick={() => trip("to")}><Icon name="route" size={16} /><span>Πώς πάω εκεί</span></button>
        <button type="button" class="second" onclick={() => trip("from")}><Icon name="locate" size={16} /><span>Ταξίδι από εδώ</span></button>
      </div>
    {/if}

    {#if id || across}
      <div class="near">
        {#if across}<button type="button" class="across" onclick={() => { const s = ix?.s[across.i]; if (s?.[3]) app.push(busStopCard(s[3], s[0])); }}>Απέναντι στάση<Icon name="chevron" size={13} /></button>{/if}
        {#if id}<button type="button" class="nm" onclick={() => (naming = true)}>{app.stopNames[id]?.name ? "Άλλαξε όνομα" : "Δώσε της όνομα"}</button>{/if}
      </div>
    {/if}

    <DisruptionRows alerts={disruptions} lines={lineIds} />
    {#if app.alert}
      {@const a = app.alert}
      <p class="on"><Icon name="bell" size={15} /> Ειδοποίηση: {a.lines.map(l => l.line).join(", ")}, {a.n === 1 ? "στην προηγούμενη στάση" : `${a.n} στάσεις πριν`} από {a.label}.
        <button type="button" class="link" onclick={() => app.setAlert(null)}>Ακύρωση</button></p>
    {/if}

    <div class="dhead">
      <h3>Αναχωρήσεις</h3>
      {#if board}<span class="fresh" class:bad={failed}><i></i>{failed ? "Η ενημέρωση απέτυχε" : `ζωντανά · ${clockNow}`}</span>{/if}
    </div>

    <!-- Under «Αναχωρήσεις» only the list scrolls (its bar beside it, not up the whole card); the top stays. -->
    <div class="scroll">

    {#snippet when(t: ArrivalTime, next?: ArrivalTime)}
      {@const note = arrivalNote(t)}
      <span class="dwhen"><b class={note.tone} title={t.here ? "" : clockOf(t)}>{big(t)}</b>{#if next}<small title={clockOf(next)}>{big(next)}</small>{/if}</span>
    {/snippet}
    {#snippet noteOf(t: ArrivalTime)}
      {@const note = arrivalNote(t)}
      <small class="dnote {note.tone}"><i class:hollow={note.tone === "muted"}></i>{note.text}</small>
    {/snippet}

    {#if board}
      <div class="deps" aria-live="polite">
        <section class="dcard" aria-label="Αναχωρήσεις">
        {#each cards.flatMap(c => c.groups.map(g => ({ c, g }))) as { c, g } (g.line + g.headsign)}
          {@const k = g.line + "|" + g.headsign}
          {@const col = app.lineColor(g.line)}
          {@const gone = passed(g)}
          {@const isOpen = openRow === k}
          {@const canBell = alertLines.some(l => l.line === g.line)}
          {@const note = arrivalNote(g.times[0])}
          {@const st = isOpen ? strip(g) : null}
          <div class="dwrap" class:open={isOpen}>
            <button type="button" class="drow" aria-expanded={isOpen} onclick={() => (openRow = isOpen ? null : k)}>
              <LineChip label={g.line} bg={col.bg} fg={col.fg} mode={modeOf(g.line)} city={app.cityId} />
              <span class="dmid"><span class="dto" title={g.headsign}>{c.to}{#if c.back}{" "}<span class="back">(επιστροφή)</span>{/if}</span>
                <small class="dsub">{#if gone}πέρασε {hm(gone)}{#if g.times[1]} · {/if}{/if}{#if g.times[1]}μετά {g.times.slice(1, 3).map(t => big(t)).join(" · ")}{:else if !gone}{arrivalNote(g.times[0]).text}{/if}</small></span>
              <span class="dwhen"><b class={note.tone}>{#if !g.times[0].here && note.tone !== "muted"}<i></i>{/if}{big(g.times[0])}</b></span>
            </button>
            {#if isOpen}
              <div class="dopen">
                {#if st}
                  <div class="strip" style:--p="{st.pos}%">
                    <i class="sl"></i><i class="sf" style:background={col.bg}></i>
                    <span class="ss a"><i style:border-color={col.bg}></i><span>{st.a}</span></span>
                    <span class="ss b"><i style:border-color={col.bg}></i><span>{st.b}</span></span>
                    <span class="sbus" style:background={col.bg} style:color={col.fg}><Icon name="bus" size={13} />{g.line}</span>
                    <span class="ss c"><i class="here" style:border-color={col.bg}></i><b>Εδώ</b></span>
                  </div>
                  <p class="dline">{#if st.away === 1}Πέρασε {st.b} · η επόμενη στάση του είναι εδώ, στις <b>{st.at}</b>{:else}{st.away} στάσεις πριν · εδώ στις <b>{st.at}</b>{/if}</p>
                {:else}
                  <p class="dline">{note.text} · εδώ στις <b>{clockOf(g.times[0])}</b></p>
                {/if}
                <div class="dtimes">
                  {#if gone}<span class="dt past"><Icon name="check" size={13} />{hm(gone)}</span>{/if}
                  {#each g.times.slice(0, 3) as t, j (j)}<span class="dt" class:live={arrivalNote(t).tone !== "muted"}>{#if arrivalNote(t).tone !== "muted"}<i></i>{/if}{clockOf(t)}</span>{/each}
                </div>
                <div class="dacts">
                  {#if canBell}<button type="button" class="dbell" class:on={!!alertFor && alertFor.lines.some(l => l.line === g.line)} onclick={() => bell([g])}><Icon name="bell" size={16} /><span>Πες μου όταν έρχεται</span></button>{/if}
                  <button type="button" class="dall" onclick={() => app.openLineAt(g.line, g.variant ? [g.variant] : variantsOf(g.line), g.times[0].vehicle)}>Όλη η γραμμή</button>
                </div>
              </div>
            {/if}
          </div>
        {/each}

            {#each leaving as d (d.line + d.to)}
              {@const col = app.lineColor(d.line)}
              <button type="button" class="drow" onclick={() => app.openLineAt(d.line, [d.variant])}>
                <LineChip label={d.line} bg={col.bg} fg={col.fg} mode={modeOf(d.line)} city={app.cityId} />
                <span class="dmid"><span class="dto" title={d.to}>{titleCase(placeNote(toward(d.to)).place)}</span><small class="dsub">από την αφετηρία · πρόγραμμα{#if d.times[1]} · μετά {d.times[1]}{/if}</small></span>
                <span class="dwhen"><b class="plain">{d.times[0]}</b></span>
              </button>
            {/each}
            {#each usualShown as u (u.line + u.headsign)}
              {@const col = app.lineColor(u.line)}
              <button type="button" class="drow" onclick={() => app.openLineAt(u.line, variantsOf(u.line))}>
                <LineChip label={u.line} bg={col.bg} fg={col.fg} mode={modeOf(u.line)} city={app.cityId} />
                <span class="dmid"><span class="dto" title={u.headsign}>{titleCase(placeNote(toward(u.headsign)).place)}</span><small class="dsub">{u.text}</small></span>
              </button>
            {/each}
            {#if quiet.length}
              <div class="drow quiet">
                <span class="dmid"><span class="dto dim">Κανένα λεωφορείο κοντά τώρα</span>
                  <span class="qchips">{#each quiet as l (l.line)}{@const col = app.lineColor(l.line)}<button type="button" class="lchip sm" style:--lb={col.bg} style:--lf={col.fg}
                    aria-label="Γραμμή {l.line}" onclick={() => app.openLineAt(l.line, l.variants)}>{l.line}</button>{/each}</span></span>
              </div>
            {/if}
        </section>

        {#if !cards.length && !leaving.length && !usualShown.length && !quiet.length}
          <p class="empty">{only ? `Κανένα ${only} καθ’ οδόν τώρα.` : "Κανένα λεωφορείο καθ’ οδόν τώρα."}</p>
        {/if}
      </div>
    {:else if failed}
      <p class="offnote">{!app.online ? "Χωρίς σύνδεση. Οι ζωντανές αφίξεις έρχονται μόλις συνδεθείς." : id ? "Δεν φόρτωσαν οι αφίξεις. Ξαναδοκιμάζω σε 20″." : "Οι αφίξεις δεν είναι διαθέσιμες. Ανανέωσε τη σελίδα."}</p>
      {#if departs.length}
        {@const shown = departs.filter(d => !only || only === d.line)}
        <section class="dcard" aria-label="Από το πρόγραμμα">
          <div class="dtop"><span class="offh">Από το πρόγραμμα · ώρες αναχώρησης</span></div>
          {#each shown as d (d.line + d.to)}
            {@const col = app.lineColor(d.line)}
            <button type="button" class="drow" onclick={() => app.openLineAt(d.line, [d.variant])}>
              <b class="lchip sm" style:--lb={col.bg} style:--lf={col.fg}>{d.line}</b>
              <span class="dmid"><span class="dto" title={d.to}>{titleCase(placeNote(toward(d.to)).place)}</span>
                <small class="dnote muted">{d.first || !d.from ? "Από την αφετηρία" : `Φεύγει από ${titleCase(d.from)}`}</small></span>
              <span class="dwhen"><b class="plain">{d.times[0]}</b>{#if d.times[1]}<small>{d.times[1]}</small>{/if}</span>
            </button>
          {/each}
        </section>
      {/if}
    {:else}
      <p>Φόρτωση αφίξεων…</p>
    {/if}

    {#if at && i != null}<NearChanges {app} {at} stop={i} lines={lines.map(l => l.line)} compact={narrow.current} />{/if}

    <div class="foot">
      <div class="legend">
        <span><i></i>Ζωντανό στίγμα</span>
        <span><i class="hollow"></i>Εκτίμηση</span>
      </div>
      {#if id && at}
        {#if sent}
          <span class="thanks">Έστειλες τη θέση της. Ευχαριστούμε!</span>
        {:else}
          <button type="button" class="ghost" onclick={startFix}><Icon name="pin" size={15} /><span>Λάθος θέση;</span></button>
        {/if}
      {/if}
    </div>
    </div>
  </section>
  {#if alertFor}
    {@const a = alertFor}
    {#await import("./AlertSheet.svelte") then m}
      <m.default {app} lines={a.lines} label={name} line={a.line} toward={a.toward} ticked={a.ticked} onclose={() => (alertFor = null)} />
    {/await}
  {/if}
{/if}

{#if tv}
  <div class="tv" bind:this={tvEl} use:portal role="dialog" aria-modal="true" aria-label="Πίνακας στάσης {name}">
    <header class="tvh">
      <div>
        <p class="tvk">Στάση</p>
        <h1>{name}</h1>
      </div>
      <div class="tvc">
        <p class="clock">{clockNow}</p>
        <p class="live" class:off={!tvRows.length}><i></i>{tvRows.length ? "Ζωντανά από τα λεωφορεία" : "Κανένα λεωφορείο καθ’ οδόν: ώρες από το πρόγραμμα"}</p>
      </div>
    </header>
    <div class="tvm">
      <section class="tvb">
        <div class="tvr tvhd"><span>Γραμμή</span><span>Προς</span><span>Έρχεται</span></div>
        {#each tvRows as g, k (g.line + g.headsign)}
          {@const c = app.lineColor(g.line)}
          {@const t = g.times[0]}
          <div class="tvr" class:first={k === 0}>
            <span class="tvl" style:--lb={c.bg} style:--lf={c.fg}>{g.line}</span>
            <span class="tvd"><b>{dest(g).to}</b><small class={tvTone(t)}>{tvNote(t)}{#if g.times[1]}<span class="then"> · μετά {timeText(g.times[1])}</span>{/if}</small></span>
            <span class="tvt {tvTone(t)}">{timeText(t)}</span>
          </div>
        {/each}
        {#each tvLeaving as d (d.line + d.to)}
          {@const c = app.lineColor(d.line)}
          <div class="tvr" class:first={!tvRows.length && d === tvLeaving[0]}>
            <span class="tvl" style:--lb={c.bg} style:--lf={c.fg}>{d.line}</span>
            <span class="tvd"><b>{titleCase(placeNote(toward(d.to)).place)}</b><small class="sched">Ξεκινά από την αφετηρία{#if d.times[1]}<span class="then"> · μετά {d.times[1]}</span>{/if}</small></span>
            <span class="tvt sched">{d.times[0]}</span>
          </div>
        {/each}
        {#each tvUsual as u (u.line + u.headsign)}
          {@const c = app.lineColor(u.line)}
          <div class="tvr" class:first={!tvRows.length && !tvLeaving.length && u === tvUsual[0]}>
            <span class="tvl" style:--lb={c.bg} style:--lf={c.fg}>{u.line}</span>
            <span class="tvd"><b>{titleCase(placeNote(toward(u.headsign)).place)}</b><small class="sched">{u.note}</small></span>
            <span class="tvt sched usual">{#if u.every}<small>κάθε</small>{/if}{u.big}</span>
          </div>
        {/each}
        {#if !tvRows.length && !tvLeaving.length && !tvUsual.length}<p class="tve">Κανένα λεωφορείο τώρα.</p>{/if}
      </section>
      <aside class="tva">
        {#each tvLate.slice(0, 2) as g (g.line + g.headsign)}
          <div class="tvn late"><b>Το {g.line} αργεί</b><span>Προς {dest(g).to}: {g.times[0].late}′ πίσω από το πρόγραμμα.</span></div>
        {/each}
        {#each disruptions.slice(0, 2) as d (d.id)}
          <div class="tvn"><b>Ανακοίνωση</b><span>{d.title}</span></div>
        {/each}
        {#if !tvLate.length && !disruptions.length}
          <div class="tvn ok"><b>Όλα κανονικά</b><span>Κανένα λεωφορείο δεν αργεί πάνω από 3′ σε αυτή τη στάση.</span></div>
        {/if}
        <p class="tvx">Esc για έξοδο</p>
      </aside>
    </div>
    <button type="button" class="tvclose" aria-label="Έξοδος από την πλήρη οθόνη" onclick={closeTv}><Icon name="close" size={18} /></button>
  </div>
{/if}

<style>
  .card { position: absolute; z-index: 6; left: 16px; bottom: 28px; width: 400px; padding: 16px;
    border: 0; border-radius: var(--radius); background: var(--glass-strong); --card: var(--glass-fill); --card-border: var(--glass-line); -webkit-backdrop-filter: var(--glass-fx); backdrop-filter: var(--glass-fx); box-shadow: var(--glass-rim); text-shadow: var(--glass-text);
    max-height: calc(100dvh - 140px); overflow: hidden; box-sizing: border-box;
    display: flex; flex-direction: column; gap: 14px; }
  .card > * { flex-shrink: 0; }
  /* The list under «Αναχωρήσεις»: it alone scrolls, under the header's edge (a short fade there), its bar inside the
     card's padding, beside the list. */
  .card > .scroll { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 14px; overflow-y: auto;
    overscroll-behavior: contain; margin: -6px -12px 0 0; padding: 6px 8px 0 0;
    -webkit-mask-image: linear-gradient(transparent, #000 10px); mask-image: linear-gradient(transparent, #000 10px); }
  .scroll > * { flex-shrink: 0; }
  .grip { display: none; }
  header { display: flex; align-items: flex-start; gap: 10px; }
  .t { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; padding-top: 2px; }
  h2 { margin: 0; font-size: 24px; font-weight: 800; line-height: 1.1; overflow: hidden; overflow-wrap: break-word;
    display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; }
  p { margin: 0; color: var(--muted); font-size: 12px; }
  .sub { font-size: 13px; font-weight: 500; line-height: 1.2; }
  .nm { margin-left: 6px; padding: 0; border: 0; background: none; color: var(--accent); font: inherit; font-size: 13px; font-weight: 600; line-height: 1.2; cursor: pointer; }
  .back { font-weight: 500; color: var(--muted); }
  .circle { flex: none; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0;
    border-radius: 50%; background: var(--card); color: var(--fg); cursor: pointer; }
  .circle:hover { background: var(--control-hover); }
  .circle.on { background: var(--accent-bg); color: var(--accent); }
  .circle.star.starred { background: color-mix(in srgb, var(--star) 16%, var(--card)); color: var(--star); }
  @media (max-width: 719px) { .circle.x { display: none; } }
  .circle.sm { width: 34px; height: 34px; background: transparent; color: var(--muted); }
  .circle.sm:hover { background: var(--control); color: var(--fg); }
  .circle.sm.on { background: var(--accent-bg); color: var(--accent); }

  /* The stop's lines: a mode tile, then each line's chip (a filter). */
  .lchips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .mode { flex: none; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 6px;
    background: var(--accent); color: var(--on-accent); }
  .sep { width: 1px; height: 16px; margin: 0 2px; background: var(--border); }
  .lchip { flex: none; display: inline-flex; align-items: center; justify-content: center; min-width: 30px; height: 26px; padding: 0 8px;
    border: 0; border-radius: 7px; background: var(--lb); color: var(--lf); font: inherit; font-size: 12px; font-weight: 800; line-height: 1;
    font-variant-numeric: tabular-nums; box-sizing: border-box; cursor: pointer; transition: opacity .15s; }
  .lchip.off { opacity: .35; }
  .lchip.sm { min-width: 0; height: 22px; padding: 0 7px; border-radius: 6px; font-size: 11px; }
  b.lchip { cursor: inherit; }

  .acts { display: flex; gap: 8px; }
  .primary, .second { flex: 1; height: 46px; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 0 14px; border: 0;
    border-radius: 14px; font-size: 15px; font-weight: 800; line-height: 1; cursor: pointer; }
  .primary { background: var(--accent); color: var(--on-accent); }
  .second { background: var(--card); color: var(--fg); font-weight: 700; }
  .second:hover { background: var(--control-hover); }

  .near { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; min-height: 20px; color: var(--muted); font-size: 13px; line-height: 1; }
  .near > i { width: 3px; height: 3px; border-radius: 50%; background: var(--muted); opacity: .6; }
  .walk { display: flex; align-items: center; gap: 6px; }
  .across { padding: 0; border: 0; background: none; color: var(--accent); font: inherit; font-weight: 600; line-height: 1; cursor: pointer; white-space: nowrap; }
  .across:hover { text-decoration: underline; text-underline-offset: 3px; }
  /* A finger-sized hit area (about 39 px high) around the one-line link, the look unchanged. */
  .across { position: relative; }
  .across::after { content: ""; position: absolute; inset: -10px -4px; }

  .dhead { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 22px; margin-top: 2px; }
  h3 { margin: 0; font-size: 18px; font-weight: 800; line-height: 1; }
  .fresh { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; font-weight: 500; line-height: 1; white-space: nowrap; }
  .fresh i { width: 7px; height: 7px; border-radius: 50%; background: var(--ontime); }
  .fresh.bad i { background: var(--late2); }

  /* The departures: a card per destination (or per line), a row per line and headsign. */
  .deps { display: flex; flex-direction: column; gap: 10px; }
  .dcard { border-radius: 16px; background: var(--card); border: 1px solid var(--card-border); overflow: hidden; }
  .dtop { display: flex; align-items: center; gap: 6px; min-height: 46px; padding: 0 8px 0 14px; border-bottom: 1px solid var(--border); }
  .dtitle { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; min-height: 46px; padding: 0; border: 0; background: none;
    color: var(--fg); font: inherit; text-align: left; cursor: pointer; }
  .dtitle.same { cursor: default; }
  .dtitle > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; font-weight: 700; line-height: 1.1; }
  .dtitle > :global(svg) { flex: none; color: var(--muted); transform: rotate(-90deg); }
  .drow { width: 100%; display: flex; align-items: center; gap: 12px; min-height: 60px; padding: 10px 14px; border: 0; border-bottom: 1px solid var(--border);
    background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; box-sizing: border-box; }
  .drow:last-child { border-bottom: 0; }
  button.drow:hover { background: var(--control); }
  .drow.quiet { cursor: default; }
  .dmid { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .dto { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; font-weight: 600; line-height: 1.15; }
  .dto.dim { color: var(--muted); }
  .dnote { display: flex; align-items: center; gap: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 500; line-height: 1.2; }
  .dnote.wrap { white-space: normal; }
  .dmid > .dnote:only-child { font-size: 14px; font-weight: 600; }
  .dnote i { flex: none; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .dnote i.hollow, .legend i.hollow { background: none; border: 1.5px solid currentColor; box-sizing: border-box; }
  .qchips { display: flex; flex-wrap: wrap; gap: 6px; }
  .ok { color: var(--ontime); }
  .late { color: var(--late2); }
  .muted { color: var(--muted); }
  /* The minutes: the first big, in the tone of its note; the one after it small. */
  .dwhen { flex: none; display: flex; align-items: baseline; gap: 8px; line-height: 1; font-variant-numeric: tabular-nums; }
  .dwhen b { font-size: 22px; font-weight: 800; letter-spacing: -.3px; }
  .dwhen b.plain { color: var(--fg); font-size: 18px; }
  .dwhen small { color: var(--muted); font-size: 14px; font-weight: 600; }
  .empty { margin: 4px 0; font-size: 14px; }
  .offnote { margin: 0; font-size: 14px; line-height: 1.4; }
  .offh { display: flex; align-items: center; min-height: 20px; font-size: 13px; font-weight: 600; color: var(--muted); }

  .on { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; padding: 10px 12px; border-radius: var(--radius-sm);
    background: var(--accent-bg); color: var(--accent); font-weight: 500; }
  .link { padding: 0; border: 0; background: none; color: var(--accent); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; font: inherit; font-weight: 600; }
  .foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .legend { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; font-size: 11px; line-height: 1; color: var(--muted); }
  .legend span { display: flex; align-items: center; gap: 6px; }
  .legend i { width: 6px; height: 6px; border-radius: 50%; background: var(--ontime); }
  .legend i.hollow { color: var(--muted); }
  .ghost { flex: none; height: 34px; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 0 12px; border: 1px solid var(--border);
    border-radius: 17px; background: transparent; color: var(--muted); font-size: 12px; font-weight: 600; line-height: 1; cursor: pointer; }
  .ghost:hover { background: var(--control); color: var(--fg); }
  .thanks { flex: none; max-width: 50%; font-size: 12px; line-height: 1.3; color: var(--muted); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @media (max-width: 719px) {
    .card { left: 0; right: 0; bottom: 0; width: auto; border-radius: 24px 24px 0 0;
      padding: 10px 16px calc(16px + env(safe-area-inset-bottom)); max-height: 78dvh; }
    /* The handle: a wide strip to catch the thumb (the header drags too), the bar in its middle. */
    .grip { display: flex; align-items: center; justify-content: center; align-self: stretch; flex: none; height: 26px; margin: -10px -16px -6px; cursor: grab; }
    .grip::after { content: ""; width: 40px; height: 5px; border-radius: 3px; background: var(--border); }
  }
  /* A card comes up from below. */
  .card { animation: cardIn .32s cubic-bezier(.2, .8, .2, 1); }
  @keyframes cardIn { from { transform: translateY(28px); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .card { animation: none; } }
  .circle.pinbtn.on { background: color-mix(in srgb, var(--pc) 18%, var(--card)); color: var(--pc); }
  .circle.tvbtn { display: none; }
  @media (min-width: 720px) and (pointer: fine) { .circle.tvbtn { display: flex; } }

  /* The stop's board on the whole screen */
  .tv { position: fixed; inset: 0; z-index: 2000; display: flex; flex-direction: column; gap: 32px; padding: 48px 56px; box-sizing: border-box;
    background: #0f1116; color: #eef0f3; font-family: var(--font); animation: tvIn .35s cubic-bezier(.2, .8, .2, 1); overflow: hidden; }
  @keyframes tvIn { from { opacity: 0; transform: scale(.98); } }
  .tvh { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; }
  .tvk { margin: 0; font-size: 16px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #a3aab6; }
  .tv h1 { margin: 6px 0 0; font-size: clamp(40px, 5vw, 72px); font-weight: 900; letter-spacing: -.035em; line-height: 1; }
  .tvc { text-align: right; }
  .clock { color: #eef0f3; margin: 0; font-size: clamp(40px, 5vw, 72px); font-weight: 800; letter-spacing: -.03em; line-height: 1; font-variant-numeric: tabular-nums; }
  .live { margin: 8px 0 0; display: flex; align-items: center; justify-content: flex-end; gap: 8px; font-size: 15px; font-weight: 600; color: #46c267; line-height: 1; }
  .live i { width: 9px; height: 9px; border-radius: 50%; background: currentColor; animation: tvBeat 2s ease-in-out infinite; }
  @keyframes tvBeat { 50% { box-shadow: 0 0 0 6px rgba(70, 194, 103, .2); } }
  .tvm { flex: 1; min-height: 0; display: flex; gap: 32px; }
  .tvb { flex: 1; min-width: 0; display: flex; flex-direction: column; border-radius: 24px; background: #15181e; border: 1px solid #242934; overflow: hidden; }
  .tvr { display: grid; grid-template-columns: 130px minmax(0, 1fr) 220px; gap: 24px; align-items: center; min-height: 92px; padding: 0 28px; border-top: 1px solid #242934; }
  .tvr:not(.tvhd) { flex: 1 1 92px; min-height: 64px; max-height: 92px; }
  .tvr.first { background: rgba(70, 194, 103, .06); }
  .tvhd { min-height: 56px; border-top: 0; font-size: 14px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #a3aab6; }
  .tvhd span:last-child { text-align: right; }
  .tvl { width: 108px; height: 56px; display: flex; align-items: center; justify-content: center; border-radius: 12px; background: var(--lb); color: var(--lf);
    font-size: 28px; font-weight: 900; line-height: 1; }
  .tvd { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .tvd b { font-size: 32px; font-weight: 800; letter-spacing: -.02em; line-height: 1.1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tvd small { font-size: 16px; font-weight: 600; line-height: 1.2; }
  .then { color: #a3aab6; font-weight: 500; }
  .tvt { text-align: right; font-size: 50px; font-weight: 900; letter-spacing: -.04em; line-height: 1; font-variant-numeric: tabular-nums; white-space: nowrap;
    min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .tvt.usual { color: #c9ced6; font-size: 44px; }
  .tvt.usual small { margin-right: 10px; font-size: 20px; font-weight: 700; letter-spacing: 0; color: #a3aab6; }
  .ok { color: #46c267; } .late { color: #f0ae45; } .sched { color: #eef0f3; }
  small.sched { color: #a3aab6; }
  .tve { margin: 28px; font-size: 22px; color: #a3aab6; }
  .tva { width: 360px; flex: none; display: flex; flex-direction: column; gap: 16px; }
  .tvn { display: flex; flex-direction: column; gap: 8px; padding: 22px; border-radius: 22px; background: #15181e; border: 1px solid #242934; font-size: 16px; line-height: 1.45; }
  .tvn b { font-size: 18px; }
  .tvn span { color: #eef0f3; }
  .live.off { color: #a3aab6; }
  .live.off i { animation: none; }
  .tvn.late { background: rgba(240, 174, 69, .12); border-color: rgba(240, 174, 69, .35); }
  .tvn.late b { color: #f0ae45; }
  .tvn.ok b { color: #46c267; }
  .tvx { margin: auto 0 0; font-size: 13px; color: #6f7684; text-align: right; }
  .tvclose { position: absolute; top: 16px; right: 16px; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0;
    border-radius: 50%; background: rgba(255, 255, 255, .06); color: #a3aab6; cursor: pointer; opacity: 0; transition: opacity .2s; }
  .tv:hover .tvclose, .tvclose:focus-visible { opacity: 1; }
  @media (prefers-reduced-motion: reduce) { .tv, .live i { animation: none; } }

  /* ---- A phone (compact mockup 4): a 19px title, the circles and the two actions at 40px, one list with a row per line. */
  @media (max-width: 719px) {
    .card { gap: 12px; }
    header { align-items: center; gap: 8px; min-height: 44px; }
    .t { gap: 6px; padding-top: 0; }
    h2 { font-size: 19px; line-height: 1; white-space: nowrap; text-overflow: ellipsis; }
    .sub { font-size: 12.5px; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .circle { background: var(--control); }
    .circle.x { display: flex; }
    .primary, .second { height: 40px; gap: 7px; border-radius: 12px; font-size: 14px; line-height: 1; }
    .primary { font-weight: 800; }
    .second { background: var(--control); }
    .near { min-height: 16px; font-size: 13px; }
    .dhead { min-height: 20px; margin-top: 0; padding: 0 2px; }
    .dhead h3 { font-size: 14px; }
    .fresh { font-size: 12.5px; font-weight: 600; }
    .deps { gap: 0; }
    .dcard { border: 0; box-shadow: inset 0 0 0 1px var(--card-border, var(--border)); }
    .drow { min-height: 52px; gap: 10px; padding: 0 12px; }
    .dmid { gap: 5px; }
    .dto { font-size: 14.5px; line-height: 1; }
    .dwhen b { font-size: 18px; }
  }
  .dsub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; font-weight: 500; line-height: 1; color: var(--muted); }
  .dwhen b { display: flex; align-items: center; gap: 6px; }
  .dwhen b i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; display: block; }
  .dwrap { border-bottom: 1px solid var(--border); }
  .dwrap:last-child { border-bottom: 0; }
  .dwrap > .drow { border-bottom: 0; }
  .dwrap.open { background: color-mix(in srgb, var(--accent) 7%, transparent); }
  .dopen { display: flex; flex-direction: column; gap: 10px; padding: 0 12px 12px; }
  .dline { margin: 0; font-size: 13px; line-height: 1.35; color: color-mix(in srgb, var(--fg) 80%, var(--muted)); }
  .dline b { color: var(--fg); }
  .strip { position: relative; height: 46px; margin-top: 4px; }
  .strip > .sl, .strip > .sf { position: absolute; left: 8px; top: 7px; height: 4px; border-radius: 2px; display: block; }
  .strip > .sl { right: 8px; background: color-mix(in srgb, var(--fg) 12%, var(--card)); }
  .strip > .sf { width: calc((100% - 16px) * var(--p) / 100); }
  .ss { position: absolute; top: 0; display: flex; flex-direction: column; gap: 9px; font-size: 12px; line-height: 1; color: var(--muted); white-space: nowrap; }
  .ss i { width: 18px; height: 18px; border-radius: 50%; border: 3px solid; box-sizing: border-box; background: var(--card); display: block; }
  .ss i.here { background: #ffffff; }
  .ss b { color: var(--fg); font-size: 12px; }
  .ss.a { left: 0; align-items: flex-start; }
  .ss.b { left: 50%; transform: translateX(-50%); align-items: center; }
  .ss.c { right: 0; align-items: flex-end; }
  .sbus { position: absolute; top: -4px; left: clamp(0px, calc((100% - 16px) * var(--p) / 100 - 14px), calc(100% - 60px)); z-index: 1; height: 26px; padding: 0 8px;
    display: flex; align-items: center; gap: 5px; border-radius: 13px; box-sizing: border-box; box-shadow: 0 0 0 3px var(--card); font-size: 12px; font-weight: 800; line-height: 1; }
  .dtimes { display: flex; flex-wrap: wrap; gap: 6px; }
  .dt { height: 32px; display: flex; align-items: center; gap: 6px; padding: 0 10px; border-radius: 10px; box-sizing: border-box;
    background: color-mix(in srgb, var(--fg) 8%, var(--card)); color: color-mix(in srgb, var(--fg) 82%, var(--muted)); font-size: 13px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
  .dt i { width: 6px; height: 6px; border-radius: 50%; background: var(--ontime); display: block; }
  .dt.live { background: color-mix(in srgb, var(--ontime) 18%, var(--card)); color: color-mix(in srgb, var(--ontime) 75%, #ffffff); }
  .dt.past { gap: 5px; padding: 0 9px; background: none; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--fg) 18%, var(--card)); color: var(--muted); }
  .dacts { display: flex; gap: 8px; }
  .dbell, .dall { white-space: nowrap; height: 40px; display: flex; align-items: center; justify-content: center; gap: 7px; padding: 0 14px; border: 0; border-radius: 12px;
    font: inherit; font-size: 13.5px; font-weight: 700; line-height: 1; cursor: pointer; }
  .dbell { flex: 1; font-weight: 800; background: var(--accent); color: var(--on-accent); }
  .dbell.on { background: var(--accent-bg); color: var(--accent); }
  .dall { background: var(--control); color: var(--fg); }
  .across { display: inline-flex; align-items: center; gap: 3px; }
  .across :global(svg) { transform: rotate(-90deg); }
  @media (max-width: 719px) { .legend { visibility: hidden; } }
</style>
