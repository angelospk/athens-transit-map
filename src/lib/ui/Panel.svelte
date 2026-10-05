<script lang="ts">
  import { clock, duration, fmtMinutes } from "../format";
  import { STALE_S, type AppState } from "../state.svelte";
  import LinePicker from "./LinePicker.svelte";
  import StatusBanner from "./StatusBanner.svelte";

  let { app }: { app: AppState } = $props();

  // Phones start compact: the map matters more than the stats at a bus stop.
  let collapsed = $state(matchMedia("(max-width: 719px)").matches);

  const badge = $derived.by(() => {
    if (!app.selected.length) return { cls: "", text: "Διάλεξε γραμμή" };
    if (app.oldestAge == null) return { cls: "", text: "Σύνδεση…" };
    if (app.oldestAge > STALE_S) return { cls: "stale", text: "Χωρίς ενημέρωση" };
    return { cls: "live", text: "Ζωντανά" };
  });

  const oldest = $derived.by(() => {
    const ts = app.selected.flatMap(l => (app.live[l] ? [app.live[l].updated_at] : []));
    return ts.length ? Math.min(...ts) : null;
  });
</script>

<section class="panel" aria-label="Πίνακας ελέγχου">
  <div class="head">
    <h1>Λεωφορεία ΟΑΣΑ</h1>
    <span class="badge {badge.cls}" title="Ανανέωση μόλις ο διακομιστής έχει νέα δεδομένα (περίπου κάθε 30 δευτερόλεπτα)">
      <i></i>{badge.text}
    </span>
    <button type="button" class="fold" aria-expanded={!collapsed} aria-controls="panel-body"
      aria-label={collapsed ? "Εμφάνιση λεπτομερειών" : "Απόκρυψη λεπτομερειών"} onclick={() => (collapsed = !collapsed)}>
      <svg viewBox="0 0 12 8" width="14" height="10" aria-hidden="true" class={{ up: !collapsed }}>
        <path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
  </div>

  <div id="panel-body" hidden={collapsed}>
    {#if oldest != null}
      <div class="muted" title="Ώρα δεδομένων {clock(oldest)}">
        Ενημέρωση πριν {duration(Math.max(0, app.serverNow / 1000 - oldest))}
      </div>
    {:else}
      <div class="muted">Διάλεξε έως 5 γραμμές για να δεις τα οχήματα ζωντανά.</div>
    {/if}

    {#if app.selected.length}
      <div class="stats">
        <div><b>{app.stats.vehicles}</b><span>οχήματα</span></div>
        <div><b>{app.stats.matched}</b><span>με δρομολόγιο</span></div>
        <div>
          <b>{#if app.stats.median == null}–{:else}{fmtMinutes(app.stats.median)} <small>λεπτά</small>{/if}</b>
          <span>διάμεση καθυστ.</span>
        </div>
      </div>
    {/if}

    {#each app.selected.filter(id => app.live[id]?.vehicles.length === 0) as id (id)}
      <div class="muted">Η γραμμή {id} δεν είχε οχήματα σε κίνηση στην τελευταία ενημέρωση.</div>
    {/each}

    <div class="legend">
      <span><i class="ontime"></i>έως 2′</span><span><i class="late1"></i>2–5′</span>
      <span><i class="late2"></i>5–10′</span><span><i class="late3"></i>πάνω από 10′</span>
      <span><i class="none"></i>χωρίς δρομολόγιο</span>
    </div>
  </div>

  <LinePicker {app} />
  <StatusBanner {app} />

  <div class="foot" hidden={collapsed}>
    <a href="https://github.com/angelospk/athens-transit-map" target="_blank" rel="noopener">Κώδικας</a> ·
    Δεδομένα ΟΑΣΑ
  </div>
</section>

<style>
  .panel { position: absolute; z-index: 5; top: calc(12px + env(safe-area-inset-top)); left: 12px; width: 320px;
    max-width: calc(100% - 64px); padding: 12px 14px; background: var(--panel); border: 1px solid var(--border);
    border-radius: 14px; box-shadow: var(--shadow); backdrop-filter: blur(8px); }
  h1 { font-size: 15px; margin: 0; flex: 1; }
  .head { display: flex; align-items: center; gap: 8px; }
  .badge { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--muted);
    white-space: nowrap; }
  .badge i { width: 8px; height: 8px; border-radius: 50%; background: var(--none); }
  .badge.live { color: var(--fg); }
  .badge.live i { background: var(--ontime); animation: pulse 2s infinite; }
  .badge.stale i { background: var(--late3); }
  @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(26, 127, 55, .6); } 70%, 100% { box-shadow: 0 0 0 6px rgba(26, 127, 55, 0); } }
  @media (prefers-reduced-motion: reduce) { .badge.live i { animation: none; } }
  .fold { width: 40px; height: 40px; margin: -10px -10px -10px 0; border: 0; background: none; color: var(--muted);
    cursor: pointer; border-radius: 8px; }
  .fold:hover { background: var(--control); }
  .fold svg { transition: transform .15s; }
  .fold svg.up { transform: rotate(180deg); }
  .muted { color: var(--muted); font-size: 12px; margin-top: 2px; }
  .stats { display: grid; grid-template-columns: repeat(3, auto); justify-content: space-between; gap: 6px; margin: 10px 0 4px; }
  .stats b { display: block; font-size: 18px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .stats small { font-size: 13px; }
  .stats span { color: var(--muted); font-size: 11px; }
  .legend { display: flex; flex-wrap: wrap; gap: 4px 10px; margin: 8px 0 0; font-size: 12px; }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 4px; vertical-align: -1px; }
  .foot { margin-top: 10px; font-size: 11px; color: var(--muted); }
  .foot a { color: inherit; }
  [hidden] { display: none !important; }
  @media (max-width: 719px) {
    .panel { left: 8px; right: 60px; width: auto; max-width: none; padding: 10px 12px; }
    .stats b { font-size: 16px; }
  }
</style>
