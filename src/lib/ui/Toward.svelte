<script lang="ts">
  // Which way the buses leave a bus stop (towards.ts): a small compass arrow (north up) and «προς X · Y»,
  // so the stop of the same name across the road is told apart. Nothing when the index has no direction.
  import { towardsText } from "../towards";
  import { titleCase } from "../nearby";

  let { dir, sep = false }: { dir: { bearing: number | null; towards: string[] } | null; sep?: boolean } = $props();
  const text = $derived(dir ? titleCase(towardsText(dir.towards)) : "");   // the feed's capitals as names, accents back
</script>

{#if dir && (text || dir.bearing != null)}
  <span class="toward">{#if sep}{" · "}{/if}{#if dir.bearing != null}<svg class="arrow" viewBox="0 0 12 12" width="13" height="13"
      aria-hidden="true" style:transform="rotate({dir.bearing}deg)"><path d="M6 11V1.8M2.3 5.5 6 1.8l3.7 3.7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /></svg>{/if}{text}</span>
{/if}

<style>
  .toward { color: var(--muted); font-size: 0.85em; font-weight: 500; }
  .arrow { display: inline-block; vertical-align: -2px; margin-right: 3px; color: var(--accent); }
</style>
