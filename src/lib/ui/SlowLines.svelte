<script lang="ts">
  // «Οι πιο αργές γραμμές»: mean start delay against OASA's daily schedule over 7 or LONG_DAYS days
  // (web#32). Shown only when some stored day has start_delay (LongTermView decides).
  import { LONG_DAYS, MIN_DELAY_RUNS, slowLines, type DayStats } from "../stats";

  let { days }: { days: DayStats[] } = $props();

  const WINDOWS = [7, LONG_DAYS];
  let win = $state(7);
  const r = $derived(slowLines(days, win, 10));
  const top = $derived(Math.max(60, ...r.rows.map(l => l.mean_s)));

  const nf = (n: number) => n.toLocaleString("el-GR");
  const mins = (s: number) => `${s < 0 ? "−" : ""}${(Math.abs(s) / 60).toLocaleString("el-GR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}′`;
  const said = (l: { line: string; mean_s: number; p90_min: number; runs: number }) =>
    `${l.line}: μέση καθυστέρηση ${mins(l.mean_s)}, 9 στις 10 κάτω από ${l.p90_min}′, ${l.runs} αναχωρήσεις`;
</script>

<section class="slow" aria-labelledby="slow-title">
  <div class="head">
    <h3 id="slow-title">Οι πιο αργές γραμμές</h3>
    <div class="seg" role="group" aria-label="Περίοδος">
      {#each WINDOWS as w (w)}
        <button type="button" aria-pressed={win === w} onclick={() => (win = w)}>{w} μέρες</button>
      {/each}
    </div>
  </div>
  {#if r.days === 0}
    <p class="muted">Καμία μέτρηση τις τελευταίες {win} μέρες.</p>
  {:else}
    <p class="read">Καθυστέρηση στην αφετηρία: {r.days} {r.days === 1 ? "μέρα" : "μέρες"} με μετρήσεις, {nf(r.runs)} αναχωρήσεις.</p>
    {#if r.rows.length}
      <div class="cols" aria-hidden="true"><span>Γραμμή</span><span>Μέση</span><span></span><span>9 στις 10</span><span>Αναχ.</span></div>
      <ol>
        {#each r.rows as l (l.line)}
          <li aria-label={said(l)} title={said(l)}>
            <b>{l.line}</b>
            <span class="v">{mins(l.mean_s)}</span>
            <span class="track"><span style:width="{(Math.max(0, l.mean_s) / top) * 100}%"></span></span>
            <span class="v">&lt; {l.p90_min}′</span>
            <span class="v">{nf(l.runs)}</span>
          </li>
        {/each}
      </ol>
    {:else}
      <p class="muted small">Καμία γραμμή με τουλάχιστον {MIN_DELAY_RUNS} μετρημένες αναχωρήσεις ακόμα.</p>
    {/if}
    <p class="note">Λεπτά που έφυγε το λεωφορείο από την αφετηρία μετά την ώρα του ημερήσιου προγράμματος του ΟΑΣΑ (μείον: νωρίτερα).
      «9 στις 10»: τόσες αναχωρήσεις έφυγαν με λιγότερη καθυστέρηση. Μετράνε μόνο αναχωρήσεις που είδαμε να ξεκινούν, και μόνο
      γραμμές με τουλάχιστον {MIN_DELAY_RUNS} ({r.eligible} {r.eligible === 1 ? "γραμμή" : "γραμμές"}).</p>
  {/if}
</section>

<style>
  section { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border); }
  .head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; }
  h3 { margin: 0; font-size: 14px; }
  .seg { display: inline-flex; border: 1px solid var(--border); border-radius: 18px; overflow: hidden; }
  .seg button { min-height: 32px; padding: 0 12px; border: 0; background: var(--control); color: inherit; font-size: 13px; cursor: pointer; }
  .seg button + button { border-left: 1px solid var(--border); }
  .seg button[aria-pressed="true"] { background: var(--accent); color: #fff; font-weight: 600; }
  .muted { color: var(--muted); }
  .small { margin: 0; font-size: 13px; }
  .read { margin: 6px 0; color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
  .note { margin: 6px 0 0; color: var(--muted); font-size: 12px; }
  .cols, li { display: grid; grid-template-columns: 44px 48px 1fr 52px 40px; align-items: center; gap: 8px; }
  .cols { color: var(--muted); font-size: 11px; }
  .cols span:not(:first-child), .v { text-align: right; }
  .cols span:first-child, li b { text-align: right; }
  ol { margin: 2px 0 0; padding: 0; list-style: none; }
  li { height: 24px; font-size: 13px; }
  .v { color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
  li .v:nth-of-type(1) { color: inherit; }
  .track { height: 10px; border-radius: 2px; background: var(--control); }
  .track span { display: block; height: 100%; border-radius: 2px; background: var(--late2); }
</style>
