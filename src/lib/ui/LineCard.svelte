<script lang="ts">
  // The card of a line, any mode, from /v2: its two directions, the vehicles now of the chosen one and,
  // for a bus line, today's runs. The vehicles are asked again every 20 s while it is open.
  import { untrack } from "svelte";
  import { isBusId } from "../busNs";
  import { fetchSchedule, fetchV2Line, fetchV2LineVehicles, peekV2Line, peekV2LineVehicles } from "../api";
  import { fmtDelay } from "../format";
  import { HELD_MAX_MS, heldNote, refreshHeld, type Held } from "../held";
  import { vehiclePhrase } from "../liveQuality";
  import { busStopCard, busVehicleCard } from "../legacy";
  import { directionGroups } from "../directions";
  import { dirLabels, firstDir, headsignName, lineVehicleRows, withDirections, type LineDetail, type V2Vehicle } from "../v2";
  import type { AppState } from "../state.svelte";
  import CardSheet from "./CardSheet.svelte";
  import DisruptionRows from "./DisruptionRows.svelte";
  import { forLine } from "../disruptions";
  import Timetable from "./Timetable.svelte";
  import Icon from "./Icon.svelte";
  import LineChip from "./LineChip.svelte";
  import LineStop from "./LineStop.svelte";
  import { titleCase } from "../nearby";
  import { matchDirection, type Schedule } from "../timetable";
  import { lineQuality, shownDay, statsLineId, type DayWord, type QualityDay } from "../quality";
  import QualityPill from "./QualityPill.svelte";
  import StopStrip from "./StopStrip.svelte";
  import { stopStrip } from "../stopStrip";
  import type { Segment } from "../liveQuality";

  let { app }: { app: AppState } = $props();

  const top = $derived(app.stack.at(-1));
  const card = $derived(top?.kind === "line" && !top.id.startsWith("muni:") ? top : null);   // muni: MuniLineCard
  const native = (id: string) => id.slice(id.indexOf(":") + 1);

  let detail = $state.raw<LineDetail | null>(null);
  // The vehicles now (and the slow gaps, rev 23, Athens and Thessaloniki), as the last good answer: a refresh that
  // fails or says warming_up keeps them for up to HELD_MAX_MS (held.ts), with a note.
  type VehiclesNow = { vehicles: V2Vehicle[]; segments: Segment[] };
  const parseNow = (b: unknown): VehiclesNow | null => {
    const o = b as { vehicles?: unknown; segments?: unknown } | null;
    return o && Array.isArray(o.vehicles) ? { vehicles: o.vehicles as V2Vehicle[], segments: Array.isArray(o.segments) ? o.segments as Segment[] : [] } : null;
  };
  let held = $state.raw<Held<VehiclesNow> | null>(null);
  const vehicles = $derived(held?.value.vehicles ?? null);
  const segments = $derived(held?.value.segments ?? []);
  const note = $derived(heldNote(held, (void app.serverNow, Date.now())));   // serverNow ticks every second
  let stripList = $state(false);   // the strip's list of bunched vehicles is open: Escape closes it, not the card
  let failed = $state(false);
  let missing = $state(false);   // the backend does not know the line (404, a bad link): no more asking
  let vFailed = $state(false);
  const cardId = $derived(card?.id);

  // Back on a line seen a moment ago: its last data shows at once (vehicles up to 10 min old, with the note),
  // then a new load. The two loads are apart, so the patterns never wait for the vehicles.
  $effect(() => {
    const id = cardId;
    if (!id) return;
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    untrack(() => {
      const d = peekV2Line(id), v = peekV2LineVehicles(id);
      detail = (d?.body as LineDetail | undefined) ?? null;
      const now = parseNow(v?.body);
      // Older than a refresh cycle: it shows its age (the note) until the new load answers.
      held = v?.at && now && Date.now() - v.at < HELD_MAX_MS ? { value: now, at: v.at, failed: Date.now() - v.at > 30_000 } : null;
      failed = false; missing = false; vFailed = false;
    });
    const load = async () => {
      if (document.visibilityState !== "hidden") {
        await Promise.all([
          fetchV2Line(id).then(r => {
            if (ac.signal.aborted) return;
            if (r.status === 200 && r.body) detail = r.body as LineDetail;
            failed = !detail;
            missing = !detail && r.status === 404;
          }),
          fetchV2LineVehicles(id).then(r => {
            if (ac.signal.aborted) return;
            held = refreshHeld(held, r, parseNow, r.at ?? Date.now());
            vFailed = held === null;
          }),
        ]);
        if (ac.signal.aborted) return;
      }
      if (!missing) timer = setTimeout(load, 20_000);
    };
    void load();
    return () => { ac.abort(); clearTimeout(timer); };
  });

  const nativeLine = $derived(card ? native(card.id) : "");
  const isBus = $derived(!!card && isBusId(card.id));
  // A bus line's directions come from its /v1 direction groups (withDirections), with their termini as labels.
  const groups = $derived(isBus && app.statics[nativeLine] ? directionGroups(app.statics[nativeLine]) : []);
  const patterns = $derived(withDirections(detail?.patterns ?? [], groups));
  const labels = $derived<(string | null)[]>(groups.length === 2 ? groups.map(g => g.to) : dirLabels(patterns, detail?.stops));
  const dir = $derived<0 | 1>(card?.dir ?? (card?.pattern ? patterns.find(p => p.id === card.pattern)?.direction : undefined) ?? firstDir(labels));
  const label = $derived(detail?.line.label ?? detail?.line.name ?? nativeLine);
  // Names with accents (titleCase): its list comes with the stop index, so the names are drawn again when it lands.
  // A bus line asks for the index anyway: its card shows the rider's stop (LineStop).
  const tc = $derived.by(() => { void app.stopIx; return (x: string | null | undefined) => titleCase(x ?? ""); });
  $effect(() => { if (isBus) void app.loadStops(); });
  // With the /v1 directions, a vehicle's own (OASA: 0) direction is no better than its pattern's: its headsign decides.
  const own = $derived(patterns === detail?.patterns ? vehicles : vehicles?.map(v => ({ ...v, direction: null })));
  const rows = $derived(detail && own ? lineVehicleRows(own, patterns, detail.stops, dir) : null);
  // Every stop of the direction with its vehicles on it (StopStrip); a vehicle that cannot be placed is listed under it.
  const strip = $derived(detail ? stopStrip(patterns, detail.stops, own ?? [], segments, dir) : null);

  // The raw headsign of the direction's most common pattern: what the day's timetable is matched on.
  const dirHeadsign = $derived.by(() => {
    const n = new Map<string, number>();
    for (const p of patterns) if (p.direction === dir) n.set(p.headsign, (n.get(p.headsign) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  });

  $effect(() => { if (detail) untrack(() => app.retitle(label)); });

  // Quality pill (lib/quality.ts): yesterday's day file (the day before's until it is written), fetched once for every card. A frequent line's
  // headways are per direction of the stats (OASA Go/Come, GTFS direction_id), which only the timetable
  // names: it is asked only for a line with headways, and its direction is matched on the headsign.
  let qShown = $state.raw<{ day: QualityDay; word: DayWord; date: string } | null>(null);
  const qDay = $derived(qShown?.day ?? null);
  $effect(() => {
    if (!isBus || !cardId) return;   // asked again per card: a file written meanwhile shows (one fetch per hour at most)
    let live = true;
    void shownDay().then(d => { if (live) qShown = d; });
    return () => { live = false; };
  });
  const qLine = $derived(card ? statsLineId(app.cityId, card.id) : "");
  const hasHeadways = $derived(Array.isArray(qDay?.headways?.by_line) && qDay.headways.by_line.some(h => h?.line === qLine));
  let qSched = $state.raw<Schedule | null>(null);
  $effect(() => {
    const l = nativeLine;
    qSched = null;
    if (!hasHeadways || !l) return;
    const ac = new AbortController();
    void fetchSchedule(l, AbortSignal.any([ac.signal, AbortSignal.timeout(10_000)])).then(r => {
      if (!ac.signal.aborted && r.status === 200 && Array.isArray((r.body as Schedule | null)?.directions)) qSched = r.body as Schedule;
    });
    return () => ac.abort();
  });
  const qDir = $derived(qSched && dirHeadsign ? matchDirection(qSched.directions, dirHeadsign)?.direction ?? null : null);
  const quality = $derived(isBus ? lineQuality(qDay, qLine, qDir) : null);

  let showTimes = $state(false);
  const color = $derived(isBus ? app.lineColor(nativeLine) : { bg: detail?.line.color ?? "#3b5bdb", fg: detail?.line.text_color ?? "#ffffff" });
  const starred = $derived(!!card && app.isFavLine(card.id));
  const disruptions = $derived(card ? forLine(app.disruptions, card.id, app.serverNow) : []);

  function open(v: V2Vehicle) {
    if (isBus) {
      app.push(busVehicleCard(nativeLine, native(v.id)));   // the map moves to the bus (MapView)
    } else {
      app.push({ kind: "vehicle", id: v.id, line: card!.id, title: `${label} → ${headsignName(v.headsign, detail?.stops)}` });
      app.flyTo([v.position.lon, v.position.lat]);
    }
  }
  // A bus line's map shows the chosen direction only (as a line opened from a stop does).
  function pick(d: 0 | 1) {
    const c = card!, g = groups[d];
    app.replaceTop({ ...c, dir: d, pattern: undefined });
    if (g && groups.length === 2) app.setFocus(nativeLine, g.variants);   // the segments are the two groups
  }
</script>

{#if card}
  <CardSheet {app} key={card.id} closeOnEscape={!stripList} starred={starred} starLabel={starred ? "Αφαίρεση από τις αγαπημένες" : "Προσθήκη στις αγαπημένες"}
    onstar={() => app.toggleFavLine({ id: card.id, label })}>
    {#snippet header()}
      {#if isBus}<LineChip {label} bg={color.bg} fg={color.fg} oasa={app.cityId === "athens"} />
      {:else}<span class="pill" style:--c={color.bg} style:--t={color.fg}>{label}</span>{/if}
      <h2 title={tc(detail?.line.name)}>{tc(detail?.line.name)}</h2>
    {/snippet}
    <DisruptionRows alerts={disruptions} />
    {#if missing}
      <p class="muted">Η γραμμή δεν βρέθηκε.</p>
    {:else if failed}
      <p class="muted">Δεν φόρτωσε η γραμμή. Δοκίμασε ξανά.</p>
    {:else if !detail}
      <p class="muted">Φόρτωση…</p>
    {:else}
      {#if quality && qShown}
        {#key card.id}<QualityPill q={quality} word={qShown.word} date={qShown.date} line={qLine} dir={qDir} limits={qDay?.origin_otp} />{/key}
      {/if}
      <div class="dirs" role="group" aria-label="Κατεύθυνση">
        {#each labels as l, d (d)}
          {#if l !== null}
            <button type="button" aria-pressed={dir === d} title={tc(l)} onclick={() => pick(d as 0 | 1)}><svg class="arr" viewBox="0 0 12 12" width="13" height="13" aria-hidden="true"><path d="M1 6h9.2M6.5 2.3 10.2 6 6.5 9.7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg><span>{tc(l)}</span></button>
          {/if}
        {/each}
      </div>
      {#if isBus && groups.length === 2}
        <LineStop {app} line={nativeLine} variants={groups[dir].variants} toward={groups[dir].to} />
      {/if}

      <h3 class="sub">Οχήματα τώρα{rows ? ` · ${rows.length}` : ""}</h3>
      {#if note}<p class="muted note" role="status">{note}</p>{/if}
      {#if strip}
        {#if !rows?.length}
          <p class="muted">{rows ? "Κανένα όχημα σε αυτή την κατεύθυνση τώρα." : vFailed ? "Δεν φόρτωσαν τα οχήματα. Νέα προσπάθεια σε λίγο." : "Φόρτωση…"}</p>
        {/if}
        <StopStrip bind:listOpen={stripList} {strip} stops={detail.stops} {color} {isBus} {tc} onvehicle={open}
          onstop={isBus ? (id, name) => app.push(busStopCard(native(id), name)) : undefined} />
      {/if}
      {@const rest = strip ? (rows ?? []).filter(r => strip.elsewhere.includes(r.vehicle)) : rows ?? []}
      {#if rest.length}
        {#if strip}<h3 class="sub">Εκτός διαδρομής</h3>{/if}
        <ul class="runs" aria-live="polite" aria-label="Τα οχήματα της κατεύθυνσης">
          {#each rest as r (r.id)}
            {@const ph = vehiclePhrase(r.vehicle.quality, r.delay_s)}
            <li><button type="button" onclick={() => open(r.vehicle)}>
              <span class="lab" title={r.label ? `Όχημα ${r.label}` : undefined}><Icon name={isBus ? "bus" : "dot"} size={16} /></span>
              <span class="next">{r.next ? tc(r.next) : "—"}</span>
              {#if ph}<span class="lvq lvt-{ph.level}">{ph.text}</span>
              {:else if r.delay_s !== null}<span class="delay">{fmtDelay(r.delay_s)}</span>{/if}
              <span aria-hidden="true" class="chev">›</span>
            </button></li>
          {/each}
        </ul>
      {:else if !strip}
        <p class="muted">{rows ? "Κανένα όχημα σε αυτή την κατεύθυνση τώρα." : vFailed ? "Δεν φόρτωσαν τα οχήματα. Νέα προσπάθεια σε λίγο." : "Φόρτωση…"}</p>
      {/if}

      <!-- frequency summary slot (option B, frequent.html): phase 3/4 -->

      {#if isBus}
        <button type="button" class="times" aria-expanded={showTimes} aria-controls="card-times" onclick={() => (showTimes = !showTimes)}>
          Δρομολόγια σήμερα <svg viewBox="0 0 12 8" width="9" height="6" aria-hidden="true" class={{ up: showTimes }}><path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
        {#if showTimes}
          <div id="card-times"><Timetable line={nativeLine} headsign={dirHeadsign} now={app.serverNow} /></div>
        {/if}
      {:else}
        <p class="muted">Το πρόγραμμα της ημέρας έρχεται σύντομα.</p>
      {/if}
    {/if}
  </CardSheet>
{/if}

<style>
  .muted { margin: 4px 0; color: var(--muted); font-size: 12px; }
  .dirs { display: flex; gap: 2px; padding: 2px; border-radius: 10px; background: var(--control); }
  .dirs button { flex: 1; min-width: 0; min-height: 36px; padding: 4px 8px; border: 0; border-radius: 8px; background: none; color: inherit;
    font: inherit; font-size: 13px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dirs button { display: flex; align-items: center; justify-content: center; gap: 5px; }
  .dirs button span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .arr { flex: none; }
  .dirs button[aria-pressed="true"] { background: var(--accent); color: #fff; font-weight: 600; }
  .sub { margin: 10px 0 2px; font-size: 12px; font-weight: 600; color: var(--muted); }
  .runs { list-style: none; margin: 0; padding: 0; }
  .runs button { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 36px; padding: 0 4px; margin: 0 -4px; border: 0;
    border-radius: 8px; background: none; color: inherit; font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
  .runs button:hover { background: var(--control); }
  .lab { flex: none; display: grid; place-items: center; width: 22px; color: var(--muted); }
  .next { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .delay { flex: none; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
  .lvq { flex: none; font-size: 13px; font-variant-numeric: tabular-nums; }   /* colour: the level (app.css .lvt-*) */
  .chev { flex: none; color: var(--muted); }
  .times { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; margin-top: 8px; padding: 0;
    border: 0; background: none; color: var(--accent); font-size: 13px; cursor: pointer; }
  .times svg { transition: transform .15s; }
  .times svg.up { transform: rotate(180deg); }
</style>
