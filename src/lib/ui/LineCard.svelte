<script lang="ts">
  // The card of a line, any mode, from /v2: its two directions, the vehicles now of the chosen one and,
  // for a bus line, today's runs. The vehicles are asked again every 20 s while it is open.
  import { untrack } from "svelte";
  import { fetchV2Line, fetchV2LineVehicles } from "../api";
  import { fmtDelay } from "../format";
  import { busVehicleCard } from "../legacy";
  import { directionGroups } from "../directions";
  import { dirLabels, headsignName, lineVehicleRows, withDirections, type LineDetail, type V2Vehicle } from "../v2";
  import type { AppState } from "../state.svelte";
  import CardSheet from "./CardSheet.svelte";
  import Timetable from "./Timetable.svelte";

  let { app }: { app: AppState } = $props();

  const top = $derived(app.stack.at(-1));
  const card = $derived(top?.kind === "line" ? top : null);
  const native = (id: string) => id.slice(id.indexOf(":") + 1);

  let detail = $state.raw<LineDetail | null>(null);
  let vehicles = $state.raw<V2Vehicle[] | null>(null);
  let failed = $state(false);

  $effect(() => {
    if (!card) return;
    const id = card.id;
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    untrack(() => { detail = null; vehicles = null; failed = false; });
    const load = async () => {
      if (document.visibilityState !== "hidden") {
        const [lr, vr] = await Promise.all([fetchV2Line(id), fetchV2LineVehicles(id)]);
        if (ac.signal.aborted) return;
        if (lr.status === 200 && lr.body) detail = lr.body as LineDetail;
        if (vr.status === 200 && vr.body) vehicles = (vr.body as { vehicles?: V2Vehicle[] }).vehicles ?? [];
        failed = !detail;
      }
      timer = setTimeout(load, 20_000);
    };
    void load();
    return () => { ac.abort(); clearTimeout(timer); };
  });

  const nativeLine = $derived(card ? native(card.id) : "");
  const isBus = $derived(!!card && card.id.startsWith("oasa:"));
  // A bus line's directions come from its /v1 direction groups (withDirections), with their termini as labels.
  const groups = $derived(isBus && app.statics[nativeLine] ? directionGroups(app.statics[nativeLine]) : []);
  const patterns = $derived(withDirections(detail?.patterns ?? [], groups));
  const labels = $derived<(string | null)[]>(groups.length === 2 ? groups.map(g => g.to) : dirLabels(patterns, detail?.stops));
  const dir = $derived<0 | 1>(card?.dir ?? (card?.pattern ? patterns.find(p => p.id === card.pattern)?.direction : undefined) ?? 0);
  const label = $derived(detail?.line.label ?? detail?.line.name ?? nativeLine);
  // With the /v1 directions, a vehicle's own (OASA: 0) direction is no better than its pattern's: its headsign decides.
  const own = $derived(patterns === detail?.patterns ? vehicles : vehicles?.map(v => ({ ...v, direction: null })));
  const rows = $derived(detail && own ? lineVehicleRows(own, patterns, detail.stops, dir) : null);

  // The raw headsign of the direction's most common pattern: what the day's timetable is matched on.
  const dirHeadsign = $derived.by(() => {
    const n = new Map<string, number>();
    for (const p of patterns) if (p.direction === dir) n.set(p.headsign, (n.get(p.headsign) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  });

  $effect(() => { if (detail) untrack(() => app.retitle(label)); });

  let showTimes = $state(false);
  const color = $derived(isBus ? app.lineColor(nativeLine) : { bg: detail?.line.color ?? "#3b5bdb", fg: detail?.line.text_color ?? "#ffffff" });
  const starred = $derived(!!card && app.isFavLine(card.id));

  function open(v: V2Vehicle) {
    if (isBus) {
      app.push(busVehicleCard(nativeLine, native(v.id)));
      app.flyTo([v.position.lon, v.position.lat]);
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
  <CardSheet {app} key={card.id} starred={starred} starLabel={starred ? "Αφαίρεση από τις αγαπημένες" : "Προσθήκη στις αγαπημένες"}
    onstar={() => app.toggleFavLine({ id: card.id, label })}>
    {#snippet header()}
      <span class="pill" style:--c={color.bg} style:--t={color.fg}>{label}</span>
      <h2>{detail?.line.name ?? ""}</h2>
    {/snippet}
    {#if failed}
      <p class="muted">Δεν φόρτωσε η γραμμή. Δοκίμασε ξανά.</p>
    {:else if !detail}
      <p class="muted">Φόρτωση…</p>
    {:else}
      <div class="dirs" role="group" aria-label="Κατεύθυνση">
        {#each labels as l, d (d)}
          {#if l !== null}
            <button type="button" aria-pressed={dir === d} onclick={() => pick(d as 0 | 1)}>→ {l}</button>
          {/if}
        {/each}
      </div>

      <h3 class="sub">Οχήματα τώρα{rows ? ` · ${rows.length}` : ""}</h3>
      {#if rows?.length}
        <ul class="runs" aria-live="polite" aria-label="Τα οχήματα της κατεύθυνσης">
          {#each rows as r (r.id)}
            <li><button type="button" onclick={() => open(r.vehicle)}>
              {#if r.label}<span class="lab">#{r.label}</span>{/if}
              <span class="next">{r.next ?? "—"}</span>
              {#if r.delay_s !== null}<span class="delay">{fmtDelay(r.delay_s)}</span>{/if}
              <span aria-hidden="true" class="chev">›</span>
            </button></li>
          {/each}
        </ul>
      {:else}
        <p class="muted">{rows ? "Κανένα όχημα σε αυτή την κατεύθυνση τώρα." : "Φόρτωση…"}</p>
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
  .dirs button[aria-pressed="true"] { background: var(--accent); color: #fff; font-weight: 600; }
  .sub { margin: 10px 0 2px; font-size: 12px; font-weight: 600; color: var(--muted); }
  .runs { list-style: none; margin: 0; padding: 0; }
  .runs button { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 36px; padding: 0 4px; margin: 0 -4px; border: 0;
    border-radius: 8px; background: none; color: inherit; font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
  .runs button:hover { background: var(--control); }
  .lab { flex: none; min-width: 44px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .next { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .delay { flex: none; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
  .chev { flex: none; color: var(--muted); }
  .times { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; margin-top: 8px; padding: 0;
    border: 0; background: none; color: var(--accent); font-size: 13px; cursor: pointer; }
  .times svg { transition: transform .15s; }
  .times svg.up { transform: rotate(180deg); }
</style>
