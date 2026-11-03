<script lang="ts">
  // A card's service disruptions (disruptions.ts), one short row each: «⚠ Εκτροπή 724 · 2/11–3/11   ΟΑΣΑ ›».
  // The whole row opens the notice: the title alone does not say what changes (contract). lines: the card's lines;
  // a stop card names which of them the notice is about.
  import { dateRange, shortTitle, type Disruption } from "../disruptions";

  let { alerts, lines = [] }: { alerts: Disruption[]; lines?: string[] } = $props();
  const native = (id: string) => id.slice(id.indexOf(":") + 1);
  const MAX = 3;
</script>

{#if alerts.length}
  <ul class="dis" aria-label="Ανακοινώσεις">
    {#each alerts.slice(0, MAX) as a (a.id)}
      {@const which = a.lines.filter(l => lines.includes(l)).map(native).join(", ")}
      {@const when = dateRange(a)}
      <li><a href={a.url} target="_blank" rel="noopener" title={a.title}
        aria-label="{a.title}{when ? `, ${when}` : ""}. Ανακοίνωση{a.source === "oasa" ? " ΟΑΣΑ" : ""}, ανοίγει σε νέα καρτέλα">
        <span class="t"><span aria-hidden="true">⚠</span> {shortTitle(a)}{which ? ` ${which}` : ""}{when ? ` · ${when}` : ""}</span>
        <span class="src" aria-hidden="true">{a.source === "oasa" ? "ΟΑΣΑ" : "Πηγή"} ›</span>
      </a></li>
    {/each}
  </ul>
{/if}

<style>
  .dis { list-style: none; margin: 0 0 8px; padding: 0; }
  .dis li + li { margin-top: 4px; }
  a { display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 0 10px; border-radius: 8px; background: var(--warn-bg);
    color: var(--fg); font-size: 13px; text-decoration: none; }
  .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  .src { flex: none; color: var(--accent); font-size: 12px; font-weight: 600; }
  a:hover .t { text-decoration: underline; text-underline-offset: 3px; }
  a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @media (pointer: coarse) { a { min-height: 44px; } }
</style>
