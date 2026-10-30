<script lang="ts">
  import { dayMonth } from "../format";
  import { GTFS_PAGE } from "../sources";
  import SourcesView from "./SourcesView.svelte";
  import LongTermView from "./LongTermView.svelte";
  import StatsView from "./StatsView.svelte";
  import FeedbackForm from "./FeedbackForm.svelte";
  import AboutView from "./AboutView.svelte";

  // ended: the day the OASA timetable ended, when it is past (explained at the top).
  // tab: bindable so «Δώσε feedback» (the ? pop) can open the sheet on the feedback tab.
  let { open = $bindable(false), tab = $bindable("sources"), motion, ended = null }:
    { open: boolean; tab?: Tab; motion: boolean; ended?: string | null } = $props();

  const TABS = [
    { id: "sources", label: "Πηγές δεδομένων" },
    { id: "stats", label: "Στατιστικά δικτύου" },
    { id: "feedback", label: "Feedback" },
  ] as const;
  type Tab = (typeof TABS)[number]["id"];
  // Inside the stats tab: the newest day first, then the stored days together.
  const SUBS = [
    { id: "day", label: "Τελευταία μέρα" },
    { id: "long", label: "Μακροχρόνια" },
  ] as const;
  type Sub = (typeof SUBS)[number]["id"];
  let sub = $state<Sub>("day");

  let dlg: HTMLDialogElement;
  // The stats tab loads its data once, the first time it is shown; it then keeps it while hidden.
  let statsSeen = $state(false);
  $effect(() => { if (tab === "stats") statsSeen = true; });

  // The app tab: feedback (B10: moved here from the map's buttons), then version and «Τι νέο». This sheet stays
  // mounted once loaded, so closing it while feedback is sent loses nothing. Releases load on the first visit.
  let appSeen = $state(false);
  $effect(() => { if (open && tab === "feedback") appSeen = true; });

  $effect(() => {
    if (open && dlg.isConnected && !dlg.open) dlg.showModal();
    else if (!open && dlg.open) dlg.close();
  });

  // Arrow keys, Home and End move through a tab list; the new tab gets the focus.
  function tabKey<T extends string>(e: KeyboardEvent, ids: readonly T[], now: T, set: (id: T) => void, prefix: string) {
    const to = { ArrowLeft: -1, ArrowRight: 1, Home: -ids.length, End: ids.length }[e.key];
    if (to == null) return;
    e.preventDefault();
    const i = ids.indexOf(now);
    const next = ids[Math.abs(to) === ids.length ? (to < 0 ? 0 : ids.length - 1) : (i + to + ids.length) % ids.length];
    set(next);
    document.getElementById(`${prefix}${next}`)?.focus();
  }
  const onTabKey = (e: KeyboardEvent) => tabKey(e, TABS.map(t => t.id), tab, id => (tab = id), "info-tab-");
  const onSubKey = (e: KeyboardEvent) => tabKey(e, SUBS.map(t => t.id), sub, id => (sub = id), "stats-tab-");
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
      <div class="tabs sub" role="tablist" aria-label="Στατιστικά">
        {#each SUBS as t (t.id)}
          <button type="button" role="tab" id="stats-tab-{t.id}" aria-controls="stats-panel-{t.id}" aria-selected={sub === t.id}
            tabindex={sub === t.id ? 0 : -1} onclick={() => (sub = t.id)} onkeydown={onSubKey}>{t.label}</button>
        {/each}
      </div>
      <div role="tabpanel" id="stats-panel-day" aria-labelledby="stats-tab-day" hidden={sub !== "day"}>
        {#if statsSeen}<StatsView />{/if}
      </div>
      <!-- Mounted only while shown, so each visit asks for the days again (cached for an hour). -->
      <div role="tabpanel" id="stats-panel-long" aria-labelledby="stats-tab-long" hidden={sub !== "long"}>
        {#if open && tab === "stats" && sub === "long"}<LongTermView />{/if}
      </div>
    </div>
    <div role="tabpanel" id="info-panel-feedback" aria-labelledby="info-tab-feedback" hidden={tab !== "feedback"}>
      <FeedbackForm visible={open && tab === "feedback"} />
      {#if appSeen}<AboutView />{/if}
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
  .tabs.sub { width: fit-content; margin-bottom: 10px; }
  .tabs.sub button { min-height: 32px; padding: 0 14px; font-size: 12px; white-space: nowrap; }
  [hidden] { display: none !important; }
  @media (max-width: 719px) {
    .sheet { width: 100%; max-width: none; height: 100%; max-height: none; margin: 0; border: 0; border-radius: 0; }
    .body { padding: calc(12px + env(safe-area-inset-top)) 16px calc(20px + env(safe-area-inset-bottom)); }
  }
</style>
