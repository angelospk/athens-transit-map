<script lang="ts">
  // The search modal (B8): lines and stops of every mode, from the /v2 indexes (loaded once, cached 1 h).
  // Full screen on a phone, a 560 px dialog on a desktop. An empty query shows the favourites, then the last
  // picks. A pick closes the modal and replaces the card stack with that card.
  import { tick, untrack } from "svelte";
  import { fetchV2Lines, fetchV2Stops } from "../api";
  import { chipOf, findLines, findStops, lineStopPoints, pushRecent, toggleChip, type Chip, type Recent, type StopEntry } from "../finder";
  import type { V2Line } from "../v2";
  import type { AppState } from "../state.svelte";
  import Icon from "./Icon.svelte";

  let { app }: { app: AppState } = $props();

  const GROUP = 5, PAGE = 60, RECENT_KEY = "recent.v2";
  const KINDS = [["all", "Όλα"], ["lines", "Γραμμές"], ["stops", "Στάσεις"]] as const;
  const CHIPS: [Chip, string][] = [["bus", "Λεωφ."], ["metro", "Μετρό"], ["tram", "Τραμ"], ["suburban", "Προαστ."]];

  let query = $state("");
  let chips = $state<Chip[]>([]);
  let lines = $state.raw<V2Line[]>([]);
  let stops = $state.raw<StopEntry[]>([]);
  let failed = $state(false);
  let recent = $state.raw<Recent[]>([]);
  let input: HTMLInputElement | undefined = $state();
  let dialog: HTMLDialogElement | undefined = $state();
  let opener: Element | null = null;
  let shown = $state(PAGE);   // rows of one group, with the kind filter on it: «Περισσότερα» adds a page

  const kind = $derived(app.finder ?? "all");
  const byId = $derived(new Map(lines.map(l => [l.id, l])));
  const stopById = $derived(new Map(stops.map(s => [s[0], s])));
  const foundLines = $derived(kind === "stops" ? [] : findLines(lines, query, chips));
  const foundStops = $derived(kind === "lines" ? [] : findStops(stops, query, chips));
  const cap = $derived(kind === "all" ? GROUP : shown);
  const chipOk = (modes: string[]) => !chips.length || modes.some(m => { const c = chipOf(m); return !!c && chips.includes(c); });
  const empty = $derived(!query.trim());
  const loading = $derived(!failed && (!lines.length || !stops.length));

  // Opening (not a change of kind): a native modal dialog (the page behind it is inert), the indexes (once), the
  // recent picks, the focus.
  const isOpen = $derived(!!app.finder);
  $effect(() => {
    if (!isOpen || !dialog) return;
    untrack(() => {
      opener = document.activeElement;
      let r: unknown = [];
      try { r = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); } catch { /* storage blocked */ }
      recent = Array.isArray(r) ? r : [];
      shown = PAGE;
      if (!dialog!.open) dialog!.showModal();
      void load();
      void tick().then(() => input?.focus());
    });
  });
  $effect(() => { void app.finder; void query; void chips; shown = PAGE; });

  async function load() {
    if (lines.length && stops.length) return;
    failed = false;
    const [l, s] = await Promise.all([fetchV2Lines(), fetchV2Stops()]);
    if (l.status === 200) lines = (l.body as { lines: V2Line[] }).lines;
    if (s.status === 200) stops = (s.body as { stops: StopEntry[] }).stops;
    failed = l.status !== 200 || s.status !== 200;
  }

  function close() {
    if (dialog?.open) dialog.close();
    app.finder = null;
    query = "";
    const o = opener as HTMLElement | null;
    opener = null;
    void tick().then(() => o?.focus?.());
  }

  function remember(r: Recent) {
    recent = pushRecent(recent, r);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); } catch { /* storage blocked */ }
  }

  function openLine(id: string, label: string) {
    remember({ kind: "line", id, label });
    close();
    app.open({ kind: "line", id, title: label });
    // A bus line frames its route once the route loads (showRoute); the other modes frame their stops.
    if (!id.startsWith("oasa:")) app.fitPoints(lineStopPoints(stops, id));
  }
  function openStop(id: string, name: string) {
    remember({ kind: "stop", id, label: name });
    close();
    app.open({ kind: "stop", id, title: name });
    const s = stops.find(x => x[0] === id);
    if (s) app.flyTo([s[3], s[2]]);
  }

  const native = (id: string) => id.slice(id.indexOf(":") + 1);
  function badge(id: string, label?: string | null) {
    const l = byId.get(id);
    const text = l?.label ?? label ?? native(id);
    if (id.startsWith("oasa:")) { const c = app.lineColor(native(id)); return { text, bg: c.bg, fg: c.fg }; }
    return { text, bg: l?.color ?? "#6b7280", fg: l?.text_color ?? "#ffffff" };
  }
  const lineLabel = (l: V2Line) => l.label ?? l.name;
  const stopModes = (s: StopEntry) => [...new Set(s[4].map(chipOf).filter((c): c is Chip => !!c))];


  // Swipe down on the head of the modal (not the list) closes it, as Escape does.
  let swipeY: number | null = null;
  const swipeStart = (e: PointerEvent) => { swipeY = (e.target as Element).closest("input, .results") ? null : e.clientY; };
  const swipeEnd = (e: PointerEvent) => { if (swipeY != null && e.clientY - swipeY > 80) close(); swipeY = null; };

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "Enter" && e.target === input) {
      e.preventDefault();   // else the key goes on to the opener, focused again by close(), and opens the modal again
      const l = foundLines[0], s = foundStops[0];
      if (l) openLine(l.id, lineLabel(l));
      else if (s) openStop(s[0], s[1]);
    }
  }
