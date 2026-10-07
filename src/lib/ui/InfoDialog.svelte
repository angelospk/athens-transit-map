<script lang="ts">
  import { dayMonth } from "../format";
  import { GTFS_PAGE } from "../sources";
  import SourcesView from "./SourcesView.svelte";
  import StatsView from "./StatsView.svelte";

  // ended: the day the OASA timetable ended, when it is past (explained at the top).
  let { open = $bindable(false), motion, ended = null }: { open: boolean; motion: boolean; ended?: string | null } = $props();

  const TABS = [
    { id: "sources", label: "Πηγές δεδομένων" },
    { id: "stats", label: "Στατιστικά δικτύου" },
  ] as const;
  type Tab = (typeof TABS)[number]["id"];

  let dlg: HTMLDialogElement;
  let tab = $state<Tab>("sources");
  // The stats tab loads its data once, the first time it is shown; it then keeps it while hidden.
  let statsSeen = $state(false);
  $effect(() => { if (tab === "stats") statsSeen = true; });

  $effect(() => {
    if (open && dlg.isConnected && !dlg.open) dlg.showModal();
    else if (!open && dlg.open) dlg.close();
  });

  function onTabKey(e: KeyboardEvent) {
    const to = { ArrowLeft: -1, ArrowRight: 1, Home: -TABS.length, End: TABS.length }[e.key];
    if (to == null) return;
    e.preventDefault();
    const i = TABS.findIndex(t => t.id === tab);
    const next = Math.abs(to) === TABS.length ? (to < 0 ? 0 : TABS.length - 1) : (i + to + TABS.length) % TABS.length;
    tab = TABS[next].id;
    document.getElementById(`info-tab-${tab}`)?.focus();
  }
</script>

<dialog bind:this={dlg} class="sheet" aria-labelledby="info-title" onclose={() => (open = false)}
  onclick={e => { if (e.target === dlg) open = false; }}
  onkeydown={e => { if (e.key === "Escape") e.stopPropagation(); }}>
  <div class="body">
    <header>
      <h2 id="info-title">Πληροφορίες</h2>
      <button type="button" class="close" aria-label="Κλείσιμο" onclick={() => (open = false)}>
        <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
      </button>
    </header>

    {#if ended}
      <div class="old">
        <b>Το πρόγραμμα του ΟΑΣΑ έληξε στις {dayMonth(ended)}.</b> Ο ΟΑΣΑ δεν έχει δημοσιεύσει ακόμα νέο πρόγραμμα
        δρομολογίων (GTFS), οπότε ο χάρτης χρησιμοποιεί το τελευταίο. Οι θέσεις των οχημάτων είναι ζωντανές· οι
        καθυστερήσεις και τα δρομολόγια βγαίνουν από το παλιό πρόγραμμα, άρα είναι κατά προσέγγιση. Μόλις βγει νέο,
        ο χάρτης το παίρνει αυτόματα. <a href={GTFS_PAGE} target="_blank" rel="noopener">Το αρχείο στο data.gov.gr</a>
      </div>
    {/if}

    <div class="tabs" role="tablist" aria-label="Πληροφορίες">
      {#each TABS as t (t.id)}
        <button type="button" role="tab" id="info-tab-{t.id}" aria-controls="info-panel-{t.id}" aria-selected={tab === t.id}
          tabindex={tab === t.id ? 0 : -1} onclick={() => (tab = t.id)} onkeydown={onTabKey}>{t.label}</button>
      {/each}
    </div>

    <div role="tabpanel" id="info-panel-sources" aria-labelledby="info-tab-sources" hidden={tab !== "sources"}>
      <SourcesView {motion} />
    </div>
    <div role="tabpanel" id="info-panel-stats" aria-labelledby="info-tab-stats" hidden={tab !== "stats"}>
      {#if statsSeen}<StatsView />{/if}
    </div>
  </div>
</dialog>

<style>
  .sheet { width: min(720px, calc(100% - 32px)); max-height: calc(100% - 48px); padding: 0; border: 1px solid var(--border);
    border-radius: 16px; background: var(--bg); color: var(--fg); box-shadow: var(--shadow); overscroll-behavior: contain; }
  .sheet::backdrop { background: rgba(0, 0, 0, .4); }
  .body { padding: 16px 20px 20px; }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  h2 { flex: 1; margin: 0; font-size: 17px; }
  .close { display: grid; place-items: center; width: 36px; height: 36px; margin: -6px -8px -6px 0; border: 0;
    border-radius: 8px; background: none; color: var(--muted); cursor: pointer; }
  .close:hover { background: var(--control); color: var(--fg); }
  .old { margin: 0 0 12px; padding: 8px 10px; border-radius: 8px; background: var(--warn-bg); font-size: 13px; }
  .old a { color: inherit; }
  .tabs { display: flex; padding: 2px; margin-bottom: 14px; border-radius: 9px; background: var(--control); }
  .tabs button { flex: 1; min-height: 34px; border: 0; border-radius: 7px; background: none; cursor: pointer; font-size: 13px; }
  .tabs button[aria-selected="true"] { background: var(--bg); box-shadow: 0 1px 3px rgba(0, 0, 0, .2); font-weight: 600; }
  [hidden] { display: none !important; }
  @media (max-width: 719px) {
    .sheet { width: 100%; max-width: none; height: 100%; max-height: none; margin: 0; border: 0; border-radius: 0; }
    .body { padding: calc(12px + env(safe-area-inset-top)) 16px calc(20px + env(safe-area-inset-bottom)); }
  }
</style>
