<script lang="ts">
  // 3D: a bus's route across (a tap on its label, MapView). Where it has been, where it is now, its next two stops
  // with their times, the rest folded («+12 στάσεις», which opens them in a row that scrolls sideways), and its last
  // stop with the time it gets there. «Ακολούθησε» rides behind it (its card and the chase camera); «Όλη η γραμμή»
  // opens its line. A phone has it as a sheet at the bottom; a wide screen as a panel over the map's foot.
  // A metro train ("metro/<trip>") has the same panel, with its run's stations and their times from the timetable
  // (the metro sends no positions: its times are the expected ones).
  import type { AppState } from "../state.svelte";
  import { busRoute, lateness } from "../bus3d";
  import { busVehicleCard, routeCard } from "../legacy";
  import { clockHM, type StasyTrip } from "../trains";
  import { fetchTrainRun } from "../api";
  import Icon from "./Icon.svelte";
  import { placeNote, toward } from "../stops";
  import { titleCase } from "../nearby";

  let { app, key }: { app: AppState; key: string } = $props();
  const metro = $derived(key.startsWith("metro/"));
  const trip = $derived(metro ? key.slice(6) : "");
  const sv = $derived(metro ? app.stasyTrains.find(t => t.trip === trip) ?? null : null);
  const line = $derived(metro ? sv?.line ?? "" : key.split("/")[0]), id = $derived(metro ? trip : key.split("/")[1]);
  const v = $derived(metro ? null : app.vehicles.find(p => p.line === line && p.v.id === id)?.v ?? app.cityByKey.get(key) ?? null);
  $effect(() => { if (!metro) app.ensureStatic(line); });
  const now = $derived(app.serverNow / 1000);
  // A metro train's run: every station with its time (the timetable's, cached for 10 minutes).
  let run = $state.raw<StasyTrip | null>(null);
  $effect(() => {
    const t = trip;
    run = null;
    if (!t) return;
    void fetchTrainRun("metro", t).then(r => { if (t === trip && r?.status === 200 && r.body) run = r.body as StasyTrip; });
  });
  const metroRoute = $derived.by(() => {
    if (!sv) return null;
    const stops = run?.stops?.length ? run.stops : [sv.from, sv.to];
    let i = stops.findIndex(st => st.name === sv.to.name && Math.abs(st.at - sv.to.at) < 120);
    if (i < 0) i = stops.findIndex(st => st.at >= now - 20);
    if (i < 0) return null;
    return { passed: i > 0 ? titleCase(stops[i - 1].name) : null, from: titleCase(stops[0].name), head: titleCase(sv.headsign),
      ahead: stops.slice(i).map((st, k) => ({ id: `${k}`, name: titleCase(st.name), at: st.at })) };
  });
  const route = $derived(metro ? metroRoute : busRoute(line, id, v, app.statics[line]));
  const late = $derived(lateness(v?.delay_s ?? null));
  const color = $derived(metro ? { bg: sv?.route_color || "#0a7cc4", fg: "#fff" } : app.lineColor(line));
  const kind = $derived(metro ? "Μετρό" : app.lineInfo.get(line)?.kind === "trolley" ? "Τρόλεϊ" : "Λεωφορείο");
  const head = $derived.by(() => {
    if (route) return route.head;
    const hs = v?.variant ? app.statics[line]?.variants[v.variant]?.headsign : undefined;
    return hs ? titleCase(placeNote(toward(hs)).place) : "";
  });

  // The next two, the last, and between them the folded ones (none to fold with four stops or fewer).
  let open = $state(false);
  $effect(() => { void key; open = false; });
  const ahead = $derived(route?.ahead ?? []);
  const fold = $derived(ahead.length > 4);
  const near = $derived(fold ? ahead.slice(0, 2) : ahead.slice(0, -1));
  const mid = $derived(fold ? ahead.slice(2, -1) : []);
  const last = $derived(ahead.at(-1) ?? null);
  const mins = (at: number) => (at - now < 30 ? "τώρα" : `σε ${Math.max(1, Math.round((at - now) / 60))}′`);
  const age = $derived(v ? Math.max(0, Math.round(now - v.position_at)) : 0);

  function close() { app.bus3d = null; }
  function follow() {
    if (metro) { app.train = { kind: "metro", id: trip }; app.bus3d = null; return; }   // its card, and the camera down with it
    app.open(busVehicleCard(line, id));
    app.setChase(key);
    app.bus3d = null;
  }
  function wholeLine() {
    if (metro) { app.open({ kind: "line", id: `stasy:${line}`, title: line }); app.bus3d = null; return; }
    const variant = v?.variant;
    app.open(variant ? routeCard(line, variant) : { kind: "line", id: `oasa:${line}`, title: line });
    app.bus3d = null;
  }
