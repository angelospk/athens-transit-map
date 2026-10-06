<script lang="ts">
  import { directionGroups, otherDirection } from "../directions";
  import { clock, duration, fmtMinutes } from "../format";
  import { STALE_S, type AppState } from "../state.svelte";
  import LinePicker from "./LinePicker.svelte";
  import StatusBanner from "./StatusBanner.svelte";

  let { app }: { app: AppState } = $props();

  // Phones start compact: the map matters more than the stats at a bus stop.
  let collapsed = $state(matchMedia("(max-width: 719px)").matches);
  // One popover at a time: map layers, or GPS age.
  let pop = $state<"layers" | "ages" | null>(null);
  const toggle = (p: "layers" | "ages") => (pop = pop === p ? null : p);

  const cityAge = $derived(app.city ? Math.max(0, app.serverNow / 1000 - app.city.updated_at) : null);
  const cityMissing = $derived(app.cityState === "unknown");

  // "040: μόνο → ΣΥΝΤΑΓΜΑ" for every line shown in one direction.
  const focused = $derived(Object.entries(app.focus).map(([line, variants]) => {
    const groups = app.statics[line] ? directionGroups(app.statics[line]) : [];
    const g = groups.find(x => x.variants.join() === variants.join());
    return { line, to: g?.to ?? "μία κατεύθυνση", other: otherDirection(groups, variants) };
  }));

  const badge = $derived.by(() => {
    const city = !app.selected.length && app.cityOn && !cityMissing;
    if (!app.selected.length && !city) return { cls: "", text: "Διάλεξε γραμμή" };
    const age = city ? cityAge : app.oldestAge;
    if (age == null) return { cls: "", text: "Σύνδεση…" };
    if (age > STALE_S) return { cls: "stale", text: "Χωρίς ενημέρωση" };
    return { cls: "live", text: "Ζωντανά" };
  });

  const oldest = $derived.by(() => {
    const ts = app.selected.flatMap(l => (app.live[l] ? [app.live[l].updated_at] : []));
    return ts.length ? Math.min(...ts) : null;
  });
</script>

