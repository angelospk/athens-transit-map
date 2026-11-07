<script lang="ts">
  // «Αρχική», the home of the app: «Πού πας;», the user's home and work one tap away, the next buses at the nearest
  // stop (or a routine's), the favourite stops' next buses as tiles, and the notices about the favourite lines (on
  // the map). The routine reminders run from here too. Live data from /v2, asked again every 30 s while it shows (at most 4 requests at a time).
  // On a phone a sheet over the map, above the tab bar; on a desktop a card in the map's left column.
  import { untrack } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { safeInsets, settleSnap, sheetDrag, type SheetDrag } from "../sheetDrag";
  import { fetchV2Stop } from "../api";
  import { forLine, strikes } from "../disruptions";
  import { busStopCard } from "../legacy";
  import { titleCase } from "../nearby";
  import { leaveNow, metresBetween, planStops, walkTo, type LeaveNow, type NowStop } from "../now";
  import { clock } from "../format";
  import { placeNote, toward } from "../stops";
  import { activeRoutine, athensNow, BEFORE_MIN, LATE_S, remindIn } from "../routines";
  import { stopRows, type StopRow, type V2Arrival } from "../v2";
  import type { AppState } from "../state.svelte";
  import Icon from "./Icon.svelte";
  import { item, rise } from "../anim";
  import RouteCard from "./RouteCard.svelte";
  import RemindSheet from "./RemindSheet.svelte";
  import { linesToward, pickWay, type Way } from "../ways";
  import { getJSON } from "../api";
  import { parsePlan, planUrl, scaledLegs, type PlanResponse } from "../plan";
  import { API_BASE } from "../config";
  import { guideFromPlan } from "../guide";
  import { fallbackPlan } from "../fallbackPlan";

  let { app }: { app: AppState } = $props();

  const POLL_MS = 30_000, PARALLEL = 4, TILES = 4;
  const native = (id: string) => id.slice(id.indexOf(":") + 1);
  const shown = $derived(app.tab === "now" && !app.stack.length && !app.favsOpen && !app.nearShown);

  $effect(() => { if (shown) void app.loadStops(); });

  // The nearest stop (from the stop index and the location), as a place to plan from.
  const nearest = $derived.by<NowStop | null>(() => {
    const g = app.nearGroups[0], ix = app.stopIx;
    const s = g && ix ? ix.s[g.idx[0]] : undefined;
    return s && s[3] ? { id: `oasa:${s[3]}`, name: titleCase(s[0]), lat: s[1], lon: s[2], fav: false } : null;
  });
  const favStops = $derived(app.favs.stops.map(s => ({ ...s, fav: true })));
  // A «Κάθε μέρα» routine in force: its stop is planned from first, and only its line counts there.
  const routine = $derived(activeRoutine(app.routines, app.serverNow));
  const plan = $derived.by(() => {
    const p = planStops(favStops, nearest, app.myPos);
    const r = routine?.stop;
    return (r ? [{ ...r, fav: true }, ...p.filter(s => s.id !== r.id)] : p).slice(0, 3);
  });
  // «Κι άλλες κοντά»: the next two nearest stops (not already planned from), each with its first bus.
  const nearOthers = $derived.by<NowStop[]>(() => {
    const ix = app.stopIx;
    return app.nearGroups.slice(1, 3).flatMap(g => {
      const s = ix?.s[g.idx[0]];
      return s && s[3] ? [{ id: `oasa:${s[3]}`, name: titleCase(s[0]), lat: s[1], lon: s[2], fav: false }] : [];
    }).filter(s => !plan.some(p => p.id === s.id));
  });
  // Every stop this panel shows: the ones planned from, the others near, and the favourites' tiles.
  const want = $derived([...new Set([...plan.map(s => s.id), ...nearOthers.map(s => s.id), ...favStops.slice(0, TILES).map(s => s.id)])]);
  const wantKey = $derived([...want].sort().join("|"));

  let boards = $state.raw<Record<string, V2Arrival[]>>({});
  let loaded = $state(false);
  $effect(() => {
    if (!shown || !wantKey) return;
    const ids = untrack(() => want);
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (document.visibilityState !== "hidden") {
        let next = 0;
        const worker = async () => {
          while (next < ids.length && !ac.signal.aborted) {
            const id = ids[next++], r = await fetchV2Stop(id);
            if (ac.signal.aborted) return;
            const b = r.body as { arrivals?: V2Arrival[] } | null;
            if (r.status === 200 && b) boards = { ...boards, [id]: b.arrivals ?? [] };
          }
        };
        await Promise.all(Array.from({ length: Math.min(PARALLEL, ids.length) }, worker));
        loaded = true;
      }
      if (!ac.signal.aborted) timer = setTimeout(load, POLL_MS);
    };
    void load();
    return () => { ac.abort(); clearTimeout(timer); };
  });

  const nowS = $derived(app.serverNow / 1000);
  const rowsOf = (id: string): StopRow[] => (boards[id] ? stopRows(boards[id], nowS) : []);
  const favLineIds = $derived(app.favs.lines.map(l => l.id));

  // The bus to leave for: the first planned stop with a bus the walk can still reach.
  const leave = $derived.by<{ stop: NowStop; l: LeaveNow } | null>(() => {
    for (const s of plan) {
      const rows = routine && s.id === routine.stop.id ? rowsOf(s.id).filter(r => r.line === routine.line) : rowsOf(s.id);
      const l = leaveNow(rows, walkTo(app.myPos, s) ?? 0, nowS, favLineIds);
      if (l) return { stop: s, l };
    }
    return null;
  });

  function badge(line: string) {
    const c = app.lineColor(native(line));
    return { label: native(line), bg: c.bg, fg: c.fg };
  }
  const openStop = (s: { id: string; name: string }) => app.push(busStopCard(native(s.id), s.name));

  // The favourites' tiles: each stop's next bus (a favourite line's first), and the one after it on that row.
  const tiles = $derived(favStops.slice(0, TILES).map(s => {
    const rows = rowsOf(s.id);
    const r = rows.find(x => favLineIds.includes(x.line)) ?? rows[0];
    const t = r?.times[0];
    return { s, r, min: t ? Math.max(0, Math.round((t.at - nowS) / 60)) : null, live: !!t?.live,
      next: r?.times[1] ? Math.max(0, Math.round((r.times[1].at - nowS) / 60)) : null };
  }));


  // A strike today (the top bar's banner moves here on «Τώρα»), closed the same way.
  const strike = $derived(app.notifyPrefs.strikes ? strikes(app.disruptions, app.serverNow, app.closedStrikes)[0] : undefined);
  // Notices about the favourite lines (route changes, works): one row each, newest first.
  const notices = $derived(!app.notifyPrefs.changes ? [] : app.favs.lines.flatMap(l => forLine(app.disruptions, l.id, app.serverNow).map(d => ({ line: l, d }))).slice(0, 2));

  // ---- The user's way now (mockup 40, B1): to work in the morning at home, home in the evening (ways.ts), or the one
  // they flip to; the best route there from where they are, as a compact card (where its bus is now), «Ξεκίνα» and
  // «Θύμισέ μου». At a stop they named for that way, only the lines that go there.
  let wayPick = $state<Way | null>(null);
  const auto = $derived(pickWay(app.places, app.myPos, athensNow(app.serverNow).hour));
  const way = $derived<Way | null>(wayPick && app.places[wayPick] ? wayPick : auto?.way ?? null);
  const target = $derived(way ? app.places[way] ?? null : null);
  const bothSet = $derived(!!app.places.home && !!app.places.work);
  let wayPlan = $state.raw<{ key: string; r: PlanResponse } | null>(null);
  const wayKey = $derived(shown && target && app.myPos && metresBetween(app.myPos, target.at) > 300
    ? JSON.stringify([app.myPos.map(x => +x.toFixed(4)), target.at]) : "");
  $effect(() => {
    const k = wayKey;
    if (!k) return;
    const [a, b] = JSON.parse(k) as [[number, number], [number, number]];
    const c = new AbortController();
    let t: ReturnType<typeof setTimeout> | undefined;
    const load = () => getJSON(planUrl(API_BASE, a, b, undefined, 3), c.signal).then(async res => {
      let r = res.status === 200 ? parsePlan(res.body) : null;
      // No route from the server: the app's own, from the stop index and the live boards (fallbackPlan.ts).
      if ((!r || !r.itineraries.length) && app.stopIx) r = (await fallbackPlan(app.stopIx, a, b, app.serverNow / 1000, line => {
        const co = app.lineColor(line);
        return { label: line, color: co.bg, text: co.fg, mode: app.lineInfo.get(line)?.kind === "trolley" ? "trolley" : "bus" };
      }, c.signal).catch(() => null)) ?? r;
      if (!c.signal.aborted && r) wayPlan = { key: k, r };
      if (!c.signal.aborted) t = setTimeout(load, 60_000);
    }, () => {});
    void load();
    return () => { c.abort(); clearTimeout(t); };
  });
  const wayR = $derived(wayPlan && wayPlan.key === wayKey ? wayPlan.r : null);
  const wayIt = $derived(wayR?.itineraries.find(x => x.depart_at > nowS - 60) ?? null);
  let wayOpen = $state(false);
  let wayRemind = $state(false);
  function wayGo() {
    if (!wayIt || !wayR || !target || !way) return;
    app.startGuide(guideFromPlan(wayIt, wayR, app.stopIx, way === "home" ? "Σπίτι" : "Δουλειά"));
  }
  // A stop named for this way: only the lines from it that go there (the rest behind «Δείξε»).
  let showAll = $state(false);
  const wayLines = (id: string): Set<string> | null => {
    const sid = native(id), n = app.stopNames[sid];
    if (!way || !target || !app.stopIx || !n?.ways?.includes(way)) return null;
    return linesToward(app.stopIx, sid, target.at);
  };
  const WAY_TO: Record<Way, string> = { home: "στο σπίτι", work: "στη δουλειά" };

  // The stop's board: its next departures in time order (a line twice when its next two come soon), three on a phone,
  // five on a computer; each live, late or from the timetable, in its colour.
  let wide = $state(typeof matchMedia === "function" && matchMedia("(min-width: 720px)").matches);
  $effect(() => {
    const q = matchMedia("(min-width: 720px)"), on = () => (wide = q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  });
  // One card per line and way (mockup 33), soonest first, with its next three times: not the same line twice.
  const keep = $derived(plan[0] ? wayLines(plan[0].id) : null);
  const allDeps = $derived(plan[0] ? rowsOf(plan[0].id).filter(r => r.times.length).map(r => ({ r, t: r.times[0] })).sort((a, b) => a.t.at - b.t.at) : []);
  const wayDeps = $derived(keep && !showAll ? allDeps.filter(d => keep.has(native(d.r.line))) : allDeps);
  const hidden = $derived(keep && !showAll ? new Set(allDeps.filter(d => !keep.has(native(d.r.line))).map(d => d.r.line)).size : 0);
  const deps = $derived(wayDeps.slice(0, wide ? 4 : 3));
  const tone = (t: StopRow["times"][number]) => (!t.live ? "sched" : (t.delay_s ?? 0) >= 120 ? "late" : "ok");
  const rowNote = (t: StopRow["times"][number]) => (!t.live ? `Πρόγραμμα · ${clock(t.at).slice(0, 5)}` : (t.delay_s ?? 0) >= 120 ? `Ζωντανά · αργεί ${Math.round((t.delay_s ?? 0) / 60)}′` : "Ζωντανά · στην ώρα του");
  const metres = $derived(plan[0] && app.myPos ? Math.round(metresBetween(app.myPos, [plan[0].lat, plan[0].lon]) / 10) * 10 : null);
  const others = $derived(nearOthers.map(s => {
    const first = rowsOf(s.id).flatMap(r => r.times.slice(0, 1).map(t => ({ r, t }))).sort((a, b) => a.t.at - b.t.at)[0];
    return { s, first, min: first ? Math.max(0, Math.round((first.t.at - nowS) / 60)) : null, walk: walkTo(app.myPos, s) };
  }));

  // «Σπίτι» and «Δουλειά»: a trip there from where the user is; not set yet, the «Πού πας;» screen asks for it.
  const SAVED = [{ k: "home", label: "Σπίτι" }, { k: "work", label: "Δουλειά" }] as const;
  let waitingFor = $state<"home" | "work" | null>(null);
  function setPlace(k: "home" | "work") {
    app.savingPlace = k;
    app.start = true;
  }
  function goPlace(k: "home" | "work") {
    if (!app.places[k]) { setPlace(k); return; }
    if (!app.myPos) { waitingFor = k; app.locate(); return; }
    tripTo(k);
  }
  function tripTo(k: "home" | "work") {
    const p = app.places[k], me = app.myPos;
    if (!p || !me) return;
    app.tripFrom = { label: "Η θέση μου", pts: [me], lines: [], kind: "me" };
    app.tripTo = { label: p.label, pts: [p.at], lines: [], kind: "street" };
    app.setTab("trip");
  }
  $effect(() => {
    const k = waitingFor, me = app.myPos;
    if (k && me) untrack(() => { waitingFor = null; tripTo(k); });
    if (k && app.locState === "denied") untrack(() => { waitingFor = null; });
  });

  // «Ειδοποίησέ με»: a reminder when it is time to leave, while the page is open (a vibration where the phone has
  // it, a system notification where the user allowed them, and the app's notice line).
  // The target is fixed when set (its own text and time, on the phone's clock), so a later bus never takes it over.
  let reminder = $state.raw<{ ms: number; atS: number; text: string } | null>(null);
  $effect(() => {
    const r = reminder;
    if (!r) return;
    const fire = () => {
      reminder = null;
      app.notify(r.text);
      navigator.vibrate?.([200, 120, 200]);
      if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("Στάσεις", { body: r.text });
    };
    const t = setTimeout(fire, Math.max(0, r.ms - Date.now()));
    return () => clearTimeout(t);
  });
  // The routine reminds by itself, once a day: at leave time or a few minutes before the bus; «only if something
  // changes» says so when its bus is over 10′ late. The «Καθυστέρηση πάνω από 10′» switch does the same for any bus here.
  let routineDone = "";
  let lateSaid = "";
  $effect(() => {
    const l = leave, r = routine;
    if (!l) return;
    untrack(() => {
      const day = athensNow(app.serverNow).day;
      if (r && l.stop.id === r.stop.id && routineDone !== `${r.id}|${day}`) {
        const inS = remindIn(r.when, l.l.inMin, l.l.walk);
        if (inS != null && !reminder) {
          routineDone = `${r.id}|${day}`;
          const text = r.when === "leave" ? `Φύγε τώρα για το ${badge(l.l.line).label}: έρχεται στη στάση ${l.stop.name} σε ${l.l.walk}′.`
            : `Το ${badge(l.l.line).label} φτάνει στη στάση ${l.stop.name} σε ${BEFORE_MIN}′.`;
          reminder = { ms: Date.now() + inS * 1000, atS: nowS + inS, text };
        }
      }
      const late = (l.l.delay_s ?? 0) >= LATE_S && (app.notifyPrefs.delay || (r?.when === "change" && l.stop.id === r.stop.id));
      const key = `${l.l.line}|${l.l.at}`;
      if (late && lateSaid !== key) {
        lateSaid = key;
        app.notify(`Το ${badge(l.l.line).label} έχει +${Math.round((l.l.delay_s ?? 0) / 60)}′ καθυστέρηση.`);
      }
    });
  });

  // A phone: the panel is a sheet with a handle. «peek» shows the search and home and work over a big map, «half»
  // where it opens, «full» all of it; dragged by the handle (sheetDrag.ts), it follows the finger and settles at
  // the nearest (a flick goes one step); a tap on the handle steps it.
  const narrow = new MediaQuery("(max-width: 719px)");
  type NSnap = "peek" | "half" | "full";
  let nsnap = $state<NSnap>("half");
  let nowEl = $state<HTMLElement>(), savedEl = $state<HTMLElement>();
  let nowTop = $state<number | null>(null), dragging = $state(false), vh = $state(typeof innerHeight === "number" ? innerHeight : 800);
  let top0 = 0;
  function tops(): Record<NSnap, number> {
    const { top: st, bottom: sb } = safeInsets();
    const foot = vh - Math.max(12, sb) - (narrow.current ? 0 : 88);   // a phone: no tab bar under it
    const peekH = nowEl && savedEl ? savedEl.getBoundingClientRect().bottom - nowEl.getBoundingClientRect().top + 16 : 190;
    return { full: st + 72, half: Math.max(220, vh * 0.32 + st), peek: Math.max(st + 72, foot - peekH) };
  }
  $effect(() => {
    void vh;
    const k = nsnap;
    if (!narrow.current) { nowTop = null; return; }
    untrack(() => { nowTop = k === "half" ? null : tops()[k]; });
  });
  const armed = $derived(!!app.alert || !!app.railAlert);
  // «Χάρτης» (and «Θέλω μόνο να δω τον χάρτη»): the sheet down to its handle.
  let seenPeek = 0;
  $effect(() => { const n = app.homePeek; if (n !== seenPeek) { seenPeek = n; untrack(() => { nsnap = "peek"; }); } });
  // Lowered to its handle on a phone, the map's own buttons come back over the map (app.css).
  $effect(() => { const on = shown && narrow.current && nsnap === "peek"; document.documentElement.toggleAttribute("data-homepeek", on); return () => document.documentElement.removeAttribute("data-homepeek"); });
  const stepN = () => { nsnap = nsnap === "peek" ? "half" : nsnap === "half" ? "full" : "peek"; };
  const nowDrag = $derived<SheetDrag>({
    ignore: narrow.current ? undefined : "*",
    start: () => { top0 = nowEl?.getBoundingClientRect().top ?? 0; dragging = true; },
    move: dy => { const t = tops(); nowTop = Math.max(t.full, Math.min(t.peek + 40, top0 + dy)); },
    end: (dy, v) => {
      dragging = false;
      const t = tops(), at = Math.max(t.full, Math.min(t.peek + 40, top0 + dy));
      const next = settleSnap<NSnap>(["peek", "half", "full"], nsnap, at, t, v, "up", dy);
      if (next === nsnap) nowTop = next === "half" ? null : t[next];
      nsnap = next;
      if (next === "half") nowTop = null;
    },
    tap: stepN,
  });
</script>

<svelte:window bind:innerHeight={vh} />

{#if wayRemind && wayIt && wayR && target}
  <RemindSheet {app} it={wayIt} r={wayR} ix={app.stopIx} to={{ label: way === "home" ? "Σπίτι" : "Δουλειά", pts: [target.at], lines: [], kind: way ?? "home" }} onclose={() => (wayRemind = false)} />
{/if}

{#if shown}
  <!-- One notice on the map, under the search: a strike first, else the newest about a favourite line. -->
  {#if strike}
    <div class="mapnote strike" in:rise={{ y: -12, delay: 200 }}>
      <a href={strike.url} target="_blank" rel="noopener" aria-label="{strike.title}. Ανοίγει σε νέα καρτέλα"><Icon name="warn" size={15} /><span>{strike.title}</span></a>
      <button type="button" aria-label="Κλείσιμο ειδοποίησης απεργίας" onclick={() => app.closeStrike(strike.id)}><Icon name="close" size={13} /></button>
    </div>
  {:else if notices.length}
    {@const n = notices[0]}
    <a class="mapnote" in:rise={{ y: -12, delay: 200 }} href={n.d.url} target="_blank" rel="noopener"><Icon name="warn" size={15} /><span>{badge(n.line.id).label}: {n.d.title}</span></a>
  {/if}
  <section class="now" class:dragging aria-label="Αρχική" in:rise bind:this={nowEl} style:top={nowTop != null ? `${nowTop}px` : undefined}>
    <div class="grip" role="button" tabindex="0" aria-label={nsnap === "full" ? "Μικρότερο" : "Μεγαλύτερο"} use:sheetDrag={nowDrag}
      onkeydown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); stepN(); } }}></div>

    <!-- The one search: «Πού πας;» (StartScreen), for places, stops and lines, with our engine. -->
    <div class="whererow">
      <button type="button" class="where" aria-haspopup="dialog" onclick={() => (app.start = true)}>
        <Icon name="search" size={20} /><span>Πού πας;</span><kbd class="pc" aria-hidden="true">/</kbd>
      </button>
      <!-- A phone has no tab bar: the alerts are this bell (a dot while one is set). -->
      <button type="button" class="bell" aria-label={armed ? "Ειδοποιήσεις, μία ενεργή" : "Ειδοποιήσεις"} title="Ειδοποιήσεις" onclick={() => app.setTab("alerts")}>
        <Icon name="bell" size={21} />{#if armed}<i class="bdot" aria-hidden="true"></i>{/if}
      </button>
    </div>

    <!-- Home and work: one tap from here, set on first use -->
    <div class="saved" bind:this={savedEl}>
      {#each SAVED as p (p.k)}
        {@const at = app.places[p.k]}
        <button type="button" class="place" onclick={() => goPlace(p.k)} aria-label={at ? `${p.label}: διαδρομή ως ${at.label}` : `Όρισε ${p.label.toLowerCase()}`}>
          <span class="pi {p.k}"><Icon name={p.k} size={17} /></span>
          <span class="pt"><b>{p.label}</b><small>{at ? (waitingFor === p.k ? "Σε ψάχνω…" : at.label) : "Όρισε"}</small></span>
        </button>
        {#if at}
          <button type="button" class="edit" aria-label="Άλλαξε {p.label.toLowerCase()}" title="Αλλαγή" onclick={() => setPlace(p.k)}>
            <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.5 4.5l3 3L7 16H4v-3z" /></svg>
          </button>
        {/if}
      {/each}
    </div>

    {#if way && target && wayKey}
      <div class="way">
        {#if bothSet}
          <div class="wseg" role="radiogroup" aria-label="Προς τα πού">
            {#each [["work", "Προς δουλειά"], ["home", "Προς σπίτι"]] as const as [k, label] (k)}
              <button type="button" role="radio" aria-checked={way === k} class:on={way === k} onclick={() => { wayPick = k; wayOpen = false; }}><Icon name={k} size={16} /><span>{label}</span></button>
            {/each}
          </div>
          {#if !wayPick && auto?.why}<p class="why">{auto.why}</p>{/if}
        {:else}
          <h2>{way === "work" ? "Προς δουλειά" : "Προς σπίτι"}</h2>
        {/if}
        {#if wayIt && wayR}
          <RouteCard it={wayIt} r={wayR} ix={app.stopIx} legs={scaledLegs(wayIt, wayR)} {nowS} tag="" open={wayOpen} live onpick={() => (wayOpen = !wayOpen)} />
          <div class="wacts">
            <button type="button" class="wgo" onclick={wayGo}>Ξεκίνα</button>
            <button type="button" class="wrm" class:on={app.leaveRemind?.key === `${wayIt.depart_at}-${wayIt.arrive_at}`} onclick={() => (wayRemind = true)}><Icon name="bell" size={16} /><span>Θύμισέ μου</span></button>
          </div>
        {:else}
          <p class="muted">Ψάχνω διαδρομή…</p>
        {/if}
      </div>
    {/if}

    <!-- The stop to plan from (the nearest, a routine's or a favourite) and its board, as a station's: the next
         departures in time, each live, late or from the timetable. -->
    <div class="sec">
      {#if !plan.length}
        <div class="head"><h2>Κοντά σου τώρα</h2></div>
        <div class="empty">
          <p>Δείξε πού είσαι και θα βλέπεις εδώ τα επόμενα λεωφορεία της πιο κοντινής στάσης.</p>
          {#if app.locState === "denied"}
            <p class="hint">Η τοποθεσία είναι κλειστή για αυτή τη σελίδα, από τις ρυθμίσεις του browser.</p>
          {:else}
            <button type="button" class="go" onclick={() => app.locate()}><Icon name="locate" size={18} /><span>{app.locState === "searching" ? "Σε ψάχνω…" : "Βρες με"}</span></button>
          {/if}
        </div>
      {:else}
        {@const st = plan[0]}
        {@const w = walkTo(app.myPos, st)}
        {@const on = app.isFavStop(st.id)}
        <div class="stophead">
          <button type="button" class="sh" onclick={() => openStop(st)}>
            <span class="sn">{app.stopLabel(st.id, st.name)}</span>
            <small>{routine && st.id === routine.stop.id ? "Η στάση της διαδρομής σου" : st.id === nearest?.id ? "Η πιο κοντινή σου στάση" : "Αγαπημένη στάση"}{metres != null ? ` · ${metres} μ` : ""}{w != null ? ` · ${w}′ με τα πόδια` : ""}</small>
          </button>
          <button type="button" class="star" class:on aria-pressed={on} aria-label={on ? "Αφαίρεση από τις αγαπημένες" : "Προσθήκη στις αγαπημένες"}
            onclick={() => app.toggleFavStop({ id: st.id, name: st.name, lat: st.lat, lon: st.lon })}><Icon name={on ? "star-filled" : "star"} size={19} /></button>
        </div>
        {#if deps.length}
          <ul class="board">
            {#each deps as d, k (d.r.line + d.r.headsign)}
              {@const b = badge(d.r.line)}
              {@const min = Math.max(0, Math.round((d.t.at - nowS) / 60))}
              <li in:item={{ i: k + 2 }} class="dcard {tone(d.t)}">
                <button type="button" class="row" onclick={() => openStop(st)}>
                  <span class="badge lg" style:--lb={b.bg} style:--lf={b.fg}>{b.label}</span>
                  <span class="rt"><b>→ {titleCase(placeNote(toward(d.r.headsign)).place)}</b><small class={tone(d.t)}>{#if d.t.live}<i></i>{/if}{rowNote(d.t)}</small></span>
                  <span class="rm {tone(d.t)}">{min === 0 ? "τώρα" : min < 60 ? `${min}′` : clock(d.t.at).slice(0, 5)}</span>
                </button>
                {#if d.r.times.length > 1}
                  <span class="dtimes">
                    {#each d.r.times.slice(0, 3) as t, j (j)}
                      {@const m = Math.max(0, Math.round((t.at - nowS) / 60))}
                      <span class="dt {tone(t)}">{#if t.live}<i></i>{/if}{m === 0 ? "τώρα" : m < 60 ? `${m}′` : clock(t.at).slice(0, 5)}</span>
                    {/each}
                  </span>
                {/if}
              </li>
            {/each}
          </ul>
          {#if hidden && way}<button type="button" class="hid" onclick={() => (showAll = true)}><span>{hidden === 1 ? "Άλλη 1 γραμμή δεν πάει" : `Άλλες ${hidden} γραμμές δεν πάνε`} {WAY_TO[way]}</span><b>Δείξε</b></button>{/if}
        {:else}
          <p class="muted">{loaded ? `Κανένα λεωφορείο τώρα στη στάση ${st.name}.` : "Φόρτωση…"}</p>
        {/if}
      {/if}
    </div>

    {#if others.length}
      <div class="sec">
        <div class="head"><h2>Κι άλλες κοντά</h2></div>
        <div class="tiles">
          {#each others as o, k (o.s.id)}
            <button type="button" class="tile near" in:item={{ i: k + 4 }} onclick={() => openStop(o.s)}>
              <span class="sname strong">{app.stopLabel(o.s.id, o.s.name)}</span>
              <span class="trow">
                {#if o.first}{@const b = badge(o.first.r.line)}<span class="badge" style:--lb={b.bg} style:--lf={b.fg}>{b.label}</span>
                  <b class="om {tone(o.first.t)}">{o.min === 0 ? "τώρα" : o.min! < 60 ? `${o.min}′` : clock(o.first.t.at).slice(0, 5)}</b>{:else}<b class="om sched">–</b>{/if}
                {#if o.walk != null}<small class="wk" title="Με τα πόδια"><Icon name="walk" size={13} />{o.walk}′</small>{/if}
              </span>
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Pinned on the map (PinSheet): its colour opens the sheet, a tap its card, × takes it off. -->
    {#if app.pins.length}
      <div class="sec">
        <div class="head"><h2>Καρφιτσωμένα</h2><span class="cnt">{app.pins.length} στον χάρτη</span></div>
        <ul class="pins">
          {#each app.pins as pin (pin.kind + pin.id)}
            <li>
              <button type="button" class="pc-dot" style:--pc={pin.color} aria-label="Χρώμα και ρυθμίσεις: {pin.label}" onclick={() => (app.pinEdit = pin)}><i></i></button>
              <button type="button" class="pin-open" onclick={() => app.open({ kind: pin.kind, id: `oasa:${pin.id}`, title: pin.label })}>
                {#if pin.kind === "line"}{@const b = badge(`oasa:${pin.id}`)}<span class="badge lg" style:--lb={b.bg} style:--lf={b.fg}>{b.label}</span>
                {:else}<span class="ptile" aria-hidden="true"><img src="{import.meta.env.BASE_URL}icons/oasa.png" alt="" /></span>{/if}
                <span class="rt"><b>{pin.kind === "line" ? (app.lineInfo.get(pin.id)?.name ? titleCase(app.lineInfo.get(pin.id)!.name) : `Γραμμή ${pin.label}`) : pin.label}</b>
                  <small>{pin.kind === "line" ? (pin.vehicles ? "Με τα οχήματά της" : "Μόνο η διαδρομή") : "Στάση"}{pin.top ? " · πάνω από όλα" : ""}</small></span>
              </button>
              <button type="button" class="unpin" aria-label="Ξεκαρφίτσωμα: {pin.label}" onclick={() => app.unpin(pin.kind, pin.id)}><Icon name="close" size={14} /></button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <!-- Favourites, live: only once there are some -->
    {#if tiles.length}
      <div class="sec">
        <div class="head">
          <h2>Αγαπημένα</h2>
          <button type="button" class="link" onclick={() => app.toggleFavs()}>Όλα</button>
        </div>
        <div class="tiles">
          {#each tiles as t, k (t.s.id)}
            <button type="button" class="tile" in:item={{ i: k + 5 }} onclick={() => openStop(t.s)}>
              <span class="trow">
                {#if t.r}{@const b = badge(t.r.line)}<span class="badge" style:--lb={b.bg} style:--lf={b.fg}>{b.label}</span>{/if}
                <span class="sname">{app.stopLabel(t.s.id, t.s.name)}</span>
              </span>
              <span class="tmin">
                {#if t.min != null}<b>{t.min === 0 ? "τώρα" : `${t.min}′`}</b>{#if t.next != null}<small>και {t.next}′</small>{/if}
                {:else}<b class="dash">–</b><small>{boards[t.s.id] ? "κανένα τώρα" : "φόρτωση"}</small>{/if}
              </span>
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </section>
{/if}

<style>
  .now { position: absolute; z-index: 6; left: 16px; bottom: 100px; width: 380px; max-height: calc(100dvh - 200px - env(safe-area-inset-top));
    overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: 16px; padding: 16px; box-sizing: border-box;
    border-radius: var(--radius); background: var(--glass-strong); --card: var(--glass-fill); --card-border: var(--glass-line); -webkit-backdrop-filter: var(--glass-fx); backdrop-filter: var(--glass-fx); box-shadow: var(--glass-rim); text-shadow: var(--glass-text); }
  .grip { display: none; }
  h2 { margin: 0; font-size: 15px; font-weight: 700; line-height: 1; }
  .muted { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.4; }
  .hint { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.3; }

  /* «Πού πας;» and, on a phone, the alerts' bell beside it */
  .whererow { flex: none; display: flex; gap: 8px; align-items: center; }
  .whererow .where { flex: 1; min-width: 0; }
  .bell { display: none; position: relative; flex: none; width: 56px; height: 56px; padding: 0; border: 0; border-radius: 50%; align-items: center; justify-content: center;
    background: var(--control); color: var(--fg); cursor: pointer; }
  .bell:hover { background: var(--control-hover); }
  .bdot { position: absolute; top: 14px; right: 15px; width: 9px; height: 9px; border-radius: 50%; background: var(--late2); box-shadow: 0 0 0 2px var(--control); }
  @media (max-width: 719px) { .bell { display: flex; } .where { border-radius: 28px; } }
  /* «Πού πας;»: the one big field */
  .where { flex: none; display: flex; align-items: center; gap: 12px; height: 56px; padding: 0 18px; border: 0; border-radius: 16px;
    background: var(--control); color: var(--muted); font: inherit; font-size: 17px; font-weight: 600; line-height: 1; cursor: pointer; }
  .where :global(svg) { color: var(--accent); stroke-width: 2.2; }
  .where:hover { background: var(--control-hover); color: var(--fg); }

  /* The way now: «Προς δουλειά» or «Προς σπίτι», the best route there */
  .way { display: flex; flex-direction: column; gap: 10px; }
  .wseg { height: 46px; display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; box-sizing: border-box; border-radius: 14px; background: var(--card); }
  .wseg button { display: flex; align-items: center; justify-content: center; gap: 7px; border: 0; border-radius: 11px; background: none; color: var(--muted);
    font: inherit; font-size: 15px; font-weight: 500; line-height: 1; cursor: pointer; }
  .wseg button.on { background: color-mix(in srgb, var(--fg) 14%, var(--card)); color: var(--fg); font-weight: 600; }
  .why { margin: -2px 2px 0; font-size: 13px; color: var(--muted); line-height: 1.3; }
  .wacts { display: flex; gap: 8px; }
  .wgo, .wrm { flex: 1; height: 44px; display: flex; align-items: center; justify-content: center; gap: 7px; border: 0; border-radius: 12px; font: inherit; font-size: 15px; line-height: 1; cursor: pointer; }
  .wgo { background: var(--accent); color: var(--on-accent, #fff); font-weight: 700; }
  .wrm { background: var(--card); color: var(--fg); font-weight: 600; }
  .wrm.on { background: color-mix(in srgb, var(--accent) 18%, var(--card)); }
  .hid { width: 100%; height: 40px; margin-top: 6px; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 12px; border: 0; border-radius: 12px;
    background: none; color: var(--muted); font: inherit; font-size: 13px; line-height: 1; cursor: pointer; }
  .hid b { color: var(--fg); font-weight: 600; }

  /* Home and work */
  .saved { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto; gap: 8px 6px; align-items: center; }
  .saved:not(:has(.edit)) { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .place { min-width: 0; display: flex; align-items: center; gap: 10px; height: 54px; padding: 0 12px; border: 0; border-radius: 14px;
    background: var(--card); color: var(--fg); font: inherit; text-align: left; cursor: pointer; }
  .place:hover { background: var(--control-hover); }
  .pi { flex: none; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; }
  .pi.home { background: var(--accent-bg); color: var(--accent); }
  .pi.work { background: color-mix(in srgb, var(--late1) 16%, transparent); color: var(--late1); }
  .pt { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .pt b { font-size: 14px; line-height: 1; }
  .pt small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; line-height: 1.1; color: var(--muted); }
  .edit { flex: none; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 50%;
    background: none; color: var(--muted); cursor: pointer; }
  .edit:hover { background: var(--control); color: var(--fg); }

  .sec { display: flex; flex-direction: column; gap: 10px; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 30px; }
  .link { min-width: 0; height: 30px; display: block; padding: 0 10px; margin-right: -6px; line-height: 30px; border: 0; border-radius: 15px;
    background: none; color: var(--accent); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .link:hover { background: var(--control); }
  .empty { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; padding: 14px; border-radius: 16px; background: var(--card); }
  .empty p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.4; }
  .go { height: 44px; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 0 16px; border: 0; border-radius: 22px;
    background: var(--accent); color: var(--on-accent); font: inherit; font-size: 14px; font-weight: 700; line-height: 1; cursor: pointer; }

  .rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .row { width: 100%; display: flex; align-items: center; gap: 12px; min-height: 58px; padding: 0 14px; border: 0; border-radius: 14px;
    background: var(--card); color: var(--fg); font: inherit; text-align: left; cursor: pointer; }
  .row:hover { background: var(--control-hover); }
  .rt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .rt b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; line-height: 1.1; }
  .rt small { font-size: 12px; line-height: 1.1; color: var(--muted); }
  .rm { flex: none; display: flex; align-items: baseline; gap: 1px; padding-right: 3px; font-size: 22px; font-weight: 800; line-height: 1.1; }
  .rm.ok { color: var(--ontime); } .rm.late { color: var(--late1); } .rm.sched { color: var(--muted); }
  .badge { display: inline-flex; align-items: center; justify-content: center; flex: none; height: 24px; min-width: 24px; padding: 0 8px; box-sizing: border-box;
    border-radius: 12px; background: var(--lb); color: var(--lf); font-size: 12px; font-weight: 800; line-height: 1; }
  .badge.lg { height: 30px; min-width: 46px; border-radius: 8px; font-size: 14px; }

  /* The stop and its board */
  .stophead { display: flex; align-items: flex-start; gap: 10px; }
  .sh { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; padding: 0; border: 0; background: none; color: var(--fg); font: inherit; text-align: left; cursor: pointer; }
  .sn { font-size: 24px; font-weight: 800; letter-spacing: -.02em; line-height: 1.1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sh small { font-size: 13px; line-height: 1.2; color: var(--muted); }
  .sh:hover .sn { color: var(--accent); }
  .star { flex: none; width: 42px; height: 42px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 50%;
    background: var(--control); color: var(--muted); cursor: pointer; transition: color .15s, transform .12s; }
  .star.on { color: var(--star); }
  .star:active { transform: scale(.9); }
  /* The board: a card per line and way, its next times under it. */
  .board { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .dcard { border-radius: 18px; background: var(--card); border: 1px solid var(--card-border); overflow: hidden; }
  .dcard.late { border-color: color-mix(in srgb, var(--late1) 38%, transparent); }
  .board .row { min-height: 58px; border-radius: 0; background: none; }
  .board .row:hover { background: var(--control); }
  .dtimes { display: flex; gap: 6px; padding: 0 14px 12px; margin-top: -4px; }
  .dt { height: 26px; display: flex; align-items: center; gap: 6px; padding: 0 9px; border-radius: 8px; background: var(--control); font-size: 12px; font-weight: 800; line-height: 1; }
  .dt i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .dt.ok { background: color-mix(in srgb, var(--ontime) 14%, transparent); color: var(--ontime); }
  .dt.late { background: color-mix(in srgb, var(--late1) 14%, transparent); color: var(--late1); }
  .rt small { display: flex; align-items: center; gap: 6px; }
  .rt small i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; }
  .rt small.ok { color: var(--ontime); } .rt small.late { color: var(--late1); }
  .rm { font-size: 24px; letter-spacing: -.03em; }
  .rm.sched { color: var(--fg); }
  .tile.near { gap: 8px; }
  .sname.strong { font-size: 14px; font-weight: 700; color: var(--fg); }
  .tile .trow small { margin-left: auto; display: flex; align-items: center; gap: 3px; font-size: 12px; line-height: 1; color: var(--muted); white-space: nowrap; }
  .om { font-size: 16px; font-weight: 800; line-height: 1; }
  .om.ok { color: var(--ontime); } .om.late { color: var(--late1); } .om.sched { color: var(--fg); }
  kbd { margin-left: auto; height: 24px; display: inline-flex; align-items: center; padding: 0 8px; border-radius: 6px; border: 1px solid var(--border);
    color: var(--muted); font: 600 12px/1 var(--font); }
  .pc { display: none; }
  @media (min-width: 720px) and (pointer: fine) { .pc { display: inline-flex; } }
  @media (min-width: 1024px) { .now { width: 400px; } }

  /* The notice on the map: an amber pill under the search field. */
  .mapnote { position: absolute; z-index: 5; left: 12px; top: calc(72px + env(safe-area-inset-top)); max-width: min(380px, calc(100% - 32px));
    height: 30px; display: flex; align-items: center; gap: 8px; padding: 0 12px 0 8px; box-sizing: border-box; border-radius: 15px;
    background: color-mix(in srgb, var(--late1) 16%, var(--surface)); border: 1px solid color-mix(in srgb, var(--late1) 35%, transparent);
    color: var(--warn-fg); font-size: 12px; font-weight: 600; line-height: 1; text-decoration: none; box-shadow: var(--shadow-sm); }
  .mapnote span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mapnote.strike { padding: 0 2px 0 0; background: color-mix(in srgb, var(--late3) 16%, var(--surface)); border-color: color-mix(in srgb, var(--late3) 35%, transparent); color: var(--late3); }
  .mapnote.strike a { flex: 1; min-width: 0; height: 100%; display: flex; align-items: center; gap: 8px; padding-left: 8px; color: inherit; text-decoration: none; }
  .mapnote.strike button { flex: none; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0;
    border-radius: 50%; background: none; color: inherit; cursor: pointer; }

  .cnt { font-size: 12px; color: var(--muted); line-height: 1; }
  .pins { list-style: none; margin: 0; padding: 0; border-radius: 16px; background: var(--card); border: 1px solid var(--card-border); overflow: hidden; }
  .pins li { display: flex; align-items: center; gap: 4px; min-height: 60px; padding: 0 6px 0 8px; }
  .pins li + li { border-top: 1px solid var(--card-border); }
  .pc-dot { flex: none; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 50%;
    background: none; cursor: pointer; }
  .pc-dot i { width: 20px; height: 20px; border-radius: 50%; background: var(--pc); box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .15); }
  .pc-dot:hover { background: var(--control); }
  .pin-open { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; min-height: 52px; padding: 0 6px; border: 0; border-radius: 12px;
    background: none; color: var(--fg); font: inherit; text-align: left; cursor: pointer; }
  .pin-open:hover { background: var(--control); }
  .ptile { flex: none; width: 46px; height: 30px; display: flex; align-items: center; justify-content: center; border-radius: 8px; background: #fff;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .08); }
  .ptile img { width: 20px; height: 20px; display: block; }
  .unpin { flex: none; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 50%;
    background: none; color: var(--muted); cursor: pointer; }
  .unpin:hover { background: var(--control); color: var(--fg); }
  .tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .tile { display: flex; flex-direction: column; align-items: stretch; gap: 10px; min-width: 0; padding: 12px; border-radius: 18px;
    border: 1px solid var(--card-border); background: var(--card); color: var(--fg); font: inherit; text-align: left; cursor: pointer; }
  .tile:hover { border-color: color-mix(in srgb, var(--accent) 40%, var(--card-border)); }
  .trow { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .sname { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; line-height: 1.2; color: var(--muted); }
  .tmin { display: flex; align-items: baseline; gap: 6px; }
  .tmin b { font-size: 26px; font-weight: 800; letter-spacing: -.5px; line-height: 1; }
  .tmin b.dash { color: var(--muted); }
  .tmin small { font-size: 13px; line-height: 1; color: var(--muted); }
  button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  @media (max-width: 719px) {
    .mapnote { left: 16px; top: calc(76px + env(safe-area-inset-top)); }
    .now { left: 10px; right: 10px; width: auto; top: max(220px, calc(32dvh + env(safe-area-inset-top))); bottom: max(10px, env(safe-area-inset-bottom)); max-height: none;
      padding: 10px 16px 16px; border-radius: var(--sheet-r); }
    /* The handle: a band across the top (an easy target), its bar in the middle. */
    .grip { display: block; position: relative; flex: none; height: 22px; margin: -10px -16px -10px; cursor: grab; }
    .grip::after { content: ""; position: absolute; left: 50%; top: 9px; width: 40px; height: 5px; margin-left: -20px; border-radius: 3px; background: var(--border); }
    .grip:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: 12px; }
    .now { overscroll-behavior: none; transition: top .26s cubic-bezier(.2, .8, .2, 1); }
    .now.dragging { transition: none; }
  }
  /* Under a press, the big buttons and rows give a little. */
  .where, .place, .row, .tile, .go { transition: transform .12s, background-color .15s, border-color .15s; }
  .where:active, .place:active, .row:active, .tile:active, .go:active { transform: scale(.98); }
  @media (prefers-reduced-motion: reduce) { .where, .place, .row, .tile, .go { transition: none; } }
</style>