</script>


{#snippet lineRow(id: string, label: string, name: string | undefined)}
  {@const bd = badge(id, label)}
  {@const on = app.isFavLine(id)}
  <li class="row">
    <button type="button" class="pick" onclick={() => openLine(id, bd.text)}>
      <span class="pill" style:--c={bd.bg} style:--t={bd.fg}>{bd.text}</span>
      <span class="name">{name ?? ""}</span>
    </button>
    <button type="button" class="star" class:on aria-pressed={on} aria-label="{on ? 'Αφαίρεση από' : 'Προσθήκη στα'} αγαπημένα: {bd.text}"
      onclick={() => app.toggleFavLine({ id, label: bd.text })}><Icon name={on ? "star-filled" : "star"} size={20} /></button>
  </li>
{/snippet}

{#snippet more(n: number, k: "lines" | "stops")}
  {#if kind === "all"}
    <button type="button" class="more" onclick={() => (app.finder = k)}>{k === "lines" ? "Όλες οι γραμμές" : "Όλες οι στάσεις"} ({n}) ›</button>
  {:else}
    <button type="button" class="more" onclick={() => (shown += PAGE)}>Περισσότερα ({n - shown}) ›</button>
  {/if}
{/snippet}

{#snippet stopRow(s: StopEntry)}
  <li class="row">
    <button type="button" class="pick" onclick={() => openStop(s[0], s[1])}>
      <span class="modes">{#each stopModes(s) as c (c)}<Icon name={c} />{/each}</span>
      <span class="name">{s[1]}<small>{s[5].slice(0, 6).map(id => byId.get(id)?.label ?? native(id)).join(" · ")}{s[5].length > 6 ? " …" : ""}</small></span>
    </button>
  </li>
{/snippet}

<!-- A press on the backdrop (the dialog element itself, around .modal) closes it. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions (Escape closes) -->
<dialog bind:this={dialog} aria-label="Αναζήτηση" {onkeydown} oncancel={e => { e.preventDefault(); close(); }}
  onclick={e => { if (e.target === e.currentTarget) close(); }} onpointerdown={swipeStart} onpointerup={swipeEnd} onpointercancel={() => (swipeY = null)}>
  {#if app.finder}
    <div class="modal">
      <div class="top">
        <input bind:this={input} bind:value={query} type="search" enterkeyhint="search" autocomplete="off" spellcheck="false"
          placeholder="Γραμμή ή στάση, π.χ. 040, Σύνταγμα" aria-label="Αναζήτηση γραμμής ή στάσης" />
        <button type="button" class="x" aria-label="Κλείσιμο" onclick={close}>×</button>
      </div>
      <div class="seg" role="group" aria-label="Τι ψάχνω">
        {#each KINDS as [k, t] (k)}
          <button type="button" aria-pressed={kind === k} onclick={() => (app.finder = k)}>{t}</button>
        {/each}
      </div>
      <div class="chips" role="group" aria-label="Μέσο">
        <button type="button" class="chip" aria-pressed={!chips.length} onclick={() => (chips = [])}>Όλα</button>
        {#each CHIPS as [c, t] (c)}
          <button type="button" class="chip" aria-pressed={chips.includes(c)} onclick={() => (chips = toggleChip(chips, c))}><Icon name={c} />{t}</button>
        {/each}
      </div>

      <div class="results" aria-live="polite">
        {#if failed}
          <p class="muted">Δεν φόρτωσε η λίστα. <button type="button" class="link" onclick={load}>Δοκίμασε ξανά</button></p>
        {:else if loading && !empty}
          <p class="muted">Φόρτωση…</p>
        {/if}

        {#if empty}
          {@const favLines = app.favs.lines.filter(l => chipOk([byId.get(l.id)?.mode ?? ""]))}
          {@const favStops = app.favs.stops.filter(s => chipOk(stopById.get(s.id)?.[4] ?? []))}
          {#if favLines.length && kind !== "stops"}
            <h3>Αγαπημένες γραμμές</h3>
            <ul>{#each favLines as l (l.id)}{@render lineRow(l.id, l.label, byId.get(l.id)?.name)}{/each}</ul>
          {/if}
          {#if favStops.length && kind !== "lines"}
            <h3>Αγαπημένες στάσεις</h3>
            <ul>{#each favStops as s (s.id)}{@render stopRow(stopById.get(s.id) ?? [s.id, s.name, s.lat, s.lon, [], []])}{/each}</ul>
          {/if}
          {@const rec = recent.filter(r => (kind === "all" || (kind === "lines") === (r.kind === "line"))
            && chipOk(r.kind === "line" ? [byId.get(r.id)?.mode ?? ""] : stopById.get(r.id)?.[4] ?? []))}
          {#if rec.length}
            <h3>Πρόσφατα</h3>
            <ul>{#each rec as r (r.kind + r.id)}
              {#if r.kind === "line"}{@render lineRow(r.id, r.label, byId.get(r.id)?.name)}
              {:else}{@render stopRow(stopById.get(r.id) ?? [r.id, r.label, 0, 0, [], []])}{/if}
            {/each}</ul>
          {/if}
        {:else if !loading}
          {#if foundLines.length}
            <h3>Γραμμές</h3>
            <ul>{#each foundLines.slice(0, cap) as l (l.id)}{@render lineRow(l.id, lineLabel(l), l.name)}{/each}</ul>
            {#if foundLines.length > cap}{@render more(foundLines.length, "lines")}{/if}
          {/if}
          {#if foundStops.length}
            <h3>Στάσεις</h3>
            <ul>{#each foundStops.slice(0, cap) as s (s[0])}{@render stopRow(s)}{/each}</ul>
            {#if foundStops.length > cap}{@render more(foundStops.length, "stops")}{/if}
          {/if}
          {#if !foundLines.length && !foundStops.length}
            <p class="muted">{kind === "all" && query.trim().length < 2 ? "Γράψε λίγο ακόμα." : `Τίποτα για «${query.trim()}».`}</p>
          {/if}
        {/if}
      </div>
    </div>
  {/if}
</dialog>

<style>
  dialog { width: 560px; max-width: calc(100% - 24px); max-height: 80vh; margin: calc(10vh + env(safe-area-inset-top)) auto 0; padding: 0;
    border: 0; border-radius: 14px; background: var(--bg); color: var(--fg); box-shadow: 0 12px 40px rgba(0, 0, 0, .35); }
  dialog::backdrop { background: rgba(0, 0, 0, .35); }
  .modal { display: flex; flex-direction: column; max-height: 80vh; padding: 12px; }
  .top { display: flex; gap: 6px; align-items: center; }
  .top, .seg, .chips { touch-action: none; }   /* the head is for the swipe down, not for panning */
  input { flex: 1; min-width: 0; min-height: 44px; padding: 8px 12px; border: 1px solid transparent; border-radius: 10px;
    background: var(--control); color: var(--fg); font: inherit; font-size: 16px; /* 16px stops iOS zooming on focus */ }
  input:focus { outline: 2px solid var(--accent); outline-offset: 0; }
  .x { flex: none; width: 44px; height: 44px; border: 0; border-radius: 10px; background: none; color: var(--muted); font-size: 24px; cursor: pointer; }
  .x:hover { background: var(--control); }
  .seg { display: flex; gap: 2px; margin-top: 10px; padding: 2px; border-radius: 10px; background: var(--control); }
  .seg button { flex: 1; min-height: 36px; border: 0; border-radius: 8px; background: none; color: inherit; font: inherit; font-size: 13px; cursor: pointer; }
  .seg button[aria-pressed="true"] { background: var(--accent); color: #fff; font-weight: 600; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .chip { display: inline-flex; align-items: center; gap: 5px; min-height: 36px; padding: 0 12px; border: 1px solid var(--border);
    border-radius: 18px; background: none; color: inherit; font: inherit; font-size: 13px; cursor: pointer; }
  .chip[aria-pressed="true"] { border-color: var(--accent); background: var(--accent); color: #fff; }
  .results { flex: 1; min-height: 0; margin-top: 8px; overflow-y: auto; overscroll-behavior: contain; }
  h3 { margin: 10px 0 2px; color: var(--muted); font-size: 12px; font-weight: 600; }
  ul { margin: 0; padding: 0; list-style: none; }
  .row { display: flex; align-items: center; }
  .pick { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 4px 6px; border: 0; border-radius: 8px;
    background: none; color: inherit; font: inherit; font-size: 14px; text-align: left; cursor: pointer; }
  .pick:hover { background: var(--control); }
  .pill { flex: none; min-width: 40px; padding: 2px 8px; border-radius: 10px; background: var(--c); color: var(--t); font-weight: 700; text-align: center; font-size: 13px; }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name small { display: block; color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; }
  .modes { flex: none; display: inline-flex; gap: 2px; min-width: 40px; color: var(--muted); }
  .star { flex: none; width: 44px; height: 44px; border: 0; border-radius: 8px; background: none; color: var(--muted); font-size: 18px; cursor: pointer; }
  .star.on { color: #f59f00; }
  .star:hover { background: var(--control); }
  .more, .link { min-height: 40px; padding: 0 6px; border: 0; background: none; color: var(--accent); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
  .link { min-height: 0; padding: 0; }
  .muted { margin: 8px 6px; color: var(--muted); font-size: 13px; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @media (max-width: 719px) {
    dialog { width: 100%; max-width: none; height: 100%; max-height: none; margin: 0; border-radius: 0; }
    .modal { height: 100%; max-height: none; box-sizing: border-box;
      padding: calc(10px + env(safe-area-inset-top)) 12px calc(10px + env(safe-area-inset-bottom)); }
  }
</style>
