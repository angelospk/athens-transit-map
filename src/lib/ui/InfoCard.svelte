<script lang="ts">
  import { untrack } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { directionGroups, groupOf } from "../directions";
  import { ago, clock, delayClass, delayText } from "../format";
  import { clampDrag, settle, type SheetState } from "../sheet";
  import type { AppState } from "../state.svelte";
  import type { DirectionGroup } from "../directions";
  import type { Vehicle } from "../types";
  import Timetable from "./Timetable.svelte";
  import Bell from "./Bell.svelte";
  import { upcomingStops } from "../eta";
  import { clockHM } from "../trains";
  import { stopIndex } from "../stops";

  let { app }: { app: AppState } = $props();

  // A city vehicle whose line is still loading: what the city layer knows, until the line's data arrives.
  const vehicle = $derived.by(() => {
    const c = app.selectedCity;
    const sv = app.selectedVehicle ?? (c && {
      line: c.line, faded: false, loading: true,
      v: { ...c, route_code: "", trip_id: null, trip_label: null, next_stop_id: null },
    });
    if (!sv) return null;
    const st = app.statics[sv.line];
    return {
      ...sv,
      info: app.lineInfo.get(sv.line),
      nextStop: sv.v.next_stop_id ? st?.stops[sv.v.next_stop_id] : undefined,
      groups: st ? directionGroups(st) : [],
      focus: app.focus[sv.line],
    };
  });

  // On a phone the card is a bottom sheet: dragged down by its top it peeks (only the header shows),
  // dragged up it opens. The same by a tap, or Enter on the grab button.
  const narrow = new MediaQuery("(max-width: 719px)");
  let sheet = $state<SheetState>("open");
  let drag = $state(0);   // px the finger has moved it from its place
  let dragging = $state(false);
  let grab: { id: number; y: number; from: SheetState; range: number; moved: boolean } | null = null;
  let card: HTMLElement | undefined = $state();
  let cardH = $state(0), topH = $state(0);
  // How far it travels to peek: all but its padding (the bottom one holds the safe area) and its top.
  function measure() {
    if (!card) return 0;
    const cs = getComputedStyle(card);
    return Math.max(0, card.offsetHeight - topH - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom));
  }
  const range = $derived.by(() => { void cardH; void topH; return measure(); });
  const shift = $derived(narrow.current ? (sheet === "peek" ? range : 0) + drag : 0);

  // A new vehicle or route opens it again; the live updates of the same one do not.
  const selKey = $derived.by(() => {
    const s = app.selection;
    return s ? `${s.kind}/${s.line}/${s.kind === "vehicle" ? s.id : s.variant}` : "";
  });
  $effect(() => {
    void selKey;
    // A finger still down on the old sheet must not move, or settle, the new one.
    untrack(() => { sheet = "open"; drag = 0; dragging = false; grab = null; });
  });

  function down(e: PointerEvent) {
    if (!narrow.current || e.button !== 0 || grab || (e.target as Element).closest(".close, .pin, .star")) return;
    grab = { id: e.pointerId, y: e.clientY, from: sheet, range: measure(), moved: false };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (!grab || e.pointerId !== grab.id) return;
    const dy = e.clientY - grab.y;
    if (!grab.moved && Math.abs(dy) < 6) return;   // a tap is not a drag
    grab.moved = true;
    dragging = true;
    drag = clampDrag(grab.from, dy, grab.range);
  }
  // Also on pointercancel and a lost capture, so the sheet never stays between its places.
  function end(e: PointerEvent) {
    if (!grab || e.pointerId !== grab.id) return;
    const g = grab;
    grab = null;
    dragging = false;
    sheet = g.moved ? settle(g.from, e.type === "pointerup" ? e.clientY - g.y : drag, g.range) : e.type === "pointerup" ? flip(g.from) : g.from;
    drag = 0;
  }
  // The selected vehicle's stops ahead, with estimated times (eta.ts: its typical speeds ahead, from its fix).
  const ahead = $derived.by(() => {
    const sv = app.selectedVehicle, st = sv && app.statics[sv.line];
    const variant = sv?.v.variant ? st?.variants[sv.v.variant] : undefined;
    return sv && st && variant ? upcomingStops(variant, st.stops, sv.v) : [];
  });
  const eta = (at: number) => {
    const m = Math.round((at * 1000 - app.serverNow) / 60_000);
    return m <= 0 ? "τώρα" : m < 60 ? `~${m}′` : `~${clockHM(at)}`;
  };
  // The alert form at one of those stops (AlertForm, loaded on the first bell): the stop's id and its place.
  let alertAt = $state.raw<{ id: string; i: number; from: number | null } | null>(null);
  $effect(() => { void selKey; alertAt = null; });
  async function bellAt(id: string, i: number) {
    if (alertAt?.id === id) { alertAt = null; return; }
    alertAt = { id, i, from: null };
    const ix = await app.loadStops();
    if (alertAt?.id !== id) return;
    alertAt = { id, i, from: ix ? stopIndex(ix, id) : -1 };
  }

  // Today's runs of the route's direction, opened on demand (they stay open for the next route).
  let showTimes = $state(false);

  const flip = (s: SheetState): SheetState => (s === "open" ? "peek" : "open");

  const route = $derived.by(() => {
    const s = app.selection;
    if (s?.kind !== "route") return null;
    const st = app.statics[s.line];
    const variant = st?.variants[s.variant];
    if (!variant) return null;
    const name = (i: number) => st.stops[variant.stops[i]]?.name ?? "";
    const groups = directionGroups(st);
    // The vehicles of this direction now, from the start of the route to its end (by their next stop).
    const dir = new Set(groupOf(groups, s.variant)?.variants ?? [s.variant]);
    const at = (v: Vehicle) => (v.variant && v.next_stop_id ? st.variants[v.variant]?.stops.indexOf(v.next_stop_id) ?? -1 : -1);
    const running = (app.live[s.line]?.vehicles ?? []).filter(v => v.variant && dir.has(v.variant))
      .map(v => ({ v, k: at(v), next: v.next_stop_id ? st.stops[v.next_stop_id]?.name : undefined }))
      .sort((a, b) => a.k - b.k);
    return {
      line: s.line,
      id: s.variant,
      info: app.lineInfo.get(s.line),
      variant,
      from: name(0),
      to: name(variant.stops.length - 1),
      running,
      groups,
      focus: app.focus[s.line],
    };
  });
