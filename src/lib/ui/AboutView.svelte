<script lang="ts">
  // Version and «Τι νέο» under the feedback form: the web's GitHub Releases, loaded the first time
  // the tab is shown. The newest one is open, the older ones fold.
  import { dayMonth } from "../format";
  import { RELEASES_PAGE, fetchReleases, type Release } from "../releases";
  import { VERSION } from "../version";

  let releases = $state<Release[] | null>(null);
  let failed = $state(false);
  fetchReleases().then(r => (releases = r), () => (failed = true));
</script>

<section aria-labelledby="whatsnew-title">
  <p class="ver">Έκδοση <b>{VERSION}</b></p>
  <h3 id="whatsnew-title">Τι νέο</h3>
  {#if failed}
    <p class="muted">Δεν φορτώθηκαν. <a href={RELEASES_PAGE} target="_blank" rel="noopener">Δες τες στο GitHub ›</a></p>
  {:else if !releases}
    <p class="muted">Φόρτωση…</p>
  {:else if !releases.length}
    <p class="muted">Καμία έκδοση ακόμα.</p>
  {:else}
    {#each releases as r, i (r.tag)}
      <details open={i === 0}>
        <summary><span class="tag">{r.tag}</span> {r.title} <span class="muted">· {dayMonth(r.date)}</span></summary>
        {#if r.notes.length}<ul>{#each r.notes as n, j (j)}<li>{n}</li>{/each}</ul>{/if}
      </details>
    {/each}
    <a class="all" href={RELEASES_PAGE} target="_blank" rel="noopener">Όλες οι εκδόσεις ›</a>
  {/if}
</section>

<style>
  section { margin-top: 20px; padding-top: 14px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 6px; }
  h3 { margin: 4px 0 0; font-size: 15px; }
  p { margin: 0; }
  .ver { font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .ver b { color: var(--fg); font-weight: 600; }
  .muted { color: var(--muted); font-size: 13px; }
  details { border-radius: 10px; background: var(--control); padding: 8px 10px; }
  summary { cursor: pointer; font-size: 14px; font-weight: 600; min-height: 28px; display: list-item; }
  .tag { font-variant-numeric: tabular-nums; }
  ul { margin: 6px 0 2px; padding-left: 20px; font-size: 14px; }
  li { margin: 2px 0; }
  a { color: inherit; }
  .all { font-size: 13px; }
</style>
