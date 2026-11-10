<script lang="ts">
  import { tick } from "svelte";
  import { fetchSchedule } from "../api";
  import { athensClock, matchDirection, timetableView, type Schedule } from "../timetable";
  import { CITIES } from "../cities";
  import { PAGE_CITY } from "../config";

  // Today's runs of a route's direction (shown only while open): gone ones muted, a missed one (no bus
  // left the start for it) struck through, the next three bold. Asked again every 60 s (the server's cache).
  // A citybus.gr city (source "citybus") shows only some of its buses, so it has no missed runs: a run a bus
  // was seen on gets a tick, the one a bus is on now a dot, the rest of the past ones stay muted.
  let { line, headsign, now }: { line: string; headsign: string; now: number } = $props();

  const REFRESH_MS = 60_000;
  const agency = CITIES[PAGE_CITY].agency;
  let sched = $state.raw<Schedule | null>(null);
  let failed = $state(false);
  let list: HTMLElement | undefined = $state();

  $effect(() => {
    const l = line;
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    sched = null;
    failed = false;
    let first = true;
    const load = async () => {
      if (document.visibilityState !== "hidden") {
        const r = await fetchSchedule(l, AbortSignal.any([ac.signal, AbortSignal.timeout(10_000)]));
        if (ac.signal.aborted) return;
        const ok = r.status === 200 && !!r.body && Array.isArray((r.body as Schedule).directions);
        sched = ok ? (r.body as Schedule) : null;
        failed = !ok;
        // The first time, scroll the next runs into view (a whole day is long).
        if (ok && first) { first = false; await tick(); list?.querySelector(".next")?.scrollIntoView({ block: "nearest" }); }
      }
      timer = setTimeout(load, REFRESH_MS);
    };
    load();
    return () => { ac.abort(); clearTimeout(timer); };
  });

  const dir = $derived(sched ? matchDirection(sched.directions, headsign) : null);
  const soft = $derived(sched?.source === "citybus");
  const view = $derived(dir ? timetableView(dir, athensClock(now, sched!.date), 3, !soft) : null);
</script>

{#if view}
  <p class="sum">
    {sched?.source === "oasa-daily" ? `Πρόγραμμα ημέρας ${agency}` : sched?.expired ? "Ενδεικτικά, από παλιό πρόγραμμα" : `Από το πρόγραμμα ${agency}`}
    {#if soft}{#if view.seen}· φάνηκαν στον χάρτη {view.seen} από {view.past} ως τώρα{/if}
    {:else if view.known}· <span class:bad={view.seen < view.known}>έγιναν {view.seen} από {view.known} ως τώρα</span>{/if}
  </p>
  {#if view.items.length}
    <ol class="runs" bind:this={list} aria-label="Δρομολόγια σήμερα">
      {#each view.items as it, i (i)}
        <li class={it.state} class:seen={soft && it.seen && !it.live} class:live={soft && it.live}
          title={it.state === "missed" ? "Δεν φάνηκε λεωφορείο να ξεκινά" : soft && it.live ? "Λεωφορείο στον δρόμο τώρα" : soft && it.seen ? "Φάνηκε λεωφορείο στον χάρτη" : undefined}>{it.t}</li>
      {/each}
    </ol>
  {:else}
    <p class="sum">Κανένα δρομολόγιο σήμερα.</p>
  {/if}
{:else if sched}
  <p class="sum">{sched.directions.length ? "Δεν βρέθηκε το πρόγραμμα αυτής της κατεύθυνσης." : `${CITIES[PAGE_CITY].agencyThe} δεν δίνει πρόγραμμα για αυτή τη γραμμή σήμερα.`}</p>
{:else if failed}
  <p class="sum">Δεν φόρτωσε το πρόγραμμα.</p>
{:else}
  <p class="sum">Φόρτωση προγράμματος…</p>
{/if}

<style>
  .sum { margin: 8px 0 6px; color: var(--muted); font-size: 12px; }
  .bad { color: var(--late2); }
  .runs { display: flex; flex-wrap: wrap; gap: 4px 10px; margin: 0; padding: 0; list-style: none;
    font-size: 13px; font-variant-numeric: tabular-nums; }
  .gone { color: var(--muted); }
  .missed { color: var(--late3); text-decoration: line-through; }
  .next { font-weight: 700; }
  .seen { color: var(--fg); }
  .seen::before { content: "✓ "; color: var(--ontime); }
  .live { color: var(--accent); font-weight: 700; }
  .live::before { content: "● "; font-size: 9px; vertical-align: 2px; }
</style>