<!-- Escape closes an open popover first (capture: before the info card's handler). -->
<svelte:window onclick={e => { if (pop && !(e.target as Element).closest?.(".pop, .tool")) pop = null; }}
  onkeydowncapture={e => { if (e.key === "Escape" && pop) { pop = null; e.stopPropagation(); } }} />

<section class="panel" aria-label="Πίνακας ελέγχου">
  <div class="head">
    <h1>Λεωφορεία ΟΑΣΑ</h1>
    <span class="badge {badge.cls}" title="Ανανέωση μόλις ο διακομιστής έχει νέα δεδομένα (περίπου κάθε 30 δευτερόλεπτα)">
      <i></i><span>{badge.text}</span>
    </span>
    <button type="button" class="tool" class:on={pop === "layers"} aria-expanded={pop === "layers"} aria-controls="pop-layers"
      aria-label="Επίπεδα χάρτη" title="Επίπεδα χάρτη" onclick={() => toggle("layers")}>
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
        <path d="M10 3l7 3.8-7 3.8-7-3.8z" /><path d="M3 10.2l7 3.8 7-3.8" /><path d="M3 13.6l7 3.8 7-3.8" />
      </svg>
    </button>
    <button type="button" class="tool" class:on={pop === "ages"} aria-expanded={pop === "ages"} aria-controls="pop-ages"
      aria-label="Ηλικία θέσης GPS" title="Ηλικία θέσης GPS" onclick={() => toggle("ages")}>
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
        <path d="M1.8 10S5 4.5 10 4.5 18.2 10 18.2 10 15 15.5 10 15.5 1.8 10 1.8 10z" /><circle cx="10" cy="10" r="2.6" />
        {#if !app.showAges}<path d="M3.5 3.5l13 13" />{/if}
      </svg>
    </button>
    <button type="button" class="fold" aria-expanded={!collapsed} aria-controls="panel-body"
      aria-label={collapsed ? "Εμφάνιση λεπτομερειών" : "Απόκρυψη λεπτομερειών"} onclick={() => (collapsed = !collapsed)}>
      <svg viewBox="0 0 12 8" width="14" height="10" aria-hidden="true" class={{ up: !collapsed }}>
        <path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
  </div>

  {#if pop === "layers"}
    <div class="pop" id="pop-layers" role="dialog" aria-label="Επίπεδα χάρτη">
      <label class="switch">
        <input type="checkbox" checked={app.cityOn} disabled={cityMissing} onchange={e => app.setCityOn(e.currentTarget.checked)} />
        <span><b>Όλα τα λεωφορεία</b><br />
          <small>{#if cityMissing}Δεν είναι ακόμα διαθέσιμο από τον διακομιστή.{:else if app.city}{app.city.vehicles.length} οχήματα σε όλη την πόλη, ανανέωση κάθε ~30″{:else}Φόρτωση…{/if}</small>
        </span>
      </label>
      <div class="field" role="radiogroup" aria-label="Τα άλλα οχήματα όταν επιλέγεις ένα">
        <span>Όταν επιλέγεις όχημα, τα υπόλοιπα:</span>
        <div class="seg">
          {#each [["normal", "Κανονικά"], ["dim", "Αχνά"], ["hide", "Κρυφά"]] as const as [v, label] (v)}
            <button type="button" role="radio" aria-checked={app.others === v} onclick={() => app.setOthers(v)}>{label}</button>
          {/each}
        </div>
      </div>
      <p class="hint">Πάτα ένα όχημα για να δεις τη γραμμή του. Πάτα σε κενό σημείο για να ξαναδείς όλα.</p>
    </div>
  {:else if pop === "ages"}
    <div class="pop" id="pop-ages" role="dialog" aria-label="Ηλικία θέσης GPS">
      <p><b class="age">24″</b> Πόσο παλιά είναι η τελευταία θέση GPS που έστειλε το όχημα. Ο ΟΑΣΑ στέλνει θέσεις
        κάθε 20–60″· ανάμεσα, ο χάρτης μετακινεί το όχημα πάνω στη διαδρομή του με την ταχύτητα που είχε.</p>
      {#if oldest != null}
        <p class="hint" title="Ώρα δεδομένων {clock(oldest)}">Ενημέρωση γραμμών πριν {duration(Math.max(0, app.serverNow / 1000 - oldest))}</p>
      {/if}
      {#if cityAge != null && app.cityOn}
        <p class="hint" title="Ώρα δεδομένων {clock(app.city!.updated_at)}">Ενημέρωση πόλης πριν {duration(cityAge)}</p>
      {/if}
      <label class="switch">
        <input type="checkbox" checked={app.showAges} onchange={e => app.setShowAges(e.currentTarget.checked)} />
        <span>Δείξε την ηλικία πάνω στα οχήματα</span>
      </label>
    </div>
  {/if}

  <div id="panel-body" hidden={collapsed}>
    {#if !app.selected.length}
      <div class="muted">
        {#if app.cityOn && !cityMissing}Όλα τα οχήματα της πόλης. Πάτα ένα για τη γραμμή του, ή διάλεξε έως 5 γραμμές.
        {:else}Διάλεξε έως 5 γραμμές για να δεις τα οχήματα ζωντανά.{/if}
      </div>
    {/if}

    {#if app.selected.length || (app.cityOn && app.city)}
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
      {#if app.showAges}<span><b class="age">24″</b>ηλικία θέσης GPS</span>{/if}
    </div>
  </div>

  <LinePicker {app} />
  {#each focused as f (f.line)}
    <div class="focus">
      <span>{f.line}: μόνο → {f.to}</span>
      {#if f.other}
        {@const other = f.other}
        <button type="button" title="Άλλη κατεύθυνση: → {other.to}" aria-label="Δείξε την άλλη κατεύθυνση της {f.line}, προς {other.to}"
          onclick={() => app.setFocus(f.line, other.variants)}>⇄</button>
      {/if}
      <button type="button" title="Όλες οι κατευθύνσεις" aria-label="Δείξε όλες τις κατευθύνσεις της {f.line}"
        onclick={() => app.setFocus(f.line, null)}>×</button>
    </div>
  {/each}
  <StatusBanner {app} />

  <div class="foot" hidden={collapsed}>
    <a href="https://github.com/angelospk/athens-transit-map" target="_blank" rel="noopener">Κώδικας</a> ·
    Δεδομένα ΟΑΣΑ
  </div>
</section>

<style>
  .panel { position: absolute; z-index: 5; top: calc(12px + env(safe-area-inset-top)); left: 12px; width: 344px;
    max-width: calc(100% - 64px); padding: 12px 14px; background: var(--panel); border: 1px solid var(--border);
    border-radius: 14px; box-shadow: var(--shadow); backdrop-filter: blur(8px); }
  h1 { font-size: 15px; margin: 0; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .head { display: flex; align-items: center; gap: 8px; }
  .badge { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--muted);
    white-space: nowrap; }
  .badge i { width: 8px; height: 8px; border-radius: 50%; background: var(--none); }
  .badge.live { color: var(--fg); }
  .badge.live i { background: var(--ontime); animation: pulse 2s infinite; }
  .badge.stale i { background: var(--late3); }
  @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(26, 127, 55, .6); } 70%, 100% { box-shadow: 0 0 0 6px rgba(26, 127, 55, 0); } }
  @media (prefers-reduced-motion: reduce) { .badge.live i { animation: none; } }
  .tool { display: grid; place-items: center; width: 34px; height: 34px; margin: -8px -4px; border: 0; border-radius: 8px;
    background: none; color: var(--muted); cursor: pointer; }
  .tool:hover, .tool.on { background: var(--control); color: var(--fg); }
  .pop { position: absolute; z-index: 7; top: calc(100% + 6px); left: 0; right: 0; padding: 12px 14px; font-size: 13px;
    background: var(--panel); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow);
    backdrop-filter: blur(8px); }
  .pop p { margin: 0 0 8px; }
  .pop .age { margin-right: 4px; padding: 0 4px; border-radius: 6px; background: var(--control); font-size: 11px;
    font-variant-numeric: tabular-nums; }
  .hint { color: var(--muted); font-size: 12px; }
  .switch { display: flex; gap: 10px; align-items: flex-start; cursor: pointer; margin: 4px 0 10px; }
  .switch input { appearance: none; flex: none; width: 34px; height: 20px; margin: 1px 0 0; border-radius: 10px;
    background: var(--border); position: relative; cursor: pointer; transition: background .15s; }
  .switch input::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%;
    background: #fff; box-shadow: 0 1px 2px rgba(0, 0, 0, .3); transition: transform .15s; }
  .switch input:checked { background: var(--accent); }
  .switch input:checked::after { transform: translateX(14px); }
  .switch input:disabled { opacity: .5; }
  .switch small { color: var(--muted); }
  .field > span { display: block; color: var(--muted); font-size: 12px; margin-bottom: 4px; }
  .seg { display: flex; padding: 2px; border-radius: 9px; background: var(--control); margin-bottom: 10px; }
  .seg button { flex: 1; min-height: 30px; border: 0; border-radius: 7px; background: none; cursor: pointer; font-size: 12px; }
  .seg button[aria-checked="true"] { background: var(--panel); box-shadow: 0 1px 3px rgba(0, 0, 0, .2); font-weight: 600; }
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
  .legend .age { margin-right: 4px; font-size: 10px; font-variant-numeric: tabular-nums; }
  .focus { display: flex; align-items: center; gap: 2px; min-height: 32px; margin: 6px 0 0; padding: 0 2px 0 10px;
    border: 1px solid var(--accent); border-radius: 16px; color: var(--accent); font-size: 12px; }
  .focus span { flex: 1; }
  .focus button { width: 30px; height: 28px; border: 0; border-radius: 14px; background: none; color: inherit;
    font-size: 14px; cursor: pointer; }
  .focus button:hover { background: var(--control); }
  .legend { display: flex; flex-wrap: wrap; gap: 4px 10px; margin: 8px 0 0; font-size: 12px; }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 4px; vertical-align: -1px; }
  .foot { margin-top: 10px; font-size: 11px; color: var(--muted); }
  .foot a { color: inherit; }
  [hidden] { display: none !important; }
  @media (max-width: 719px) {
    .panel { left: 8px; right: 60px; width: auto; max-width: none; padding: 10px 12px; }
    .stats b { font-size: 16px; }
    .badge span { display: none; }
  }
</style>
