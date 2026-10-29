<script lang="ts">
  import { fetchTrainRun, peekTrainRun } from "../api";
  import { stopRows, type StasyTrip, type SuburbanRun } from "../trains";
  import type { AppState } from "../state.svelte";
  import type { FetchResult } from "../poller";

  // The tapped train: its line and destination, where its position comes from (the STASY timetable,
  // or the GPS of the Proastiakos with its age and speed), and its run's stops with their times. The
  // run is asked again every 30 s while the card is open and the tab visible (live delays).
  let { app }: { app: AppState } = $props();

  const sel = $derived(app.train);
  const metro = $derived(sel?.kind === "metro" ? app.stasyTrains.find(v => v.trip === sel.id) : undefined);
  const sub = $derived(sel?.kind === "suburban" ? app.suburbanTrains.find(v => v.train === sel.id) : undefined);
  const corridor = $derived(sub ? app.suburban?.corridors[sub.corridor] : undefined);

  const REFRESH_MS = 30_000;
  let run = $state.raw<StasyTrip | SuburbanRun | null>(null);
  let failed = $state(false);

  const nowS = $derived(app.serverNow / 1000);
  const label = $derived(metro?.line ?? (run && "line" in run ? run.line : "Π"));
  const color = $derived(metro?.route_color ?? (run && "route_color" in run ? run.route_color : corridor?.color ?? "#666666"));
  const to = $derived(metro?.headsign ?? sub?.to ?? (run ? ("headsign" in run ? run.headsign : run.to) : ""));
  const delay = $derived(run && "delay_min" in run ? run.delay_min : (sub?.delay_min ?? null));
  // Proastiakos: the run's delay for every stop. It is the live one while the GPS stream is open; the
  // stops' own delays are the day's board, up to 10 minutes old.
  const rows = $derived(!run ? [] : "headsign" in run ? stopRows(run.stops, nowS)
    : stopRows(run.stops.map(s => ({ name: s.name, at: s.at })), nowS, run.delay_min));
  // The line to show on its own from the chip: the metro line, or the Proastiakos corridor.
  const lineSel = $derived(metro ? { kind: "metro" as const, id: metro.line } : sub && corridor ? { kind: "suburban" as const, id: sub.corridor } : null);
  const age = $derived(sub ? Math.max(0, Math.round(nowS - sub.position_at)) : 0);
  const gps = $derived([
    sub && `GPS πριν ${age < 60 ? `${age}″` : `${Math.floor(age / 60)}′`}`,
    sub && sub.speed_kmh >= 1 && `${Math.round(sub.speed_kmh)} km/h`,
    sel && `Τρένο ${sel.id}`, "Hellenic Train",
  ].filter(Boolean).join(" · "));

  const runOf = (r: FetchResult | undefined) => {
    const b = r?.body as { stops?: unknown } | null;
    return r?.status === 200 && Array.isArray(b?.stops) ? (b as StasyTrip | SuburbanRun) : null;
  };

  $effect(() => {
    const t = sel;
    if (!t) return;
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    run = runOf(peekTrainRun(t.kind, t.id));   // loaded already by the map: shown at once
    failed = false;
    const load = async () => {
      if (busy) return;
      clearTimeout(timer);
      if (document.visibilityState !== "hidden") {
        busy = true;
        const r = await fetchTrainRun(t.kind, t.id);
        busy = false;
        if (ac.signal.aborted) return;
        const got = runOf(r);
        if (got) { run = got; failed = false; }
        else failed = !run;   // keep the last run through a failed refresh
      }
      timer = setTimeout(load, REFRESH_MS);
    };
    const shown = () => { if (document.visibilityState === "visible") load(); };
    load();
    document.addEventListener("visibilitychange", shown);
    return () => { ac.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", shown); };
  });

  // The next stop in view (the last one when the run is over), only when it changes: the rows follow
  // the clock, and a list scrolled by hand stays where it is.
  const nextAt = $derived.by(() => { const i = rows.findIndex(r => r.next); return i < 0 ? rows.length - 1 : i; });
  function toNext(node: HTMLElement) {
    $effect(() => {
      if (nextAt < 0) return;
      const li = node.children[Math.min(nextAt, node.children.length - 1)] as HTMLElement | undefined;
      if (li) node.scrollTop = Math.max(0, li.offsetTop - node.offsetTop - 28);
    });
  }
</script>

<svelte:window onkeydown={e => { if (e.key === "Escape" && app.train) app.selectTrain(null); }} />

{#if sel}
  <section class="card" aria-live="polite" aria-label="Τρένο προς {to}">
    <header>
      {#if lineSel}
        <button type="button" class="chip" style:--accent={color} title="Η γραμμή και τα τρένα της" aria-label="Γραμμή {label}: τα τρένα της"
          onclick={() => app.selectRailLine(lineSel)}>{label}</button>
      {:else}
        <b class="chip" style:--accent={color}>{label}</b>
      {/if}
      <h2>→ {to || "…"}</h2>
      <button type="button" class="close" aria-label="Κλείσιμο" onclick={() => app.selectTrain(null)}>×</button>
    </header>
    {#if sel.kind === "metro"}
      <p class="src">Θέση κατά προσέγγιση, από το πρόγραμμα της ΣΤΑΣΥ, όχι live.</p>
    {:else}
      <p class="src">{#if delay}<b class="late">Καθυστέρηση {delay > 0 ? "+" : ""}{delay}′</b>{" · "}{/if}{gps}</p>
    {/if}
    {#if rows.length}
      <ol class="stops" aria-label="Στάσεις" use:toNext>
        {#each rows as r, i (i)}
          <li class:gone={r.gone} class:next={r.next}><span class="t">{r.t}</span><span class="name">{r.name}</span></li>
        {/each}
      </ol>
    {:else if run}
      <p>Χωρίς στάσεις στο πρόγραμμα.</p>
    {:else if failed}
      <p>Δεν φόρτωσαν οι στάσεις του τρένου.</p>
    {:else}
      <p>Φόρτωση στάσεων…</p>
    {/if}
  </section>
{/if}

<style>
  .card { position: absolute; z-index: 6; left: 12px; bottom: 28px; width: 340px; padding: 12px 14px;
    background: var(--panel); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow);
    backdrop-filter: blur(8px); }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  h2 { flex: 1; margin: 0; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chip { flex: none; min-width: 30px; padding: 2px 6px; border: 0; border-radius: 6px; background: var(--accent); color: #fff;
    font: inherit; font-size: 12px; font-weight: 700; text-align: center; }
  button.chip { min-height: 28px; cursor: pointer; }
  p { margin: 0 0 8px; color: var(--muted); font-size: 12px; }
  .src { font-size: 11px; }
  .late { color: var(--late2); }
  .stops { list-style: none; margin: 0; padding: 0; max-height: 168px; overflow-y: auto; }
  .stops li { display: flex; gap: 10px; min-height: 26px; align-items: center; font-size: 13px; }
  .stops .t { flex: none; font-variant-numeric: tabular-nums; font-weight: 600; }
  .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .stops li.gone { color: var(--muted); }
  .stops li.gone .t { font-weight: 400; }
  .stops li.next { font-weight: 700; }
  .close { width: 36px; height: 36px; margin: -8px -10px -8px 0; border: 0; background: none; font-size: 22px;
    color: var(--muted); cursor: pointer; border-radius: 8px; }
  .close:hover { background: var(--control); }
  @media (max-width: 719px) {
    .card { left: 0; right: 0; bottom: 0; width: auto; border-radius: 16px 16px 0 0; border-width: 1px 0 0;
      padding: 14px 16px calc(14px + env(safe-area-inset-bottom)); }
  }
</style>
