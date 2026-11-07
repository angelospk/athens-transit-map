<script lang="ts">
  // The card of a tapped vehicle. A bus: from the line's live data (the stops ahead with their estimated
  // times, and a bell on each). A train, metro or tram: from /v2 (its run's stops ahead, a bell on each: web
  // push when this train nears that stop), asked again every 20 s.
  import { untrack } from "svelte";
  import { fetchV2Line, fetchV2LineVehicles, fetchV2Run } from "../api";
  import { upcomingStops } from "../eta";
  import { ageLabel, fmtDelay } from "../format";
  import { busStopCard, routeCard } from "../legacy";
  import { placeNote, stopIndex, toward } from "../stops";
  import { railHeads, type RailSpec } from "../railAlerts";
  import { freshness, headsignName, timesNote, nextStops, vehicleDir, type LineDetail, type V2Run, type V2Vehicle } from "../v2";
  import type { AppState } from "../state.svelte";
  import { cardQuery } from "../cards";
  import { clockHM } from "../trains";
  import { titleCase } from "../nearby";
  import { crowdOn, LOADS, loadLabel, loadOn, shareRide as sendFixes, type Load } from "../crowd";
  import LoadIcon from "./LoadIcon.svelte";
  import { open } from "../anim";
  import Bell from "./Bell.svelte";
  import Icon from "./Icon.svelte";
  import CardSheet, { whenText } from "./CardSheet.svelte";

  let { app }: { app: AppState } = $props();

  const top = $derived(app.stack.at(-1));
  const card = $derived(top?.kind === "vehicle" ? top : null);
  const isBus = $derived(!!card && card.id.startsWith("oasa:"));
  const isRail = $derived(!!card && !isBus && (card.id.startsWith("stasy:") || card.id.startsWith("proastiakos:")));
  const native = (id: string) => id.slice(id.indexOf(":") + 1);

  // ---- Bus: a city vehicle whose line is still loading is what the city layer knows, until the line's data arrives.
  const bus = $derived.by(() => {
    if (!isBus) return null;
    const c = app.selectedCity;
    const sv = app.selectedVehicle ?? (c && { line: c.line, faded: false, v: { ...c, route_code: "", trip_id: null, trip_label: null, next_stop_id: null } });
    if (!sv) return null;
    const st = app.statics[sv.line];
    const variant = sv.v.variant ? st?.variants[sv.v.variant] : undefined;
    return { line: sv.line, v: sv.v, variant, st };
  });
  const driven = $derived(bus?.st && bus.variant ? upcomingStops(bus.variant, bus.st.stops, bus.v).map(a => ({ ...a, name: titleCase(a.name) })) : []);
  // A bus at the start of its route is waiting there, not driving: the drive estimate would say «τώρα» for the first
  // stops. Its run's time at the start (/v2 runs: when it leaves) moves every time on by the wait. Asked every 30 s
  // while the bus is at the start.
  const startKey = $derived(isBus && card && bus && driven[0]?.i === 0 ? `${card.line}|${bus.v.id}` : "");
  let leaveAt = $state<number | null>(null);
  $effect(() => {
    const k = startKey;
    leaveAt = null;
    if (!k) return;
    const [lineId, vid] = k.split("|");
    let timer: ReturnType<typeof setTimeout> | undefined, dead = false;
    const load = async () => {
      const r = await fetchV2LineVehicles(lineId);
      const v = r.status === 200 ? ((r.body as { vehicles?: V2Vehicle[] }).vehicles ?? []).find(x => x.id === `oasa:${vid}`) : undefined;
      const rr = v?.run && !dead ? await fetchV2Run(v.run) : null;
      if (dead) return;
      const s0 = rr?.status === 200 ? (rr.body as { run?: V2Run } | null)?.run?.stops?.[0] : undefined;
      leaveAt = s0 && !s0.passed ? s0.at : null;
      timer = setTimeout(load, 30_000);
    };
    void load();
    return () => { dead = true; clearTimeout(timer); };
  });
  const ahead = $derived.by(() => {
    const wait = leaveAt != null && driven.length ? Math.max(0, leaveAt - driven[0].at) : 0;
    return wait > 30 ? driven.map(a => ({ ...a, at: a.at + wait })) : driven;
  });
  const waitMin = $derived(leaveAt != null ? Math.round((leaveAt * 1000 - app.serverNow) / 60_000) : null);
  const headParts = $derived(placeNote(bus?.variant?.headsign ? toward(bus.variant.headsign) : ""));
  const busHead = $derived(titleCase(headParts.place));
  // The note in the headsign's brackets ("ΠΡΟΣΩΡΙΝΗ ΛΟΓΩ ΕΡΓΩΝ"), as a sentence.
  const headNote = $derived(headParts.note ? headParts.note[0] + headParts.note.slice(1).toLocaleLowerCase("el") : "");
  const busAge = $derived(bus ? app.serverNow / 1000 - bus.v.position_at : 0);
  // An old position (the server got nothing new for 2 min): a time it puts in the past is not «τώρα» but unknown.
  const busStale = $derived(busAge > 120);

  // The alert form at one of those stops (AlertForm, loaded on the first bell): the stop's id and its place.
  let alertAt = $state.raw<{ id: string; i: number; from: number | null; name: string; line: string; variant: string } | null>(null);
  $effect(() => { void card?.id; alertAt = null; });
  async function bellAt(a: { id: string; i: number; name: string }) {
    const variant = bus?.v.variant;
    if (!bus || !variant || (alertAt?.id === a.id && alertAt.i === a.i)) { alertAt = null; return; }
    const at = { id: a.id, i: a.i, name: a.name, line: bus.line, variant };
    alertAt = { ...at, from: null };
    const ix = await app.loadStops();
    if (alertAt?.id !== a.id || alertAt.i !== a.i) return;
    alertAt = { ...at, from: ix ? stopIndex(ix, a.id) : -1 };
  }
  const sheetHs = $derived(alertAt ? app.statics[alertAt.line]?.variants[alertAt.variant]?.headsign : undefined);

  // ---- How full this bus is, from its riders (/v2 `occupancy`, contract rev 21): asked every 30 s while the card is
  // open, where the crowd endpoint is set.
  let occ = $state.raw<{ level: Load; reports: number; at: number } | null>(null);
  const occKey = $derived(isBus && card && bus && loadOn() ? `${card.line}|${bus.v.id}` : "");
  $effect(() => {
    const k = occKey;
    occ = null;
    if (!k) return;
    const [lineId, vid] = k.split("|");
    let timer: ReturnType<typeof setTimeout> | undefined, dead = false;
    const load = async () => {
      const r = await fetchV2LineVehicles(lineId);
      if (dead) return;
      const v = r.status === 200 ? ((r.body as { vehicles?: V2Vehicle[] }).vehicles ?? []).find(x => x.id === `oasa:${vid}`) : undefined;
      occ = v?.occupancy ?? null;
      timer = setTimeout(load, 30_000);
    };
    void load();
    return () => { dead = true; clearTimeout(timer); };
  });

  // Plain words for a delay: early, on time, or late (a minus sign reads as a typo).
  const lateWords = (d: number | null) => d == null ? "Χωρίς δρομολόγιο" : d >= 120 ? `Αργεί ${Math.round(d / 60)}′`
    : d <= -120 ? `${Math.round(-d / 60)}′ νωρίτερα` : "Στην ώρα του";

  // ---- Riding this bus: the stop the rider gets off at, how many stops are left, a buzz one stop before, a link to send.
  const riding = $derived(!!bus && app.ride?.line === bus.line && app.ride.vehicle === bus.v.id);
  const getOff = $derived(riding ? app.ride?.stop ?? null : null);
  const dest = $derived(getOff ? ahead.findIndex(a => a.id === getOff.id && a.i === getOff.i) : -1);
  const left = $derived(dest >= 0 ? dest + 1 : null);
  const destAt = $derived(dest >= 0 ? ahead[dest].at : null);
  // The stop the bus has just left (the one before its next on the variant).
  const passed = $derived.by(() => {
    const k = ahead[0]?.i, id = bus?.variant && k != null && k > 0 ? bus.variant.stops[k - 1] : undefined;
    return id && bus?.st ? titleCase(bus.st.stops[id]?.name ?? "") : "";
  });

  function board() {
    if (!bus) return;
    app.startRide(bus.line, bus.v.id);   // the map stays as it was: 3D follow is the rider's choice (the cube below)
  }
  function offAt(a: { id: string; i: number; name: string }) {
    if (app.ride) app.ride = { ...app.ride, stop: { id: a.id, i: a.i, name: a.name }, buzzed: false };
    if (app.rideBuzz && "Notification" in window && Notification.permission === "default") void Notification.requestPermission();
  }

  // The rider's position for the crowd endpoint, while riding and allowed (only one ride at a time).
  const crowd = crowdOn();
  // Keyed by the bus, not its data: each new position must not start another ride.
  const rideBus = $derived(riding && bus ? { line: bus.line, id: bus.v.id } : null);
  const rideKey = $derived(rideBus ? `${rideBus.line}/${rideBus.id}` : "");
  $effect(() => {
    if (!crowd || !rideKey || !app.rideShare) return;
    const { line, id } = untrack(() => rideBus!);
    const rid = untrack(() => app.ride!.rid);
    return untrack(() => sendFixes(rid, line, id, () => (bus && bus.v.id === id ? [bus.v.lat, bus.v.lon] : null)));
  });

  async function shareRide() {
    if (!card) return;
    const url = location.origin + location.pathname + cardQuery(card, []);
    const text = `Είμαι στο ${native(card.line)}` + (getOff && destAt ? `, φτάνω ${getOff.name} γύρω στις ${clockHM(destAt)}` : "");
    try {
      if (navigator.share) { await navigator.share({ text, url }); return; }
    } catch (e) { if ((e as Error).name === "AbortError") return; }
    try { await navigator.clipboard.writeText(`${text} ${url}`); app.notify("Ο σύνδεσμος αντιγράφηκε"); }
    catch { app.notify("Δεν έγινε η αποστολή"); }
  }

  // ---- Rail
  type Ahead = { stop: string; at: number; live: boolean; platform: string | null };
  let rail = $state.raw<{ detail: LineDetail | null; vehicle: V2Vehicle | null; ahead: Ahead[]; state: "loading" | "ok" | "gone" | "error" }>(
    { detail: null, vehicle: null, ahead: [], state: "loading" });

  $effect(() => {
    if (!isRail || !card) return;
    const id = card.id, line = card.line;
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    untrack(() => { rail = { detail: null, vehicle: null, ahead: [], state: "loading" }; });
    const load = async () => {
      if (document.visibilityState !== "hidden") {
        const [lr, vr] = await Promise.all([fetchV2Line(line), fetchV2LineVehicles(line)]);
        if (ac.signal.aborted) return;
        const detail = lr.status === 200 && lr.body ? (lr.body as LineDetail) : rail.detail;
        if (vr.status !== 200 || !vr.body) {
          rail = { ...rail, detail, state: rail.state === "ok" ? "ok" : "error" };
        } else {
          const vehicle = ((vr.body as { vehicles?: V2Vehicle[] }).vehicles ?? []).find(x => x.id === id) ?? null;
          let ahead: Ahead[] = [];
          if (vehicle) {
            const rr = await fetchV2Run(vehicle.run ?? id);
            if (ac.signal.aborted) return;
            ahead = rr.status === 200 && rr.body ? nextStops((rr.body as { run: V2Run }).run) : rail.ahead;
          }
          rail = { detail, vehicle, ahead, state: vehicle ? "ok" : "gone" };
        }
      }
      timer = setTimeout(load, 20_000);
    };
    void load();
    return () => { ac.abort(); clearTimeout(timer); };
  });

  const railLabel = $derived(rail.detail?.line.label ?? rail.detail?.line.name ?? (card ? native(card.line) : ""));
  const railHead = $derived(rail.vehicle ? headsignName(rail.vehicle.headsign, rail.detail?.stops) : "");
  const railFresh = $derived(rail.vehicle ? freshness(rail.vehicle, app.serverNow / 1000) : null);
  const note = $derived(timesNote(rail.ahead));

  // The rail alert sheet at one of the stops ahead: this train when it has a run, else its line and direction.
  let railAt = $state.raw<Omit<RailSpec, "min" | "until"> | null>(null);
  $effect(() => { void card?.id; railAt = null; });
  function railBell(stop: string, name: string) {
    const v = rail.vehicle;
    if (!v || !card || railAt?.stop === stop) { railAt = null; return; }
    const pats = rail.detail?.patterns ?? [];
    railAt = { stop, name, line: card.line, label: railLabel, toward: railHead, heads: railHeads(pats, vehicleDir(v, pats), v.headsign), ...(v.run ? { run: v.run } : {}) };
  }

  // The title of the card (the back button and the page title) once the data names it.
  $effect(() => {
    const label = isBus ? card && native(card.line) : isRail ? railLabel : "";
    const head = isBus ? busHead : railHead;
    if (label && head) untrack(() => app.retitle(`${label} → ${head}`));
  });

  const key = $derived(card ? `${card.id}` : "");
