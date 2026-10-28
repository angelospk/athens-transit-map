<script lang="ts">
  import { tick } from "svelte";
  import { fetchSchedule } from "../api";
  import { athensClock, matchDirection, timetableView, type Schedule } from "../timetable";

  // Today's runs of a route's direction (shown only while open): gone ones muted, a missed one (no bus
  // left the start for it) struck through, the next three bold. Asked again every 60 s (the server's cache).
  let { line, headsign, now }: { line: string; headsign: string; now: number } = $props();

  const REFRESH_MS = 60_000;
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
  const view = $derived(dir ? timetableView(dir, athensClock(now, sched!.date)) : null);
</script>

{#if view}
  <p class="sum">
    {sched?.source === "oasa-daily" ? "Πρόγραμμα ημέρας ΟΑΣΑ" : sched?.expired ? "Ενδεικτικά, από παλιό πρόγραμμα" : "Από το πρόγραμμα ΟΑΣΑ"}
    {#if view.known}· <span class:bad={view.seen < view.known}>έγιναν {view.seen} από {view.known} ως τώρα</span>{/if}
  </p>
  {#if view.items.length}
    <ol class="runs" bind:this={list} aria-label="Δρομολόγια σήμερα">
      {#each view.items as it, i (i)}
        <li class={it.state} title={it.state === "missed" ? "Δεν φάνηκε λεωφορείο να ξεκινά" : undefined}>{it.t}</li>
      {/each}
    </ol>
  {:else}
    <p class="sum">Κανένα δρομολόγιο σήμερα.</p>
  {/if}
{:else if sched}
  <p class="sum">Δεν βρέθηκε το πρόγραμμα αυτής της κατεύθυνσης.</p>
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
</style>