</script>

<!-- Direction chips: show one direction on the map. From a vehicle, the other direction opens
     that direction's route card (the vehicle is not on it). -->
{#snippet dirs(line: string, groups: DirectionGroup[], focus: string[] | undefined, mine: DirectionGroup | undefined)}
  <div class="dirs" role="group" aria-label="Κατεύθυνση στον χάρτη">
    <button type="button" aria-pressed={!focus} onclick={() => app.setFocus(line, null)}>Όλες</button>
    {#each groups as g (g.variants.join())}
      <button type="button" class:mine={g === mine} aria-pressed={focus?.join() === g.variants.join()}
        title={g === mine ? "Η κατεύθυνση αυτού του οχήματος" : undefined}
        onclick={() => {
          // Read everything first: selectRoute tears this block down. It goes before setFocus,
          // which would drop a vehicle selection the new direction hides.
          const l = line, vs = g.variants, other = app.selection?.kind === "vehicle" && g !== mine;
          if (other) app.selectRoute(l, vs[0]);
          app.setFocus(l, vs);
        }}>→ {g.to}</button>
    {/each}
  </div>
{/snippet}

<svelte:window onkeydown={e => { if (e.key === "Escape" && app.selection) app.clearSelection(); }} />

{#if vehicle || route}
  {@const line = vehicle?.line ?? route!.line}
  {@const info = vehicle?.info ?? route?.info}
  {@const pinned = app.selected.includes(line)}
  {@const starred = app.favorites.includes(line)}
  <section class="card" class:dragging class:peek={narrow.current && sheet === "peek"} aria-live="polite" aria-label="Λεπτομέρειες" bind:this={card} bind:offsetHeight={cardH}
    style:transform={shift ? `translateY(${shift}px)` : undefined}>
    <!-- svelte-ignore a11y_no_static_element_interactions (the keyboard goes through the grab button) -->
    <div class="top" bind:offsetHeight={topH} onpointerdown={down} onpointermove={move} onpointerup={end} onpointercancel={end}
      onlostpointercapture={end}>
      <!-- Pointer taps and drags are handled above; a click with no pointer (Enter, Space) comes here. -->
      <button type="button" class="grab" aria-expanded={sheet === "open"} aria-controls="card-body"
        aria-label={sheet === "open" ? "Σύμπτυξη λεπτομερειών" : "Ανάπτυξη λεπτομερειών"} onclick={e => { if (e.detail === 0) sheet = flip(sheet); }}><span></span></button>
      <header>
        <span class="pill" style:--c={app.lineColor(line).bg} style:--t={app.lineColor(line).fg}>{line}</span>
        <h2>{info?.name ?? ""}</h2>
        <button type="button" class="star" class:on={starred} aria-pressed={starred} title={starred ? "Αφαίρεση από τις αγαπημένες" : "Προσθήκη στις αγαπημένες"}
          aria-label={starred ? `Αφαίρεση της γραμμής ${line} από τις αγαπημένες` : `Προσθήκη της γραμμής ${line} στις αγαπημένες`}
          onclick={() => app.toggleFavorite(line)}>{starred ? "★" : "☆"}</button>
        <!-- Keeps the line on the bar of the panel; the card can then be closed without losing it. -->
        <button type="button" class="pin" class:on={pinned} aria-pressed={pinned} title={pinned ? "Ξεκαρφίτσωμα: βγάλε τη γραμμή από τον χάρτη" : "Καρφίτσωμα: κράτα τη γραμμή στον χάρτη"}
          aria-label={pinned ? `Ξεκαρφίτσωμα της γραμμής ${line}` : `Καρφίτσωμα της γραμμής ${line}`} onclick={() => app.toggleLine(line)}>
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill={pinned ? "currentColor" : "none"} stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">
            <path d="M7 2.5h6l-.8 5 2.3 2.7v1.3H5.5V10.2l2.3-2.7z" /><path d="M10 11.5v6" />
          </svg>
        </button>
        <button type="button" class="close" aria-label="Κλείσιμο" onclick={() => app.clearSelection()}>×</button>
      </header>
    </div>

    <div class="body" id="card-body" inert={narrow.current && sheet === "peek"}>

      {#if vehicle}
        {@const v = vehicle.v}
        <table>
          <tbody>
            <tr>
              <th>Καθυστέρηση</th>
              <td>
                <i class="dot {delayClass(v.delay_s)}"></i>
                {delayText(v.delay_s)}
              </td>
            </tr>
            {#if v.trip_label}<tr><th>Δρομολόγιο</th><td title={v.trip_id ?? ""}>{v.trip_label}</td></tr>{/if}
            {#if v.next_stop_id}
              <tr>
                <th>Επόμενη στάση</th>
                <td>{vehicle.nextStop?.name ?? ""} <span class="muted">({v.next_stop_id})</span></td>
              </tr>
            {/if}
            <tr><th>Θέση GPS</th><td title={clock(v.position_at)}>{ago(v.position_at, app.serverNow)}</td></tr>
            <tr><th>Όχημα</th><td>{v.id}</td></tr>
            {#if "loading" in vehicle}<tr><th></th><td class="muted">Φόρτωση δρομολογίου…</td></tr>{/if}
          </tbody>
        </table>
        {#if ahead.length}
          <h3 class="sub">Επόμενες στάσεις <small>· ώρες κατά προσέγγιση</small></h3>
          <ol class="ahead" aria-label="Επόμενες στάσεις">
            {#each ahead as a, k (a.id + "/" + a.i)}
              <li class:next={k === 0}>
                <span class="t">{eta(a.at)}</span><span class="name">{a.name}</span>
                <button type="button" class="bell" class:on={alertAt?.id === a.id} aria-expanded={alertAt?.id === a.id}
                  title="Ειδοποίηση άφιξης σε αυτή τη στάση" aria-label="Ειδοποίηση άφιξης του {vehicle.line} στη στάση {a.name}"
                  onclick={() => bellAt(a.id, a.i)}><Bell /></button>
              </li>
              {#if alertAt?.id === a.id}
                <li class="alert">
                  {#if alertAt.from == null}
                    <p class="muted">Φόρτωση…</p>
                  {:else if alertAt.from < 0 || !v.variant}
                    <p class="muted">Αυτή η στάση δεν είναι στα δεδομένα στάσεων.</p>
                  {:else}
                    {@const from = alertAt.from}
                    {@const variant = v.variant}
                    {#await import("./AlertForm.svelte")}
                      <p class="muted">Φόρτωση…</p>
                    {:then m}
                      <m.default {app} label={a.name} onstarted={() => (alertAt = null)}
                        lines={[{ line: vehicle.line, variants: [{ id: variant, i: a.i, from }] }]} />
                    {:catch}
                      <p class="muted">Δεν φόρτωσε η ειδοποίηση. Δοκίμασε ξανά.</p>
                    {/await}
                  {/if}
                </li>
              {/if}
            {/each}
          </ol>
        {/if}
        {#if vehicle.groups.length > 1}
          {@const mine = groupOf(vehicle.groups, v.variant)}
          {@render dirs(vehicle.line, vehicle.groups, vehicle.focus, mine)}
        {/if}
      {:else if route}
        <table>
          <tbody>
            <tr><th>Κατεύθυνση</th><td>{route.from} → {route.to}</td></tr>
            <tr><th>Στάσεις</th><td>{route.variant.stops.length}</td></tr>
          </tbody>
        </table>
        <h3 class="sub">Οχήματα τώρα · {route.running.length}</h3>
        {#if route.running.length}
          <ul class="runs" aria-label="Τα οχήματα της κατεύθυνσης">
            {#each route.running as r (r.v.id)}
              <li><button type="button" onclick={() => { const v = r.v; app.selectVehicle(route.line, v.id); app.flyTo([v.lon, v.lat]); }}>
                <i class="dot {delayClass(r.v.delay_s)}" aria-hidden="true"></i>
                <span class="next">{r.next ? `επόμενη: ${r.next}` : "χωρίς δρομολόγιο"}</span>
                <span class="muted">{ago(r.v.position_at, app.serverNow)}</span>
              </button></li>
            {/each}
          </ul>
        {:else}
          <p class="muted">{app.live[route.line] ? "Κανένα όχημα σε αυτή την κατεύθυνση τώρα." : "Φόρτωση…"}</p>
        {/if}
        {#if route.groups.length > 1}
          {@render dirs(route.line, route.groups, route.focus, groupOf(route.groups, route.id))}
        {/if}
        <button type="button" class="times" aria-expanded={showTimes} aria-controls="card-times" onclick={() => (showTimes = !showTimes)}>
          Δρομολόγια σήμερα <svg viewBox="0 0 12 8" width="9" height="6" aria-hidden="true" class={{ up: showTimes }}><path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
        {#if showTimes}
          <div id="card-times"><Timetable line={route.line} headsign={route.variant.headsign} now={app.serverNow} /></div>
        {/if}
      {/if}
    </div>
  </section>
{/if}

<style>
  .card { position: absolute; z-index: 6; left: 12px; bottom: 28px; width: 340px; padding: 12px 14px;
    background: var(--panel); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow);
    backdrop-filter: blur(8px); }
  .top { touch-action: none; }
  .grab { display: none; width: 100%; height: 14px; margin: -8px 0 2px; padding: 0; border: 0; background: none; cursor: grab; }
  .grab span { display: block; width: 40px; height: 5px; margin: 0 auto; border-radius: 3px; background: var(--border); }
  .grab:focus-visible { outline: 2px solid var(--accent); border-radius: 6px; }
  .body { max-height: min(55dvh, 420px); overflow-y: auto; overscroll-behavior: contain; transition: opacity .15s; }
  .card.peek .body { opacity: 0; }   /* no sliver of it under the header */
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  h2 { flex: 1; margin: 0; font-size: 13px; font-weight: 600; color: var(--muted); overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; }
  .pill { padding: 2px 8px; border-radius: 10px; background: var(--c); color: var(--t); font-weight: 700; }
  .close { width: 36px; height: 36px; margin: -8px -10px -8px 0; border: 0; background: none; font-size: 22px;
    color: var(--muted); cursor: pointer; border-radius: 8px; }
  .close:hover { background: var(--control); }
  .pin { display: grid; place-items: center; width: 36px; height: 36px; margin: -8px -4px -8px 0; border: 0; background: none;
    color: var(--muted); cursor: pointer; border-radius: 8px; }
  .pin:hover { background: var(--control); }
  .pin.on { color: var(--accent); }
  .star { width: 36px; height: 36px; margin: -8px -4px -8px 0; border: 0; background: none; color: var(--muted); font-size: 20px;
    cursor: pointer; border-radius: 8px; }
  .star:hover { background: var(--control); }
  .star.on { color: #f59f00; }
  table { border-collapse: collapse; font-size: 13px; }
  th { padding: 2px 10px 2px 0; color: var(--muted); font-weight: 400; text-align: left; vertical-align: top; white-space: nowrap; }
  td { padding: 2px 0; font-variant-numeric: tabular-nums; }
  .muted { color: var(--muted); font-size: 12px; }
  .dirs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .dirs button { min-height: 36px; padding: 4px 12px; border: 1px solid var(--border); border-radius: 18px;
    background: var(--control); cursor: pointer; font-size: 13px; }
  .dirs button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
  .dirs button.mine:not([aria-pressed="true"]) { border-color: var(--accent); }
  .times { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; margin-top: 8px; padding: 0;
    border: 0; background: none; color: var(--accent); font-size: 13px; cursor: pointer; }
  .times svg { transition: transform .15s; }
  .times svg.up { transform: rotate(180deg); }
  .sub small { font-weight: 400; }
  .ahead { list-style: none; margin: 0; padding: 0; }
  .ahead li { display: flex; align-items: center; gap: 10px; min-height: 30px; font-size: 13px; }
  .ahead li.next { font-weight: 700; }
  .ahead .t { flex: none; min-width: 48px; font-variant-numeric: tabular-nums; }
  .ahead .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ahead li.alert { display: block; margin: 2px 0 6px; padding: 8px 10px; border-radius: 10px; background: var(--control); font-weight: 400; }
  .ahead li.alert :global(select) { background: var(--panel); }
  .bell { flex: none; display: grid; place-items: center; width: 32px; height: 30px; border: 0; border-radius: 8px; background: none;
    color: var(--muted); cursor: pointer; }
  .bell:hover, .bell.on { background: var(--control); color: var(--accent); }
  .sub { margin: 10px 0 2px; font-size: 12px; font-weight: 600; color: var(--muted); }
  .runs { list-style: none; margin: 0; padding: 0; }
  .runs button { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 32px; padding: 0 4px; margin: 0 -4px; border: 0;
    border-radius: 8px; background: none; color: inherit; font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
  .runs button:hover { background: var(--control); }
  .runs .next { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .runs .dot { flex: none; }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 4px; vertical-align: -1px; }
  @media (prefers-reduced-motion: reduce) { .card { transition: none !important; } }
  @media (max-width: 719px) {
    .card { left: 0; right: 0; bottom: 0; width: auto; border-radius: 16px 16px 0 0; border-width: 1px 0 0;
      padding: 14px 16px calc(14px + env(safe-area-inset-bottom)); transition: transform .22s ease; }
    .card.dragging { transition: none; }
    .grab { display: block; }
  }
</style>
