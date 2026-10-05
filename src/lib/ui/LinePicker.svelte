<script lang="ts">
  import { MAX_LINES, normalizeLineId } from "../selection";
  import type { AppState } from "../state.svelte";
  import type { LineInfo } from "../types";

  let { app }: { app: AppState } = $props();

  const QUICK = ["040", "550", "Α1", "Χ95", "2"];

  let query = $state("");
  let open = $state(false);
  let active = $state(0);
  let input: HTMLInputElement | undefined = $state();
  let list: HTMLUListElement | undefined = $state();

  // Case-, accent- and final-sigma-insensitive Greek matching.
  const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("el").replace(/ς/g, "σ");
  const byId = (a: LineInfo, b: LineInfo) => a.id.localeCompare(b.id, "el", { numeric: true });
  const sorted = $derived([...app.lines].sort(byId));

  const results = $derived.by(() => {
    const q = fold(query.trim());
    if (!q) return sorted;
    const qid = fold(normalizeLineId(query));
    const rank = (l: LineInfo) => {
      const id = fold(l.id);
      if (id === qid) return 0;
      if (id.startsWith(qid)) return 1;
      if (fold(l.name).includes(q) || fold(l.name_en).includes(q)) return 2;
      return -1;
    };
    return sorted.map(l => [rank(l), l] as const).filter(([r]) => r >= 0).sort((a, b) => a[0] - b[0]).map(([, l]) => l);
  });

  const full = $derived(app.selected.length >= MAX_LINES);
  const quick = $derived(QUICK.filter(id => app.lineInfo.has(id) && !app.selected.includes(id)));

  function pick(id: string) {
    if (!app.selected.includes(id) && full) {
      app.toggleLine(id);   // shows the 5-line notice
      return;
    }
    app.toggleLine(id);
    query = "";
    open = false;
    input?.blur();   // show the map on phones
  }

  function move(to: number) {
    active = Math.max(0, Math.min(results.length - 1, to));
    list?.children[active]?.scrollIntoView({ block: "nearest" });
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { open = true; return; }
      move(active + (e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "PageDown" || e.key === "PageUp") {
      e.preventDefault();
      move(active + (e.key === "PageDown" ? 8 : -8));
    } else if (e.key === "Enter" && open && results[active]) {
      e.preventDefault();
      pick(results[active].id);
    } else if (e.key === "Escape") {
      open = false;
    } else if (e.key === "Tab") {
      open = false;
    }
  }

  function chipState(id: string) {
    const s = app.pollState[id];
    const age = app.live[id] ? app.serverNow / 1000 - app.live[id].updated_at : 0;
    if (s === "backoff") return { icon: "!", title: "Σφάλμα σύνδεσης, νέα προσπάθεια σε λίγο" };
    if (s === "warming" || s === "loading") return { icon: "…", title: "Φόρτωση" };
    if (age > 120) return { icon: "!", title: "Η γραμμή δεν ανανεώνεται" };
    return null;
  }
</script>

<svelte:document onpointerdown={e => { if (open && !(e.target as Element).closest?.(".picker")) open = false; }} />

<div class="picker">
  {#if app.selected.length}
    <ul class="chips" aria-label="Επιλεγμένες γραμμές">
      {#each app.selected as id (id)}
        {@const info = app.lineInfo.get(id)}
        {@const st = chipState(id)}
        <li>
          <button
            type="button"
            class="chip"
            style:--c={info?.color ?? "#3b5bdb"}
            style:--t={info?.text_color ?? "#fff"}
            title={st?.title ?? info?.name}
            aria-label="Αφαίρεση γραμμής {id}"
            onclick={() => app.toggleLine(id)}
          >
            {id}{#if st}<span class="st">{st.icon}</span>{/if}<span class="x" aria-hidden="true">×</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <input
    bind:this={input}
    bind:value={query}
    type="search"
    enterkeyhint="search"
    autocomplete="off"
    spellcheck="false"
    placeholder={full ? "Έως 5 γραμμές ταυτόχρονα" : "Γραμμή ή περιοχή, π.χ. 040, Πειραιάς"}
    role="combobox"
    aria-label="Αναζήτηση γραμμής"
    aria-expanded={open}
    aria-controls="line-list"
    aria-autocomplete="list"
    aria-activedescendant={open && results[active] ? `line-opt-${active}` : undefined}
    onfocus={() => { open = true; active = 0; }}
    oninput={() => { open = true; active = 0; }}
    {onkeydown}
  />

  {#if !app.selected.length && quick.length && !open}
    <div class="quick">
      <span>Δημοφιλείς:</span>
      {#each quick as id (id)}
        <button type="button" class="q" style:--c={app.lineInfo.get(id)?.color} onclick={() => pick(id)}>{id}</button>
      {/each}
    </div>
  {/if}

  {#if open}
    <ul id="line-list" class="list" role="listbox" aria-label="Γραμμές" aria-multiselectable="true" bind:this={list}>
      {#if app.linesFailed}
        <li class="empty">Δεν φορτώθηκε η λίστα γραμμών. Δοκίμασε ξανά σε λίγο.</li>
      {:else if !app.lines.length}
        <li class="empty">Φόρτωση γραμμών…</li>
      {:else if !results.length}
        <li class="empty">Καμία γραμμή για «{query}»</li>
      {/if}
      {#each results as l, i (l.id)}
        {@const sel = app.selected.includes(l.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events (keyboard goes through the combobox input) -->
        <li
          id="line-opt-{i}"
          role="option"
          aria-selected={sel}
          aria-disabled={!sel && full}
          class={{ active: i === active, disabled: !sel && full }}
          onpointerenter={() => (active = i)}
          onpointerdown={e => e.preventDefault()}
          onclick={() => pick(l.id)}
        >
          <span class="id" style:--c={l.color} style:--t={l.text_color}>{l.id}</span>
          <span class="name">{l.name}</span>
          {#if sel}<span class="check" aria-hidden="true">✓</span>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .picker { position: relative; margin-top: 10px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 8px; padding: 0; list-style: none; }
  .chip { display: inline-flex; align-items: center; gap: 4px; min-height: 32px; padding: 0 10px; border: 0;
    border-radius: 16px; background: var(--c); color: var(--t); font-weight: 700; cursor: pointer; }
  .chip .x { opacity: .8; font-weight: 400; margin-left: 2px; }
  .chip .st { display: inline-grid; place-items: center; width: 16px; height: 16px; border-radius: 50%;
    background: rgba(0, 0, 0, .3); font-size: 11px; }
  input { width: 100%; min-height: 40px; padding: 8px 12px; border-radius: 10px; border: 1px solid transparent;
    background: var(--control); font-size: 16px; /* 16px stops iOS zooming on focus */ }
  input:focus { outline: 2px solid var(--accent); outline-offset: 0; }
  .quick { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; color: var(--muted); font-size: 12px; }
  .q { min-height: 32px; padding: 0 10px; border: 0; border-radius: 16px; background: var(--c, #3b5bdb); color: #fff;
    font-weight: 700; cursor: pointer; }
  .list { position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 10; margin: 0; padding: 4px;
    list-style: none; max-height: min(360px, 55vh); overflow-y: auto; overscroll-behavior: contain;
    background: var(--bg); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 8px 24px rgba(0, 0, 0, .25); }
  .list li { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 4px 8px; border-radius: 8px; cursor: pointer; }
  .list li.active { background: var(--control-hover); }
  .list li.disabled { opacity: .45; cursor: not-allowed; }
  .list li.empty { color: var(--muted); cursor: default; }
  .id { flex: none; min-width: 44px; padding: 2px 6px; border-radius: 6px; background: var(--c); color: var(--t);
    font-weight: 700; text-align: center; font-size: 13px; }
  .name { flex: 1; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .check { color: var(--accent); font-weight: 700; }
</style>
