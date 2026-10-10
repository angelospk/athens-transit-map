<script lang="ts">
  import { tick, untrack } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { directionGroups, focusGroup, otherDirection } from "../directions";
  import { clock, duration, fmtMinutes } from "../format";
  import { refreshCycle, ringAt } from "../refresh";
  import { STALE_S, type AppState } from "../state.svelte";
  import HelpPop from "./HelpPop.svelte";
  import LinePicker from "./LinePicker.svelte";
  import MetroToggles from "./MetroToggles.svelte";
  import StatusBanner from "./StatusBanner.svelte";

  let { app }: { app: AppState } = $props();

  // Phones start compact: the map matters more than the stats at a bus stop.
  let collapsed = $state(matchMedia("(max-width: 719px)").matches);
  // One popover at a time, opened from the buttons on the right: the map menu, what the symbols mean, or the
  // trip planner (loaded on first open).
  let pop = $state<"layers" | "help" | "trip" | null>(null);
  // On a phone a popover covers the panel: what it covers cannot be reached by the keyboard either.
  const narrow = new MediaQuery("(max-width: 719px)");
  let tripButton: HTMLButtonElement | undefined = $state();
  let layersButton: HTMLButtonElement | undefined = $state();
  let helpButton: HTMLButtonElement | undefined = $state();
  let foldButton: HTMLButtonElement | undefined = $state();
  let focusOpen = $state(false);   // the direction rows of several lines, under their one summary row
  // Folded, the search field is hidden; the magnifier shows it (and the list under it) until a line is picked.
  let searching = $state(false);
  // The bar shrinks to its chips and buttons when nothing is open under it.
  const compact = $derived(collapsed && !searching);

  // Focus returns to the button that opened a popover.
  async function refocus(p: "layers" | "help" | "trip") {
    await tick();
    ({ layers: layersButton, help: helpButton, trip: tripButton })[p]?.focus();
  }
  const closeTrip = () => { pop = null; void refocus("trip"); };   // its A and B stay on the map until its own ×
  const toggle = (p: "layers" | "help" | "trip") => {
    pop = pop === p ? null : p;
    if (pop === "help") void tick().then(() => document.getElementById("pop-help")?.focus());
    if (pop !== "layers") return;
    app.loadMetro();   // again, if the first load failed
    app.selectStation(null);   // its card would cover the menu's metro lines on a phone
  };
  // The chevron: opens and closes the dropdown.
  function fold() {
    searching = false;
    collapsed = !collapsed;
  }
  // A press anywhere outside the panel folds it: the map matters more. The trip planner stays open while the map is used.
  function dismiss(e: PointerEvent) {
    if (pop === "trip" || (e.target as Element | null)?.closest?.(".panel, .rail, .popwrap")) return;
    searching = false;
    collapsed = true;
    pop = null;
  }
  // Escape: a popover first, then the dropdown (when focus is in it; the search closes its own list).
  function onEscape(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    if (pop && pop !== "trip") {
      const p = pop;
      pop = null;
      e.stopPropagation();
      void refocus(p);
    } else if (!collapsed && (e.target as Element | null)?.closest?.("#panel-body")) {
      collapsed = true;
      e.stopPropagation();
      void tick().then(() => foldButton?.focus());
    }
  }

  const cityAge = $derived(app.city ? Math.max(0, app.serverNow / 1000 - app.city.updated_at) : null);
  const cityMissing = $derived(app.cityState === "unknown");

  // "040: μόνο → ΣΥΝΤΑΓΜΑ" for every line shown in one direction.
  const focused = $derived(Object.entries(app.focus).map(([line, variants]) => {
    const groups = app.statics[line] ? directionGroups(app.statics[line]) : [];
    const g = focusGroup(groups, variants);
    return { line, to: g?.to ?? "μία κατεύθυνση", other: otherDirection(groups, variants) };
  }));

  // Shown only while something is wrong: no data yet, or none for a while.
  const badge = $derived.by(() => {
    const city = !app.selected.length && app.cityOn && !cityMissing;
    if (!app.selected.length && !city) return null;
    const age = city ? cityAge : app.oldestAge;
    if (age == null) return { cls: "", text: "Σύνδεση…" };
    if (age > STALE_S) return { cls: "stale", text: "Χωρίς ενημέρωση" };
    return null;
  });

  // With motion off, ages are always shown: they are all that says how old a position is.
  // The ring round the panel fills over the refresh cycle of the feed the numbers come from. `from` and
  // `to` are numbers so that another line's update, which leaves the cycle as it was, does not restart it.
  const cycle = $derived(refreshCycle(app.selected.length || !app.cityOn
    ? app.selected.flatMap(l => (app.live[l] ? [app.live[l]] : [])) : app.city ? [app.city] : []));
  const from = $derived(cycle?.from), to = $derived(cycle?.to);
  // Where in the cycle it is now is read once per cycle, not every second; and again when the ring
  // comes back from the stale state (it was not drawn, so its animation lost time).
  const stale = $derived(badge?.cls === "stale");
  const ring = $derived(from == null || to == null || stale ? null : untrack(() => ringAt({ from, to }, app.serverNow / 1000)));
  let boxW = $state(0), boxH = $state(0);

  $effect(() => { if (focused.length < 2) focusOpen = false; });

  const ages = $derived(app.showAges || !app.motion);

  const oldest = $derived.by(() => {
    const ts = app.selected.flatMap(l => (app.live[l] ? [app.live[l].updated_at] : []));
    return ts.length ? Math.min(...ts) : null;
  });
