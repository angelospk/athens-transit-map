<script lang="ts">
  import { fade } from "svelte/transition";
  import MapSettings from "./MapSettings.svelte";
  import { flushSync, tick, untrack } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { directionGroups, focusGroup, otherDirection } from "../directions";
  import { muniPlaces } from "../finder";
  import { clock, duration, fmtMinutes } from "../format";
  import { LOOKS } from "../map/look3d";
    import { STALE_S, type AppState } from "../state.svelte";
  import Bell from "./Bell.svelte";
  import HelpPop from "./HelpPop.svelte";
  import Icon from "./Icon.svelte";
  import LinePicker from "./LinePicker.svelte";
  import StatusBanner from "./StatusBanner.svelte";
  import { strikes } from "../disruptions";
  import { preloadThree } from "../map/scene3d";

  let { app }: { app: AppState } = $props();

  // The panel starts compact, on a phone and a desktop alike (B10): the map matters more; the stats are a tap away.
  let collapsed = $state(true);
  let panelH = $state(0);   // the planner sits under the panel on a computer
  // One popover at a time, opened from the buttons on the right: the map menu, what the symbols mean, or the
  // trip planner (loaded on first open). The idea box is in the ⓘ sheet (B10).
  let pop = $state<"layers" | "help" | "trip" | null>(null);
  // On a phone the settings are a page in the history: open, it is a screen; the phone's Back closes it.
  $effect(() => { const on = pop === "layers" && narrow.current; untrack(() => { app.settings = on; }); });
  $effect(() => { if (!app.settings) untrack(() => { if (pop === "layers" && narrow.current) pop = null; }); });
  // On a phone a popover covers the panel: what it covers cannot be reached by the keyboard either.
  const narrow = new MediaQuery("(max-width: 719px)");
  // A phone with the planner or a card open: the map's buttons step aside (the rail here, the zoom and locate ones
  // of the map), and the open panel takes the width, a margin each side. The page's root carries it (app.css).
  $effect(() => {
    const on = narrow.current && (pop === "trip" || app.stack.length > 0);
    document.documentElement.toggleAttribute("data-sheet", on);
    return () => document.documentElement.removeAttribute("data-sheet");
  });
  // A computer with the planner open: a card opens beside it, not over it (CardSheet reads this).
  $effect(() => {
    document.documentElement.toggleAttribute("data-planner", !narrow.current && pop === "trip");
    return () => document.documentElement.removeAttribute("data-planner");
  });
  let tripButton: HTMLButtonElement | undefined = $state();
  let layersButton: HTMLButtonElement | undefined = $state();
  let helpButton: HTMLButtonElement | undefined = $state();
  let foldButton: HTMLButtonElement | undefined = $state();
  let focusOpen = $state(false);   // the direction rows of several lines, under their one summary row
  // The bar shrinks to its chips and buttons when nothing is open under it.
  const compact = $derived(collapsed);

  // Focus returns to the button that opened a popover.
  async function refocus(p: "layers" | "help" | "trip") {
    await tick();
    ({ layers: layersButton, help: helpButton, trip: tripButton })[p]?.focus();
  }
  // its A and B stay on the map until its own ×; closed, the «Ταξίδι» tab gives way to the map
  const closeTrip = () => { pop = null; if (app.tab === "trip") app.tab = "now"; void refocus("trip"); };
  const toggle = (p: "layers" | "help" | "trip") => {
    pop = pop === p ? null : p;
    // Another popover in the planner's place takes the tab back to the map, so «Ταξίδι» can open it again.
    if (pop === "trip") app.tab = "trip";
    else if (app.tab === "trip") app.tab = "map";
    if (pop === "help") void tick().then(() => document.getElementById("pop-help")?.focus());
    if (pop !== "layers") return;
    app.loadMetro();   // again, if the first load failed
    app.loadMunicipal();   // the «Δημοτικά» switch shows once its data is there
  };

  // «Οδηγίες εδώ» in the search modal: the trip planner opens and takes the place as its end.
  // The phone's «Πού πας;» over the lines: as on the home screen (NowPanel), straight into typing, keyboard up.
  function openWhere(e: MouseEvent) {
    e.stopPropagation();
    flushSync(() => { app.start = true; app.startDirect = true; });
    const f = document.getElementById("start-to") as HTMLInputElement | null;
    f?.focus();
    f?.click();
  }
  // The planner's code, fetched once the page is idle: asked for later, it opens at once (no «Φόρτωση» first).
  $effect(() => {
    const go = () => { void import("./TripPlanner.svelte"); };
    const w = window as Window & { requestIdleCallback?: (f: () => void) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(go); else setTimeout(go, 2000);
  });
  // A phone: a trip asked from elsewhere (a stop's «Πώς πάω», a place on the map, Σπίτι) opens in «Πού πας;», which shows
  // its routes (compact mockup 14); the old planner with its own fields is only the picked route's sheet there (it
  // comes with app.tripPrefs, from «Πού πας;» itself).
  $effect(() => {
    const t = app.tripTo, f = app.tripFrom;
    if (!t && !f) return;
    untrack(() => {
      if (narrow.current && !app.tripPrefs) {
        app.tripTo = null; app.tripFrom = null;
        app.startEnds = { from: f ?? (app.myPos ? { label: "Η θέση μου", pts: [app.myPos], lines: [], kind: "me" } : null), to: t };
        if (pop === "trip") pop = null;
        if (app.tab === "trip") app.tab = "now";
        app.start = true;
        return;
      }
      pop = "trip"; app.tab = "trip";
    });
  });
  // The «Ταξίδι» tab is the planner: picked, it opens; another tab picked, it closes.
  $effect(() => {
    const t = app.tab;
    untrack(() => {
      // A phone, a trip on its way to «Πού πας;» (above): not the old planner.
      if (t === "trip" && narrow.current && !app.tripPrefs && (app.tripTo || app.tripFrom || app.startEnds)) return;
      if (t === "trip") pop = "trip"; else if (pop === "trip") pop = null;
    });
  });

  // The chevron: opens and closes the dropdown.
  function fold() {
    collapsed = !collapsed;
  }
  // A press anywhere outside the panel folds it: the map matters more. The trip planner stays open while the map is used.
  function dismiss(e: PointerEvent) {
    if (pop === "trip" || (e.target as Element | null)?.closest?.(".panel, .rail, .popwrap")) return;
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

  $effect(() => { if (focused.length < 2) focusOpen = false; });


  // «Τώρα» and «Ειδοποιήσεις» with no card open: the bar is a search field (as in the mockup), not the line picker. A
  // phone keeps that one round search over a card too, in the same place, unless lines are picked (their chips show).
  // A phone with a card open from a link (tab «map»): the same round search as «Τώρα», not the old bar (compact mockup 4).
  const home = $derived((app.tab === "now" || app.tab === "alerts" || narrow.current && app.tab === "map" && app.stack.length > 0)
    && (!app.stack.length || narrow.current && !app.selected.length));

  // A strike today (/v2/alerts, urgent): one line under the bar until the user closes it.
  const strike = $derived(app.notifyPrefs.strikes ? strikes(app.disruptions, app.serverNow, app.closedStrikes)[0] : undefined);

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

<section class="panel" class:compact class:home class:mbar={narrow.current && !home} inert={!!pop && narrow.current} aria-label="Πίνακας ελέγχου" bind:offsetHeight={panelH}>
  <h1 class="sr">Στάσεις: συγκοινωνίες live</h1>

  <!-- Always shown: the picked lines, the search, and the chevron. The map buttons are on the right (.rail). -->
  {#if home}
    <!-- «Τώρα» and «Ειδοποιήσεις»: the search, at the left with the rest of the column (the map's settings are on the
         rail at the right). -->
    <div class="homebar" hidden={narrow.current && app.stack.length > 0}>
      {#if app.tab !== "alerts"}
        <!-- «Πού πας;» is in the home sheet: here only the search for a line or a stop. -->
        <button type="button" class="round" aria-haspopup="dialog" aria-label="Βρες γραμμή, στάση ή μέρος" title="Βρες γραμμή, στάση ή μέρος" onclick={() => { app.finding = true; app.start = true; }}><Icon name="search" size={20} /></button>
      {:else}
        <button type="button" class="where" aria-haspopup="dialog" onclick={() => (app.start = true)}><Icon name="search" size={18} /><span>Πού πας;</span></button>
      {/if}
    </div>
  {:else}
  <div class="bar">
    <!-- A phone (compact mockup 15Γ): «Πού πας;» on top of the map as on the home screen, the lines as pills under it. -->
    {#if narrow.current}<button type="button" class="where mwhere" aria-haspopup="dialog" onclick={openWhere}><Icon name="search" size={19} /><span>Πού πας;</span></button>{/if}
    <LinePicker {app} expanded={!collapsed} onsearch={() => (app.start = true)} {tail} />
  </div>
  {/if}

  {#if strike && app.tab !== "now" && app.tab !== "alerts"}
    <div class="strike" role="note">
      <a href={strike.url} target="_blank" rel="noopener" title={strike.title} aria-label="{strike.title}. Ανοίγει σε νέα καρτέλα"><span
        aria-hidden="true">⚠</span> {strike.title} <span aria-hidden="true">›</span></a>
      <button type="button" aria-label="Κλείσιμο ειδοποίησης απεργίας" onclick={() => app.closeStrike(strike.id)}>✕</button>
    </div>
  {/if}

  <!-- The dropdown: the tools, then what the picked lines are doing. -->
  <div id="panel-body" hidden={collapsed || home}>
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
      {#if app.ageMode !== "never"}<span><b class="age">24″</b>πριν από τόσο ήρθε η θέση</span>{/if}
    </div>
    {#if app.trainsOn && app.cityInfo.rail}
      <!-- The marker shapes (B3): the colour of a bus is its delay; a train's is its line's. -->
      <div class="legend shapes">
        <span><img class="ico" src="{import.meta.env.BASE_URL}icons/bus.png" alt="" />λεωφορείο</span>
        <span><img class="ico" src="{import.meta.env.BASE_URL}icons/trolley.png" alt="" />τρόλεϊ</span>
        <span><i class="disc" style:background="#7E57C2"><img src="{import.meta.env.BASE_URL}icons/glyph-metro.png" alt="" /></i>προαστιακός (GPS)</span>
        <span><i class="disc" style:background="#d7171f"><img src="{import.meta.env.BASE_URL}icons/glyph-metro.png" alt="" /></i>μετρό</span>
        <span><i class="disc" style:background="#dc137a"><img src="{import.meta.env.BASE_URL}icons/glyph-tram.png" alt="" /></i>τραμ (μετρό, τραμ: από πρόγραμμα)</span>
      </div>
    {/if}

    {#if focused.length}
      {#if focused.length > 1}
        <!-- Several lines in one direction: one row, the rows of each line behind the chevron. -->
        <div class="focus">
          <span>{focused.map(f => f.line).join(", ")}: μία κατεύθυνση</span>
          <button type="button" title="Όλες οι κατευθύνσεις" aria-label="Δείξε όλες τις κατευθύνσεις όλων των γραμμών"
            onclick={() => { for (const f of focused) app.setFocus(f.line, null); }}><Icon name="close" size={13} /></button>
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
            onclick={() => app.setFocus(f.line, null)}><Icon name="close" size={13} /></button>
        </div>
      {/each}
      </div>
    {/if}
    {#if app.alert}
      {@const a = app.alert}
      <div class="focus">
        <span><Bell /> {a.lines.map(l => l.line).join(", ")} · {a.n === 1 ? "στην προηγούμενη στάση" : `${a.n} στάσεις πριν`} · έως {clock(a.until).slice(0, 5)}</span>
        <button type="button" title="Τέλος ειδοποίησης" aria-label="Σταμάτα την ειδοποίηση" onclick={() => app.setAlert(null)}><Icon name="close" size={13} /></button>
      </div>
    {/if}
    {#if app.railAlert}
      {@const a = app.railAlert}
      <div class="focus">
        <span><Bell /> {a.label} · {a.name} · {a.min}′ πριν · έως {clock(a.until).slice(0, 5)}</span>
        <button type="button" title="Τέλος ειδοποίησης" aria-label="Σταμάτα την ειδοποίηση για {a.label}" onclick={() => app.setRailAlert(null)}><Icon name="close" size={13} /></button>
      </div>
    {/if}
  </div>

  {#each app.hits as h (h.id)}
    <div class="hit" role="alert">
      <span><Icon name="bus" /> {h.text}</span>
      <button type="button" aria-label="Κλείσιμο" onclick={() => app.dismissHit(h.id)}><Icon name="close" size={13} /></button>
    </div>
  {/each}

  {#snippet tail()}
    {#if app.selected.length}
      <button type="button" class="tool add" aria-haspopup="dialog"
        aria-label="Πού πας; Διεύθυνση, στάση ή γραμμή" title="Πού πας;" onclick={() => (app.start = true)}><Icon name="search" size={18} /></button>
    {/if}
    <span class="sep" aria-hidden="true"></span>
    {#if app.favorites.length}
      <!-- The star filters the map (mockup 33): only the favourites, and the bar says so. -->
      <button type="button" class="tool favbtn" class:on={app.favOnly} role="switch" aria-checked={app.favOnly}
        title={app.favOnly ? "Όλα τα λεωφορεία στον χάρτη" : "Μόνο τα αγαπημένα στον χάρτη"} onclick={() => app.setFavOnly(!app.favOnly)}>
        <Icon name={app.favOnly ? "star-filled" : "star"} size={17} />{#if app.favOnly}<span>Δικά μου · {app.favorites.length}</span>{/if}
      </button>
    {:else}
      <button type="button" class="tool favbtn" aria-label="Αγαπημένα" title="Αγαπημένα" onclick={() => app.toggleFavs()}><Icon name="star" size={17} /></button>
    {/if}
    <button type="button" class="fold" aria-expanded={!collapsed} aria-controls="panel-body" bind:this={foldButton}
      aria-label={collapsed ? "Εμφάνιση λεπτομερειών" : "Απόκρυψη λεπτομερειών"} onclick={fold}>
      <svg viewBox="0 0 12 8" width="14" height="10" aria-hidden="true" class={{ up: !collapsed }}>
        <path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
  {/snippet}
</section>
  <!-- Under the bar, each on its own (no panel behind them): the connection's state and notices, the favourites' first
       tip. Not while a popover or a card stands under the bar: they would cover it. -->
  {#if !pop && !app.stack.length}
  <div class="under" style:top="calc(16px + env(safe-area-inset-top) + {panelH}px + 10px)">
    <!-- A phone's home screen has it under its search and chips (NowPanel): here it sat behind them. -->
    {#if !(narrow.current && app.tab === "now")}<StatusBanner {app} />{/if}
    <!-- Favourites only (B7): its first-time tip, on its own under the bar (no panel behind it). -->
    {#if app.tab === "now" || app.tab === "alerts"}
      <!-- «Τώρα» holds the favourites and the notices itself: the bar stays a search bar. -->
    {:else if !app.favorites.length && !app.favHintSeen && !app.selected.length && !app.linked && !(pop && narrow.current)}
      <!-- Not under the chips, nor on a shared link: on a phone that row would cover the map. Nor while a popover covers
           the panel on a phone: the panel is inert then, and its «Εντάξει» could not be pressed. -->
      <div class="favtip" role="note" transition:fade={{ duration: 160 }}>
        <span class="ftic"><Icon name="star-filled" size={15} /></span>
        <span class="ftx"><b>Μόνο τα δικά σου.</b> Πάτα το αστέρι σε στάση ή γραμμή, και μετά εδώ, για να βλέπεις μόνο αυτά.</span>
        <button type="button" onclick={() => app.dismissFavHint()}>Εντάξει</button>
      </div>
    {/if}
  </div>
  {/if}



<!-- The popover of a map button opens on the right, beside the buttons (on a phone over the panel). -->
{#if pop}
  <div class="popwrap" class:raised={pop === "layers" || pop === "help"} class:tabbed={pop === "trip"} class:page={pop === "layers" && narrow.current} style:--ph="{panelH}px">
    {#if pop === "trip"}
      {#if !app.cityInfo.plan}
        <div class="pop"><p class="hint">Οι οδηγίες (από εδώ ως εκεί) έρχονται σύντομα {app.cityInfo.inName}. Ως τότε, δες τις γραμμές και τις στάσεις στον χάρτη.</p></div>
      {:else}
        {#await import("./TripPlanner.svelte")}
          <div class="pop loadp" role="status" aria-label="Φόρτωση"><i class="spin" aria-hidden="true"></i></div>
        {:then m}
          <m.default {app} onclose={closeTrip} />
        {:catch}
          <div class="pop"><p class="hint">Δεν φόρτωσε. Έλεγξε τη σύνδεση και πάτα ξανά την πυξίδα.</p></div>
        {/await}
      {/if}
    {:else if pop === "help"}
      <div class="pop" id="pop-help" role="dialog" tabindex="-1" aria-label="Τι σημαίνει κάθε σύμβολο">
        <button type="button" class="feedback" onclick={() => { toggle("help"); dispatchEvent(new Event("openfeedback")); }}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>
          Δώσε feedback ή πες μας ένα πρόβλημα
        </button>
        <HelpPop />
      </div>
    {:else if pop === "layers"}
      <div class="pop" id="pop-layers" role="dialog" aria-label="Ρυθμίσεις" aria-modal={narrow.current}>
        <MapSettings {app} {cityMissing} {cityAge} {oldest} onclose={() => (pop = null)} />
      </div>
    {/if}
  </div>
{/if}

<div class="rail" role="toolbar" aria-label="Εργαλεία χάρτη">
  <button type="button" class="tool three" class:on={app.threeD} aria-pressed={app.threeD}
    aria-label="Τρισδιάστατη προβολή (beta)" data-tip="3D (beta, σε δοκιμή): κτίρια, δέντρα και τα λεωφορεία σε μοντέλο, με κλίση του χάρτη (δύο δάχτυλα ή δεξί κλικ για περιστροφή)"
    onpointerenter={() => void preloadThree()} onfocus={() => void preloadThree()}
    onclick={() => app.setThreeD(!app.threeD)}>3D<span class="beta" aria-hidden="true">β</span></button>
  {#if app.threeD}
    <!-- The metro under the street: the street dims and the buildings turn see-through, the tunnels show. -->
    <button type="button" class="tool utool" class:on={app.under} aria-pressed={app.under} aria-label="Λειτουργία μετρό: μόνο το υπόγειο"
      data-tip="Λειτουργία μετρό: μόνο τα τούνελ και τα τρένα, κάτω από τον δρόμο. Πάτα ξανά για να βγεις" onclick={() => (app.under = !app.under)}>
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 6.5h16" /><path d="M4 17v-4.5a6 6 0 0 1 12 0V17" /><path d="M7.5 17v-3.2h5V17" />
      </svg>
    </button>
  {/if}
  <button type="button" class="tool" class:on={pop === "layers"} class:filtering={app.only.fresh || app.only.onTime} aria-expanded={pop === "layers"} aria-controls="pop-layers"
    bind:this={layersButton} aria-label="Ρυθμίσεις χάρτη" data-tip="Ρυθμίσεις χάρτη: τι δείχνει, θέμα, 3D, φίλτρα" onclick={() => toggle("layers")}>
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
      <path d="M2 10S5 4.8 10 4.8 18 10 18 10 15 15.2 10 15.2 2 10 2 10z" /><circle cx="10" cy="10" r="2.5" />
    </svg>
  </button>
  <button type="button" class="tool tripb" class:on={pop === "trip"} class:pinned={!!app.tripEnds && pop !== "trip"} aria-expanded={pop === "trip"} bind:this={tripButton}
    aria-label="Διαδρομή: ποιες γραμμές με πάνε" data-tip="Διαδρομή: διάλεξε Α και Β και δες ποιες γραμμές σε πάνε" onclick={() => toggle("trip")}>
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
      <circle cx="10" cy="10" r="8" /><path d="M12.8 7.2l-1.6 4-4 1.6 1.6-4z" />
    </svg>
  </button>
  <button type="button" class="tool helpb" class:on={pop === "help"} aria-expanded={pop === "help"} aria-controls="pop-help"
    aria-label="Τι σημαίνει κάθε σύμβολο" data-tip="Τι σημαίνει κάθε σύμβολο και χρώμα στον χάρτη" onclick={() => toggle("help")} bind:this={helpButton}>
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="10" cy="10" r="8" /><path d="M7.8 7.9a2.3 2.3 0 1 1 3.3 2.1c-.7.4-1.1.8-1.1 1.6" /><circle cx="10" cy="14.2" r=".5" fill="currentColor" />
    </svg>
  </button>
</div>

<style>
  /* One floating glass card over the map (the glass recipe: app.css): top left, 16 px in from the edges. */
  .panel { position: absolute; z-index: 5; top: calc(16px + env(safe-area-inset-top)); left: 16px; width: 400px;
    max-width: calc(100% - 76px); padding: 12px 14px; border: 0; border-radius: var(--radius); background: var(--glass-strong); --card: var(--glass-fill); --card-border: var(--glass-line); -webkit-backdrop-filter: var(--glass-fx); backdrop-filter: var(--glass-fx); box-shadow: var(--glass-rim); text-shadow: var(--glass-text); }
  .panel.compact { width: 400px; max-width: calc(100% - 76px); }   /* as wide as the cards below it */
  /* The home bar: a search pill and a round layers button, floating on the map with no panel behind them. */
  .panel.home, .panel.home.compact { width: 400px; max-width: calc(100% - 32px); padding: 0; background: none; border: 0; box-shadow: none;
    -webkit-backdrop-filter: none; backdrop-filter: none; text-shadow: none; }
  .homebar { display: flex; gap: 10px; }
  .homebar[hidden] { display: none; }
  .where { flex: 1; min-width: 0; height: 52px; display: flex; align-items: center; gap: 10px; padding: 0 18px; border: 0;
    border-radius: 26px; color: color-mix(in srgb, var(--fg) 82%, transparent); font: inherit; font-size: 16px; font-weight: 600; line-height: 1;
    cursor: pointer; background: var(--glass); -webkit-backdrop-filter: var(--glass-fx); backdrop-filter: var(--glass-fx); box-shadow: var(--glass-rim); text-shadow: var(--glass-text); }
  .homebar .round { flex: none; width: 52px; height: 52px; display: flex; align-items: center; justify-content: center; padding: 0;
    border: 0; border-radius: 50%; color: var(--fg); cursor: pointer; background: var(--glass); -webkit-backdrop-filter: var(--glass-fx); backdrop-filter: var(--glass-fx); box-shadow: var(--glass-rim); text-shadow: var(--glass-text); }
  .where:focus-visible, .homebar .round:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .sr { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  #panel-body { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); }
  .tools { display: flex; align-items: center; gap: 2px; }
  .badge { display: inline-flex; align-items: center; gap: 8px; height: 26px; padding: 0 10px; border-radius: 13px; background: var(--control);
    font-size: 12px; font-weight: 600; line-height: 1; color: var(--muted); white-space: nowrap; }
  .badge i { width: 8px; height: 8px; border-radius: 50%; background: var(--none); }
  .badge.stale { background: var(--bad-bg); color: var(--late3); }
  .badge.stale i { background: var(--late3); }
  .tool { display: grid; place-items: center; flex: none; width: 40px; height: 40px; margin: 0; padding: 0; border: 0; border-radius: 12px;
    background: none; color: var(--muted); cursor: pointer; }
  .tool:hover, .tool.on { background: var(--control); color: var(--fg); }
  /* The star: a filter for the map; on, it says what the map shows. */
  .sep { flex: none; width: 1px; height: 24px; margin: 0 4px; background: var(--border); }
  .favbtn { width: auto; min-width: 40px; display: flex; align-items: center; justify-content: center; gap: 7px; padding: 0 10px; font: inherit; font-size: 13px; font-weight: 800; line-height: 1; }
  .favbtn.on { background: color-mix(in srgb, var(--star) 18%, transparent); color: var(--star); }
  .favbtn.on:hover { background: color-mix(in srgb, var(--star) 26%, transparent); color: var(--star); }
  @media (pointer: coarse) { .favbtn { height: 44px; min-width: 44px; } }
  /* The first time: what the star does, once. */
  .under { position: absolute; z-index: 5; left: 16px; width: 400px; max-width: calc(100% - 76px); display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
  .under > :global(*) { pointer-events: auto; }
  .favtip { box-sizing: border-box; display: flex; align-items: center; gap: 12px;
    padding: 12px 12px 12px 14px; border-radius: 22px; background: color-mix(in srgb, var(--star) 13%, var(--surface));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--star) 34%, transparent), 0 8px 24px rgba(0, 0, 0, .3); }
  .ftic { flex: none; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border-radius: 50%;
    background: color-mix(in srgb, var(--star) 18%, transparent); color: var(--star); }
  .ftx { flex: 1; min-width: 0; font-size: 12.5px; line-height: 1.35; color: var(--muted); }
  .ftx b { color: var(--fg); }
  .favtip button { flex: none; height: 32px; padding: 0 10px; border: 0; border-radius: 10px; background: none; color: var(--star); font: inherit;
    font-size: 12.5px; font-weight: 800; line-height: 1; cursor: pointer; }
  .favtip button:hover { background: color-mix(in srgb, var(--star) 14%, transparent); }
  .shapes .ico { flex: none; width: 16px; height: 16px; margin-right: 6px; }
  .shapes .disc { display: inline-grid; place-items: center; flex: none; width: 16px; height: 16px; margin-right: 6px; border-radius: 50%;
    border: 1.5px solid #fff; box-shadow: 0 0 0 1px rgba(0, 0, 0, .15); box-sizing: border-box; }
  .shapes .disc img { display: block; width: 19px; height: 19px; }
  /* A map filter is on: some vehicles are hidden. */
  .tool { position: relative; }
  .tool.filtering::after, .tool.pinned::after { content: ""; position: absolute; top: 6px; right: 6px; width: 7px; height: 7px;
    border-radius: 50%; background: var(--accent); }
  /* The map buttons (right, under the zoom and locate buttons) and the popover that opens beside them: one themed
     column with the same corners and size as the zoom and locate group above it (app.css). */
  /* The map's buttons, top right: 3D, underground, settings, route, help; the locate and zoom buttons are at the
     bottom right (MapView), the zoom last. */
  .rail { position: absolute; z-index: 5; top: calc(16px + env(safe-area-inset-top)); right: 16px; width: 40px; display: flex;
    flex-direction: column; border-radius: 20px; background: var(--glass); -webkit-backdrop-filter: var(--glass-fx); backdrop-filter: var(--glass-fx); box-shadow: var(--glass-rim); text-shadow: var(--glass-text); }
  .rail .tool { width: 40px; height: 40px; border-radius: 0; color: var(--fg); }
  .rail .tool + .tool { border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent); }
  .rail .tool:first-child { border-radius: 20px 20px 0 0; }
  .rail .tool:last-child { border-radius: 0 0 20px 20px; }
  .rail .tool:hover { background: color-mix(in srgb, var(--control) 60%, transparent); }
  .rail .tool.on { background: var(--accent-bg); color: var(--accent); }
  .rail .tool.filtering::after, .rail .tool.pinned::after { top: 5px; right: 5px; }
  .rail .tool.three { position: relative; font: 700 12px/1 var(--font); letter-spacing: .02em; }
  /* 3D is in beta: a small amber tag on its button. */
  .beta { position: absolute; top: 3px; right: 3px; width: 13px; height: 13px; display: flex; align-items: center; justify-content: center; border-radius: 50%;
    background: var(--late1); color: #1a1200; font: 800 9px/1 var(--font); letter-spacing: 0; }
  /* What a button does: beside it, on hover or keyboard focus (no tooltip on a touch screen; the popover itself opens). */
  .rail .tool::before { content: attr(data-tip); position: absolute; right: calc(100% + 10px); top: 50%; translate: 0 -50%; width: max-content;
    max-width: 220px; padding: 7px 10px; border-radius: 10px; background: var(--surface); color: var(--fg);
    box-shadow: var(--shadow-sm); font-size: 12px; font-weight: 500; line-height: 1.35; white-space: normal; text-align: left; pointer-events: none;
    opacity: 0; transition: opacity .12s; }
  @media (hover: hover) { .rail .tool:not(.on):hover::before { opacity: 1; transition-delay: .35s; } }
  .rail .tool:not(.on):focus-visible::before { opacity: 1; }
  .popwrap { position: absolute; z-index: 5; top: calc(16px + env(safe-area-inset-top)); right: 68px; width: 360px; max-width: calc(100% - 76px);
    max-height: calc(100dvh - 32px - env(safe-area-inset-top)); display: flex; flex-direction: column; }
  .popwrap.raised { z-index: 8; }   /* the map menu over the info card */
  .pop { min-height: 0; padding: 16px; font-size: 13px; border: 0;
    border-radius: var(--radius); background: var(--glass-strong); --card: var(--glass-fill); --card-border: var(--glass-line); -webkit-backdrop-filter: var(--glass-fx); backdrop-filter: var(--glass-fx); box-shadow: var(--glass-rim); text-shadow: var(--glass-text); box-sizing: border-box; overflow-y: auto; overscroll-behavior: contain; }
  .pop p { margin: 0 0 8px; }
  .pop .feedback { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 44px;
    margin: 0 0 12px; border: 0; border-radius: var(--radius-sm); background: var(--accent); color: var(--on-accent); font: inherit; font-size: 14px;
    font-weight: 600; line-height: 1; cursor: pointer; }
  /* A phone with lines on the map (compact mockup 15Γ): no panel behind; the search pill, then the lines' pills and the
     round glass buttons on one row, centred on each other. */
  @media (max-width: 719px) {
    .panel.mbar { padding: 0; background: none; box-shadow: none; -webkit-backdrop-filter: none; backdrop-filter: none; text-shadow: none; }
    .mbar .mwhere { width: 100%; margin-bottom: 10px; }
    .mbar .mwhere :global(svg) { color: var(--accent); }
    .mbar .tool.add, .mbar .sep { display: none; }
    .mbar .bar :global(.find) { display: none; }   /* the pill above is the search */
    .mbar .tool, .mbar .fold { width: 36px; height: 36px; min-width: 36px; padding: 0; display: flex; align-items: center; justify-content: center; border: 0; border-radius: 18px;
      background: color-mix(in srgb, var(--surface) 62%, transparent); -webkit-backdrop-filter: blur(18px) saturate(160%); backdrop-filter: blur(18px) saturate(160%);
      box-shadow: 0 2px 8px rgb(0 0 0 / .35), inset 0 0 0 1px var(--card-border, var(--border)); color: var(--fg); }
    .mbar .favbtn.on { width: auto; padding: 0 12px; background: color-mix(in srgb, var(--star) 22%, var(--surface)); color: var(--star); }
    .mbar #panel-body:not([hidden]) { margin-top: 10px; padding: 12px 14px; border-radius: 20px; background: var(--glass-strong);
      -webkit-backdrop-filter: var(--glass-fx); backdrop-filter: var(--glass-fx); box-shadow: var(--glass-rim); }
  }
  .loadp { display: flex; align-items: center; justify-content: center; min-height: 64px; }
  .spin { width: 22px; height: 22px; border-radius: 50%; border: 2.5px solid color-mix(in srgb, var(--fg) 18%, transparent); border-top-color: var(--accent); animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .hint { color: var(--muted); font-size: 12px; }
  .field > span { display: block; color: var(--muted); font-size: 12px; margin-bottom: 6px; }
  .seg { display: flex; gap: 4px; padding: 4px; border-radius: var(--radius-sm); background: var(--control); margin-bottom: 10px; }
  .fold { flex: none; display: grid; place-items: center; width: 40px; height: 40px; margin: 0; padding: 0; border: 0; background: none;
    color: var(--muted); cursor: pointer; border-radius: 12px; }
  .fold:hover { background: var(--control); color: var(--fg); }
  .fold svg { transition: transform .15s; }
  .fold svg.up { transform: rotate(180deg); }
  .muted { color: var(--muted); font-size: 13px; margin-top: 4px; }
  .stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 10px 0 4px; }
  .stats > div { padding: 10px 12px; border-radius: var(--radius-sm); background: var(--control); }
  .stats b { display: block; font-size: 18px; font-weight: 700; line-height: 1.15; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .stats small { font-size: 12px; font-weight: 600; color: var(--muted); }
  .stats span { display: block; margin-top: 2px; color: var(--muted); font-size: 11px; font-weight: 500; line-height: 1.25; }
  .legend .age { margin-right: 4px; font-size: 10px; font-variant-numeric: tabular-nums; }
  .focus { display: flex; align-items: center; gap: 2px; min-height: 34px; margin: 8px 0 0; padding: 0 2px 0 12px;
    border: 0; border-radius: 17px; background: var(--accent-bg); color: var(--accent); font-size: 12px; font-weight: 600; }
  .focus span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.2; }
  .focus button { flex: none; display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 15px;
    background: none; color: inherit; font-size: 14px; cursor: pointer; }
  .focus button:hover { background: var(--control); }
  .focus svg { transition: transform .15s; }
  .focus svg.up { transform: rotate(180deg); }
  .strike { display: flex; align-items: center; gap: 2px; min-height: 36px; margin-top: 10px; padding: 0 2px 0 12px; border-radius: var(--radius-sm);
    background: var(--late3); color: var(--on-accent); font-size: 13px; font-weight: 600; }
  .strike a { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: inherit; text-decoration: none; line-height: 1.2; }
  .strike a:hover { text-decoration: underline; text-underline-offset: 3px; }
  .strike button { flex: none; display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 9px;
    background: none; color: inherit; font-size: 14px; cursor: pointer; }
  @media (pointer: coarse) { .strike { min-height: 44px; } .strike button { width: 44px; height: 44px; } }
  .hit { display: flex; align-items: center; gap: 6px; margin-top: 10px; padding: 8px 4px 8px 12px; border-radius: var(--radius-sm);
    background: var(--accent); color: var(--on-accent); font-size: 14px; font-weight: 600; }
  .hit span { flex: 1; line-height: 1.3; }
  .hit button { display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 9px; background: none;
    color: inherit; font-size: 18px; cursor: pointer; }
  .legend { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin: 12px 0 0; font-size: 12px; font-weight: 500; }
  .legend > span { display: inline-flex; align-items: center; line-height: 1.2; }
  .legend .lead { color: var(--fg); font-weight: 600; }
  .legend i { display: inline-block; flex: none; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; }
  [hidden] { display: none !important; }
  @media (max-width: 719px) {
    .panel { left: 16px; right: 68px; width: auto; max-width: none; padding: 10px 12px; }
    .panel.home, .panel.home.compact { left: 16px; right: 16px; width: auto; max-width: none; }
    .panel.compact { right: auto; max-width: calc(100% - 84px); }
    .rail { top: calc(16px + env(safe-area-inset-top)); right: 16px; }
    .popwrap { top: calc(16px + env(safe-area-inset-top)); left: 16px; right: 68px; width: auto; max-width: none;
      max-height: calc(100dvh - 24px - env(safe-area-inset-top)); }
    .stats b { font-size: 16px; }
  }
  /* Touch: 44 px buttons (B10), as the map's own (app.css). Above the rail: the zoom pair and the locate button. */
  @media (pointer: coarse) {
    .rail { width: 44px; top: calc(16px + env(safe-area-inset-top)); }
    .rail .tool { width: 44px; height: 44px; }
    .popwrap { top: calc(16px + env(safe-area-inset-top)); right: 68px; max-width: calc(100% - 80px);
      max-height: calc(100dvh - 32px - env(safe-area-inset-top)); }
    .panel { max-width: calc(100% - 80px); }
  }
  /* The planner is the «Ταξίδι» tab: on a phone it stops above the tab bar. */
  /* On a computer the planner is the left column, under the panel and over the tab bar, as the cards are: the map
     and its buttons stay free on the right. */
  @media (min-width: 720px) {
    .popwrap.tabbed { top: calc(28px + var(--ph, 60px) + env(safe-area-inset-top)); left: 16px; right: auto; width: 420px; max-width: calc(100% - 84px);
      max-height: calc(100dvh - 36px - var(--ph, 60px) - 92px - env(safe-area-inset-top)); }
  }
  /* Wide enough that the tab bar (in the middle) is clear of the column: the planner goes down to the window's foot. */
  @media (min-width: 1180px) {
    .popwrap.tabbed { max-height: calc(100dvh - 44px - var(--ph, 60px) - env(safe-area-inset-top)); }
  }
  /* A phone: above the tab bar and the map's credits line over it. */
  @media (max-width: 719px) { .popwrap.tabbed { max-height: calc(100dvh - 60px - env(safe-area-inset-top) - env(safe-area-inset-bottom)) !important; } }   /* no tab bar */
  /* A phone, a trip's details open: a sheet at the foot, over the tab bar, so the route shows on the map above it. */
  @media (max-width: 719px) {
    .popwrap.tabbed:has(:global(.rv)) { top: auto !important; bottom: 0; left: 0 !important; right: 0 !important; width: auto !important; max-width: none !important; height: 46dvh;
      max-height: 46dvh !important; animation: sheetUp .32s cubic-bezier(.2, .8, .2, 1); }
    @keyframes sheetUp { from { transform: translateY(40px); opacity: 0; } }
  }
  @media (max-width: 719px) and (prefers-reduced-motion: reduce) { .popwrap.tabbed:has(:global(.rv)) { animation: none; } }
  /* The trip's sheet with its handle (TripPlanner sets data-tripsheet: peek, half or full; data-tripdrag while a
     finger moves it): the search bar and the tab bar step away so the map gets the room, the sheet goes to the foot. */
  @media (max-width: 719px) {
    :global(:root[data-tripsheet]) .panel { display: none; }
    /* Edge to edge at the foot, as the picked route's sheet under it (no margins to snap out to); at most 72 % of the
       screen high, so the route on the map stays in view. */
    :global(:root[data-tripsheet]) .popwrap.tabbed:has(:global(.rv)) { top: auto !important; bottom: 0 !important; height: var(--trip-h, 52dvh);
      max-height: none !important; transition: height .26s cubic-bezier(.2, .8, .2, 1); }
    :global(:root[data-tripsheet="peek"]) { --trip-h: var(--trip-peek, 200px); }
    :global(:root[data-tripsheet="half"]) { --trip-h: 52dvh; }
    :global(:root[data-tripsheet="full"]) { --trip-h: 72dvh; }
    :global(:root[data-tripfree]) .popwrap.tabbed:has(:global(.rv)) { height: var(--trip-free) !important; }
    :global(:root[data-tripdrag]) .popwrap.tabbed:has(:global(.rv)) { height: var(--trip-drag) !important; transition: none; }
  }
  @media (max-width: 719px) {
    :global(:root[data-sheet]) .popwrap { left: 8px !important; right: 8px !important; width: auto; max-width: none; }
    :global(:root[data-sheet]) .popwrap.tabbed:has(:global(.rv)) { left: 0 !important; right: 0 !important; }   /* the route's sheet: edge to edge */
    :global(:root[data-sheet]) .rail { opacity: 0; pointer-events: none; transform: translateX(12px); }
    :global(:root[data-sheet]) .panel:not(.home) { right: 16px; width: auto; max-width: none; }
    .under { right: 68px; width: auto; max-width: none; }
    .rail { transition: opacity .2s, transform .25s cubic-bezier(.2, .8, .2, 1); }
  }
  @media (pointer: coarse) and (max-width: 719px) {
    .rail { top: calc(16px + env(safe-area-inset-top)); right: 16px; }
    .panel, .popwrap { right: 72px; }
    .popwrap { top: calc(16px + env(safe-area-inset-top)); max-width: none; max-height: calc(100dvh - 32px - env(safe-area-inset-top)); }
    .panel.compact { max-width: calc(100% - 88px); }
  }
  /* A phone: the settings are a page of their own over the map, cards and tab bar (compact mockup 11). */
  @media (max-width: 719px) {
    :global(:root) .popwrap.page[class] { position: fixed; inset: 0 !important; z-index: 20; width: auto; max-width: none !important; max-height: none !important;
      background: var(--bg); animation: pageIn .26s cubic-bezier(.2, .8, .2, 1); }
    .popwrap.page .pop { flex: 1; padding: 0; border-radius: 0; background: var(--bg); -webkit-backdrop-filter: none; backdrop-filter: none; box-shadow: none;
      text-shadow: none; --card: inherit; --card-border: inherit; }
    @keyframes pageIn { from { transform: translateX(24px); opacity: 0; } }
  }
  @media (max-width: 719px) and (prefers-reduced-motion: reduce) { :global(:root) .popwrap.page[class] { animation: none; } }
  /* A phone, the home sheet lowered (compact mockup 15Γ): the search and chips are the sheet's, on top; the map's
     buttons go to the bottom right in one column (layers, 3D), above locate; the planner and the legend are elsewhere. */
  @media (max-width: 719px) {
    :global(:root[data-homepeek]) .homebar { display: none; }
    :global(:root[data-homepeek]) .rail { top: auto; bottom: calc(var(--peek, 120px) + 16px + 52px + env(safe-area-inset-bottom)); }
    /* The compass shown (the map turned or in 3D): it sits over locate, the tools go up by it. */
    :global(:root[data-homepeek]:has(.north-ctl .turned, .north-ctl .tilted)) .rail { bottom: calc(var(--peek, 120px) + 16px + 104px + env(safe-area-inset-bottom)); }
    :global(:root[data-homepeek]) .rail .tripb, :global(:root[data-homepeek]) .rail .helpb { display: none; }
  }
  /* A phone with the home sheet (compact mockup 15Γ): its own search is on the map; the map's tools show only while
     the sheet is lowered (at the bottom right then). */
  @media (max-width: 719px) {
    :global(:root[data-home]) .homebar { display: none; }
    :global(:root[data-home]:not([data-homepeek])) .rail { display: none; }
  }
</style>
