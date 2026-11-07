<script lang="ts">
  // «Ακρίβεια των αφίξεων» (web#27): last week's error of our arrival times against the real
  // passes, up to 20′ out. Hidden when the file is missing or malformed.
  import { onMount } from "svelte";
  import { dayMonth } from "../format";
  import { accuracyCounts, fmtErr, loadAccuracy, type EtaAccuracy } from "../eta-accuracy";

  let a = $state<EtaAccuracy | null>(null);
  const c = $derived(a && accuracyCounts(a));
  onMount(() => { void loadAccuracy().then(r => (a = r)); });

  const nf = (n: number) => n.toLocaleString("el-GR");
  const range = (label: string) => label === "0-5′" ? "έως 5′" : label.replace("-", "–");
  const said = (b: EtaAccuracy["buckets"][number]) =>
    `Λεωφορείο που έρχεται σε ${range(b.label)}: συνήθως πέφτουμε έξω ${fmtErr(b.median_s)}, ${Math.round(100 * b.within_120)}% μέσα σε 2 λεπτά`;
</script>

{#if a}
  <section class="acc" aria-labelledby="acc-title">
    <h3 id="acc-title">Ακρίβεια των αφίξεων</h3>
    <p class="read">{dayMonth(a.from)}–{dayMonth(a.to)}: {nf(c!.measured)} προβλέψεις σε {a.stops} στάσεις, με λεωφορείο έως 20′ μακριά.</p>
    <div class="cols" aria-hidden="true"><span>Έρχεται σε</span><span>Συνήθως</span><span>Μέσα σε 2′</span></div>
    <ol>
      {#each a.buckets as b (b.label)}
        <li aria-label={said(b)}>
          <b>{range(b.label)}</b>
          <span class="v">±{fmtErr(b.median_s)}</span>
          <span class="v">{Math.round(100 * b.within_120)}%</span>
        </li>
      {/each}
    </ol>
    <p class="note">Η ώρα άφιξης που δείχνει ο χάρτης, μπροστά στην ώρα που πέρασε το λεωφορείο από τη στάση (GPS).
      «Συνήθως»: οι μισές προβλέψεις πέφτουν έξω λιγότερο. Πάνω από 20′ η πρόβλεψη είναι πιο χοντρική, γιατί το λεωφορείο
      συχνά δεν έχει ξεκινήσει ακόμα. Σε {c!.unseen_pct}% των προβλέψεων δεν είδαμε το λεωφορείο να περνά (συνήθως κενό στο GPS)
      και δεν μετράνε. Ανανεώνεται κάθε εβδομάδα.</p>
  </section>
{/if}

<style>
  section { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border); }
  h3 { margin: 0; font-size: 14px; }
  .read { margin: 6px 0; color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
  .note { margin: 6px 0 0; color: var(--muted); font-size: 12px; }
  .cols, li { display: grid; grid-template-columns: 80px 80px 80px; align-items: center; gap: 8px; }
  .cols { color: var(--muted); font-size: 11px; }
  .cols span:not(:first-child), .v { text-align: right; }
  ol { margin: 2px 0 0; padding: 0; list-style: none; }
  li { height: 24px; font-size: 13px; }
  li b { font-weight: 600; }
  .v { font-variant-numeric: tabular-nums; white-space: nowrap; }
</style>