</script>

<svelte:window onkeydown={e => { if (e.key === "Escape") close(); }} />

<section class="r3d" aria-label="Η διαδρομή του {line}" style:--c={color.bg} style:--t={color.fg}>
  <header>
    <span class="chip">{line}</span>
    <div class="ttl">
      <h2>{head ? `→ ${head}` : `Όχημα ${id}`}</h2>
      <span class="sub">{kind}{route?.from ? ` · από ${route.from}` : ""}</span>
    </div>
    {#if late.text}<span class="late {late.tone}"><i></i>{late.text}</span>{/if}
    <span class="sp"></span>
    <div class="acts">
      <button type="button" class="go" onclick={follow}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5l7.5 19-7.5-4.3-7.5 4.3z" /></svg>
        <span>Ακολούθησε</span></button>
      <button type="button" class="sec" onclick={wholeLine}><span>Όλη η γραμμή</span></button>
    </div>
    <button type="button" class="x" aria-label="Κλείσιμο" onclick={close}><Icon name="close" size={14} /></button>
  </header>

  {#if route}
    {#if !open}
      <!-- Folded: passed (dim), now, the next two, the rest as one button, the last. -->
      <ol class="strip" class:fold aria-label="Οι στάσεις μπροστά">
        {#if route.passed}
          <li class="stop past"><i class="dot"></i><b>{route.passed}</b><small>πέρασε</small></li>
        {/if}
        <li class="stop now t-{late.tone}"><span class="here"><Icon name={metro ? "metro" : "bus"} size={14} /></span><b>Τώρα</b></li>
        {#each near as a, k (a.id + k)}
          <li class="stop" class:first={k === 0}><i class="dot"></i><b>{a.name}</b><span class="when"><strong>{mins(a.at)}</strong><small>{clockHM(a.at)}</small></span></li>
        {/each}
        {#if fold}
          <li class="more"><button type="button" aria-expanded="false" onclick={() => (open = true)}>
            <span>+{mid.length} <span class="long">στάσεις</span></span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg></button></li>
        {/if}
        {#if last}
          <li class="stop end"><span class="term" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24"><path d="M6 21.5V3" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" /><path d="M6 3.5h12.5l-3 4.75 3 4.75H6z" fill="currentColor" /></svg></span><b>{last.name} <small>τέρμα</small></b><span class="when"><small>{clockHM(last.at)}</small><strong>{mins(last.at)}</strong></span></li>
        {/if}
      </ol>
    {:else}
      <!-- Open: every stop ahead in a row that scrolls sideways; the last stays at the right edge. -->
      <div class="openhead">
        <b>Στάσεις μπροστά · {ahead.length}</b>
        <button type="button" aria-expanded="true" onclick={() => (open = false)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
          <span>Λιγότερες</span></button>
      </div>
      <div class="rowwrap">
        <ol class="row" aria-label="Όλες οι στάσεις μπροστά">
          <li class="stop now t-{late.tone}"><span class="here"><Icon name={metro ? "metro" : "bus"} size={14} /></span><b>Τώρα</b></li>
          {#each ahead.slice(0, -1) as a, k (a.id + k)}
            <li class="stop" class:first={k === 0}><i class="dot"></i><b>{a.name}</b><span class="when"><strong>{mins(a.at)}</strong><small>{clockHM(a.at)}</small></span></li>
          {/each}
        </ol>
        {#if last}
          <div class="pin"><span class="term" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24"><path d="M6 21.5V3" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" /><path d="M6 3.5h12.5l-3 4.75 3 4.75H6z" fill="currentColor" /></svg></span><b>{last.name}</b><span class="when"><small>{clockHM(last.at)}</small><strong>{mins(last.at)}</strong></span></div>
        {/if}
      </div>
    {/if}
    <small class="foot">{#if metro}Ώρες από το πρόγραμμα: το μετρό δεν στέλνει τη θέση του, οπότε είναι οι αναμενόμενες{:else}Ώρες κατά προσέγγιση, από τη θέση του πριν {age < 60 ? `${age}″` : `${Math.round(age / 60)}′`}{/if}</small>
  {:else}
    <p class="note">{metro ? (sv ? "Φόρτωση σταθμών…" : "Το τρένο δεν είναι πια στον χάρτη.") : app.statics[line] ? "Δεν ξέρουμε ακόμα πού είναι στη διαδρομή του." : "Φόρτωση στάσεων…"}</p>
  {/if}
</section>

<style>
  /* Over the map's foot, right of the panel (368 px at the left) and clear of the map's buttons at the right. */
  .r3d { position: absolute; z-index: 6; left: 16px; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom)); max-width: 980px; margin: 0 auto;
    display: flex; flex-direction: column; gap: 16px; padding: 18px 22px 14px; box-sizing: border-box;
    border-radius: 24px; border: 0; background: var(--glass-strong); --card: var(--glass-fill); --card-border: var(--glass-line); -webkit-backdrop-filter: var(--glass-fx); backdrop-filter: var(--glass-fx); box-shadow: var(--glass-rim); text-shadow: var(--glass-text); color: var(--fg);
    animation: up .25s cubic-bezier(.2, .8, .2, 1); }
  @keyframes up { from { opacity: 0; transform: translateY(12px); } }
  header { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .chip { flex: none; display: flex; align-items: center; justify-content: center; height: 32px; padding: 0 10px; border-radius: 8px;
    background: var(--c); color: var(--t); font-size: 15px; font-weight: 800; line-height: 1; }
  .ttl { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  h2 { margin: 0; font-size: 19px; font-weight: 800; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub { color: var(--muted); font-size: 13px; font-weight: 500; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .late { flex: none; display: flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px; border-radius: 14px; font-size: 13px; font-weight: 700; line-height: 1; }
  .late i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
  .late.ok { color: var(--ontime); background: var(--ok-bg); }
  .late.late { color: var(--late1); background: var(--warn-bg); }
  .late.bad { color: var(--late3); background: var(--bad-bg); }
  .sp { flex: 1; }
  .acts { flex: none; display: flex; gap: 8px; }
  .acts button { display: flex; align-items: center; justify-content: center; gap: 8px; height: 40px; padding: 0 16px; border: 0; border-radius: 20px;
    font: inherit; font-size: 14px; font-weight: 700; line-height: 1; cursor: pointer; }
  .go { background: var(--accent); color: var(--on-accent); }
  .sec { background: var(--control); color: var(--fg); font-weight: 600 !important; }
  .sec:hover { background: var(--control-hover); }
  .x { flex: none; display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; padding: 0; border: 0; border-radius: 50%;
    background: var(--control); color: var(--fg); cursor: pointer; }

  /* A stop: its dot on the line, its name, its minutes and time. The line runs through the dots (each stop draws its
     own stretch to the next). */
  .strip, .row { display: flex; margin: 0; padding: 0; list-style: none; }
  .stop { position: relative; flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 8px; padding-right: 10px; }
  .stop::before { content: ""; position: absolute; left: 14px; right: -14px; top: 13px; height: 4px; background: var(--c); }
  .stop.past::before { background: var(--border); }
  .row .stop:last-child::before { display: none; }
  /* The last stop's own stretch: from its left edge to its square, dashed after the folded ones. */
  .stop.end::before { left: -2px; right: 14px; }
  .more + .stop.end::before { background: repeating-linear-gradient(90deg, var(--c) 0 8px, transparent 8px 14px); }
  .strip .stop:has(+ .more)::before { right: -40px; background: repeating-linear-gradient(90deg, var(--c) 0 8px, transparent 8px 14px); }
  .dot { position: relative; z-index: 1; flex: none; width: 14px; height: 14px; margin: 8px 0 0 8px; box-sizing: border-box; border-radius: 50%;
    background: var(--surface); border: 3px solid var(--c); }
  .first .dot { width: 18px; height: 18px; margin: 6px 0 0 6px; border-width: 4px; background: var(--fg); }
  .past { opacity: .55; }
  .past .dot { border-color: var(--muted); }
  .stop b { font-size: 14px; font-weight: 700; line-height: 1.15; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
  .first b { font-size: 15px; font-weight: 800; }
  .stop small { color: var(--muted); font-size: 12px; font-weight: 500; line-height: 1; }
  .when { display: flex; align-items: baseline; gap: 6px; }
  .when strong { font-size: 14px; font-weight: 800; line-height: 1; }
  .first .when strong { font-size: 15px; }
  .now { flex: 0 0 96px; }
  .now b { font-size: 13px; }
  .here { position: relative; z-index: 1; display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; box-sizing: border-box;
    border-radius: 50%; background: var(--c); border: 3px solid var(--border); color: var(--t); }
  /* t-: the delay's tone, prefixed (the app's .none and .late are colours of their own: a grey box). */
  .now.t-ok .here { border-color: var(--ontime); } .now.t-ok b { color: var(--ontime); }
  .now.t-late .here { border-color: var(--late1); } .now.t-late b { color: var(--late1); }
  .now.t-bad .here { border-color: var(--late3); } .now.t-bad b { color: var(--late3); }
  .end { align-items: flex-end; text-align: right; padding: 0; }
  /* The terminus: a disc in the line's colour with a finish flag, ringed in the panel's colour so the line ends at it. */
  .term { position: relative; z-index: 1; flex: none; display: flex; align-items: center; justify-content: center; width: 30px; height: 30px;
    box-sizing: border-box; border-radius: 50%; background: var(--c); color: var(--t); box-shadow: 0 0 0 3px var(--surface), 0 0 0 5px var(--c); }
  .term svg { display: block; margin-left: 2px; }
  .end .term { margin: 0 2px 0 0; }
  .more { position: relative; flex: 0 0 auto; display: flex; justify-content: center; padding: 0 12px; }
  .more::before { content: ""; position: absolute; left: 0; right: 0; top: 13px; height: 4px;
    background: repeating-linear-gradient(90deg, var(--c) 0 8px, transparent 8px 14px); }
  .more button { position: relative; z-index: 1; display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border: 1px solid var(--border);
    border-radius: 15px; background: var(--control); color: var(--fg); font: inherit; font-size: 13px; font-weight: 700; line-height: 1; cursor: pointer; white-space: nowrap; }
  .more button:hover { background: var(--control-hover); }

  .openhead { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .openhead b { color: var(--muted); font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; line-height: 1; }
  .openhead button { display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border: 1px solid var(--border); border-radius: 15px;
    background: var(--control); color: var(--fg); font: inherit; font-size: 13px; font-weight: 700; line-height: 1; cursor: pointer; }
  .rowwrap { position: relative; display: flex; min-width: 0; }
  .row { flex: 1; min-width: 0; overflow-x: auto; overscroll-behavior: contain; padding-bottom: 10px; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
  .row::-webkit-scrollbar { height: 6px; }
  .row::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
  .row::-webkit-scrollbar-track { background: transparent; margin-inline: 8px; }
  .row .stop { flex: 0 0 112px; }
  .row .now { flex: 0 0 80px; }
  .row .stop:nth-last-child(1)::before { display: block; right: -40px; }
  .rowwrap::after { content: ""; position: absolute; right: 120px; top: 0; bottom: 10px; width: 36px; pointer-events: none;
    background: linear-gradient(90deg, transparent, var(--surface)); }
  .pin { flex: 0 0 120px; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; padding-left: 10px; box-sizing: border-box;
    border-left: 1px solid var(--border); text-align: right; }
  .pin .term { margin: 0 2px 0 0; }
  .pin b { font-size: 14px; font-weight: 800; line-height: 1.15; }
  .pin small { color: var(--muted); font-size: 12px; line-height: 1; }
  .foot { color: var(--muted); font-size: 12px; line-height: 1; }
  .note { margin: 0; color: var(--muted); font-size: 13px; }

  /* A phone: a sheet at the bottom; the delay under the title, the buttons at the foot; the strip without the passed
     stop, the folded count short. */
  @media (max-width: 719px) {
    .r3d { left: 12px; right: 12px; bottom: max(12px, env(safe-area-inset-bottom)); max-width: none; padding: 16px 16px 14px;
      border-radius: var(--sheet-r); gap: 14px; }
    /* line · title · ×, the delay under the title, the buttons across */
    header { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; grid-template-areas: "chip ttl x" ". late ." "acts acts acts";
      align-items: center; gap: 8px 12px; }
    .chip { grid-area: chip; }
    .ttl { grid-area: ttl; }
    .x { grid-area: x; width: 36px; height: 36px; }
    .late { grid-area: late; justify-self: start; height: 26px; margin-top: -2px; }
    .sp { display: none; }
    .acts { grid-area: acts; margin-top: 6px; }
    .acts button { flex: 1; height: 44px; border-radius: 22px; font-size: 15px; }
    .strip .past { display: none; }
    .strip .now { flex: 0 0 56px; }
    .strip .stop b { font-size: 13px; }
    .strip .more { padding: 0 6px; }
    .strip .more .long { display: none; }
    .strip .end small { display: none; }
    .rowwrap::after { right: 96px; }
    .pin { flex-basis: 96px; }
    .row .stop { flex-basis: 92px; }
  }
</style>
