<script lang="ts">
  import { ago, clock, delayClass, fmtDelay } from "../format";
  import type { AppState } from "../state.svelte";

  let { app }: { app: AppState } = $props();

  const vehicle = $derived.by(() => {
    const sv = app.selectedVehicle;
    if (!sv) return null;
    const st = app.statics[sv.line];
    return {
      ...sv,
      info: app.lineInfo.get(sv.line),
      nextStop: sv.v.next_stop_id ? st?.stops[sv.v.next_stop_id] : undefined,
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
      info: app.lineInfo.get(s.line),
      variant,
      from: name(0),
      to: name(variant.stops.length - 1),
      running: (app.live[s.line]?.vehicles ?? []).filter(v => v.variant === s.variant).length,
    };
  });
</script>

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
              {v.delay_s == null ? "δεν αντιστοιχίστηκε σε δρομολόγιο" : fmtDelay(v.delay_s)}
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
        </tbody>
      </table>
    {:else if route}
      <table>
        <tbody>
          <tr><th>Κατεύθυνση</th><td>{route.from} → {route.to}</td></tr>
          <tr><th>Στάσεις</th><td>{route.variant.stops.length}</td></tr>
          <tr><th>Οχήματα τώρα</th><td>{route.running}</td></tr>
        </tbody>
      </table>
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
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 4px; vertical-align: -1px; }
  @media (max-width: 719px) {
    .card { left: 0; right: 0; bottom: 0; width: auto; border-radius: 16px 16px 0 0; border-width: 1px 0 0;
      padding: 14px 16px calc(14px + env(safe-area-inset-bottom)); }
  }
</style>
