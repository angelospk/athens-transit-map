<script lang="ts">
  // The card of a tapped vehicle. A bus: from the line's live data (the stops ahead with their estimated
  // times, and a bell on each). A train, metro or tram: from /v2 (its run's stops ahead, a bell on each: web
  // push when this train nears that stop), asked again every 20 s.
  import { untrack } from "svelte";
  import { fetchV2Line, fetchV2LineVehicles, fetchV2Run } from "../api";
  import { upcomingStops } from "../eta";
  import { ageLabel, delayText, fmtDelay } from "../format";
  import { busStopCard, routeCard } from "../legacy";
  import { stopIndex, toward } from "../stops";
  import { railHeads, type RailSpec } from "../railAlerts";
  import { freshness, headsignName, nextStops, vehicleDir, type LineDetail, type V2Run, type V2Vehicle } from "../v2";
  import type { AppState } from "../state.svelte";
  import Bell from "./Bell.svelte";
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
  const ahead = $derived(bus?.st && bus.variant ? upcomingStops(bus.variant, bus.st.stops, bus.v) : []);
  const busHead = $derived(bus?.variant?.headsign ? toward(bus.variant.headsign) : "");
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
  const anyTimetable = $derived(rail.ahead.some(a => !a.live));

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
      <h2>{busHead ? `→ ${busHead}` : (app.lineInfo.get(line)?.name ?? "")}</h2>
      {#if bus}<span class="fresh" class:warn={busAge > 90}>{ageLabel(busAge)}</span>{/if}
    {/snippet}
    {#if bus}
      <p class="meta">{delayText(bus.v.delay_s)} · #{bus.v.id}</p>
      {#if ahead.length}
        <p class="note" class:warn={busStale}>{busStale ? `Καμία νέα θέση εδώ και ${Math.round(busAge / 60)}′· οι ώρες μπορεί να μην ισχύουν` : "ώρες κατά προσέγγιση"}</p>
        <ol class="ahead" aria-live="polite" aria-label="Επόμενες στάσεις">
          {#each ahead.slice(0, 8) as a, k (a.id + "/" + a.i)}
            <li class:next={k === 0}>
              <span class="t">{busStale && a.at * 1000 <= app.serverNow ? "—" : whenText(a.at, app.serverNow)}</span><button type="button" class="name" title="Η στάση {a.name}" onclick={() => app.push(busStopCard(a.id, a.name))}>{a.name}</button>
              <button type="button" class="bell" class:on={alertAt?.id === a.id && alertAt.i === a.i} aria-expanded={alertAt?.id === a.id && alertAt.i === a.i}
                title="Ειδοποίηση άφιξης σε αυτή τη στάση" aria-label="Ειδοποίηση άφιξης του {line} στη στάση {a.name}"
                onclick={() => bellAt(a)}><Bell /></button>
            </li>
            {#if alertAt?.id === a.id && alertAt.i === a.i && (alertAt.from == null || alertAt.from < 0)}
              <li class="alert"><p class="muted">{alertAt.from == null ? "Φόρτωση…" : "Αυτή η στάση δεν είναι στα δεδομένα στάσεων."}</p></li>
            {/if}
          {/each}
        </ol>
      {:else if !bus.variant}
        <p class="muted">Φόρτωση δρομολογίου…</p>
      {/if}
    {:else}
      <p class="muted">Το όχημα δεν είναι πια στον χάρτη.</p>
    {/if}
    <button type="button" class="foot" onclick={() => app.push(bus?.v.variant ? routeCard(line, bus.v.variant) : { kind: "line", id: card.line, title: line })}>
      Γραμμή {line} <span aria-hidden="true">›</span>
    </button>
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
        {#if anyTimetable}<p class="note">πρόγραμμα</p>{/if}
        <ol class="ahead" aria-live="polite" aria-label="Επόμενες στάσεις">
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
  .muted { margin: 4px 0; color: var(--muted); font-size: 12px; }
  .meta { margin: 0 0 4px; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .note { margin: 8px 0 2px; font-size: 11px; color: var(--muted); }
  .note.warn { color: #e03131; }
  .ahead { list-style: none; margin: 0; padding: 0; }
  .ahead li { display: flex; align-items: center; gap: 10px; min-height: 36px; font-size: 13px; }
  .ahead li.next { font-weight: 700; }
  .ahead li.sched { font-style: italic; }
  .ahead .t { flex: none; min-width: 48px; font-variant-numeric: tabular-nums; }
  .ahead .name { flex: 1; min-width: 0; min-height: 36px; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ahead .name:hover { text-decoration: underline; }
  .ahead .plat { flex: none; padding: 1px 8px; border-radius: 10px; background: var(--control); font-size: 11px; font-style: normal; font-weight: 400; }
  .ahead li.alert { display: block; margin: 2px 0 6px; padding: 8px 10px; border-radius: 10px; background: var(--control); font-weight: 400; }
  .bell { flex: none; display: grid; place-items: center; width: 36px; height: 36px; border: 0; border-radius: 8px; background: none;
    color: var(--muted); cursor: pointer; }
  .bell:hover, .bell.on { background: var(--control); color: var(--accent); }
  .foot { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 40px; margin-top: 8px; padding: 0 12px;
    border: 0; border-radius: 10px; background: var(--control); color: var(--fg); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
  .foot:hover { background: var(--control-hover); }
</style>
