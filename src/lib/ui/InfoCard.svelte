<script lang="ts">
  import { directionGroups, groupOf } from "../directions";
  import { ago, clock, delayClass, delayText } from "../format";
  import type { AppState } from "../state.svelte";
  import type { DirectionGroup } from "../directions";

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

  const route = $derived.by(() => {
    const s = app.selection;
    if (s?.kind !== "route") return null;
    const st = app.statics[s.line];
    const variant = st?.variants[s.variant];
    if (!variant) return null;
    const name = (i: number) => st.stops[variant.stops[i]]?.name ?? "";
    return {
      line: s.line,
      id: s.variant,
      info: app.lineInfo.get(s.line),
      variant,
      from: name(0),
      to: name(variant.stops.length - 1),
      running: (app.live[s.line]?.vehicles ?? []).filter(v => v.variant === s.variant).length,
      groups: directionGroups(st),
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
  <section class="card" aria-live="polite" aria-label="Λεπτομέρειες">
    <header>
      <span class="pill" style:--c={info?.color ?? "#3b5bdb"} style:--t={info?.text_color ?? "#fff"}>{line}</span>
      <h2>{info?.name ?? ""}</h2>
      <button type="button" class="close" aria-label="Κλείσιμο" onclick={() => app.clearSelection()}>×</button>
    </header>

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
      {#if vehicle.groups.length > 1}
        {@const mine = groupOf(vehicle.groups, v.variant)}
        {@render dirs(vehicle.line, vehicle.groups, vehicle.focus, mine)}
      {/if}
    {:else if route}
      <table>
        <tbody>
          <tr><th>Κατεύθυνση</th><td>{route.from} → {route.to}</td></tr>
          <tr><th>Στάσεις</th><td>{route.variant.stops.length}</td></tr>
          <tr><th>Οχήματα τώρα</th><td>{route.running}</td></tr>
        </tbody>
      </table>
      {#if route.groups.length > 1}
        {@render dirs(route.line, route.groups, route.focus, groupOf(route.groups, route.id))}
      {/if}
    {/if}
  </section>
{/if}

<style>
  .card { position: absolute; z-index: 6; left: 12px; bottom: 28px; width: 340px; padding: 12px 14px;
    background: var(--panel); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow);
    backdrop-filter: blur(8px); }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  h2 { flex: 1; margin: 0; font-size: 13px; font-weight: 600; color: var(--muted); overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; }
  .pill { padding: 2px 8px; border-radius: 10px; background: var(--c); color: var(--t); font-weight: 700; }
  .close { width: 36px; height: 36px; margin: -8px -10px -8px 0; border: 0; background: none; font-size: 22px;
    color: var(--muted); cursor: pointer; border-radius: 8px; }
  .close:hover { background: var(--control); }
  table { border-collapse: collapse; font-size: 13px; }
  th { padding: 2px 10px 2px 0; color: var(--muted); font-weight: 400; text-align: left; vertical-align: top; white-space: nowrap; }
  td { padding: 2px 0; font-variant-numeric: tabular-nums; }
  .muted { color: var(--muted); font-size: 12px; }
  .dirs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .dirs button { min-height: 36px; padding: 4px 12px; border: 1px solid var(--border); border-radius: 18px;
    background: var(--control); cursor: pointer; font-size: 13px; }
  .dirs button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
  .dirs button.mine:not([aria-pressed="true"]) { border-color: var(--accent); }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 4px; vertical-align: -1px; }
  @media (max-width: 719px) {
    .card { left: 0; right: 0; bottom: 0; width: auto; border-radius: 16px 16px 0 0; border-width: 1px 0 0;
      padding: 14px 16px calc(14px + env(safe-area-inset-bottom)); }
  }
</style>