</script>

<!-- Escape is handled in capture, before the info card's handler. The trip planner stays open while the map is
     used; it closes itself (×, Escape). -->
<svelte:document onpointerdown={dismiss} />
<svelte:window onclick={e => { if (pop && pop !== "trip" && !(e.target as Element).closest?.(".pop, .tool")) pop = null; }}
  onkeydowncapture={onEscape} />

<section class="panel" class:compact inert={!!pop && narrow.current} aria-label="Πίνακας ελέγχου" bind:clientWidth={boxW} bind:clientHeight={boxH}>
  <!-- Decorative: on the border. Fills clockwise over the refresh cycle; amber and full when nothing has come for a while. -->
  <svg class="ring" width={boxW + 2} height={boxH + 2} aria-hidden="true">
    {#if stale}
      <rect class="late" x="1" y="1" width={boxW} height={boxH} rx="13" />
    {:else if ring}
      {#key `${from}-${to}`}
        <rect class="fill" x="1" y="1" width={boxW} height={boxH} rx="13" pathLength="100"
          style:--dur="{ring.dur}s" style:--delay="-{ring.elapsed}s" />
      {/key}
    {/if}
  </svg>
  <h1 class="sr">Λεωφορεία ΟΑΣΑ</h1>

  <!-- Always shown: the picked lines, the search, and the chevron. The map buttons are on the right (.rail). -->
  <div class="bar">
    <LinePicker {app} expanded={!collapsed} searchOpen={searching} onsearch={() => (searching = true)} onclose={() => (searching = false)} {tail} />
  </div>

  <!-- The dropdown: the tools, then what the picked lines are doing. -->
  <div id="panel-body" hidden={collapsed}>
    <div class="tools">
      {#if badge}
        <span class="badge {badge.cls}" title="Ανανέωση μόλις ο διακομιστής έχει νέα δεδομένα (περίπου κάθε 30 δευτερόλεπτα)">
          <i></i><span>{badge.text}</span>
        </span>
      {/if}
    </div>

    {#if !app.selected.length && !(app.cityOn && !cityMissing)}
      <div class="muted">Διάλεξε έως 5 γραμμές για να δεις τα οχήματα ζωντανά.</div>
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

    <div class="legend">
      <span class="lead">Καθυστέρηση:</span>
      <span><i class="ontime"></i>έως 2′ ή νωρίτερα</span><span><i class="late1"></i>2–5′</span>
      <span><i class="late2"></i>5–10′</span><span><i class="late3"></i>πάνω από 10′</span>
      <span><i class="none"></i>χωρίς δρομολόγιο</span>
      {#if ages}<span><b class="age">24″</b>πριν από τόσο ήρθε η θέση</span>{/if}
    </div>

    {#if focused.length}
      {#if focused.length > 1}
        <!-- Several lines in one direction: one row, the rows of each line behind the chevron. -->
        <div class="focus">
          <span>{focused.map(f => f.line).join(", ")}: μία κατεύθυνση</span>
          <button type="button" title="Όλες οι κατευθύνσεις" aria-label="Δείξε όλες τις κατευθύνσεις όλων των γραμμών"
            onclick={() => { for (const f of focused) app.setFocus(f.line, null); }}>×</button>
          <button type="button" aria-expanded={focusOpen} aria-controls="focus-rows" aria-label="Κατευθύνσεις ανά γραμμή"
            onclick={() => (focusOpen = !focusOpen)}>
            <svg viewBox="0 0 12 8" width="12" height="8" aria-hidden="true" class={{ up: focusOpen }}><path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
        </div>
      {/if}
      <div id="focus-rows" hidden={focused.length > 1 && !focusOpen}>
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
      </div>
    {/if}
    {#if app.alert}
      {@const a = app.alert}
      <div class="focus">
        <span>🔔 {a.lines.map(l => l.line).join(", ")} · {a.n === 1 ? "στην προηγούμενη στάση" : `${a.n} στάσεις πριν`} · έως {clock(a.until).slice(0, 5)}</span>
        <button type="button" title="Τέλος ειδοποίησης" aria-label="Σταμάτα την ειδοποίηση" onclick={() => app.setAlert(null)}>×</button>
      </div>
    {/if}
  </div>

  {#each app.hits as h (h.id)}
    <div class="hit" role="alert">
      <span>🚌 {h.text}</span>
      <button type="button" aria-label="Κλείσιμο" onclick={() => app.dismissHit(h.id)}>×</button>
    </div>
  {/each}
  <StatusBanner {app} />

  {#snippet tail()}
    {#if collapsed && app.selected.length}
      <button type="button" class="tool" class:on={searching} aria-expanded={searching}
        aria-label="Αναζήτηση γραμμής" title="Αναζήτηση γραμμής" onclick={() => (searching = !searching)}>
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
          <circle cx="8.5" cy="8.5" r="5.5" /><path d="M12.6 12.6L17 17" />
        </svg>
      </button>
    {/if}
    <button type="button" class="fold" aria-expanded={!collapsed} aria-controls="panel-body" bind:this={foldButton}
      aria-label={collapsed ? "Εμφάνιση λεπτομερειών" : "Απόκρυψη λεπτομερειών"} onclick={fold}>
      <svg viewBox="0 0 12 8" width="14" height="10" aria-hidden="true" class={{ up: !collapsed }}>
        <path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
  {/snippet}
</section>


<!-- The popover of a map button opens on the right, beside the buttons (on a phone over the panel). -->
{#if pop}
  <div class="popwrap" class:raised={pop === "layers" || pop === "help"}>
    {#if pop === "trip"}
      {#await import("./TripPlanner.svelte")}
        <div class="pop"><p class="hint">Φόρτωση…</p></div>
      {:then m}
        <m.default {app} onclose={closeTrip} />
      {:catch}
        <div class="pop"><p class="hint">Δεν φόρτωσε. Έλεγξε τη σύνδεση και πάτα ξανά την πυξίδα.</p></div>
      {/await}
    {:else if pop === "help"}
      <div class="pop" id="pop-help" role="dialog" tabindex="-1" aria-label="Τι σημαίνει κάθε σύμβολο">
        <HelpPop />
      </div>
    {:else if pop === "layers"}
      <div class="pop" id="pop-layers" role="dialog" aria-label="Τι δείχνει ο χάρτης">
        <h3>Τι δείχνει ο χάρτης</h3>
        <section>
          <h4>Μετρό, ΗΣΑΠ και τραμ</h4>
          <p class="hint">Οι σταθμοί φαίνονται πάντα· πάτα έναν για τις γραμμές του. Άνοιξε μια γραμμή για να φαίνεται η διαδρομή της.</p>
          {#if app.metro}
            <MetroToggles {app} ids={app.metro.lines.map(l => l.id)} />
          {:else}
            <p class="hint">Φόρτωση…</p>
          {/if}
        </section>
        <section>
          <h4>Λεωφορεία</h4>
          <label class="switch">
            <input type="checkbox" checked={app.cityOn} disabled={cityMissing} onchange={e => app.setCityOn(e.currentTarget.checked)} />
            <span>Όλα της πόλης <small>{#if cityMissing}(όχι ακόμα διαθέσιμο){:else if app.city}· {app.city.vehicles.length} τώρα{/if}</small><br />
              <small>Κλειστό: μόνο οι γραμμές που διαλέγεις.</small></span>
          </label>
          <div class="field" role="radiogroup" aria-label="Τα άλλα λεωφορεία όταν πατάς ένα">
            <span>Όταν πατάς ένα, τα άλλα:</span>
            <div class="seg">
              {#each [["normal", "Κανονικά"], ["dim", "Αχνά"], ["hide", "Κρυφά"]] as const as [v, label] (v)}
                <button type="button" role="radio" aria-checked={app.others === v} onclick={() => app.setOthers(v)}>{label}</button>
              {/each}
            </div>
          </div>
        </section>
        <section>
          <h4>Φίλτρα λεωφορείων <small>· κρύβουν όσα δεν ταιριάζουν</small></h4>
          <label class="switch">
            <input type="checkbox" checked={app.only.fresh} onchange={e => app.setOnly({ fresh: e.currentTarget.checked })} />
            <span>Μόνο με πρόσφατη θέση<br /><small>Έστειλαν θέση τα τελευταία 1½ λεπτά.</small></span>
          </label>
          <label class="switch">
            <input type="checkbox" checked={app.only.onTime} onchange={e => app.setOnly({ onTime: e.currentTarget.checked })} />
            <span>Μόνο στην ώρα τους<br /><small>Έως 5 λεπτά καθυστέρηση.</small></span>
          </label>
        </section>
        <section>
          <h4>Κίνηση λεωφορείων</h4>
          <label class="switch">
            <input type="checkbox" checked={app.motion} onchange={e => app.setMotion(e.currentTarget.checked)} />
            <span>Κίνηση ανάμεσα στις θέσεις<br /><small>Κλειστό: το όχημα μένει εκεί που έστειλε θέση.</small></span>
          </label>
          <label class="switch">
            <input type="checkbox" checked={ages} disabled={!app.motion} onchange={e => app.setShowAges(e.currentTarget.checked)} />
            <span>Ηλικία θέσης <b class="age">24″</b><br /><small>{#if app.motion}Πριν πόσο έστειλε θέση.{:else}Πάντα ανοιχτό όταν η κίνηση είναι κλειστή.{/if}</small></span>
          </label>
          <details class="hint">
            <summary>Πώς κινούνται</summary>
            Ο ΟΑΣΑ στέλνει θέσεις κάθε 20–60″. Όταν η νέα θέση είναι μακριά, το όχημα πηγαίνει γρήγορα ως εκεί και αφήνει
            για λίγο μπλε ίχνος. Αχνό όχημα με πορτοκαλί ηλικία: δεν έστειλε θέση για πάνω από 1½ λεπτό, άρα μπορεί να είναι αλλού.
            {#if oldest != null}<br /><span title="Ώρα δεδομένων {clock(oldest)}">Ενημέρωση γραμμών πριν {duration(Math.max(0, app.serverNow / 1000 - oldest))}.</span>{/if}
            {#if cityAge != null && app.cityOn}<br /><span title="Ώρα δεδομένων {clock(app.city!.updated_at)}">Ενημέρωση πόλης πριν {duration(cityAge)}.</span>{/if}
          </details>
        </section>
        <section>
          <h4>Ταχύτητα δρόμων (πιλοτικό)</h4>
          <label class="switch">
            <input type="checkbox" checked={app.segSpeed} onchange={e => app.setSegSpeed(e.currentTarget.checked)} />
            <span>Τυπική ταχύτητα λεωφορείων<br /><small>Ανά κομμάτι δρόμου, από στάση σε στάση. Πάτα ένα για km/h.</small></span>
          </label>
        </section>
        <section>
          <h4>Θέμα χάρτη</h4>
          <div class="seg" role="radiogroup" aria-label="Θέμα">
            {#each [["system", "Συσκευής"], ["light", "Φωτεινό"], ["dark", "Σκοτεινό"]] as const as [v, label] (v)}
              <button type="button" role="radio" aria-checked={app.theme === v} onclick={() => app.setTheme(v)}>{label}</button>
            {/each}
          </div>
        </section>
      </div>
    {/if}
  </div>
{/if}

<div class="rail" role="toolbar" aria-label="Εργαλεία χάρτη">
  <button type="button" class="tool" class:on={pop === "layers"} class:filtering={app.only.fresh || app.only.onTime} aria-expanded={pop === "layers"} aria-controls="pop-layers"
    bind:this={layersButton} aria-label="Τι δείχνει ο χάρτης" data-tip="Τι δείχνει ο χάρτης: γραμμές μετρό, ποια λεωφορεία, φίλτρα, θέμα" onclick={() => toggle("layers")}>
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
      <path d="M2 10S5 4.8 10 4.8 18 10 18 10 15 15.2 10 15.2 2 10 2 10z" /><circle cx="10" cy="10" r="2.5" />
    </svg>
  </button>
  <button type="button" class="tool" class:on={pop === "trip"} class:pinned={!!app.tripEnds && pop !== "trip"} aria-expanded={pop === "trip"} bind:this={tripButton}
    aria-label="Διαδρομή: ποιες γραμμές με πάνε" data-tip="Διαδρομή: διάλεξε Α και Β και δες ποιες γραμμές σε πάνε" onclick={() => toggle("trip")}>
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
      <circle cx="10" cy="10" r="8" /><path d="M12.8 7.2l-1.6 4-4 1.6 1.6-4z" />
    </svg>
  </button>
  <button type="button" class="tool" class:on={pop === "help"} aria-expanded={pop === "help"} aria-controls="pop-help"
    aria-label="Τι σημαίνει κάθε σύμβολο" data-tip="Τι σημαίνει κάθε σύμβολο και χρώμα στον χάρτη" onclick={() => toggle("help")} bind:this={helpButton}>
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="10" cy="10" r="8" /><path d="M7.8 7.9a2.3 2.3 0 1 1 3.3 2.1c-.7.4-1.1.8-1.1 1.6" /><circle cx="10" cy="14.2" r=".5" fill="currentColor" />
    </svg>
  </button>
</div>

<style>
  .panel { position: absolute; z-index: 5; top: calc(12px + env(safe-area-inset-top)); left: 12px; width: 344px;
    max-width: calc(100% - 64px); padding: 12px 14px; background: var(--panel); border: 1px solid var(--border);
    border-radius: 14px; box-shadow: var(--shadow); backdrop-filter: blur(8px); }
  .panel.compact { width: fit-content; max-width: min(344px, calc(100% - 64px)); }
  .ring { position: absolute; top: -1px; left: -1px; pointer-events: none; overflow: visible; }
  .ring rect { fill: none; stroke-width: 2; }
  .ring .fill { stroke: var(--accent); stroke-dasharray: 100; stroke-dashoffset: 100;
    animation: ring var(--dur) linear var(--delay) forwards; }
  .ring .late { stroke: var(--late2); opacity: .8; }
  @keyframes ring { to { stroke-dashoffset: 0; } }
  .sr { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  #panel-body { margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--border); }
  .tools { display: flex; align-items: center; gap: 2px; }
  .badge { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--muted);
    white-space: nowrap; }
  .badge i { width: 8px; height: 8px; border-radius: 50%; background: var(--none); }
  .badge.stale i { background: var(--late3); }
  .tool { display: grid; place-items: center; flex: none; width: 40px; height: 40px; margin: 0; border: 0; border-radius: 8px;
    background: none; color: var(--muted); cursor: pointer; }
  .tool:hover, .tool.on { background: var(--control); color: var(--fg); }
  /* A map filter is on: some vehicles are hidden. */
  .tool { position: relative; }
  .tool.filtering::after, .tool.pinned::after { content: ""; position: absolute; top: 6px; right: 6px; width: 7px; height: 7px;
    border-radius: 50%; background: var(--accent); }
  /* The map buttons (right, under the zoom and locate buttons) and the popover that opens beside them. */
  /* The same look and size as MapLibre's zoom and locate buttons above it (white in dark too). */
  .rail { position: absolute; z-index: 5; top: calc(116px + env(safe-area-inset-top)); right: 10px; width: 29px; display: flex;
    flex-direction: column; background: #fff; border-radius: 4px; box-shadow: 0 0 0 2px rgba(0, 0, 0, .1); }
  .rail .tool { width: 29px; height: 29px; border-radius: 0; color: #333; }
  .rail .tool + .tool { border-top: 1px solid #ddd; }
  .rail .tool:first-child { border-radius: 4px 4px 0 0; }
  .rail .tool:last-child { border-radius: 0 0 4px 4px; }
  .rail .tool:hover, .rail .tool.on { background: rgba(0, 0, 0, .08); color: #333; }
  .rail .tool.on { color: var(--accent); }
  .rail .tool.filtering::after, .rail .tool.pinned::after { top: 3px; right: 3px; }
  /* What a button does: beside it, on hover or keyboard focus (no tooltip on a touch screen; the popover itself opens). */
  .rail .tool::before { content: attr(data-tip); position: absolute; right: calc(100% + 10px); top: 50%; translate: 0 -50%; width: max-content;
    max-width: 220px; padding: 6px 9px; border-radius: 8px; background: var(--panel); color: var(--fg); border: 1px solid var(--border);
    box-shadow: var(--shadow); font-size: 12px; line-height: 1.35; white-space: normal; text-align: left; pointer-events: none;
    opacity: 0; transition: opacity .12s; }
  @media (hover: hover) { .rail .tool:not(.on):hover::before { opacity: 1; transition-delay: .35s; } }
  .rail .tool:not(.on):focus-visible::before { opacity: 1; }
  .popwrap { position: absolute; z-index: 5; top: calc(116px + env(safe-area-inset-top)); right: 52px; width: 344px; max-width: calc(100% - 64px);
    max-height: calc(100dvh - 128px - env(safe-area-inset-top)); display: flex; flex-direction: column; }
  .popwrap.raised { z-index: 8; }   /* the map menu over the info card */
  .pop { min-height: 0; padding: 12px 14px; font-size: 13px; background: var(--bg); border: 1px solid var(--border);
    border-radius: 14px; box-shadow: var(--shadow); box-sizing: border-box; overflow-y: auto; overscroll-behavior: contain; }
  .pop p { margin: 0 0 8px; }
  .pop h3 { margin: 0 0 10px; font-size: 15px; }
  .pop h4 { margin: 0 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  .pop section + section { margin-top: 4px; padding-top: 10px; border-top: 1px solid var(--border); }
  .pop .age { margin-right: 4px; padding: 0 4px; border-radius: 6px; background: var(--control); font-size: 11px;
    font-variant-numeric: tabular-nums; }
  .hint { color: var(--muted); font-size: 12px; }
  .field > span { display: block; color: var(--muted); font-size: 12px; margin-bottom: 4px; }
  .seg { display: flex; padding: 2px; border-radius: 9px; background: var(--control); margin-bottom: 10px; }
  .seg button { flex: 1; min-height: 30px; border: 0; border-radius: 7px; background: none; cursor: pointer; font-size: 12px; }
  .seg button[aria-checked="true"] { background: var(--panel); box-shadow: 0 1px 3px rgba(0, 0, 0, .2); font-weight: 600; }
  .fold { flex: none; width: 40px; height: 40px; margin: 0; border: 0; background: none; color: var(--muted);
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
  .focus span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .focus button { flex: none; width: 30px; height: 28px; border: 0; border-radius: 14px; background: none; color: inherit;
    font-size: 14px; cursor: pointer; }
  .focus button:hover { background: var(--control); }
  .focus svg { transition: transform .15s; }
  .focus svg.up { transform: rotate(180deg); }
  .hit { display: flex; align-items: flex-start; gap: 6px; margin-top: 8px; padding: 8px 4px 8px 10px; border-radius: 10px;
    background: var(--accent); color: #fff; font-size: 14px; font-weight: 600; }
  .hit span { flex: 1; }
  .hit button { width: 30px; height: 28px; border: 0; border-radius: 8px; background: none; color: inherit; font-size: 18px; cursor: pointer; }
  .pop h4 small { text-transform: none; letter-spacing: 0; font-weight: 400; }
  .pop details summary { cursor: pointer; margin-bottom: 4px; }
  .legend { display: flex; flex-wrap: wrap; gap: 4px 10px; margin: 8px 0 0; font-size: 12px; }
  .legend .lead { color: var(--muted); }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 4px; vertical-align: -1px; }
  [hidden] { display: none !important; }
  @media (max-width: 719px) {
    .panel { left: 8px; right: 60px; width: auto; max-width: none; padding: 10px 12px; }
    .panel.compact { right: auto; max-width: calc(100% - 68px); }
    .rail { top: calc(50px + env(safe-area-inset-top)); }   /* no zoom buttons above it */
    .popwrap { top: calc(12px + env(safe-area-inset-top)); left: 8px; right: 60px; width: auto; max-width: none;
      max-height: calc(100dvh - 24px - env(safe-area-inset-top)); }
    .stats b { font-size: 16px; }
  }
</style>
