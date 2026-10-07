<script lang="ts" module>
  import type { Place } from "../trip";

  // Kept across close and reopen.
  interface End { text: string; place: Place | null }
  const memo = { from: { text: "", place: null } as End, to: { text: "", place: null } as End, radius: 500, applied: "" };
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import { fetchLines } from "../api";
  import { MAX_LINES } from "../selection";
  import type { AppState } from "../state.svelte";
  import { centre, distM, findTrips, geocode, loadTripIndex, places, searchPlaces, toggleTripLine, type TripIndex } from "../trip";

  let { app, onclose }: { app: AppState; onclose: () => void } = $props();

  type Field = "from" | "to";
  const RADII = [300, 500, 800];
  const ME = "Η θέση μου";

  let ends = $state.raw<Record<Field, End>>({ from: memo.from, to: memo.to });
  let radius = $state(memo.radius);
  let data = $state.raw<{ ix: TripIndex; places: Place[]; known: Set<string>; stale: string | null } | null>(null);
  let failed = $state(false);
  let folded = $state(false);
  let openField = $state<Field | null>(null);
  let active = $state(0);
  // Address search (Nominatim) and my-location answers per field; `gen` drops answers to an old text.
  let found = $state.raw<Record<Field, Place[] | null>>({ from: null, to: null });
  let busy = $state.raw<Record<Field, string | null>>({ from: null, to: null });
  const set = <T,>(o: Record<Field, T>, f: Field, v: T) => ({ ...o, [f]: v });
  let gen = { from: 0, to: 0 };
  let err = $state<string | null>(null);

  $effect(() => { memo.from = ends.from; memo.to = ends.to; memo.radius = radius; });

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

  // Suggestions for the open field: my location, stop names, then the address search.
  type Opt = { kind: "me" } | { kind: "place"; place: Place } | { kind: "search" };
  const opts = $derived.by((): Opt[] => {
    if (!openField) return [];
    const text = ends[openField].text.trim();
    const own = text && text !== ME && data ? searchPlaces(data.places, text) : [];
    const addr = found[openField] ?? [];
    return [{ kind: "me" }, ...[...own, ...addr].map(place => ({ kind: "place" as const, place })),
      ...(text.length >= 3 && text !== ME && !found[openField] ? [{ kind: "search" as const }] : [])];
  });

  // Typing forgets the chosen place; Enter then takes the first suggestion after "my location".
  function edit(f: Field, text: string) {
    gen[f]++;
    ends = set(ends, f, { text, place: null });
    found = set(found, f, null);
    busy = set(busy, f, null);
    openField = f;
    active = text.trim() ? 1 : 0;
  }

  function choose(f: Field, o: Opt) {
    if (o.kind === "me") return locate(f);
    if (o.kind === "search") return search(f);
    gen[f]++;
    ends = set(ends, f, { text: o.place.label, place: o.place });
    busy = set(busy, f, null);
    openField = null;
  }

  function locate(f: Field) {
    const g = ++gen[f];
    ends = set(ends, f, { text: ME, place: null });
    found = set(found, f, null);
    openField = null;
    busy = set(busy, f, "Εντοπισμός…");
    navigator.geolocation.getCurrentPosition(
      p => {
        if (g !== gen[f]) return;
        busy = set(busy, f, null);
        const acc = Math.round(p.coords.accuracy);
        ends = set(ends, f, { text: ME, place: { label: ME, hint: `±${acc} μ.`, pts: [[p.coords.latitude, p.coords.longitude]], lines: [] } });
      },
      e => {
        if (g !== gen[f]) return;
        busy = set(busy, f, null);
        ends = set(ends, f, { text: "", place: null });
        err = e.code === 1 ? "Ο browser δεν επιτρέπει πρόσβαση στην τοποθεσία." : "Δεν βρέθηκε η τοποθεσία σου. Δοκίμασε ξανά ή γράψε μια περιοχή.";
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  async function search(f: Field) {
    const g = ++gen[f], text = ends[f].text;
    busy = set(busy, f, "Αναζήτηση…");
    try {
      const r = await geocode(text);
      if (g !== gen[f]) return;
      found = set(found, f, r);
      openField = f;
      active = Math.min(1, r.length);
      if (!r.length) err = `Δεν βρέθηκε «${text}» στην Αττική.`;
    } catch (e) {
      if (g !== gen[f]) return;
      err = (e as Error).message === "busy" ? "Η αναζήτηση διευθύνσεων είναι απασχολημένη. Δοκίμασε σε λίγο." : "Η αναζήτηση διευθύνσεων απέτυχε.";
    } finally {
      if (g === gen[f]) busy = set(busy, f, null);
    }
  }

  function swap() {
    gen.from++; gen.to++;
    ends = { from: ends.to, to: ends.from };
    found = { from: found.to, to: found.from };
    busy = { from: null, to: null };
  }

  // Both ends set: the lines, applied to the map at once (a new trip replaces the picks).
  const from = $derived(ends.from.place), to = $derived(ends.to.place);
  const tooClose = $derived(!!from && !!to && Math.min(...from.pts.flatMap(a => to.pts.map(b => distM(a, b)))) < radius);
  const trips = $derived(data && from && to && !tooClose ? findTrips(data.ix, from.pts, to.pts, radius, data.known) : null);

  // A and B on the map whenever both ends are set (again after a reopen).
  $effect(() => { app.tripEnds = from && to ? { from: centre(from.pts), to: centre(to.pts) } : null; });

  let shownOnce = false;
  // Once per trip: reopening the planner must not undo picks changed since.
  $effect(() => {
    if (!trips || !from || !to) return;
    const key = JSON.stringify([from.pts, to.pts, radius]);
    if (key === memo.applied) return;
    memo.applied = key;
    untrack(() => {
      app.showTrip(trips.map(t => ({ id: t.line, variants: t.variants.map(v => v.id) })));
    });
    // On a phone, the first trip folds the planner to show the map; later edits keep it open.
    if (trips.length && !shownOnce && matchMedia("(max-width: 719px)").matches) folded = true;
    shownOnce = true;
  });

  function close() {
    app.tripEnds = null;
    onclose();
  }

  const stop = (k: number) => data?.ix.s[k][0] ?? "";
  const metres = (m: number) => (m < 50 ? "δίπλα" : `≈ ${Math.round(m / 50) * 50} μ.`);

  function onkeydown(f: Field, e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openField = f;
      active = Math.max(0, Math.min(opts.length - 1, active + (e.key === "ArrowDown" ? 1 : -1)));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = openField === f ? opts[active] : undefined;
      if (o) choose(f, o);
    } else if (e.key === "Escape" && openField) {
      e.stopPropagation();
      openField = null;
    }
  }

  function focusIn(node: HTMLElement) { node.querySelector("input")?.focus(); }
</script>

<svelte:document onpointerdown={e => { if (openField && !(e.target as Element).closest?.(".field")) openField = null; }} />

<div class="trip" role="dialog" tabindex="-1" aria-labelledby="trip-h" {@attach focusIn}
  onkeydown={e => { if (e.key === "Escape" && !openField) { e.stopPropagation(); close(); } }}>
  <header>
    <h3 id="trip-h">Διαδρομή χωρίς αλλαγή</h3>
    {#if trips?.length}
      <button type="button" class="icon" aria-expanded={!folded} aria-label={folded ? "Άνοιγμα" : "Σύμπτυξη"} onclick={() => (folded = !folded)}>
        <svg viewBox="0 0 12 8" width="14" height="10" aria-hidden="true" class:up={!folded}><path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
    {/if}
    <button type="button" class="icon" aria-label="Κλείσιμο" title="Κλείσιμο" onclick={close}>×</button>
  </header>

  {#if folded && from && to && trips}
    <button type="button" class="summary" onclick={() => (folded = false)}>
      {from.label} → {to.label} · {trips.length} {trips.length === 1 ? "γραμμή" : "γραμμές"}
    </button>
  {:else}
    {#each ["from", "to"] as const as f (f)}
      {@const e = ends[f]}
      <div class="field">
        <label for="trip-{f}">{f === "from" ? "Από" : "Προς"}</label>
        <input id="trip-{f}" type="search" autocomplete="off" spellcheck="false" enterkeyhint="search"
          placeholder={f === "from" ? "Η θέση μου, στάση ή περιοχή" : "Στάση ή περιοχή, π.χ. Ταύρος"}
          value={e.text} class:set={!!e.place}
          role="combobox" aria-expanded={openField === f} aria-controls="trip-{f}-list" aria-autocomplete="list"
          aria-activedescendant={openField === f && opts[active] ? `trip-${f}-${active}` : undefined}
          onfocus={() => { openField = f; active = 0; }} oninput={ev => edit(f, ev.currentTarget.value)} onkeydown={ev => onkeydown(f, ev)} />
        {#if busy[f]}<small class="note">{busy[f]}</small>{:else if e.place?.hint}<small class="note">{e.place.hint}</small>{/if}
        {#if openField === f}
          <ul id="trip-{f}-list" class="list" role="listbox">
            {#each opts as o, k (k)}
              <!-- svelte-ignore a11y_click_events_have_key_events (keyboard goes through the combobox input) -->
              <li id="trip-{f}-{k}" role="option" aria-selected={k === active} class:active={k === active}
                onpointerdown={ev => ev.preventDefault()} onclick={() => choose(f, o)}>
                {#if o.kind === "me"}📍 {ME}
                {:else if o.kind === "search"}🔎 Αναζήτηση διεύθυνσης «{e.text.trim()}»
                {:else}
                  <span>{o.place.label}</span>
                  <small>{o.place.lines.length ? o.place.lines.slice(0, 6).join(" · ") + (o.place.lines.length > 6 ? " …" : "") : o.place.hint}</small>
                {/if}
              </li>
            {/each}
            {#if found[f]?.length}<li class="credit" aria-hidden="true">Διευθύνσεις: © OpenStreetMap</li>{/if}
          </ul>
        {/if}
      </div>
      {#if f === "from"}
        <button type="button" class="swap" aria-label="Αντιστροφή αφετηρίας και προορισμού" title="Αντιστροφή" onclick={swap}>⇅</button>
      {/if}
    {/each}

    <div class="radius" role="radiogroup" aria-label="Περπάτημα έως τη στάση">
      <span>Περπάτημα έως</span>
      {#each RADII as r (r)}
        <button type="button" role="radio" aria-checked={radius === r} onclick={() => (radius = r)}>{r} μ.</button>
      {/each}
    </div>

    {#if err}<p class="warn" role="status">{err} <button type="button" class="link" onclick={() => (err = null)}>OK</button></p>{/if}
    {#if failed}
      <p class="warn">Δεν φόρτωσαν οι στάσεις. <button type="button" class="link" onclick={load}>Ξανά</button></p>
    {:else if !data}
      <p class="muted">Φόρτωση στάσεων…</p>
    {:else if tooClose}
      <p class="muted">Είναι πολύ κοντά: καλύτερα με τα πόδια.</p>
    {:else if trips && !trips.length}
      <p class="muted">Καμία γραμμή δεν πάει χωρίς αλλαγή. Δοκίμασε περισσότερο περπάτημα ή κοντινή περιοχή.</p>
    {:else if trips}
      <ol class="results">
        {#each trips as t, k (t.line)}
          {@const info = app.lineInfo.get(t.line)}
          {@const v = t.variants[0]}
          <li class:out={k >= MAX_LINES}>
            <button type="button" class="chip" style:--c={info?.color ?? "#3b5bdb"} style:--t={info?.text_color ?? "#fff"}
              aria-pressed={app.selected.includes(t.line)} title={info?.name}
              onclick={() => toggleTripLine(app, t)}>{t.line}</button>
            <span>{stop(v.from)} → {stop(v.to)}<br />
              <small>{t.stops} {t.stops === 1 ? "στάση" : "στάσεις"} · περπάτημα {metres(t.walk)}{#if k >= MAX_LINES} · εκτός χάρτη (έως {MAX_LINES}){/if}</small></span>
          </li>
        {/each}
      </ol>
      <p class="note">Απόσταση σε ευθεία, ως τη στάση και από τη στάση. Πάτα μια γραμμή για να τη δείξεις ή να την κρύψεις.</p>
    {:else}
      <p class="muted">Διάλεξε αφετηρία και προορισμό: οι γραμμές που τα συνδέουν θα φανούν στον χάρτη.</p>
    {/if}
    {#if data?.stale}<p class="note">Οι στάσεις είναι από τα δεδομένα της {data.stale}· οι γραμμές μπορεί να έχουν αλλάξει από τότε.</p>{/if}
  {/if}
</div>

<style>
  .trip { position: absolute; z-index: 6; top: calc(100% + 6px); left: 0; right: 0; padding: 10px 14px 12px; font-size: 13px;
    background: var(--panel); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow);
    backdrop-filter: blur(8px); box-sizing: border-box; max-height: calc(100vh - 160px); overflow-y: auto; overscroll-behavior: contain; }
  header { display: flex; align-items: center; gap: 4px; margin-bottom: 6px; }
  h3 { flex: 1; margin: 0; font-size: 14px; }
  .icon { display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 8px; background: none;
    color: var(--muted); font-size: 18px; cursor: pointer; }
  .icon:hover { background: var(--control); color: var(--fg); }
  .icon svg { transition: transform .15s; }
  .icon svg.up { transform: rotate(180deg); }
  .summary { width: 100%; min-height: 34px; border: 0; border-radius: 8px; background: var(--control); color: var(--fg);
    font-size: 13px; text-align: left; padding: 0 10px; cursor: pointer; }
  .field { position: relative; display: grid; grid-template-columns: 44px 1fr; align-items: center; gap: 0 6px; }
  .field label { color: var(--muted); font-size: 12px; }
  .field input { min-width: 0; height: 36px; padding: 0 10px; border: 1px solid var(--border); border-radius: 9px;
    background: var(--control); color: var(--fg); font-size: 14px; }
  .field input.set { border-color: var(--accent); }
  .field .note { grid-column: 2; }
  .list { position: absolute; z-index: 2; top: 38px; left: 50px; right: 0; max-height: 260px; overflow-y: auto; margin: 0;
    padding: 4px; list-style: none; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--shadow); }
  .list li { display: flex; flex-direction: column; padding: 7px 8px; border-radius: 7px; cursor: pointer; }
  .list li small { color: var(--muted); font-size: 11px; }
  .list li.active, .list li:hover { background: var(--control); }
  .list .credit { cursor: default; color: var(--muted); font-size: 11px; }
  .swap { display: block; margin: 0 0 0 50px; height: 22px; padding: 0 8px; border: 0; border-radius: 6px; background: none;
    color: var(--muted); cursor: pointer; font-size: 15px; }
  .swap:hover { background: var(--control); color: var(--fg); }
  .radius { display: flex; align-items: center; gap: 4px; margin: 10px 0 4px; color: var(--muted); font-size: 12px; }
  .radius span { flex: 1; }
  .radius button { min-height: 28px; padding: 0 8px; border: 0; border-radius: 7px; background: var(--control); color: var(--fg);
    font-size: 12px; cursor: pointer; }
  .radius button[aria-checked="true"] { background: var(--accent); color: #fff; font-weight: 600; }
  .results { margin: 8px 0 0; padding: 0; list-style: none; }
  .results li { display: flex; align-items: flex-start; gap: 8px; padding: 5px 0; }
  .results li.out { opacity: .6; }
  .results small { color: var(--muted); }
  .chip { flex: none; min-width: 46px; min-height: 28px; padding: 0 8px; border: 2px solid var(--c); border-radius: 14px;
    background: none; color: var(--fg); font-weight: 700; cursor: pointer; }
  .chip[aria-pressed="true"] { background: var(--c); color: var(--t); }
  .muted, .note { color: var(--muted); }
  .note { display: block; margin: 6px 0 0; font-size: 11px; }
  p.muted { margin: 10px 0 0; }
  .warn { margin: 8px 0 0; color: var(--late2); }
  .link { border: 0; background: none; color: var(--accent); text-decoration: underline; cursor: pointer; font-size: inherit; }
  @media (max-width: 719px) { .trip { max-height: calc(100vh - 120px); } }
</style>