</script>

{#snippet label(text: string, bg: string, fg: string)}
  <span class="pill" style:--c={bg} style:--t={fg}>{text}</span>
{/snippet}

{#if card && isBus}
  {@const line = native(card.line)}
  <CardSheet {app} {key} closeOnEscape={!alertAt}>
    {#snippet header()}
      {@render label(line, app.lineColor(line).bg, app.lineColor(line).fg)}
      {#if riding && bus}
        <h2>Είσαι μέσα · #{bus.v.id}</h2>
        <span class="livedot" class:warn={busAge > 90} title={ageLabel(busAge)}></span>
      {:else}
        <span class="ht"><h2 class="wrap">{busHead ? `Προς ${busHead}` : titleCase(app.lineInfo.get(line)?.name ?? "")}</h2>
          <small>{app.lineInfo.get(line)?.kind === "trolley" ? "Τρόλεϊ" : "Λεωφορείο"}{bus ? ` · όχημα ${bus.v.id}` : ""}</small></span>
      {/if}
    {/snippet}
    {#if bus}
      {#if !riding}
        <!-- Its state in one strip (mockup 34): the delay in its colour, where it was last, when it ends -->
        {#if waitMin != null && waitMin >= 1}<p class="meta">Στην αφετηρία · φεύγει σε {waitMin}′</p>{/if}
        {@const d = bus.v.delay_s}
        {@const end = ahead.length ? ahead[ahead.length - 1].at : null}
        <div class="facts">
          <span><small>ΚΑΘΥΣΤΕΡΗΣΗ</small><b class:late={(d ?? 0) >= 120} class:ok={d != null && d < 120 && d > -120}>{d == null ? "—" : d >= 120 ? `+${Math.round(d / 60)}′` : d <= -120 ? `−${Math.round(-d / 60)}′` : "Στην ώρα"}</b></span>
          <span><small>ΘΕΣΗ</small><b class:warn={busAge > 90}>πριν {ageLabel(busAge)}</b></span>
          <span><small>{end ? "ΤΕΡΜΑ" : "ΟΧΗΜΑ"}</small><b>{end ? clockHM(end) : bus.v.id}</b></span>
        </div>
        {#if headNote}
          <p class="detour"><Icon name="warn" size={15} /><span><b>{headNote}</b>{busHead ? `: η διαδρομή προς ${busHead} μπορεί να διαφέρει.` : ""}</span></p>
        {/if}
        {#if occ}
          <span class="occ {occ.level}" title="Από {occ.reports} {occ.reports === 1 ? 'επιβάτη' : 'επιβάτες'}, πριν {Math.max(1, Math.round((app.serverNow / 1000 - occ.at) / 60))}′">
            <LoadIcon level={LOADS.find(x => x.value === occ!.level)?.level ?? 0} size={11} /><span>{loadLabel(occ.level)}</span></span>
        {/if}
      {/if}
      {#if riding}
        <section class="ride" aria-live="polite" in:open>
          {#if getOff && left != null}
            {@const mins = destAt != null ? Math.max(0, Math.round((destAt * 1000 - app.serverNow) / 60_000)) : null}
            <div class="rhead">
              <div class="rl"><span>Κατεβαίνεις {left === 1 ? "στην" : "σε"}</span><b>{left === 1 ? "επόμενη" : `${left} στάσεις`}</b></div>
              <div class="rr"><b>{getOff.name}</b>{#if destAt}<span>{clockHM(destAt)}{mins != null ? ` · σε ${mins}′` : ""}</span>{/if}</div>
            </div>
            <!-- The stops left: the one just passed, the next, (how many between), and the rider's own. -->
            <ol class="left" aria-label="Οι στάσεις ως την κάθοδο">
              {#if passed}<li class="done"><span class="ic"><Icon name="check" size={12} /></span><span class="n">{passed}</span></li>{/if}
              {#if dest > 0}
                <li class="nx"><span class="ic"><i></i></span><span class="n">{ahead[0].name}</span><span class="w">{whenText(ahead[0].at, app.serverNow)}</span></li>
              {/if}
              {#if dest > 1}<li class="gap"><span class="ic"></span><span class="n">{dest - 1 === 1 ? "και 1 στάση ακόμα" : `και ${dest - 1} στάσεις ακόμα`}</span></li>{/if}
              <li class="dst"><span class="ic"><Icon name="down" size={12} /></span><span class="n">{getOff.name} · πάτα STOP {left === 1 ? "τώρα" : "εδώ"}</span>
                <span class="w">{whenText(ahead[dest].at, app.serverNow)}</span></li>
            </ol>
            <button type="button" class="opt" role="switch" aria-checked={app.rideBuzz} onclick={() => app.setRideBuzz(!app.rideBuzz)}>
              <span class="oic amber"><Icon name="vibrate" size={16} /></span>
              <span class="otx"><b>Δόνηση μία στάση πριν</b><small>Και με την κάρτα κλειστή</small></span>
              <span class="sw" class:on={app.rideBuzz} aria-hidden="true"><i></i></span>
            </button>
          {:else}
            <div class="rhead">
              <div class="rl"><span>Είσαι μέσα</span><b class="sm">Πού κατεβαίνεις;</b></div>
            </div>
            <p class="pick">Πάτα «Κάθοδος» στη στάση σου: θα σου πω πότε να πατήσεις STOP.</p>
          {/if}
          <!-- How full the bus is: the rider's word, for the others waiting (crowd.ts) -->
          <div class="loadq" role="group" aria-label="Πόσο γεμάτο είναι το λεωφορείο">
            <span class="lq">Πόσο γεμάτο είναι;</span>
            <div class="lopts">
              {#each LOADS as o (o.value)}
                <button type="button" class="lopt {o.value}" aria-pressed={app.ride?.load === o.value} onclick={() => app.setRideLoad(o.value)}>
                  <LoadIcon level={o.level} size={14} /><span>{o.label}</span>
                </button>
              {/each}
            </div>
          </div>
          {#if crowd}
            <div class="crowd" class:on={app.rideShare}>
              <span class="oic green"><Icon name="shield" size={16} /></span>
              <span class="otx"><b>{app.rideShare ? "Βοηθάς όσους περιμένουν" : "Βοήθα όσους περιμένουν"}</b><small>{app.rideShare ? `Διορθώνεις το #${bus.v.id} · ανώνυμα` : "Η θέση σου διορθώνει το λεωφορείο · ανώνυμα"}</small></span>
              <button type="button" class="cbtn" aria-pressed={app.rideShare} onclick={() => app.setRideShare(!app.rideShare)}>{app.rideShare ? "Σταμάτα" : "Βοήθα"}</button>
            </div>
          {/if}
          <div class="row2">
            <button type="button" class="act" onclick={shareRide}><Icon name="share" size={17} />Στείλε πότε φτάνω</button>
            <button type="button" class="act quiet" onclick={() => app.endRide()}>Τέλος</button>
            {#if bus}
              {@const ck = `${bus.line}/${bus.v.id}`}
              <button type="button" class="act quiet sq" class:on3d={app.chase === ck} aria-pressed={app.chase === ck}
                aria-label={app.chase === ck ? "Σταμάτα το 3D" : "Ακολούθησε σε 3D"} title={app.chase === ck ? "Σταμάτα το 3D" : "Ακολούθησε σε 3D"}
                onclick={() => app.setChase(app.chase === ck ? null : ck)}><Icon name="cube" size={18} /></button>
            {/if}
            <button type="button" class="act quiet sq" aria-label="Μικρή μπάρα: δες τον χάρτη" title="Μικρή μπάρα" onclick={() => app.minimizeRide()}><Icon name="down" size={18} /></button>
          </div>
        </section>
      {/if}
      {#if ahead.length && !getOff}
        <p class="note" class:warn={busStale}>{busStale ? `Καμία νέα θέση εδώ και ${Math.round(busAge / 60)}′· οι ώρες μπορεί να μην ισχύουν` : "ώρες κατά προσέγγιση"}</p>
        <ol class="ahead listscroll" aria-live="polite" aria-label="Επόμενες στάσεις">
          {#each ahead as a, k (a.id + "/" + a.i)}
            <li class:next={k === 0} class:dest={k === dest} class:past={dest >= 0 && k > dest}>
              <span class="t">{busStale && a.at * 1000 <= app.serverNow ? "—" : whenText(a.at, app.serverNow)}<small>{clockHM(a.at)}</small></span><button type="button" class="name" title="Η στάση {a.name}" onclick={() => app.push(busStopCard(a.id, a.name))}>{a.name}</button>
              {#if riding && k === dest}
                <button type="button" class="off on" aria-label="Άλλαξε στάση καθόδου (τώρα {a.name})"
                  onclick={() => app.ride && (app.ride = { ...app.ride, stop: null, buzzed: false })}><Icon name="check" size={14} />Κάθοδος</button>
              {:else if riding && dest < 0}
                <button type="button" class="off" aria-label="Κατεβαίνω στη στάση {a.name}" onclick={() => offAt(a)}>Κάθοδος</button>
              {:else if !riding && app.cityInfo.alerts}
                <button type="button" class="bell" class:on={alertAt?.id === a.id && alertAt.i === a.i} aria-expanded={alertAt?.id === a.id && alertAt.i === a.i}
                  title="Ειδοποίηση άφιξης σε αυτή τη στάση" aria-label="Ειδοποίηση άφιξης του {line} στη στάση {a.name}"
                  onclick={() => bellAt(a)}><Bell /></button>
              {/if}
            </li>
            {#if alertAt?.id === a.id && alertAt.i === a.i && (alertAt.from == null || alertAt.from < 0)}
              <li class="alert"><p class="muted">{alertAt.from == null ? "Φόρτωση…" : "Αυτή η στάση δεν είναι στα δεδομένα στάσεων."}</p></li>
            {/if}
          {/each}
        </ol>
      {:else if !bus.variant}
        <p class="muted">Φόρτωση δρομολογίου…</p>
      {/if}
    {:else if !app.live[line]}
      <!-- The line's data is not in yet (with the city layer off, nothing else knows the vehicle): not gone. -->
      <p class="muted">Φόρτωση…</p>
    {:else}
      <p class="muted">Το όχημα δεν είναι πια στον χάρτη.</p>
    {/if}
    {#if bus && !riding}
      {@const key = `${bus.line}/${bus.v.id}`}
      <div class="row2">
        {#if !riding && ahead.length}
          <button type="button" class="act" onclick={board}><Icon name="check" size={17} />Είμαι μέσα</button>
        {/if}
        <button type="button" class="act" class:quiet={!riding && ahead.length > 0 || app.chase === key} aria-pressed={app.chase === key}
          onclick={() => app.setChase(app.chase === key ? null : key)}>
          <Icon name="cube" size={17} />{app.chase === key ? "Σταμάτα το 3D" : "Δες το σε 3D"}
        </button>
      </div>
    {/if}
    {#if !riding}
      <button type="button" class="foot" onclick={() => app.push(bus?.v.variant ? routeCard(line, bus.v.variant) : { kind: "line", id: card.line, title: line })}>
        Όλη η γραμμή {line} · δρομολόγια και στάσεις <span aria-hidden="true">›</span>
      </button>
    {/if}
  </CardSheet>
{:else if card && isRail}
  <CardSheet {app} {key} closeOnEscape={!railAt}>
    {#snippet header()}
      {@render label(railLabel, rail.detail?.line.color ?? "#3b5bdb", rail.detail?.line.text_color ?? "#ffffff")}
      <h2>{railHead ? `→ ${railHead}` : ""}</h2>
      {#if railFresh}<span class="fresh" class:warn={railFresh.warn}>{railFresh.text}</span>{/if}
    {/snippet}
    {#if rail.state === "loading"}
      <p class="muted">Φόρτωση…</p>
    {:else if rail.state === "error"}
      <p class="muted">Δεν φόρτωσαν τα στοιχεία. Δοκίμασε ξανά.</p>
    {:else if rail.state === "gone"}
      <p class="muted">Το όχημα δεν είναι πια σε δρομολόγιο.</p>
    {:else}
      {#if rail.vehicle && (rail.vehicle.delay_s !== null || rail.vehicle.label)}
        <p class="meta">{[rail.vehicle.delay_s !== null ? fmtDelay(rail.vehicle.delay_s) : "", rail.vehicle.label ? `#${rail.vehicle.label}` : ""].filter(Boolean).join(" · ")}</p>
      {/if}
      {#if rail.ahead.length}
        {#if note}<p class="note">{note}</p>{/if}
        <ol class="ahead listscroll" aria-live="polite" aria-label="Επόμενες στάσεις">
          {#each rail.ahead as a, k (a.stop + "/" + k)}
            {@const nm = rail.detail?.stops[a.stop]?.name ?? a.stop}
            <li class:next={k === 0} class:sched={!a.live}>
              <span class="t">{whenText(a.at, app.serverNow)}</span><button type="button" class="name" title="Η στάση {nm}" onclick={() => app.push({ kind: "stop", id: a.stop, title: nm })}>{nm}</button>
              {#if a.platform}<span class="plat">Αποβ. {a.platform}</span>{/if}
              <button type="button" class="bell" class:on={railAt?.stop === a.stop} aria-expanded={railAt?.stop === a.stop}
                title="Ειδοποίηση άφιξης σε αυτή τη στάση" aria-label="Ειδοποίηση άφιξης του {railLabel} στη στάση {nm}"
                onclick={() => railBell(a.stop, nm)}><Bell /></button>
            </li>
          {/each}
        </ol>
      {/if}
    {/if}
    <button type="button" class="foot" onclick={() => app.push({ kind: "line", id: card.line, title: railLabel })}>
      Γραμμή {railLabel} <span aria-hidden="true">›</span>
    </button>
  </CardSheet>
{/if}

{#if alertAt && alertAt.from != null && alertAt.from >= 0}
  {@const a = alertAt}
  {@const from = alertAt.from}
  {#await import("./AlertSheet.svelte") then m}
    <m.default {app} label={a.name} line={a.line} toward={sheetHs ? toward(sheetHs) : undefined} onclose={() => (alertAt = null)}
      lines={[{ line: a.line, variants: [{ id: a.variant, i: a.i, from }] }]} />
  {/await}
{/if}

{#if railAt}
  {@const a = railAt}
  {#await import("./AlertSheet.svelte") then m}
    <m.default {app} rail={a} color={{ bg: rail.detail?.line.color ?? "#3b5bdb", fg: rail.detail?.line.text_color ?? "#ffffff" }}
      label={a.name} line={a.label} toward={a.toward} onclose={() => (railAt = null)} />
  {/await}
{/if}

<style>
  .ht { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .ht small { color: var(--muted); font-size: 12px; font-weight: 500; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .muted { margin: 4px 0; color: var(--muted); font-size: 13px; }
  .meta { display: inline-flex; align-items: center; height: 26px; margin: 0 0 6px; padding: 0 10px; border-radius: 13px; background: var(--control);
    font-size: 12px; font-weight: 600; line-height: 1; color: var(--muted); font-variant-numeric: tabular-nums; }
  .note { margin: 8px 0 6px; font-size: 12px; color: var(--muted); }
  /* The state strip, and a detour as a notice. */
  .facts { display: flex; margin: 0 0 10px; border-radius: 16px; background: var(--card); overflow: hidden; }
  .facts > span { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; padding: 10px 12px; }
  .facts > span + span { border-left: 1px solid var(--card-border); }
  .facts small { font-size: 10px; font-weight: 800; letter-spacing: .05em; color: var(--muted); line-height: 1; }
  .facts b { font-size: 15px; font-weight: 800; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
  .facts b.late { color: var(--late3); } .facts b.ok { color: var(--ontime); } .facts b.warn { color: var(--late1); }
  .detour { display: flex; align-items: center; gap: 10px; margin: 0 0 10px; padding: 10px 12px; border-radius: 14px; font-size: 12.5px; line-height: 1.35;
    background: color-mix(in srgb, #f0ae45 11%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, #f0ae45 30%, transparent); color: var(--fg); }
  .detour :global(svg) { flex: none; color: #f0ae45; }
  .note.warn { color: var(--late3); }
  /* The stops ahead as a timeline: a rail on the left with a node per stop; the next stop is the filled one. */
  .ahead { list-style: none; margin: 4px 0 0; padding: 0; }
  /* Only the stops scroll (CardSheet keeps the rest of the card still): the bar sits beside them, in the card. */
  .ahead.listscroll { flex: 0 1 auto; min-height: 126px; overflow-y: auto; overscroll-behavior: contain; margin-right: -10px; padding-right: 6px; }
  .ahead.listscroll::-webkit-scrollbar { width: 6px; }
  .ahead.listscroll::-webkit-scrollbar-track { margin-block: 6px; }
  .ahead.listscroll::-webkit-scrollbar-thumb { border-width: 1px; min-height: 30px; }
  .ahead li { position: relative; display: flex; align-items: center; gap: 10px; min-height: 42px; padding-left: 26px; font-size: 14px; }
  .ahead li:not(.alert)::before { content: ""; position: absolute; left: 8px; top: 0; bottom: 0; width: 4px; border-radius: 2px;
    background: var(--border); }
  .ahead li:not(.alert):first-child::before { top: 50%; }
  .ahead li:not(.alert):last-of-type::before { bottom: 50%; }
  .ahead li:not(.alert)::after { content: ""; position: absolute; left: 4px; top: 50%; width: 12px; height: 12px; margin-top: -6px;
    border-radius: 50%; border: 3px solid var(--accent); background: var(--surface); box-sizing: border-box; }
  .ahead li.next::after { background: var(--accent); box-shadow: 0 0 0 4px var(--accent-bg); }
  .ahead li.next .name { font-weight: 700; }
  .ahead li:not(.sched) .t { font-weight: 700; }
  .ahead li.sched { color: var(--muted); }
  .ahead .t { flex: none; min-width: 48px; display: flex; flex-direction: column; gap: 2px; font-variant-numeric: tabular-nums; line-height: 1.05; }
  .ahead .t small { font-size: 10.5px; font-weight: 500; color: var(--muted); }
  .ahead .name { flex: 1; min-width: 0; min-height: 42px; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left;
    cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ahead .name:hover { text-decoration: underline; text-underline-offset: 3px; }
  .ahead .plat { flex: none; display: inline-flex; align-items: center; height: 22px; padding: 0 8px; border-radius: 11px; background: var(--control);
    font-size: 11px; font-weight: 600; line-height: 1; }
  .ahead li.alert { display: block; margin: 2px 0 8px; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--control); font-weight: 400; }
  .bell { flex: none; display: grid; place-items: center; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 50%; background: none;
    color: var(--muted); cursor: pointer; }
  .bell:hover { background: var(--control); color: var(--fg); }
  .bell.on { background: var(--accent-bg); color: var(--accent); }
  .bell:not(.on) { opacity: .5; }
  .bell:not(.on):hover { opacity: 1; }
  /* Two pill buttons side by side (one fills the row when alone). */
  .row2 { display: flex; gap: 8px; margin-top: 12px; }
  .act { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: center; gap: 8px; height: 48px; padding: 0 14px; border: 0;
    border-radius: 24px; background: var(--accent); color: var(--on-accent); font: inherit; font-size: 14px; font-weight: 700; line-height: 1;
    white-space: nowrap; cursor: pointer; }
  .act.quiet { background: var(--card); color: var(--fg); box-shadow: inset 0 0 0 1px var(--card-border); }
  .act:hover { filter: brightness(1.05); }
  .act:focus-visible, .off:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  /* On board (the mockup's ride sheet): stops left and the stop, the stops between, the buzz switch, the crowd row. */
  .ride { display: flex; flex-direction: column; gap: 14px; margin: 2px 0 12px; }
  .ride .row2 { margin-top: 2px; }
  .ride .act.quiet { flex: none; padding: 0 16px; }
  .ride .act.sq { width: 48px; padding: 0; }
  .ride .act.sq.on3d { background: var(--accent); color: var(--on-accent); box-shadow: none; }
  .rhead { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
  .rl { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .rl span { font-size: 13px; font-weight: 600; line-height: 1; color: var(--muted); }
  .rl b { font-size: 40px; font-weight: 800; letter-spacing: -1px; line-height: .95; white-space: nowrap; }
  .rl b.sm { font-size: 26px; letter-spacing: -.5px; }
  .rr { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; min-width: 0; text-align: right; }
  .rr b { max-width: 160px; font-size: 16px; font-weight: 700; line-height: 1.1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rr span { font-size: 13px; line-height: 1; color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .pick { margin: 0; font-size: 14px; line-height: 1.35; color: var(--muted); }
  .left { list-style: none; margin: 0; padding: 6px 14px; border-radius: 18px; background: var(--card); border: 1px solid var(--card-border); }
  .left li { height: 40px; display: flex; align-items: center; gap: 12px; font-size: 14px; line-height: 1; }
  .left .ic { flex: none; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; border-radius: 50%; }
  .left .n { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .left .w { flex: none; font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .left .done { color: var(--none); }
  .left .done .ic { background: var(--control); color: var(--muted); }
  .left .nx .n { font-weight: 600; }
  .left .nx .ic { background: var(--accent); }
  .left .nx .ic i { width: 8px; height: 8px; border-radius: 50%; background: #fff; }
  .left .gap { height: 28px; font-size: 12px; color: var(--muted); }
  .left .dst .ic { background: var(--late1); color: #1a1206; }
  .left .dst .n { font-weight: 700; }
  .left .dst .w { font-weight: 700; color: var(--late1); }
  .opt, .crowd { width: 100%; min-height: 56px; display: flex; align-items: center; gap: 12px; padding: 10px 12px 10px 14px; box-sizing: border-box;
    border-radius: 18px; background: var(--card); border: 1px solid var(--card-border); color: var(--fg); font: inherit; text-align: left; }
  .opt { cursor: pointer; }
  .opt:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .oic { flex: none; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 50%; }
  .oic.amber { background: color-mix(in srgb, var(--late1) 16%, transparent); color: var(--late1); }
  .oic.green { background: color-mix(in srgb, var(--ontime) 18%, transparent); color: var(--ontime); }
  .otx { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
  .otx b { font-size: 14px; font-weight: 600; line-height: 1.1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .otx small { font-size: 12px; line-height: 1.1; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sw { flex: none; position: relative; width: 46px; height: 28px; border-radius: 14px; background: var(--border); transition: background .15s; }
  .sw i { position: absolute; left: 3px; top: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; transition: transform .15s; }
  .sw.on { background: var(--accent); }
  .sw.on i { transform: translateX(18px); }
  .meta.late { background: color-mix(in srgb, var(--late3) 14%, var(--control)); color: var(--late3); }
  .meta.quiet { background: none; padding: 0 2px; }
  .meta.quiet.warn { color: var(--late3); }
  .occ { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border-radius: 13px; font-size: 12px; font-weight: 700;
    line-height: 1; white-space: nowrap; background: color-mix(in srgb, var(--t) 14%, transparent); color: var(--t); }
  .occ.empty { --t: var(--ontime); } .occ.some { --t: var(--late1); } .occ.full { --t: var(--late3); }
  /* Fullness: three equal options, the chosen one in its tone (green, amber, red). */
  .loadq { display: flex; flex-direction: column; gap: 10px; }
  .lq { font-size: 13px; font-weight: 600; line-height: 1; color: var(--muted); }
  .lopts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .lopt { min-width: 0; height: 64px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; padding: 0 6px;
    border: 1px solid var(--card-border); border-radius: 16px; background: var(--card); color: var(--muted); font: inherit; font-size: 12px;
    font-weight: 700; line-height: 1; cursor: pointer; }
  .lopt span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lopt:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .lopt.empty[aria-pressed="true"] { --t: var(--ontime); }
  .lopt.some[aria-pressed="true"] { --t: var(--late1); }
  .lopt.full[aria-pressed="true"] { --t: var(--late3); }
  .lopt[aria-pressed="true"] { border-color: color-mix(in srgb, var(--t) 55%, transparent); background: color-mix(in srgb, var(--t) 14%, var(--card)); color: var(--t); }
  .crowd.on { background: color-mix(in srgb, var(--ontime) 10%, var(--card)); border-color: color-mix(in srgb, var(--ontime) 28%, transparent); }
  .cbtn { flex: none; height: 30px; display: flex; align-items: center; justify-content: center; padding: 0 12px; border-radius: 15px;
    border: 1px solid color-mix(in srgb, var(--ontime) 40%, transparent); background: none; color: var(--ontime); font: inherit; font-size: 12px;
    font-weight: 700; line-height: 1; white-space: nowrap; cursor: pointer; }
  .livedot { flex: none; width: 8px; height: 8px; margin-right: 4px; border-radius: 50%; background: var(--ontime);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--ontime) 20%, transparent); }
  .livedot.warn { background: var(--late3); box-shadow: 0 0 0 4px color-mix(in srgb, var(--late3) 20%, transparent); }
  .off { flex: none; display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 30px; padding: 0 11px; border: 0;
    border-radius: 15px; background: var(--control); color: var(--fg); font: inherit; font-size: 12px; font-weight: 700; line-height: 1; cursor: pointer; }
  .off.on { background: var(--accent); color: var(--on-accent); }
  .ahead li.dest .name { font-weight: 700; }
  .ahead li.dest::after { background: var(--late3); border-color: var(--late3); }
  .ahead li.past { opacity: .45; }
  .foot { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 44px; margin-top: 12px; padding: 0 14px;
    border: 0; border-radius: var(--radius-sm); background: var(--control); color: var(--fg); font: inherit; font-size: 14px; font-weight: 600;
    line-height: 1; cursor: pointer; }
  .foot:hover { background: var(--control-hover); }
  .lopt, .act, .opt, .off, .cbtn { transition: background-color .2s, color .2s, border-color .2s, transform .12s; }
  .lopt:active, .act:active, .opt:active, .off:active, .cbtn:active { transform: scale(.96); }
  .lopt[aria-pressed="true"] :global(svg) { animation: bump .35s cubic-bezier(.34, 1.56, .64, 1); }
  @keyframes bump { 40% { transform: scale(1.25); } }
  .sw i { transition: transform .25s cubic-bezier(.34, 1.56, .64, 1); }
  .left li { animation: rowIn .3s cubic-bezier(.2, .8, .2, 1) both; }
  .left li:nth-child(2) { animation-delay: .04s; } .left li:nth-child(3) { animation-delay: .08s; } .left li:nth-child(4) { animation-delay: .12s; }
  @keyframes rowIn { from { transform: translateX(-8px); opacity: 0; } }
  .rl b { display: inline-block; animation: tickIn .45s cubic-bezier(.34, 1.56, .64, 1); }
  @keyframes tickIn { from { transform: translateY(8px); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) {
    .lopt, .act, .opt, .off, .cbtn, .sw i { transition: none; }
    .lopt[aria-pressed="true"] :global(svg), .left li, .rl b { animation: none; }
  }
</style>
