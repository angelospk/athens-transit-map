<script lang="ts" module>
  import type { Place } from "../trip";

  // Kept across close and reopen.
  interface End { text: string; place: Place | null }
  const memo = { from: { text: "", place: null } as End, to: { text: "", place: null } as End, radius: 500, n: 3, applied: "" };
</script>

<script lang="ts">
  import { tick, untrack } from "svelte";
  import { fetchLines } from "../api";
  import { MAX_LINES } from "../selection";
  import { canPush, startPush, stopPush } from "../push";
  import { encodeAlert } from "../tglink";
  import type { AppState } from "../state.svelte";
  import { alertTargets, boardings, centre, distM, findTrips, geocode, loadTripIndex, places, searchPlaces, suggest, termini, toggleTripLine, type TripIndex, type TripLine } from "../trip";

  let { app, onclose }: { app: AppState; onclose: () => void } = $props();

  type Field = "from" | "to";
  const FIELDS = ["from", "to"] as const;
  const RADII = [300, 500, 800];
  const ME = "Η θέση μου";
  const ALERT_S = 2 * 3600;
  const phone = () => matchMedia("(max-width: 719px)").matches;

  let ends = $state.raw<Record<Field, End>>({ from: memo.from, to: memo.to });
  let radius = $state(memo.radius);
  let n = $state(memo.n);
  let data = $state.raw<{ ix: TripIndex; places: Place[]; known: Set<string>; stale: string | null } | null>(null);
  let failed = $state(false);
  let folded = $state(false);
  let openField = $state<Field | null>(null);
  let activeKey = $state<string | null>(null);
  // Geocoder answers for the open field's text, and the request in flight (one per field).
  let geo = $state.raw<{ text: string; places: Place[] } | null>(null);
  let geoBusy = $state(false);
  let locating = $state<Field | null>(null);
  let err = $state<string | null>(null);
  const inputs: Record<Field, HTMLInputElement | undefined> = { from: undefined, to: undefined };
  let ctl: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let gen = 0;   // geocoder answers to an older edit are dropped
  const locGen = { from: 0, to: 0 };   // the same for each field's location request
  let closed = false;

  $effect(() => { memo.from = ends.from; memo.to = ends.to; memo.radius = radius; memo.n = n; });
  $effect(() => () => { ctl?.abort(); clearTimeout(timer); gen++; locGen.from++; locGen.to++; closed = true; });

  async function load() {
    failed = false;
    try {
      const [ix, lines] = await Promise.all([loadTripIndex(), fetchLines()]);
      data = { ix, places: places(ix), known: new Set(lines.lines.map(l => l.id)), stale: ix.v === lines.gtfs_version ? null : ix.v };
    } catch {
      failed = true;
    }
  }
  load();

  // Suggestions: my location for an empty field; else one short list (areas, stops, streets).
  type Opt = { key: string; me?: true; place?: Place };
  const keyOf = (p: Place) => `${p.kind}|${p.label}|${p.pts[0].join()}`;
  const opts = $derived.by((): Opt[] => {
    if (!openField) return [];
    const text = ends[openField].text.trim();
    if (!text || text === ME) return [{ key: "me", me: true }];
    const own = data ? searchPlaces(data.places, text, 6) : [];
    return suggest(own, geo?.text === text ? geo.places : []).map(place => ({ key: keyOf(place), place }));
  });
  const active = $derived(Math.max(0, opts.findIndex(o => o.key === activeKey)));

  function stopSearch() {
    gen++;
    ctl?.abort();
    clearTimeout(timer);
    geoBusy = false;
  }

  // Typing forgets the chosen place and asks the geocoder after a pause.
  function edit(f: Field, text: string) {
    stopSearch();
    locGen[f]++;
    if (locating === f) locating = null;
    ends = { ...ends, [f]: { text, place: null } };
    openField = f;
    activeKey = null;
    err = null;
    const q = text.trim();
    if (q.length < 3) return;
    const g = gen;
    geoBusy = true;
    timer = setTimeout(() => {
      ctl = new AbortController();
      geocode(q, ctl.signal).then(
        r => { if (g === gen) geo = { text: q, places: r }; },
        () => {},   // offline or busy: the stops still answer
      ).finally(() => { if (g === gen) geoBusy = false; });
    }, 350);
  }

  function choose(f: Field, o: Opt) {
    stopSearch();
    openField = null;
    if (o.me) return locate(f);
    ends = { ...ends, [f]: { text: o.place!.label, place: o.place! } };
    next(f);
  }

  // After a choice: on to the other field while it is empty, else close the keyboard.
  function next(f: Field) {
    const other: Field = f === "from" ? "to" : "from";
    if (!ends[other].place && !ends[other].text.trim()) inputs[other]?.focus();
    else inputs[f]?.blur();
  }

  function locate(f: Field) {
    const g = ++locGen[f];
    ends = { ...ends, [f]: { text: ME, place: null } };
    locating = f;
    navigator.geolocation.getCurrentPosition(
      p => {
        if (g !== locGen[f]) return;
        locating = null;
        const place: Place = { label: ME, hint: `±${Math.round(p.coords.accuracy)} μ.`, pts: [[p.coords.latitude, p.coords.longitude]], lines: [], kind: "me" };
        ends = { ...ends, [f]: { text: ME, place } };
        next(f);
      },
      e => {
        if (g !== locGen[f]) return;
        locating = null;
        ends = { ...ends, [f]: { text: "", place: null } };
        err = e.code === 1 ? "Ο browser δεν επιτρέπει πρόσβαση στην τοποθεσία." : "Δεν βρέθηκε η τοποθεσία σου. Δοκίμασε ξανά ή γράψε μια περιοχή.";
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  function swap() {
    stopSearch();
    locGen.from++; locGen.to++;
    locating = null;
    ends = { from: ends.to, to: ends.from };
  }

  // Both ends set: the lines, applied to the map at once (a new trip replaces the picks).
  const from = $derived(ends.from.place), to = $derived(ends.to.place);
  const tooClose = $derived(!!from && !!to && Math.min(...from.pts.flatMap(a => to.pts.map(b => distM(a, b)))) < radius);
  const trips = $derived(data && from && to && !tooClose ? findTrips(data.ix, from.pts, to.pts, radius, data.known) : null);

  // A and B on the map whenever both ends are set (again after a reopen).
  $effect(() => { app.tripEnds = from && to ? { from: centre(from.pts), to: centre(to.pts) } : null; });

  // Once per trip: reopening the planner must not undo picks changed since. On a phone, each new trip
  // folds the planner so the map shows.
  $effect(() => {
    if (!trips || !from || !to) return;
    const key = JSON.stringify([from.pts, to.pts, radius]);
    if (key === memo.applied) return;
    memo.applied = key;
    untrack(() => app.showTrip(trips.map(t => ({ id: t.line, variants: t.variants.map(v => v.id) }))));
    if (trips.length && phone()) {
      folded = true;
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
  });

  function close() {
    stopSearch();
    app.tripEnds = null;
    onclose();
  }

  // The lines of the trip that are on the map, for the folded summary and the alert: which, and where each goes.
  const onMap = $derived((trips ?? []).filter(t => app.selected.includes(t.line)));

  // Alert settings, folded until asked for: the stop to wait at (each line's own, or one of the stops
  // nearest the start), how early, and which of the trip's lines on the map. A new trip resets them.
  let alertOpen = $state(false);
  let boardName = $state("");
  let off = $state<string[]>([]);
  $effect(() => { void trips; boardName = ""; off = []; });
  const near = $derived(data && from && to && onMap.length ? boardings(data.ix, from.pts, to.pts, radius, onMap.map(t => t.line)) : []);
  const board = $derived(near.find(b => b.name === boardName) ?? null);
  const tickable = $derived((board ? board.lines.map(l => l.line) : onMap.map(t => t.line)).filter(l => app.selected.includes(l)));
  const targets = $derived(trips ? alertTargets(trips, app.selected, board, off) : []);
  const setTicked = (line: string, on: boolean) => { off = on ? off.filter(l => l !== line) : [...off, line]; };

  // The chosen alert as a link payload (src/lib/tglink.ts): for Telegram and for web push.
  const payload = $derived(data && !data.stale ? encodeAlert(data.ix, n, targets) : null);

  // Stop alert for the chosen lines, at the chosen stop: in the page, and as web push where the browser
  // has it (then it comes with the page closed). The permission prompt comes first, from the tap itself
  // (browsers ignore it later).
  const canNotify = typeof Notification !== "undefined";
  // iPhones give web push only to a web app opened from the Home Screen.
  const iosTab = typeof navigator !== "undefined" && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) &&
    !matchMedia("(display-mode: standalone)").matches && !(navigator as { standalone?: boolean }).standalone;
  // One alert at a time: a second tap while the first waits (permission, server) does nothing.
  let pushing = $state(false);
  async function alertMe() {
    if (pushing) return;
    pushing = true;
    try { await startAlert(); } finally { pushing = false; }
  }
  async function startAlert() {
    const t = trips, d = data, f = from, p = payload;
    if (!t || !d || !f) return;
    if (canNotify && Notification.permission === "default") await Notification.requestPermission().catch(() => {});
    // Registered before the alert starts: phones show notifications only through it.
    const reg = await navigator.serviceWorker?.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => null);
    if (closed || t !== trips) return;   // the trip changed while the browser asked
    const ix = d.ix;
    const lines = targets.map(l => ({ line: l.line, variants: l.variants.map(v => ({ id: v.id, i: v.i, name: ix.s[v.from][0] })) }));
    if (!lines.length) {
      err = onMap.length ? "Διάλεξε τουλάχιστον μία γραμμή." : "Καμία γραμμή της διαδρομής δεν είναι στον χάρτη: πάτα μία για να τη δείξεις.";
      return;
    }
    err = null;
    let push: { id: string; until: number } | null = null;
    if (reg && p && canPush() && Notification.permission === "granted") {
      const ready = await Promise.race([navigator.serviceWorker.ready, new Promise<null>(r => setTimeout(r, 5000, null))]);
      push = ready && (await startPush(ready, p));
      if (closed || t !== trips || p !== payload) { if (push) void stopPush(push.id); return; }
      if (!push) err = "Η ειδοποίηση δουλεύει μόνο με τη σελίδα ανοιχτή: ο server ειδοποιήσεων δεν απάντησε.";
    }
    app.setAlert({ n, until: push?.until ?? Math.floor(app.serverMs() / 1000) + ALERT_S, label: board?.name ?? f.label, lines, ...(push ? { push: push.id } : {}) });
    alertOpen = false;
  }

  // The same alert in Telegram (src/lib/tglink.ts).
  const BOT = "oasa_bus_bot";
  const tgLink = $derived(payload && `https://t.me/${BOT}?start=${payload}`);

  const stop = (k: number) => data?.ix.s[k][0] ?? "";
  const metres = (m: number) => (m < 50 ? "δίπλα" : `≈ ${Math.round(m / 50) * 50} μ.`);
  const icon = (p: Place) => ({ area: "◎", stop: "🚏", me: "📍", street: "⌖", poi: "•" })[p.kind ?? "street"];
  const shown = $derived(trips ? Math.min(trips.length, MAX_LINES) : 0);
  // Where a result goes: the variants that make the trip. The summary follows the direction shown on the map.
  const going = (t: TripLine) => (data ? termini(data.ix, t.line, t.variants.map(v => v.id)).join(" · ") : "");
  const goingNow = (t: TripLine) => (data ? termini(data.ix, t.line, app.focus[t.line] ?? t.variants.map(v => v.id)).join(" · ") : "");

  // New results, or the planner opened again: bring the list into view (not while a suggestion list is open).
  let resultsEl: HTMLElement | undefined = $state();
  $effect(() => {
    if (!trips?.length || folded || openField) return;
    void tick().then(() => resultsEl?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
  });

  function onkeydown(f: Field, e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openField = f;
      const k = Math.max(0, Math.min(opts.length - 1, active + (e.key === "ArrowDown" ? 1 : -1)));
      activeKey = opts[k]?.key ?? null;
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = openField === f ? opts[active] : undefined;
      if (o) choose(f, o);
    } else if (e.key === "Escape" && openField) {
      e.stopPropagation();
      openField = null;
    }
  }

  function focusIn(node: HTMLElement) {
    if (!phone() || !ends.from.place) node.querySelector("input")?.focus();   // a phone keeps the map until a tap
  }
</script>

<svelte:document onpointerdown={e => { if (openField && !(e.target as Element).closest?.(".ends")) openField = null; }} />

<div class="trip" role="dialog" tabindex="-1" aria-labelledby="trip-h" {@attach focusIn}
  onkeydown={e => { if (e.key === "Escape" && !openField) { e.stopPropagation(); close(); } }}>
  {#if folded && from && to && trips}
    <span id="trip-h" class="sr">Διαδρομή χωρίς αλλαγή</span>
    <div class="row">
      <button type="button" class="summary" aria-expanded="false" onclick={() => (folded = false)}>
        <b>{from.label} → {to.label}</b>
        <small>{trips.length} {trips.length === 1 ? "γραμμή" : "γραμμές"}{#if trips.length > MAX_LINES} · {MAX_LINES} στον χάρτη{/if}{#if app.alert} · 🔔{/if}</small>
        {#if onMap.length}
          <span class="lines">
            {#each onMap as t (t.line)}
              {@const info = app.lineInfo.get(t.line)}
              <span class="ln" style:--c={info?.color ?? "#3b5bdb"}><b>{t.line}</b>{#if goingNow(t)}<i>→ {goingNow(t)}</i>{/if}</span>
            {/each}
          </span>
        {/if}
      </button>
      <button type="button" class="icon" aria-label="Κλείσιμο διαδρομής" title="Κλείσιμο" onclick={close}>×</button>
    </div>
  {:else}
    <div class="row">
      <h3 id="trip-h">Διαδρομή χωρίς αλλαγή</h3>
      {#if trips?.length}
        <button type="button" class="icon" aria-label="Σύμπτυξη" title="Σύμπτυξη" onclick={() => (folded = true)}>
          <svg viewBox="0 0 12 8" width="14" height="10" aria-hidden="true"><path d="M1 6.5l5-5 5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
      {/if}
      <button type="button" class="icon" aria-label="Κλείσιμο διαδρομής" title="Κλείσιμο" onclick={close}>×</button>
    </div>

    <div class="ends">
      {#each FIELDS as f (f)}
        {@const e = ends[f]}
        <div class="field">
          <i class="dot {f}" aria-hidden="true">{f === "from" ? "A" : "B"}</i>
          <input id="trip-{f}" bind:this={inputs[f]} type="search" autocomplete="off" spellcheck="false" enterkeyhint="search"
            aria-label={f === "from" ? "Από" : "Προς"} placeholder={f === "from" ? "Από: η θέση μου, στάση, περιοχή" : "Προς: στάση ή περιοχή"}
            value={e.text} class:set={!!e.place}
            role="combobox" aria-expanded={openField === f} aria-controls="trip-{f}-list" aria-autocomplete="list"
            aria-activedescendant={openField === f && opts[active] ? `trip-${f}-${active}` : undefined}
            onfocus={() => { openField = f; }} oninput={ev => edit(f, ev.currentTarget.value)} onkeydown={ev => onkeydown(f, ev)} />
        </div>
        <!-- In the flow, not floating: a floating list is cut off by the planner's own scroll box. -->
        {#if openField === f}
            <ul id="trip-{f}-list" class="list" role="listbox" aria-label={f === "from" ? "Αφετηρία" : "Προορισμός"}>
              {#each opts as o, k (o.key)}
                <!-- svelte-ignore a11y_click_events_have_key_events (keyboard goes through the combobox input) -->
                <li id="trip-{f}-{k}" role="option" aria-selected={k === active} class:active={k === active}
                  onpointerdown={ev => ev.preventDefault()} onclick={() => choose(f, o)}>
                  {#if o.me}<span><i aria-hidden="true">📍</i> {ME}</span>
                  {:else if o.place}
                    <span><i aria-hidden="true">{icon(o.place)}</i> {o.place.label}</span>
                    <small>{o.place.lines.length ? o.place.lines.slice(0, 6).join(" · ") + (o.place.lines.length > 6 ? " …" : "") : o.place.hint ?? ""}</small>
                  {/if}
                </li>
              {:else}
                <li class="empty">{geoBusy ? "Αναζήτηση…" : "Δεν βρέθηκε στάση ή περιοχή με αυτό το όνομα."}</li>
              {/each}
              {#if geoBusy && opts.length}<li class="empty" aria-hidden="true">Αναζήτηση περιοχών…</li>{/if}
            </ul>
          {/if}
      {/each}
      <button type="button" class="swap" hidden={!!openField} aria-label="Αντιστροφή αφετηρίας και προορισμού" title="Αντιστροφή" onclick={swap}>⇅</button>
    </div>
    {#if locating}<p class="note">Εντοπισμός…</p>{/if}

    {#if err}<p class="warn" role="status">{err}</p>{/if}
    {#if failed}
      <p class="warn">Δεν φόρτωσαν οι στάσεις. <button type="button" class="link" onclick={load}>Ξανά</button></p>
    {:else if !data}
      <p class="note">Φόρτωση στάσεων…</p>
    {:else if tooClose}
      <p class="note">Είναι πολύ κοντά: καλύτερα με τα πόδια.</p>
    {:else if trips && !trips.length}
      <p class="note">Καμία γραμμή δεν πάει χωρίς αλλαγή. Δοκίμασε περισσότερο περπάτημα ή κοντινή περιοχή.</p>
    {:else if trips}
      <ol class="results" bind:this={resultsEl}>
        {#each trips as t, k (t.line)}
          {@const info = app.lineInfo.get(t.line)}
          {@const v = t.variants[0]}
          <li class:out={k >= MAX_LINES}>
            <button type="button" class="chip" style:--c={info?.color ?? "#3b5bdb"} style:--t={info?.text_color ?? "#fff"}
              aria-pressed={app.selected.includes(t.line)} title={info?.name}
              onclick={() => toggleTripLine(app, t)}>{t.line}</button>
            <span>{stop(v.from)} → {stop(v.to)}<br />
              <small>{#if going(t)}προς {going(t)} · {/if}{t.stops} {t.stops === 1 ? "στάση" : "στάσεις"} · περπάτημα {metres(t.walk)}{#if k >= MAX_LINES} · εκτός χάρτη (έως {MAX_LINES}){/if}</small></span>
          </li>
        {/each}
      </ol>
      {#if shown}
        <div class="alert">
          {#if app.alert}
            {@const a = app.alert}
            <span>🔔 {a.lines.map(l => l.line).join(", ")}: έως {a.n} {a.n === 1 ? "στάση" : "στάσεις"} πριν από {a.label}{a.push ? ", και με κλειστή σελίδα" : ""}.</span>
            <button type="button" class="link" onclick={() => app.setAlert(null)}>Ακύρωση</button>
            {#if tgLink}<a class="bell tg" href={tgLink} target="_blank" rel="noopener">Στο Telegram</a>{/if}
          {:else if data.stale}
            <small>Ειδοποίηση: όχι με παλιά δεδομένα στάσεων.</small>
          {:else}
            <button type="button" class="lead" aria-expanded={alertOpen} aria-controls="trip-alert" onclick={() => (alertOpen = !alertOpen)}>
              🔔 Ειδοποίηση
              <svg viewBox="0 0 12 8" width="12" height="8" aria-hidden="true" class:up={alertOpen}><path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>
          {/if}
        </div>
        {#if alertOpen && !app.alert && !data.stale}
          <div id="trip-alert" class="form">
            {#if near.length > 1}
              <label>Στάση
                <select bind:value={boardName}>
                  <option value="">η κοντινότερη κάθε γραμμής</option>
                  {#each near as b (b.name)}<option value={b.name}>{b.name} · {metres(b.walk)} · {b.lines.map(l => l.line).join(", ")}</option>{/each}
                </select>
              </label>
            {/if}
            <label>Πότε
              <select bind:value={n}>
                {#each [1, 2, 3, 4, 5] as k (k)}<option value={k}>{k === 1 ? "στην προηγούμενη στάση" : `${k} στάσεις πριν`}</option>{/each}
              </select>
            </label>
            <fieldset>
              <legend>Γραμμές</legend>
              {#each tickable as l (l)}
                {@const info = app.lineInfo.get(l)}
                <label class="ln" style:--c={info?.color ?? "#3b5bdb"}>
                  <input type="checkbox" checked={!off.includes(l)} onchange={e => setTicked(l, e.currentTarget.checked)} /><b>{l}</b>
                </label>
              {/each}
            </fieldset>
            <div class="go">
              <button type="button" class="bell" disabled={!targets.length || pushing} onclick={alertMe}>{pushing ? "…" : "Εδώ"}</button>
              {#if tgLink}<a class="bell tg" href={tgLink} target="_blank" rel="noopener">Στο Telegram</a>{/if}
            </div>
            <p class="note">Για 2 ώρες.
              {#if canPush()}Εδώ: και με κλειστή σελίδα ή κλειδωμένη οθόνη.
              {:else}Εδώ: όσο η σελίδα είναι ανοιχτή{canNotify ? "" : ", μόνο μέσα στη σελίδα"}.{/if}
              Telegram: και με κλειδωμένη οθόνη, από το @{BOT}.</p>
            {#if iosTab}
              <p class="note">iPhone, για ειδοποίηση εδώ με κλειδωμένη οθόνη: Κοινοποίηση → «Προσθήκη στην οθόνη Αφετηρίας», και άνοιξε τον χάρτη από το εικονίδιο.</p>
            {/if}
          </div>
        {/if}
      {/if}
    {:else}
      <p class="note">Διάλεξε από πού και προς τα πού: οι γραμμές που τα συνδέουν φαίνονται στον χάρτη.</p>
    {/if}

    <div class="foot">
      <label>Περπάτημα έως
        <select bind:value={radius}>{#each RADII as r (r)}<option value={r}>{r} μ.</option>{/each}</select>
      </label>
      {#if data?.stale}<small>Στάσεις από {data.stale}· μπορεί να έχουν αλλάξει.</small>{/if}
      {#if geo?.places.length}<small>Περιοχές: © OpenStreetMap</small>{/if}
    </div>
  {/if}
</div>

<style>
  .trip { min-height: 0; padding: 8px 12px 10px; font-size: 13px;
    background: var(--panel); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow);
    backdrop-filter: blur(8px); box-sizing: border-box; overflow-y: auto; overscroll-behavior: contain; }
  .sr { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .row { display: flex; align-items: center; gap: 4px; }
  h3 { flex: 1; margin: 0; font-size: 14px; }
  .icon { display: grid; place-items: center; flex: none; width: 34px; height: 34px; border: 0; border-radius: 8px; background: none;
    color: var(--muted); font-size: 20px; cursor: pointer; }
  .icon:hover { background: var(--control); color: var(--fg); }
  .summary { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; padding: 4px 8px; border: 0;
    border-radius: 8px; background: none; color: var(--fg); text-align: left; cursor: pointer; }
  .summary b { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
  .summary small { color: var(--muted); }
  .summary:hover { background: var(--control); }
  .lines { display: flex; flex-wrap: wrap; gap: 4px; max-width: 100%; margin-top: 4px; }
  .ln { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 0 8px; border: 2px solid var(--c);
    border-radius: 12px; font-size: 12px; line-height: 20px; }
  .ln i { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-style: normal; color: var(--muted); }
  .ends { position: relative; display: flex; flex-direction: column; gap: 6px; margin-top: 6px; padding-right: 38px; }
  .field { display: flex; align-items: center; gap: 6px; }
  .dot { flex: none; display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: #222; color: #fff;
    font: normal 700 11px system-ui, sans-serif; }
  /* 16px: iOS zooms into smaller inputs on focus. */
  .field input { flex: 1; min-width: 0; height: 38px; padding: 0 10px; border: 1px solid var(--border); border-radius: 9px;
    background: var(--control); color: var(--fg); font-size: 16px; }
  .field input.set { border-color: var(--accent); }
  .swap { position: absolute; right: 0; top: calc(50% - 20px); width: 34px; height: 40px; border: 0; border-radius: 8px; background: none;
    color: var(--muted); font-size: 18px; cursor: pointer; }
  .swap[hidden] { display: none; }
  .swap:hover { background: var(--control); color: var(--fg); }
  .list { margin: 0 -38px 0 26px; max-height: min(320px, 45dvh); overflow-y: auto; padding: 4px; list-style: none;
    background: var(--control); border-radius: 10px; }
  .list li { display: flex; flex-direction: column; padding: 8px; border-radius: 7px; cursor: pointer; }
  .list li i { font-style: normal; display: inline-block; width: 1.3em; text-align: center; }
  .list li small { padding-left: 1.6em; color: var(--muted); font-size: 11px; }
  .list li.active, .list li:hover { background: var(--panel); }
  .list li.empty { cursor: default; color: var(--muted); font-size: 12px; background: none; }
  .results { margin: 8px 0 0; padding: 0; list-style: none; }
  .results li { display: flex; align-items: flex-start; gap: 8px; padding: 4px 0; }
  .results li.out { opacity: .6; }
  .results small { color: var(--muted); }
  .chip { flex: none; min-width: 46px; min-height: 28px; padding: 0 8px; border: 2px solid var(--c); border-radius: 14px;
    background: none; color: var(--fg); font-weight: 700; cursor: pointer; }
  .chip[aria-pressed="true"] { background: var(--c); color: var(--t); }
  .alert { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
  .alert span { flex: 1; }
  .alert .lead { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 0 8px; margin-left: -8px; border: 0;
    border-radius: 8px; background: none; color: var(--fg); font-weight: 600; font-size: 13px; cursor: pointer; }
  .alert .lead:hover { background: var(--control); }
  .alert .lead svg.up { transform: rotate(180deg); }
  .form { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
  .form > label { display: flex; align-items: center; gap: 8px; color: var(--muted); }
  .form > label select { flex: 1; min-width: 0; }
  .form fieldset { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0; padding: 0; border: 0; }
  .form legend { float: left; margin-right: 2px; color: var(--muted); }
  .form .ln { min-height: 30px; cursor: pointer; }
  .form .ln input { margin: 0; accent-color: var(--c); }
  .go { display: flex; gap: 6px; }
  .bell:disabled { opacity: .5; cursor: default; }
  .bell.tg { display: inline-grid; place-items: center; background: #229ed9; text-decoration: none; }
  .bell { min-height: 34px; padding: 0 12px; border: 0; border-radius: 9px; background: var(--accent); color: #fff; font-weight: 600;
    font-size: 14px; cursor: pointer; }
  select { min-height: 34px; padding: 0 6px; border: 1px solid var(--border); border-radius: 8px; background: var(--control);
    color: var(--fg); font-size: 16px; }
  .foot { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin-top: 8px; color: var(--muted); font-size: 12px; }
  .foot label { display: flex; align-items: center; gap: 6px; }
  .note { display: block; margin: 8px 0 0; color: var(--muted); font-size: 12px; }
  .warn { margin: 8px 0 0; color: var(--late2); }
  .link { border: 0; background: none; color: var(--accent); text-decoration: underline; cursor: pointer; font-size: inherit; }
</style>
